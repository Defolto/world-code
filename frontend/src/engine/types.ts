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
  /** Урон за один удар */
  damage: number;
  coins: number;
}

/** Герой до первого снимка: derive() симулятора на пустом loadout. Зеркало
 *  simulator/world.py — до запуска лога нет, а HUD показать надо */
export const HERO_AT_START: Omit<HeroState, "x" | "y" | "dir"> = {
  hp: 20,
  hp_max: 20,
  energy: 20,
  energy_max: 20,
  damage: 3,
  coins: 0,
};

/** Ворота: открыты ли и сколько ходов рядом ещё постоять (0 у открытых).
 *  Преграды (яма, балка): на месте ли — случайные могут отсутствовать */
export interface TileState {
  x: number;
  y: number;
  kind: string;
  state: "open" | "closed" | "present" | "absent";
  left?: number;
}

/** Предмет на карте; поднятый остаётся в снимке с taken: true.
 *  Подделка ли он — в снимке нет: рендер узнаёт это только из `checked`,
 *  после того как герой проверил */
export interface ItemState {
  id: string;
  kind: string;
  x: number;
  y: number;
  taken: boolean;
  checked: "real" | "fake" | null;
}

export interface WorldSnapshot {
  hero: HeroState;
  units: unknown[];
  items: ItemState[];
  tiles: TileState[];
}

export type Outcome = "win" | "lose" | "timeout" | "error";

export type GameEvent =
  | { type: "move"; who: string; from: [number, number]; to: [number, number] }
  | { type: "blocked"; who: string; dir: Dir; into: string }
  | { type: "wait"; who: string }
  | { type: "pickup"; who: string; item: string; kind: string; fake: boolean }
  | { type: "nothing_to_take"; who: string }
  | { type: "no_energy"; who: string }
  /** Бесплатный запрос «настоящая ли монета»: без тика, но с кадром */
  | { type: "check"; who: string; item: string | null; result: "real" | "fake" | "none" }
  | { type: "hit"; who: string; by: string; amount: number; hp: number }
  | { type: "died"; who: string }
  /** Бесплатный запрос «можно ли шагнуть туда» */
  | { type: "check_move"; who: string; dir: Dir; at: [number, number]; result: boolean }
  | { type: "jump"; who: string; from: [number, number]; to: [number, number]; over: string }
  | { type: "crawl"; who: string; from: [number, number]; to: [number, number]; over: string }
  | { type: "cannot_jump"; who: string; dir: Dir; into: string }
  | { type: "cannot_crawl"; who: string; dir: Dir; into: string }
  /** Герой произнёс значение; opened — запертые ворота, которые от этого открылись */
  | { type: "say"; who: string; text: string; opened: Array<[number, number]> }
  /** Посмотрел под ноги, не поднимая: что там (False — пусто) */
  | { type: "look"; who: string; item: string | null; value: boolean | string | number }
  /** Второй тяжёлый предмет в руки не влез */
  | { type: "hands_full"; who: string; item: string }
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
  /** Мир до первой команды: каких случайных преград в этом прогоне нет */
  initial: WorldSnapshot;
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
  objects?: Record<
    string,
    {
      blocking?: boolean;
      waits_to_open?: number | null;
      password?: string | string[] | { subtract: [string, string] } | { max: string } | null;
      pickable?: boolean;
      reveals?: string | null;
      blank?: { count: number } | null;
      gives?: number[] | null;
      icon?: "coin" | "scroll" | "sack" | null;
      heavy?: boolean;
      fake?: { count: number; damage: number } | null;
      jumpable?: boolean;
      crawlable?: boolean;
      chance?: number | null;
      present?: { count: number } | null;
    }
  >;
  api: string[];
  starter: string;
  goals: Array<{ reach?: [number, number]; stay_alive?: boolean; collect?: string }>;
  medals?: { short?: "auto" | number; clean?: "no_repeat" };
}

export const EMPTY_LOADOUT: Loadout = { strength: 0, agility: 0, stamina: 0, items: [] };
