// Плеер демки. Живёт вне React: React создаёт его один раз и получает
// обратно только редкие события (сменилась строка, изменились монеты).
//
// Правило, ради которого он написан именно так: позиция — чистая функция
// от времени. Никаких очередей твинов и CSS-переходов, каждый кадр мы
// спрашиваем «сколько сейчас времени» и считаем всё заново. Иначе
// перемотка и ускорение, которые появятся в настоящем плеере, сломаются.

import {
  COIN_COL,
  GOBLIN_COL,
  GOBLIN_HITS,
  SCRIPT,
  TOTAL_MS,
  type Step,
} from "./demoScript";

export const CELL = 44;
export const COLS = 9;
export const ROWS = 5;
export const ROW = 2;

export interface SceneRefs {
  hero: SVGGElement;
  heroArm: SVGGElement;
  heroBody: SVGGElement;
  // Суставы ходьбы. Позы — данные, как в tehnicheskaya-arhitektura.md:
  // ноги в противофазе, задняя рука — в противофазе передней.
  heroArmBack: SVGGElement;
  heroLegFront: SVGGElement;
  heroLegBack: SVGGElement;
  goblin: SVGGElement;
  goblinHp: SVGRectElement;
  coin: SVGGElement;
  spark: SVGGElement;
}

export interface PlayerEvents {
  onLine(line: number): void;
  onCoins(coins: number): void;
}

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** Где мы внутри сценария в момент t (мс от начала цикла). */
function locate(t: number): { step: Step; p: number; index: number } {
  let acc = 0;
  for (let i = 0; i < SCRIPT.length; i++) {
    const step = SCRIPT[i];
    if (t < acc + step.dur) {
      return { step, p: (t - acc) / step.dur, index: i };
    }
    acc += step.dur;
  }
  const last = SCRIPT[SCRIPT.length - 1];
  return { step: last, p: 1, index: SCRIPT.length - 1 };
}

/** Сколько ударов уже прилетело гоблину к моменту t. */
function hitsLanded(index: number, p: number): number {
  let landed = 0;
  for (let i = 0; i <= index; i++) {
    const step = SCRIPT[i];
    if (step.kind !== "attack") continue;
    // Удар засчитывается в середине замаха, а не в его конце
    if (i < index || p >= 0.55) landed++;
  }
  return landed;
}

export class DemoPlayer {
  private raf = 0;
  private start = 0;
  private lastLine = -1;
  private lastCoins = -1;

  constructor(
    private readonly refs: SceneRefs,
    private readonly events: PlayerEvents,
  ) {}

  play() {
    this.start = performance.now();
    const tick = (now: number) => {
      this.drawAt((now - this.start) % TOTAL_MS);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  /** Статичный кадр — для тех, кто просил уменьшить анимацию. */
  drawStill() {
    this.drawAt(TOTAL_MS - 200);
  }

  private drawAt(t: number) {
    const { step, p, index } = locate(t);
    const { refs } = this;

    // --- Положение героя: одно translate на внешней группе ---
    let col = "col" in step ? step.col : 0;
    let lean = 0;
    let armAngle = 8;
    let legAngle = 0;
    let bob = 0;

    if (step.kind === "move") {
      const e = easeInOut(p);
      col = step.fromCol + (step.toCol - step.fromCol) * e;
      // Фаза шага — тоже функция от прогресса, не отдельная анимация
      const phase = Math.sin(p * Math.PI * 2);
      armAngle = 8 + phase * 26;
      legAngle = phase * 22;
      bob = Math.abs(Math.sin(p * Math.PI)) * -1.6;
    } else if (step.kind === "attack") {
      // Ключевые кадры замаха: 0 → -72° → +58° → 0
      if (p < 0.35) armAngle = 8 + (-72 - 8) * (p / 0.35);
      else if (p < 0.55) armAngle = -72 + (58 + 72) * ((p - 0.35) / 0.2);
      else armAngle = 58 + (8 - 58) * ((p - 0.55) / 0.45);
      lean = p < 0.35 ? -4 * (p / 0.35) : 5 * (1 - (p - 0.35) / 0.65);
    } else if (step.kind === "take") {
      armAngle = 8 - 60 * Math.sin(Math.min(p / 0.5, 1) * Math.PI);
      bob = -Math.sin(Math.min(p / 0.5, 1) * Math.PI) * 2;
    }

    const x = col * CELL + CELL / 2;
    const y = ROW * CELL + CELL / 2 + bob;
    refs.hero.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    refs.heroBody.setAttribute("transform", `rotate(${lean.toFixed(2)})`);
    refs.heroArm.setAttribute("transform", `rotate(${armAngle.toFixed(2)})`);
    // Задняя рука качается зеркально передней вокруг покоя (8°), а в
    // замахе не участвует: бьёт одна рука.
    const armBack = step.kind === "move" ? 16 - armAngle : 8;
    refs.heroArmBack.setAttribute("transform", `rotate(${armBack.toFixed(2)})`);
    refs.heroLegFront.setAttribute("transform", `rotate(${legAngle.toFixed(2)})`);
    refs.heroLegBack.setAttribute("transform", `rotate(${(-legAngle).toFixed(2)})`);

    // --- Гоблин: полоса здоровья и смерть ---
    const landed = hitsLanded(index, p);
    const hp = Math.max(0, GOBLIN_HITS - landed);
    refs.goblinHp.setAttribute("width", String((hp / GOBLIN_HITS) * 26));

    if (hp === 0) {
      // Оседает и гаснет: короткое падение, дальше просто нет
      const deathP = Math.min(1, (t - this.timeOfDeath()) / 300);
      refs.goblin.style.opacity = String(1 - deathP);
      refs.goblin.setAttribute(
        "transform",
        `translate(${GOBLIN_COL * CELL + CELL / 2} ${ROW * CELL + CELL / 2}) ` +
          `translate(0 ${(deathP * 6).toFixed(2)}) scale(1 ${(1 - deathP * 0.4).toFixed(2)})`,
      );
    } else {
      refs.goblin.style.opacity = "1";
      refs.goblin.setAttribute(
        "transform",
        `translate(${GOBLIN_COL * CELL + CELL / 2} ${ROW * CELL + CELL / 2})`,
      );
    }

    // --- Вспышка удара в момент попадания ---
    const striking = step.kind === "attack" && p >= 0.5 && p < 0.72;
    refs.spark.style.opacity = striking ? String(1 - (p - 0.5) / 0.22) : "0";

    // --- Монета ---
    const taken = step.kind === "take" ? p > 0.45 : step.kind === "hold";
    refs.coin.style.opacity = taken ? "0" : "1";
    const coinFloat = Math.sin(t / 420) * 2;
    refs.coin.setAttribute(
      "transform",
      `translate(${COIN_COL * CELL + CELL / 2} ${(ROW * CELL + CELL / 2 + coinFloat).toFixed(2)})`,
    );

    // --- Наверх уходят только изменения, не каждый кадр ---
    if (step.line !== this.lastLine) {
      this.lastLine = step.line;
      this.events.onLine(step.line);
    }
    const coins = taken ? 1 : 0;
    if (coins !== this.lastCoins) {
      this.lastCoins = coins;
      this.events.onCoins(coins);
    }
  }

  /** Момент цикла, в который гоблин умирает — нужен для затухания. */
  private timeOfDeath(): number {
    let acc = 0;
    let landed = 0;
    for (const step of SCRIPT) {
      if (step.kind === "attack") {
        landed++;
        if (landed === GOBLIN_HITS) return acc + step.dur * 0.55;
      }
      acc += step.dur;
    }
    return 0;
  }
}
