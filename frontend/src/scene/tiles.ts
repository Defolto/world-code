// Автотайлинг: какую плитку рисовать в клетке, зависит от соседей.
//
// Чистые функции от карты. Здесь нет ни правил игры, ни SVG — только
// «стена ли сосед» и детерминированный хэш координат, чтобы пол не был
// монотонным, а одна и та же карта всегда выглядела одинаково.
//
// Вид — три четверти: пол видим сверху, у стены есть верхняя грань (cap)
// и лицевая (face), которая показывается там, где под стеной пол.

/** Биты маски соседей: N=1, E=2, S=4, W=8 — стена ли с той стороны */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export type IsWall = (x: number, y: number) => boolean;

/** Маска 0–15: какие из четырёх соседей — стены */
export function wallMask(isWall: IsWall, x: number, y: number): number {
  return (
    (isWall(x, y - 1) ? N : 0) |
    (isWall(x + 1, y) ? E : 0) |
    (isWall(x, y + 1) ? S : 0) |
    (isWall(x - 1, y) ? W : 0)
  );
}

/** Стена показывает лицевую грань, если прямо под ней не стена */
export function hasFace(isWall: IsWall, x: number, y: number): boolean {
  return !isWall(x, y + 1);
}

/**
 * За краем карты — стена. Так внешняя кладка не обводится снаружи и
 * читается как продолжение подземелья, а не как остров на пустом фоне.
 */
export function wallsOf(cols: number, rows: number, kinds: (x: number, y: number) => string | undefined): IsWall {
  return (x, y) => x < 0 || y < 0 || x >= cols || y >= rows || kinds(x, y) === "wall";
}

/** Детерминированный хэш координат в [0, 1): варианты пола и декали */
export function cellHash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
