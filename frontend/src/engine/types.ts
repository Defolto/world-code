// Типы лога кадров и уровня — зеркало simulator/runner.py и раздела 3
// архитектуры. Рендер не знает правил игры: он читает эти структуры и
// ничего не решает сам.

export type Dir = "right" | "left" | "up" | "down";

export interface HeroState {
  x: number;
  y: number;
  dir: Dir;
  hp: number;
  hp_max: number;
  energy: number;
  energy_max: number;
  coins: number;
}

/** Ворота: открыты ли и сколько ходов рядом ещё постоять (0 у открытых) */
export interface TileState {
  x: number;
  y: number;
  kind: string;
  state: "open" | "closed";
  left: number;
}

export interface WorldSnapshot {
  hero: HeroState;
  units: unknown[];
  items: unknown[];
  tiles: TileState[];
}

export type Outcome = "win" | "lose" | "timeout" | "error";

export type GameEvent =
  | { type: "move"; who: string; from: [number, number]; to: [number, number] }
  | { type: "blocked"; who: string; dir: Dir; into: string }
  | { type: "wait"; who: string }
  | { type: "level_end"; status: Outcome; reason: string | null };

export interface Frame {
  i: number;
  tick: number;
  line: number;
  /** Есть только в кадрах, где мир изменился */
  world?: WorldSnapshot;
  events: GameEvent[];
  vars?: Record<string, unknown>;
}

export interface RunError {
  type: string;
  message: string;
  line: number | null;
  human: string;
}

export interface Loadout {
  strength: number;
  agility: number;
  stamina: number;
  items: string[];
}

export interface FrameLog {
  version: number;
  level: string;
  seed: number;
  loadout: Loadout;
  outcome: { status: Outcome; reason: string | null };
  metrics: { ticks: number; lines: number; ast_nodes: number; repeats: number };
  checksum: string;
  frames: Frame[];
  error: RunError | null;
}

/** Уровень, каким он приходит в браузер: без solution и hints */
export interface Level {
  id: string;
  lesson: number;
  title: string;
  brief: string;
  map: { legend: Record<string, string>; grid: string };
  objects?: Record<string, { blocking?: boolean; waits_to_open?: number | null }>;
  api: string[];
  starter: string;
  goals: Array<{ reach?: [number, number]; stay_alive?: boolean }>;
  medals?: { short?: "auto" | number; clean?: "no_repeat" };
}

export const EMPTY_LOADOUT: Loadout = { strength: 0, agility: 0, stamina: 0, items: [] };
