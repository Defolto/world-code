// Плеер лога кадров. Живёт вне React: компонент создаёт его один раз и
// получает обратно только редкие события (сменился кадр, прогон закончен).
//
// Правило, на котором всё держится: позиция — чистая функция от времени.
// Каждый кадр браузера мы спрашиваем «сколько сейчас времени на плёнке»,
// находим кадр лога и прогресс внутри него и считаем всё заново. Поэтому
// шаг назад — это просто другое время, ускорение — деление времени, а
// прыжок в любую точку не оставляет за собой недоигранных анимаций.

import type { Dir, Frame, FrameLog, TileState } from "../engine/types";
import { CELL, gateKey } from "./grid";

// Длительности — данные. Тик мира и длительность анимации связаны этой
// таблицей, а не формулой: мгновенные действия не должны выглядеть
// зависанием, а долгие — пролетать незаметно.
export const TIMINGS = {
  move: 450,
  // Ожидание длится как шаг: один ход — одно и то же время на экране
  wait: 450,
  blocked: 320,
  // Строка без действия: видна ровно столько, чтобы подсветка успела мигнуть
  line: 120,
  // Финальный кадр держится, чтобы конец не обрывал шаг
  end: 400,
} as const;

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export interface SceneRefs {
  hero: SVGGElement;
  body: SVGGElement;
  armFront: SVGGElement;
  armBack: SVGGElement;
  legFront: SVGGElement;
  legBack: SVGGElement;
  /** Ворота по ключу "x-y" — группы с data-state и счётчиком */
  gates: Map<string, SVGGElement>;
}

export interface PlayerEvents {
  /** Сменился кадр лога — подсветить строку, обновить переменные */
  onFrame(frame: Frame): void;
  onPlaying(playing: boolean): void;
  /** Плёнка дошла до конца */
  onEnd(): void;
}

/** Всё, что нужно знать о кадре, чтобы нарисовать его за O(1) */
interface Segment {
  frame: Frame;
  start: number;
  dur: number;
  /** Где герой стоял до кадра и где стоит после */
  from: [number, number];
  to: [number, number];
  /** Вид сбоку: только вправо или влево, вверх и вниз наследуют прошлое */
  facing: "right" | "left";
  action: "move" | "blocked" | "wait" | "none";
  dir: Dir;
  /** Ворота на момент кадра: из его снимка или из ближайшего предыдущего */
  tiles: TileState[];
}

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const easeIn = (p: number) => p * p;
const easeOut = (p: number) => 1 - (1 - p) ** 2;

const DELTA: Record<Dir, [number, number]> = {
  right: [1, 0],
  left: [-1, 0],
  up: [0, -1],
  down: [0, 1],
};

function buildSegments(log: FrameLog, start: [number, number], gates: TileState[]): Segment[] {
  const segments: Segment[] = [];
  let pos = start;
  let facing: "right" | "left" = "right";
  let tiles = gates;
  let t = 0;
  for (const frame of log.frames) {
    let action: Segment["action"] = "none";
    let dir: Dir = facing;
    let dur: number = TIMINGS.line;
    let to = pos;
    for (const ev of frame.events) {
      if (ev.type === "move") {
        action = "move";
        to = ev.to;
        dur = TIMINGS.move;
      } else if (ev.type === "blocked") {
        action = "blocked";
        dir = ev.dir;
        dur = TIMINGS.blocked;
      } else if (ev.type === "wait") {
        action = "wait";
        dur = TIMINGS.wait;
      } else if (ev.type === "level_end") {
        dur = TIMINGS.end;
      }
    }
    if (frame.world) {
      const d = frame.world.hero.dir;
      if (d === "left" || d === "right") facing = d;
      dir = d;
      tiles = frame.world.tiles;
    }
    segments.push({ frame, start: t, dur, from: pos, to, facing, action, dir, tiles });
    pos = to;
    t += dur;
  }
  return segments;
}

export class LevelPlayer {
  private segments: Segment[];
  private total: number;
  private t = 0;
  private playing = false;
  private speed: Speed = 1;
  private raf = 0;
  private lastNow = 0;
  private lastIndex = -1;

  constructor(
    log: FrameLog,
    start: [number, number],
    gates: TileState[],
    private readonly refs: SceneRefs,
    private readonly events: PlayerEvents,
  ) {
    this.segments = buildSegments(log, start, gates);
    this.total = this.segments.reduce((s, seg) => s + seg.dur, 0);
    this.draw();
  }

  /** Статичный кадр до всякого прогона: герой на старте, ворота как в уровне */
  static drawIdle(refs: SceneRefs, start: [number, number], gates: TileState[]) {
    placeHero(refs, start[0], start[1], 0, "right", { walk: 0, phase: 0, bob: 0 });
    placeGates(refs, gates);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get isPlaying() {
    return this.playing;
  }

  get frameIndex() {
    return this.locate(this.t).index;
  }

  get frameCount() {
    return this.segments.length;
  }

  play() {
    if (this.playing) return;
    if (this.t >= this.total) this.t = 0;
    this.playing = true;
    this.events.onPlaying(true);
    this.lastNow = performance.now();
    const tick = (now: number) => {
      this.t += (now - this.lastNow) * this.speed;
      this.lastNow = now;
      if (this.t >= this.total) {
        this.t = this.total;
        this.draw();
        this.pause();
        this.events.onEnd();
        return;
      }
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.events.onPlaying(false);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
  }

  /** Шаг назад — это frames[i-1], а не откат мира. Начало текущего кадра
   *  и есть конец предыдущего, поэтому откуда бы мы ни стояли внутри
   *  кадра — уходим на итог предыдущего. */
  stepBack() {
    this.pause();
    const { index } = this.locate(this.t);
    if (index === 0) this.seekStart();
    else this.seekFrame(index - 1);
  }

  /** Посреди кадра — доиграть его до конца; с конца — на итог следующего */
  stepForward() {
    this.pause();
    const { index, p } = this.locate(this.t);
    const target = p < 0.98 ? index : index + 1;
    this.seekFrame(Math.min(this.segments.length - 1, target));
  }

  /** Встать на итог кадра i: герой уже дошёл, подсветка на его строке */
  seekFrame(i: number) {
    const seg = this.segments[i];
    if (!seg) return;
    // Конец кадра минус чуть-чуть, чтобы не перескочить в следующий
    this.t = Math.min(this.total, seg.start + seg.dur - 0.001);
    this.draw();
  }

  seekStart() {
    this.pause();
    this.t = 0;
    this.draw();
  }

  private locate(t: number): { index: number; p: number } {
    // Кадров могут быть тысячи (циклы), поэтому двоичный поиск
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid].start <= t) lo = mid;
      else hi = mid - 1;
    }
    const seg = this.segments[lo];
    const p = seg.dur > 0 ? Math.min(1, (t - seg.start) / seg.dur) : 1;
    return { index: lo, p };
  }

  private draw() {
    const { index, p } = this.locate(this.t);
    const seg = this.segments[index];
    if (!seg) return;

    let x = seg.to[0];
    let y = seg.to[1];
    let bumpX = 0;
    let bumpY = 0;
    let walk = 0;
    let phase = 0;
    let bob = 0;

    if (seg.action === "move") {
      // Разгон только в первом шаге пробежки, торможение — в последнем.
      // Ease на каждой клетке давал остановку через шаг: герой семенил.
      const prev = this.segments[index - 1];
      const next = this.segments[index + 1];
      const first = prev?.action !== "move";
      const last = next?.action !== "move";
      const e = first && last ? easeInOut(p) : first ? easeIn(p) : last ? easeOut(p) : p;
      x = seg.from[0] + (seg.to[0] - seg.from[0]) * e;
      y = seg.from[1] + (seg.to[1] - seg.from[1]) * e;
      walk = Math.min(1, first ? p * 3 : 1, last ? (1 - p) * 3 : 1);
      phase = Math.sin(p * Math.PI * 2);
      bob = -(Math.sin(p * Math.PI * 2) ** 2) * 1.4;
    } else if (seg.action === "blocked") {
      // Короткий тычок в сторону стены и назад: событие, а не ошибка
      const [dx, dy] = DELTA[seg.dir];
      const k = Math.sin(Math.min(1, p / 0.7) * Math.PI) * 0.18;
      bumpX = dx * k;
      bumpY = dy * k;
    } else if (seg.action === "wait") {
      // Герой стоит и дышит: видно, что время идёт, а он — нет
      bob = -Math.sin(p * Math.PI) * 1.2;
    }

    placeHero(this.refs, x + bumpX, y + bumpY, bob, seg.facing, { walk, phase, bob });

    if (index !== this.lastIndex) {
      this.lastIndex = index;
      // Ворота меняются только между кадрами — переход между состояниями рисует CSS
      placeGates(this.refs, seg.tiles);
      this.events.onFrame(seg.frame);
    }
  }
}

function placeGates(refs: SceneRefs, tiles: TileState[]) {
  for (const tile of tiles) {
    const el = refs.gates.get(gateKey(tile.x, tile.y));
    if (!el) continue;
    el.setAttribute("data-state", tile.state);
    const badge = el.querySelector("[data-left]");
    if (badge) badge.textContent = String(tile.left);
  }
}

function placeHero(
  refs: SceneRefs,
  cx: number,
  cy: number,
  bob: number,
  facing: "right" | "left",
  pose: { walk: number; phase: number; bob: number },
) {
  const px = cx * CELL + CELL / 2;
  const py = cy * CELL + CELL / 2 + bob;
  const flip = facing === "left" ? " scale(-1 1)" : "";
  refs.hero.setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)})${flip}`);

  // Одна клетка — один полный шаг обеими ногами. Рука идёт против своей
  // ноги, иначе походка «на ходулях». Задняя рука — против передней, но
  // её мах смещён вперёд: она за торсом и из-за спины не должна вылезать.
  const legAngle = -pose.phase * 26;
  const armAngle = 8 + pose.phase * 24;
  const armBack = 8 - 22 * pose.walk - (armAngle - 8) * 1.1;
  const lean = 3 * pose.walk;
  refs.body.setAttribute("transform", `rotate(${lean.toFixed(2)})`);
  refs.armFront.setAttribute("transform", `rotate(${armAngle.toFixed(2)})`);
  refs.armBack.setAttribute("transform", `rotate(${armBack.toFixed(2)})`);
  refs.legFront.setAttribute("transform", `rotate(${legAngle.toFixed(2)})`);
  refs.legBack.setAttribute("transform", `rotate(${(-legAngle).toFixed(2)})`);
}
