// Плеер лога кадров. Живёт вне React: компонент создаёт его один раз и
// получает обратно только редкие события (сменился кадр, прогон закончен).
//
// Правило, на котором всё держится: позиция — чистая функция от времени.
// Каждый кадр браузера мы спрашиваем «сколько сейчас времени на плёнке»,
// находим кадр лога и прогресс внутри него и считаем всё заново. Поэтому
// шаг назад — это просто другое время, ускорение — деление времени, а
// прыжок в любую точку не оставляет за собой недоигранных анимаций.

import { HERO_AT_START, type Dir, type Frame, type FrameLog, type HeroState, type ItemState, type TileState } from "../engine/types";
import { CELL, gateKey } from "./grid";

// Длительности — данные. Тик мира и длительность анимации связаны этой
// таблицей, а не формулой: мгновенные действия не должны выглядеть
// зависанием, а долгие — пролетать незаметно.
export const TIMINGS = {
  move: 450,
  // Ожидание длится как шаг: один ход — одно и то же время на экране
  wait: 450,
  blocked: 320,
  // Нагнуться за предметом (или за пустотой)
  take: 380,
  // Приглядеться к монете или в сторону: короче шага — это не ход, а взгляд
  check: 300,
  // Прыжок через клетку: дольше шага — герой летит две
  jump: 620,
  // Проползти две клетки под балкой: медленнее прыжка
  crawl: 800,
  // Отшатнуться от подделки
  hit: 420,
  // Упасть: последнее, что видно
  died: 600,
  // Замереть без сил
  tired: 380,
  // Сказать слово: пузырь должен успеть прочитаться
  say: 900,
  // Посмотреть под ноги: мысль короче слова
  peek: 700,
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
  /** Предметы по ключу "x-y" — группы с data-state lying/taken */
  items: Map<string, SVGGElement>;
  /** Слой маршрута под героем: плеер рисует в него сам */
  route: SVGGElement;
  /** Пузырь речи: плеер ставит текст и место */
  bubble: SVGGElement;
}

export interface PlayerEvents {
  /** Сменился кадр лога — подсветить строку, обновить переменные и HUD.
   *  hero — из снимка кадра или ближайшего предыдущего */
  onFrame(frame: Frame, hero: HeroState): void;
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
  action:
    | "move"
    | "blocked"
    | "wait"
    | "take"
    | "check"
    | "look"
    | "jump"
    | "crawl"
    | "hit"
    | "died"
    | "tired"
    | "say"
    | "peek"
    | "none";
  /** Герой уже погиб к началу кадра — лежит, что бы ни было в кадре */
  dead: boolean;
  dir: Dir;
  /** Ворота и предметы на момент кадра: из его снимка или из ближайшего предыдущего */
  tiles: TileState[];
  items: ItemState[];
  hero: HeroState;
  /** Сколько клеток герой уже прошёл к началу кадра — длина пройденного маршрута */
  moves: number;
  /** Куда смотрел can_move и что увидел — для отметки на маршруте */
  look?: { at: [number, number]; ok: boolean };
  /** Что сказал герой — или что подумал, глядя под ноги */
  said?: string;
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

function buildSegments(
  log: FrameLog,
  start: [number, number],
  gates: TileState[],
  startItems: ItemState[],
): Segment[] {
  const segments: Segment[] = [];
  let pos = start;
  let facing: "right" | "left" = "right";
  let tiles = gates;
  let items = startItems;
  let hero: HeroState = { x: start[0], y: start[1], dir: "right", ...HERO_AT_START };
  // Случайные преграды, которых в этом прогоне нет, известны до первого кадра
  if (log.initial) {
    tiles = log.initial.tiles;
    items = log.initial.items;
  }
  let t = 0;
  let moves = 0;
  let dead = false;
  for (const frame of log.frames) {
    let action: Segment["action"] = "none";
    let dir: Dir = facing;
    let dur: number = TIMINGS.line;
    let to = pos;
    let look: Segment["look"];
    let said: string | undefined;
    for (const ev of frame.events) {
      if (ev.type === "move") {
        action = "move";
        to = ev.to;
        dur = TIMINGS.move;
      } else if (ev.type === "jump" || ev.type === "crawl") {
        action = ev.type;
        to = ev.to;
        dur = TIMINGS[ev.type];
      } else if (ev.type === "blocked" || ev.type === "cannot_jump" || ev.type === "cannot_crawl") {
        // Не та преграда или некуда прыгать — тот же тычок, что и в стену
        action = "blocked";
        dir = ev.dir;
        dur = TIMINGS.blocked;
      } else if (ev.type === "say") {
        action = "say";
        said = ev.text;
        dur = TIMINGS.say;
      } else if (ev.type === "look") {
        action = "peek";
        said = ev.value === false ? "…" : ev.value === true ? "!" : String(ev.value);
        dur = TIMINGS.peek;
      } else if (ev.type === "hands_full") {
        // Нагнулся, не поднял — как за пустотой
        action = "take";
        dur = TIMINGS.take;
      } else if (ev.type === "check_move") {
        action = "look";
        dir = ev.dir;
        look = { at: ev.at, ok: ev.result };
        dur = TIMINGS.check;
      } else if (ev.type === "wait") {
        action = "wait";
        dur = TIMINGS.wait;
      } else if (ev.type === "pickup" || ev.type === "nothing_to_take") {
        action = "take";
        dur = TIMINGS.take;
      } else if (ev.type === "check") {
        action = "check";
        dur = TIMINGS.check;
      } else if (ev.type === "hit") {
        action = "hit";
        dur = TIMINGS.hit;
      } else if (ev.type === "died") {
        action = "died";
        dur = TIMINGS.died;
      } else if (ev.type === "no_energy") {
        action = "tired";
        dur = TIMINGS.tired;
      } else if (ev.type === "level_end") {
        dur = TIMINGS.end;
      }
    }
    if (frame.world) {
      const d = frame.world.hero.dir;
      if (d === "left" || d === "right") facing = d;
      dir = d;
      tiles = frame.world.tiles;
      items = frame.world.items;
      hero = frame.world.hero;
    }
    segments.push({ frame, start: t, dur, from: pos, to, facing, action, dir, tiles, items, hero, moves, dead, look, said });
    if (action === "move") moves += 1;
    if (action === "jump" || action === "crawl") moves += 2;
    if (action === "died") dead = true;
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
  /** Сплошная часть маршрута: пройденное. Длину открывает draw() через dashoffset */
  private routeDone: SVGPathElement | null = null;

  constructor(
    log: FrameLog,
    start: [number, number],
    gates: TileState[],
    items: ItemState[],
    private readonly refs: SceneRefs,
    private readonly events: PlayerEvents,
  ) {
    this.segments = buildSegments(log, start, gates, items);
    this.total = this.segments.reduce((s, seg) => s + seg.dur, 0);
    this.routeDone = drawRoute(refs.route, this.segments);
    this.draw();
  }

  /** Статичный кадр до всякого прогона: герой на старте, ворота, преграды и предметы как в уровне */
  static drawIdle(refs: SceneRefs, start: [number, number], gates: TileState[], items: ItemState[]) {
    placeHero(refs, start[0], start[1], 0, "right", { walk: 0, phase: 0, bob: 0, tilt: 0 });
    placeGates(refs, gates);
    placeItems(refs, items);
    refs.route.replaceChildren();
    refs.bubble.setAttribute("display", "none");
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
    // Наклон всего героя: удар отшатывает, смерть кладёт
    let tilt = 0;
    // Пройденная длина маршрута в клетках: шаги до кадра плюс доля текущего
    let travelled = seg.moves;

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
      travelled += e;
      walk = Math.min(1, first ? p * 3 : 1, last ? (1 - p) * 3 : 1);
      phase = Math.sin(p * Math.PI * 2);
      bob = -(Math.sin(p * Math.PI * 2) ** 2) * 1.4;
    } else if (seg.action === "jump") {
      // Дуга через клетку: разгон, полёт, приземление
      const e = easeInOut(p);
      x = seg.from[0] + (seg.to[0] - seg.from[0]) * e;
      y = seg.from[1] + (seg.to[1] - seg.from[1]) * e;
      travelled += 2 * e;
      bob = -Math.sin(p * Math.PI) * 26;
      walk = Math.sin(p * Math.PI);
      phase = 0.8;
    } else if (seg.action === "crawl") {
      // Пригнуться и проползти: ниже обычного, семенящий шаг
      const e = p;
      x = seg.from[0] + (seg.to[0] - seg.from[0]) * e;
      y = seg.from[1] + (seg.to[1] - seg.from[1]) * e;
      travelled += 2 * e;
      const crouch = Math.sin(Math.min(1, p / 0.15) * Math.PI / 2) * Math.sin(Math.min(1, (1 - p) / 0.15) * Math.PI / 2);
      bob = 9 * crouch;
      tilt = 14 * crouch;
      walk = crouch;
      phase = Math.sin(p * Math.PI * 4) * 0.6;
    } else if (seg.action === "look") {
      // Посмотреть в сторону: лёгкий наклон туда, куда спрашивали
      const [dx, dy] = DELTA[seg.dir];
      const k = Math.sin(p * Math.PI) * 0.06;
      bumpX = dx * k;
      bumpY = dy * k;
    } else if (seg.action === "blocked") {
      // Короткий тычок в сторону стены и назад: событие, а не ошибка
      const [dx, dy] = DELTA[seg.dir];
      const k = Math.sin(Math.min(1, p / 0.7) * Math.PI) * 0.18;
      bumpX = dx * k;
      bumpY = dy * k;
    } else if (seg.action === "wait") {
      // Герой стоит и дышит: видно, что время идёт, а он — нет
      bob = -Math.sin(p * Math.PI) * 1.2;
    } else if (seg.action === "take") {
      // Присесть за предметом и выпрямиться
      bob = Math.sin(Math.min(1, p / 0.8) * Math.PI) * 4;
    } else if (seg.action === "check") {
      // Наклониться, приглядеться — легче, чем за предметом
      bob = Math.sin(Math.min(1, p / 0.9) * Math.PI) * 2;
    } else if (seg.action === "hit") {
      // Отшатнуться назад и вздрогнуть
      const k = Math.sin(Math.min(1, p / 0.6) * Math.PI);
      bumpX = (seg.facing === "right" ? -1 : 1) * k * 0.15;
      tilt = -k * 18;
      bob = Math.sin(p * Math.PI * 5) * 1.2 * (1 - p);
    } else if (seg.action === "died") {
      // Упасть навзничь и остаться лежать
      const e = easeIn(Math.min(1, p / 0.7));
      tilt = -90 * e;
      bob = 14 * e;
    } else if (seg.action === "tired") {
      // Сил нет: герой оседает и дрожит, но с места не двигается
      bob = 3 + Math.sin(p * Math.PI * 6) * 0.8;
    } else if (seg.action === "say") {
      // Чуть приподняться — набрать воздуха
      bob = -Math.sin(Math.min(1, p / 0.3) * Math.PI / 2) * 1.5;
    } else if (seg.action === "peek") {
      // Наклониться, приглядеться
      bob = Math.sin(Math.min(1, p / 0.9) * Math.PI) * 2;
    }

    // Пузырь над героем: речь на кадре say, мысль — на look; во весь кадр
    const bubble = seg.action === "say" || seg.action === "peek" ? (seg.said ?? "") : null;
    placeBubble(this.refs, bubble, x + bumpX, y + bumpY, seg.action === "peek");

    // После смерти герой лежит на всех кадрах до конца плёнки
    if (seg.dead && seg.action !== "died") {
      tilt = -90;
      bob = 14;
    }
    placeHero(this.refs, x + bumpX, y + bumpY, bob, seg.facing, { walk, phase, bob, tilt });
    if (this.routeDone) {
      // Каждый шаг — ровно одна клетка, поэтому длина пути = шаги × CELL
      const total = Number(this.routeDone.dataset.length);
      this.routeDone.setAttribute("stroke-dashoffset", (total - travelled * CELL).toFixed(2));
    }

    if (index !== this.lastIndex) {
      this.lastIndex = index;
      // Ворота и предметы меняются только между кадрами — переходы рисует CSS
      placeGates(this.refs, seg.tiles);
      placeItems(this.refs, seg.items);
      this.events.onFrame(seg.frame, seg.hero);
    }
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const center = (c: number) => c * CELL + CELL / 2;

/**
 * Весь маршрут прогона сразу, до того как герой сделал первый шаг: код —
 * это план, и кривой план видно заранее. Пунктир — ломаная по центрам
 * клеток; поверх — сплошная копия, которую draw() открывает по мере
 * движения через stroke-dashoffset (перемотка и скорость — бесплатно).
 * Тычки в стену и остановки помечаются отдельно: без них самая частая
 * ошибка («три раза в стену») на пунктире не видна, а wait у ворот
 * выглядит как «просто прошёл». Возвращает сплошной путь или null,
 * если герой не сделал ни шага.
 */
function drawRoute(layer: SVGGElement, segments: Segment[]): SVGPathElement | null {
  layer.replaceChildren();
  const first = segments[0];
  if (!first) return null;

  let d = `M${center(first.from[0])} ${center(first.from[1])}`;
  let moves = 0;
  // Тычки по (клетка, направление) — один штрих на место, сколько бы раз
  // герой ни бился; остановки — по клетке, с суммой ходов; взгляды —
  // по клетке, последний ответ
  const bumps = new Set<string>();
  const waits = new Map<string, { x: number; y: number; n: number }>();
  const looks = new Map<string, { x: number; y: number; ok: boolean }>();
  for (const seg of segments) {
    if (seg.action === "move") {
      d += ` L${center(seg.to[0])} ${center(seg.to[1])}`;
      moves += 1;
    } else if (seg.action === "jump" || seg.action === "crawl") {
      // Прямая через преграду: маршрут показывает, куда попал, а не как
      d += ` L${center(seg.to[0])} ${center(seg.to[1])}`;
      moves += 2;
    } else if (seg.action === "look" && seg.look) {
      looks.set(`${seg.look.at[0]},${seg.look.at[1]}`, { x: seg.look.at[0], y: seg.look.at[1], ok: seg.look.ok });
    } else if (seg.action === "blocked") {
      bumps.add(`${seg.from[0]},${seg.from[1]},${seg.dir}`);
    } else if (seg.action === "wait") {
      const key = `${seg.from[0]},${seg.from[1]}`;
      const w = waits.get(key) ?? { x: seg.from[0], y: seg.from[1], n: 0 };
      w.n += 1;
      waits.set(key, w);
    }
  }

  let done: SVGPathElement | null = null;
  if (moves > 0) {
    const length = moves * CELL;
    layer.append(svgEl("path", { d, "data-plan": "" }));
    done = svgEl("path", {
      d,
      "data-done": "",
      "stroke-dasharray": length,
      "stroke-dashoffset": length,
      "data-length": length,
    });
    layer.append(done);
  }

  for (const key of bumps) {
    const [xs, ys, dir] = key.split(",");
    const [dx, dy] = DELTA[dir as Dir];
    const x0 = center(Number(xs));
    const y0 = center(Number(ys));
    // Штрих от центра к стене и крестик у самой стены
    const x1 = x0 + dx * (CELL / 2 - 4);
    const y1 = y0 + dy * (CELL / 2 - 4);
    const g = svgEl("g", { "data-bump": "" });
    g.append(svgEl("line", { x1: x0, y1: y0, x2: x1, y2: y1 }));
    g.append(svgEl("line", { x1: x1 - 4, y1: y1 - 4, x2: x1 + 4, y2: y1 + 4 }));
    g.append(svgEl("line", { x1: x1 - 4, y1: y1 + 4, x2: x1 + 4, y2: y1 - 4 }));
    layer.append(g);
  }

  for (const w of waits.values()) {
    const g = svgEl("g", { "data-wait": "", transform: `translate(${center(w.x)} ${center(w.y)})` });
    g.append(svgEl("circle", { r: 8 }));
    const text = svgEl("text", {});
    text.textContent = String(w.n);
    g.append(text);
    layer.append(g);
  }

  for (const l of looks.values()) {
    // В углу клетки, чтобы не спорить с маршрутом и преградой в центре
    const g = svgEl("g", {
      "data-look": l.ok ? "yes" : "no",
      transform: `translate(${center(l.x) + CELL / 2 - 10} ${center(l.y) - CELL / 2 + 10})`,
    });
    g.append(svgEl("circle", { r: 7.5 }));
    const text = svgEl("text", {});
    text.textContent = l.ok ? "✓" : "✗";
    g.append(text);
    layer.append(g);
  }
  return done;
}

function placeBubble(refs: SceneRefs, text: string | null, cx: number, cy: number, thought = false) {
  const g = refs.bubble;
  if (text === null) {
    g.setAttribute("display", "none");
    return;
  }
  if (thought) g.setAttribute("data-thought", "");
  else g.removeAttribute("data-thought");
  const label = g.querySelector("text");
  const box = g.querySelector("rect");
  if (!label || !box) return;
  if (label.textContent !== text) {
    label.textContent = text;
    // Ширина по тексту: моноширинный шрифт, ~7px на знак, плюс поля
    const w = Math.max(28, text.length * 7 + 16);
    box.setAttribute("x", String(-w / 2));
    box.setAttribute("width", String(w));
  }
  const px = cx * CELL + CELL / 2;
  const py = cy * CELL + CELL / 2 - 30;
  g.setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)})`);
  g.removeAttribute("display");
}

function placeItems(refs: SceneRefs, items: ItemState[]) {
  for (const item of items) {
    const el = refs.items.get(gateKey(item.x, item.y));
    if (!el) continue;
    el.setAttribute("data-state", item.taken ? "taken" : "lying");
    if (item.checked) el.setAttribute("data-check", item.checked);
    else el.removeAttribute("data-check");
  }
}

function placeGates(refs: SceneRefs, tiles: TileState[]) {
  for (const tile of tiles) {
    const el = refs.gates.get(gateKey(tile.x, tile.y));
    if (!el) continue;
    el.setAttribute("data-state", tile.state);
    const badge = el.querySelector("[data-left]");
    if (badge && tile.left != null) badge.textContent = String(tile.left);
  }
}

function placeHero(
  refs: SceneRefs,
  cx: number,
  cy: number,
  bob: number,
  facing: "right" | "left",
  pose: { walk: number; phase: number; bob: number; tilt: number },
) {
  const px = cx * CELL + CELL / 2;
  const py = cy * CELL + CELL / 2 + bob;
  const flip = facing === "left" ? " scale(-1 1)" : "";
  // Наклон идёт после отражения, поэтому отрицательный угол — всегда
  // «назад», куда бы герой ни смотрел
  const tilt = pose.tilt ? ` rotate(${pose.tilt.toFixed(2)})` : "";
  refs.hero.setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)})${flip}${tilt}`);

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
