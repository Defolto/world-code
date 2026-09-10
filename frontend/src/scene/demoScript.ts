// Сценарий демки на главной. Это уменьшённая копия того, чем позже станет
// настоящий лог кадров: список шагов, у каждого — строка кода и длительность.
// Рендер не знает правил, он умеет только проигрывать этот список.

export const CODE_LINES = [
  "for i in range(3):",
  "    hero.move_right()",
  "",
  "while hero.nearest_enemy():",
  "    hero.attack(hero.nearest_enemy())",
  "",
  "while hero.can_move_right():",
  "    hero.move_right()",
  "",
  "hero.take()",
] as const;

export type Step =
  | { kind: "move"; line: number; dur: number; fromCol: number; toCol: number }
  | { kind: "attack"; line: number; dur: number; col: number; hitsLeft: number }
  | { kind: "take"; line: number; dur: number; col: number }
  | { kind: "hold"; line: number; dur: number; col: number };

// Длительности — данные, как и в игре. Скорость меняется делением времени,
// а не правкой рендера.
const MOVE = 420;
const ATTACK = 520;
const TAKE = 460;

export const HERO_START_COL = 1;
export const GOBLIN_COL = 5;
export const COIN_COL = 7;
export const GOBLIN_HITS = 3;

function moves(line: number, from: number, count: number): Step[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "move" as const,
    line,
    dur: MOVE,
    fromCol: from + i,
    toCol: from + i + 1,
  }));
}

export const SCRIPT: Step[] = [
  // for i in range(3): три шага вправо, герой встаёт вплотную к гоблину
  ...moves(1, HERO_START_COL, 3),
  // while hero.nearest_enemy(): бьём, пока гоблин жив
  ...Array.from({ length: GOBLIN_HITS }, (_, i) => ({
    kind: "attack" as const,
    line: 4,
    dur: ATTACK,
    col: GOBLIN_COL - 1,
    hitsLeft: GOBLIN_HITS - i - 1,
  })),
  // while hero.can_move_right(): идём до монеты
  ...moves(7, GOBLIN_COL - 1, 3),
  { kind: "take", line: 9, dur: TAKE, col: COIN_COL },
  { kind: "hold", line: 9, dur: 1500, col: COIN_COL },
];

export const TOTAL_MS = SCRIPT.reduce((sum, step) => sum + step.dur, 0);
