import type { ReactNode } from "react";
import atlas from "../assets/tiles/dungeon.json";
import atlasUrl from "../assets/tiles/dungeon.png";
import { CELL, PAD } from "../scene/grid";
import { E, N, S, W, cellHash, wallMask, wallsOf, type IsWall } from "../scene/tiles";
import type { ParsedMap } from "./LevelScene";
import styles from "./Tiles.module.css";

/**
 * Пол и стены подземелья, вид сверху, из атласа плиток (tools/tiles.py).
 *
 * Стена — это масса скалы, а коридор в ней выложен тёсаным камнем:
 * облицовка одной ширины идёт вдоль каждой стороны стены, обращённой к
 * полу, — сверху, снизу, слева и справа одинаково. На внешнем углу
 * стены она поворачивает угловым блоком, на внутреннем углу коридора
 * (пол только по диагонали) — заполняет угол таким же блоком. Поэтому
 * стенам нужны и диагональные соседи: четырёх сторон для углов мало.
 *
 * В атласе — скала, три полосы (во всю клетку, при одном угле, между
 * двумя), угловой блок и варианты пола. Полосы нарисованы для верхней
 * стороны; остальные стороны — поворот и отражение. Тени на полу у стен,
 * валуны на скале и уход в темноту к краям сцены — поверх, процедурно.
 */

/** Прямоугольник в атласе: x, y, w, h в его пикселях */
type Frame = [number, number, number, number];

// Пиксель атласа → единицы сцены
const K = CELL / atlas.cell;
// Ширина облицовки в единицах сцены
const BAND = atlas.band_width * K;
// Перекрытие соседних плиток пола, единицы сцены
const BLEED = 0.4;
// Тень на полу у стен: сверху чуть глубже, свет идёт сверху
const SHADE_N = 0.34;
const SHADE_SIDE = 0.26;

const ROCK: Frame = [atlas.rock[0], atlas.rock[1], atlas.cell, atlas.cell];
const FLOORS: Frame[] = atlas.floors.map(([x, y]) => [x, y, atlas.cell, atlas.cell]);
const BAND_FULL = atlas.band as Frame;
const BAND_END = atlas.band_end as Frame;
const BAND_MID = atlas.band_mid as Frame;
const CORNER = atlas.corner as Frame;

export function Tiles({ map }: { map: ParsedMap }) {
  const kindAt = new Map(map.cells.map((c) => [`${c.x},${c.y}`, c.kind]));
  const isWall = wallsOf(map.cols, map.rows, (x, y) => kindAt.get(`${x},${y}`));
  const floors = map.cells.filter((c) => c.kind !== "wall");
  const walls = map.cells.filter((c) => c.kind === "wall");
  // Скала вокруг карты: кольцо в PAD клеток, все — стены без открытых сторон
  const rock: Array<{ x: number; y: number }> = [];
  for (let y = -PAD; y < map.rows + PAD; y++) {
    for (let x = -PAD; x < map.cols + PAD; x++) {
      if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) rock.push({ x, y });
    }
  }
  const solid = [...rock, ...walls];
  const fadeW = PAD * CELL;
  const sceneW = (map.cols + 2 * PAD) * CELL;
  const sceneH = (map.rows + 2 * PAD) * CELL;
  return (
    <g className={styles.tiles}>
      <defs>
        <linearGradient id="shade-n" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--shadow)" stopOpacity="0.6" />
          <stop offset="1" stopColor="var(--shadow)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="shade-s" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="var(--shadow)" stopOpacity="0.4" />
          <stop offset="1" stopColor="var(--shadow)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="shade-w" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--shadow)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--shadow)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="shade-e" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="var(--shadow)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--shadow)" stopOpacity="0" />
        </linearGradient>
        {/* Уход скалы в темноту к краям сцены */}
        <linearGradient id="fade-n" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--void)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--void)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fade-s" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="var(--void)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--void)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fade-w" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--void)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--void)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fade-e" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="var(--void)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--void)" stopOpacity="0" />
        </linearGradient>
        {/* Скала — узор на всю сцену, а не клетка за клеткой: между соседними
            картинками антиалиасинг оставляет волосяные щели, у узора их нет */}
        <pattern id="rock" patternUnits="userSpaceOnUse" width={CELL} height={CELL}>
          <Sprite frame={ROCK} x={0} y={0} w={CELL} h={CELL} />
        </pattern>
      </defs>
      <rect x={-PAD * CELL} y={-PAD * CELL} width={sceneW} height={sceneH} fill="url(#rock)" />
      {floors.map((c) => (
        <Sprite
          key={`${c.x}-${c.y}`}
          frame={FLOORS[Math.floor(cellHash(c.x, c.y) * FLOORS.length)]}
          x={c.x * CELL}
          y={c.y * CELL}
          w={CELL}
          h={CELL}
          bleed
        />
      ))}
      {/* Тени поверх пола, до стен: ворота и флаг рисуются позже, поверх тени */}
      {floors.map((c) => (
        <Shade key={`${c.x}-${c.y}`} x={c.x} y={c.y} mask={wallMask(isWall, c.x, c.y)} />
      ))}
      {/* Валуны поверх скалы: переходят через границы клеток, чтобы сетки не было видно */}
      {solid.map((c) => (
        <Boulders key={`${c.x}-${c.y}`} x={c.x} y={c.y} isWall={isWall} />
      ))}
      {/* Облицовка коридоров — поверх валунов, чтобы те её не перекрывали */}
      {solid.map((c) => (
        <Lining key={`${c.x}-${c.y}`} x={c.x} y={c.y} isWall={isWall} />
      ))}
      {/* Темнота по краям — в координатах сцены, поэтому сдвиг на -PAD */}
      <g transform={`translate(${-PAD * CELL} ${-PAD * CELL})`}>
        <rect width={sceneW} height={fadeW} fill="url(#fade-n)" />
        <rect y={sceneH - fadeW} width={sceneW} height={fadeW} fill="url(#fade-s)" />
        <rect width={fadeW} height={sceneH} fill="url(#fade-w)" />
        <rect x={sceneW - fadeW} width={fadeW} height={sceneH} fill="url(#fade-e)" />
      </g>
    </g>
  );
}

/**
 * Вырезка из атласа в прямоугольник сцены: вложенный svg с viewBox на
 * кадр, как у героя. Поворот и отражения — вокруг центра прямоугольника:
 * для полос на боковых сторонах и для угловых блоков, нарисованных под
 * левый верхний угол. Отражение применяется до поворота, в системе кадра.
 */
function Sprite({
  frame,
  x,
  y,
  w,
  h,
  rotate = 0,
  flipX = false,
  flipY = false,
  bleed = false,
}: {
  frame: Frame;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Чуть шире своего места — чтобы соседние плитки перекрывались и щелей не было */
  bleed?: boolean;
}) {
  const [fx, fy, fw, fh] = frame;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const grow = bleed ? BLEED : 0;
  // Повёрнутый на 90° кадр рисуется как горизонтальный вокруг того же центра
  const turned = rotate % 180 !== 0;
  const rw = (turned ? h : w) + grow;
  const rh = (turned ? w : h) + grow;
  const parts: string[] = [];
  if (rotate) parts.push(`rotate(${rotate} ${cx} ${cy})`);
  if (flipX || flipY) {
    parts.push(`translate(${cx} ${cy}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1}) translate(${-cx} ${-cy})`);
  }
  const svg = (
    <svg
      x={cx - rw / 2}
      y={cy - rh / 2}
      width={rw}
      height={rh}
      viewBox={`${fx} ${fy} ${fw} ${fh}`}
      preserveAspectRatio="none"
    >
      <image href={atlasUrl} width={atlas.size[0]} height={atlas.size[1]} />
    </svg>
  );
  return parts.length ? <g transform={parts.join(" ")}>{svg}</g> : svg;
}

/** Тень на полу у подножия стен со всех четырёх сторон; сверху чуть глубже */
function Shade({ x, y, mask }: { x: number; y: number; mask: number }) {
  if (!mask) return null;
  return (
    <g transform={`translate(${x * CELL} ${y * CELL})`}>
      {mask & N ? <rect width={CELL} height={CELL * SHADE_N} fill="url(#shade-n)" /> : null}
      {mask & S ? <rect y={CELL * (1 - SHADE_SIDE)} width={CELL} height={CELL * SHADE_SIDE} fill="url(#shade-s)" /> : null}
      {mask & W ? <rect width={CELL * SHADE_SIDE} height={CELL} fill="url(#shade-w)" /> : null}
      {mask & E ? <rect x={CELL * (1 - SHADE_SIDE)} width={CELL * SHADE_SIDE} height={CELL} fill="url(#shade-e)" /> : null}
    </g>
  );
}

/**
 * Крупный валун на скале — один на несколько клеток. Может выходить за
 * клетку в те стороны, где сосед — глухая стена (маска 15): там его никто
 * не перекроет облицовкой. Это единственное, что ломает сетку клеток на
 * массиве скалы.
 */
function Boulders({ x, y, isWall }: { x: number; y: number; isWall: IsWall }) {
  if (wallMask(isWall, x, y) !== 15 || cellHash(x, y, 80) > 0.3) return null;
  const solid = (dx: number, dy: number) => wallMask(isWall, x + dx, y + dy) === 15;
  const w = CELL * (0.5 + cellHash(x, y, 81) * 0.7);
  const h = CELL * (0.3 + cellHash(x, y, 82) * 0.4);
  // Куда валун может вылезти: вправо и вниз — если там тоже глухая скала
  const maxX = solid(1, 0) ? CELL * 1.4 - w : CELL - w - 3;
  const maxY = solid(0, 1) ? CELL * 1.3 - h : CELL - h - 3;
  const bx = 3 + cellHash(x, y, 83) * Math.max(0, maxX - 3);
  const by = 3 + cellHash(x, y, 84) * Math.max(0, maxY - 3);
  return (
    <g transform={`translate(${x * CELL} ${y * CELL})`}>
      <rect x={bx} y={by} width={w} height={h} rx={h / 2.2} className={styles.boulder} />
      <rect x={bx + 3} y={by + 1.5} width={w - 6} height={1.6} rx={0.8} className={styles.boulderLight} />
    </g>
  );
}

/** Полоса по угловым блокам на её концах: кадр, отражать ли по длине, отступ от начала */
function bandFor(start: boolean, end: boolean): { frame: Frame; flip: boolean; offset: number } {
  if (start && end) return { frame: BAND_MID, flip: false, offset: BAND };
  if (start) return { frame: BAND_END, flip: false, offset: BAND };
  if (end) return { frame: BAND_END, flip: true, offset: 0 };
  return { frame: BAND_FULL, flip: false, offset: 0 };
}

/**
 * Облицовка коридора внутри клетки стены: полоса вдоль каждой стороны,
 * обращённой к полу; угловой блок на внешнем углу (две открытые стороны
 * рядом) и на внутреннем (пол только по диагонали, а обе стороны при нём —
 * стены). Полосы идут между угловыми блоками, поэтому ничего не
 * перекрывается, а по концам выбирается кадр нужной длины.
 */
function Lining({ x, y, isWall }: { x: number; y: number; isWall: IsWall }) {
  const m = wallMask(isWall, x, y);
  const openN = !(m & N);
  const openE = !(m & E);
  const openS = !(m & S);
  const openW = !(m & W);
  const nw = (openN && openW) || (!openN && !openW && !isWall(x - 1, y - 1));
  const ne = (openN && openE) || (!openN && !openE && !isWall(x + 1, y - 1));
  const sw = (openS && openW) || (!openS && !openW && !isWall(x - 1, y + 1));
  const se = (openS && openE) || (!openS && !openE && !isWall(x + 1, y + 1));
  if (!openN && !openE && !openS && !openW && !nw && !ne && !sw && !se) return null;

  const ox = x * CELL;
  const oy = y * CELL;
  const pieces: ReactNode[] = [];

  // Кадр полосы нарисован для верхней стороны, начало — левый конец.
  // Боковые стороны — поворот на 90°: у западной начало оказывается
  // внизу, у восточной — вверху; нижняя — отражение по вертикали
  if (openN) {
    const b = bandFor(nw, ne);
    const len = CELL - (nw ? BAND : 0) - (ne ? BAND : 0);
    pieces.push(<Sprite key="n" frame={b.frame} x={ox + b.offset} y={oy} w={len} h={BAND} flipX={b.flip} />);
  }
  if (openS) {
    const b = bandFor(sw, se);
    const len = CELL - (sw ? BAND : 0) - (se ? BAND : 0);
    pieces.push(
      <Sprite key="s" frame={b.frame} x={ox + b.offset} y={oy + CELL - BAND} w={len} h={BAND} flipX={b.flip} flipY />,
    );
  }
  if (openW) {
    const b = bandFor(sw, nw);
    const len = CELL - (nw ? BAND : 0) - (sw ? BAND : 0);
    const top = oy + (nw ? BAND : 0);
    pieces.push(<Sprite key="w" frame={b.frame} x={ox} y={top} w={BAND} h={len} rotate={-90} flipX={b.flip} />);
  }
  if (openE) {
    const b = bandFor(ne, se);
    const len = CELL - (ne ? BAND : 0) - (se ? BAND : 0);
    const top = oy + (ne ? BAND : 0);
    pieces.push(
      <Sprite key="e" frame={b.frame} x={ox + CELL - BAND} y={top} w={BAND} h={len} rotate={90} flipX={b.flip} />,
    );
  }
  // Угловой блок нарисован для левого верхнего угла; скруглённая кромка — наружу
  if (nw) pieces.push(<Sprite key="nw" frame={CORNER} x={ox} y={oy} w={BAND} h={BAND} />);
  if (ne) pieces.push(<Sprite key="ne" frame={CORNER} x={ox + CELL - BAND} y={oy} w={BAND} h={BAND} flipX />);
  if (sw) pieces.push(<Sprite key="sw" frame={CORNER} x={ox} y={oy + CELL - BAND} w={BAND} h={BAND} flipY />);
  if (se) {
    pieces.push(<Sprite key="se" frame={CORNER} x={ox + CELL - BAND} y={oy + CELL - BAND} w={BAND} h={BAND} flipX flipY />);
  }

  return <g>{pieces}</g>;
}
