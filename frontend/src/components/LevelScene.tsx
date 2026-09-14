import type { RefObject } from "react";
import type { ItemState, Level, TileState } from "../engine/types";
import { CELL, DISPLAY_CELL, PAD, gateKey } from "../scene/grid";
import { HeroSprite, type CharacterId } from "./HeroSprite";
import styles from "./LevelScene.module.css";
import { Tiles } from "./Tiles";

/**
 * Статичная карта уровня плюс герой. Это разметка, не логика: клетки
 * читаются из legend/grid уровня ровно так, как их видит методист.
 * Всё, что движется, двигает LevelPlayer напрямую через ref — героя,
 * ворота (по data-gate="x-y") и предметы (по data-item="x-y"), состояние
 * у тех и других в data-state.
 */

export interface ParsedMap {
  cols: number;
  rows: number;
  cells: Array<{ x: number; y: number; kind: string }>;
  start: [number, number];
  /** Ворота и преграды до первого запуска — то же, что даст initial лога
   *  для прогона без случайностей */
  gates: TileState[];
  /** Предметы до первого запуска, в том же порядке и с теми же id, что даёт симулятор */
  items: ItemState[];
}

export function parseMap(level: Level): ParsedMap {
  const rows = level.map.grid.replace(/\n$/, "").split("\n");
  const cells: ParsedMap["cells"] = [];
  const gates: TileState[] = [];
  const items: ItemState[] = [];
  let start: [number, number] = [0, 0];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const kind = level.map.legend[ch] ?? "floor";
      if (kind === "hero") start = [x, y];
      cells.push({ x, y, kind: kind === "hero" ? "floor" : kind });
      const spec = level.objects?.[kind];
      if (spec?.waits_to_open) gates.push({ x, y, kind, state: "closed", left: spec.waits_to_open });
      if (spec?.password) gates.push({ x, y, kind, state: "closed" });
      // Преграды и всё случайное — то же, что симулятор кладёт в tiles
      if (spec?.jumpable || spec?.crawlable || spec?.chance != null || spec?.present) {
        gates.push({ x, y, kind, state: "present" });
      }
      // id как в симуляторе: вид и порядковый номер построчно
      if (spec?.pickable) {
        items.push({ id: `${kind}-${items.length + 1}`, kind, x, y, taken: false, checked: null });
      }
    });
  });
  return { cols: Math.max(...rows.map((r) => r.length)), rows: rows.length, cells, start, gates, items };
}

interface LevelSceneProps {
  /** Корень SVG — по нему плеер находит ворота */
  ref: RefObject<SVGSVGElement | null>;
  level: Level;
  map: ParsedMap;
  character: CharacterId;
  hero: RefObject<SVGGElement | null>;
  body: RefObject<SVGGElement | null>;
  armFront: RefObject<SVGGElement | null>;
  armBack: RefObject<SVGGElement | null>;
  legFront: RefObject<SVGGElement | null>;
  legBack: RefObject<SVGGElement | null>;
}

/** Размер сцены в клетках: карта плюс кольцо скалы */
export const sceneSize = (map: ParsedMap) => ({ cols: map.cols + 2 * PAD, rows: map.rows + 2 * PAD });

export function LevelScene({ ref, level, map, character, hero, ...joints }: LevelSceneProps) {
  const goal = level.goals.find((g) => g.reach)?.reach;
  const size = sceneSize(map);
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${size.cols * CELL} ${size.rows * CELL}`}
      className={styles.svg}
      width={size.cols * DISPLAY_CELL}
      height={size.rows * DISPLAY_CELL}
      role="img"
      aria-label={`Карта уровня «${level.title}»`}
    >
      <defs>
        <radialGradient id="goal-glow">
          <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Всё содержимое — в координатах карты, сдвинутых на кольцо скалы */}
      <g transform={`translate(${PAD * CELL} ${PAD * CELL})`}>
      {/* Пол и стены — статичный слой, плитки по соседям; скала вокруг — тоже здесь */}
      <Tiles map={map} />

      {/* Отметка старта */}
      <rect
        x={map.start[0] * CELL + 8}
        y={map.start[1] * CELL + 8}
        width={CELL - 16}
        height={CELL - 16}
        className={styles.mark}
      />

      {/* Флаг — цель. Рисуется кодом: это интерфейс мира, а не предмет */}
      {map.cells
        .filter((c) => c.kind === "flag")
        .map((c) => (
          <g key={`flag-${c.x}-${c.y}`} transform={`translate(${c.x * CELL + CELL / 2} ${c.y * CELL + CELL / 2})`}>
            {goal && goal[0] === c.x && goal[1] === c.y && <circle r={20} fill="url(#goal-glow)" />}
            <line x1="-6" y1="-16" x2="-6" y2="16" className={styles.flagPole} />
            <path d="M-6 -16 L12 -10 L-6 -4 Z" className={styles.flagCloth} />
          </g>
        ))}

      {/* Предметы на полу. Рисуются кодом, как флаг: это интерфейс мира.
          Свиток (reveals) — пергамент, всё остальное — монетка. Поднятый
          прячет CSS по data-state, который ставит плеер; результат
          проверки — data-check: подделка зеленеет, настоящая получает
          галочку. До проверки все одинаковые — в этом смысл */}
      {map.items.map((it) => (
        <g
          key={it.id}
          data-item={gateKey(it.x, it.y)}
          data-state="lying"
          className={styles.item}
          transform={`translate(${it.x * CELL + CELL / 2} ${it.y * CELL + CELL / 2})`}
        >
          <ellipse className={styles.itemShadow} cx={0} cy={11} rx={9} ry={3} />
          {itemIcon(level.objects?.[it.kind]) === "sack" ? (
            <g>
              <path className={styles.sack} d="M-9 10 C-13 4 -12 -3 -6 -6 L-3 -9 L3 -9 L6 -6 C12 -3 13 4 9 10 Z" />
              <path className={styles.sackTie} d="M-5 -7 Q0 -4 5 -7" />
              <path className={styles.sackFold} d="M-6 2 Q0 6 6 2" />
            </g>
          ) : itemIcon(level.objects?.[it.kind]) === "scroll" ? (
            <g className={styles.scroll}>
              <rect className={styles.scrollSheet} x={-9} y={-10} width={18} height={20} rx={2} />
              <rect className={styles.scrollRoll} x={-12} y={-12} width={24} height={5} rx={2.5} />
              <rect className={styles.scrollRoll} x={-12} y={7} width={24} height={5} rx={2.5} />
              <line className={styles.scrollInk} x1={-5} y1={-4} x2={5} y2={-4} />
              <line className={styles.scrollInk} x1={-5} y1={0} x2={4} y2={0} />
              <line className={styles.scrollInk} x1={-5} y1={4} x2={2} y2={4} />
            </g>
          ) : (
            <>
              <circle className={styles.coin} r={9} />
              <circle className={styles.coinInner} r={5.5} />
              <path className={styles.coinShine} d="M-4 -3 A5 5 0 0 1 2 -5" />
              <g className={styles.checkBadge} transform="translate(9 -9)">
                <circle r={6} />
                <path className={styles.checkReal} d="M-2.5 0 L-0.5 2 L3 -2" />
                <path className={styles.checkFake} d="M-2.5 -2.5 L2.5 2.5 M-2.5 2.5 L2.5 -2.5" />
              </g>
            </>
          )}
        </g>
      ))}

      {/* Преграды. Яма — дыра в полу, паутина — сеть на всю клетку с просветом
          внизу, под которым герой проползает, всё остальное — завал из
          камней. Рисуются по флагу объекта, а не по имени: новая «яма» в
          YAML — та же дыра. Случайная преграда, которой в прогоне нет,
          прячется по data-state */}
      {map.gates
        .filter((g) => g.state === "present")
        .map((g) => {
          const spec = level.objects?.[g.kind];
          return (
            <g
              key={`obstacle-${g.x}-${g.y}`}
              data-gate={gateKey(g.x, g.y)}
              data-state={g.state}
              className={styles.obstacle}
              transform={`translate(${g.x * CELL + CELL / 2} ${g.y * CELL + CELL / 2})`}
            >
              {spec?.jumpable ? (
                <>
                  <ellipse className={styles.pitRim} rx={17} ry={11} />
                  <ellipse className={styles.pit} rx={14} ry={8.5} />
                  <ellipse className={styles.pitDeep} cx={1} cy={2} rx={9} ry={4.5} />
                </>
              ) : spec?.crawlable ? (
                <Web />
              ) : (
                <Rubble />
              )}
            </g>
          );
        })}

      {/* Маршрут прогона: пунктир плана, сплошное — пройденное, тычки в стену,
          остановки. Содержимое рисует плеер, здесь — только слой и стили */}
      <g data-route className={styles.route} />

      {/* Герой. Внешняя группа — положение и поворот, суставы внутри */}
      <g ref={hero}>
        <HeroSprite character={character} {...joints} />
      </g>

      {/* Пузырь речи: текст и положение ставит плеер на кадрах say */}
      <g data-bubble display="none">
        <path className={styles.bubbleTail} d="M-5 0 L0 7 L5 0 Z" />
        <rect className={styles.bubbleBox} x={-30} y={-22} width={60} height={22} rx={6} />
        <text className={styles.bubbleText} y={-11} />
      </g>

      {/* Ворота — поверх героя, чтобы решётка перекрывала его, а не наоборот.
          Число в углу — сколько ходов рядом ещё постоять; у запертых — замок */}
      {map.gates
        .filter((g) => g.state === "closed")
        .map((g) => (
        <g
          key={`gate-${g.x}-${g.y}`}
          data-gate={gateKey(g.x, g.y)}
          data-state={g.state}
          transform={`translate(${g.x * CELL} ${g.y * CELL})`}
        >
          <clipPath id={`gate-clip-${g.x}-${g.y}`}>
            <rect width={CELL} height={CELL} />
          </clipPath>
          <g clipPath={`url(#gate-clip-${g.x}-${g.y})`}>
            <g className={styles.bars}>
              {[10, 17, 24, 31].map((bx) => (
                <line key={bx} x1={bx} y1={4} x2={bx} y2={CELL - 3} />
              ))}
              <line x1={6} y1={26} x2={CELL - 6} y2={26} />
            </g>
          </g>
          <rect className={styles.gateFrame} x={0} y={0} width={CELL} height={6} />
          <rect className={styles.gateFrame} x={0} y={0} width={5} height={CELL} />
          <rect className={styles.gateFrame} x={CELL - 5} y={0} width={5} height={CELL} />
          <g className={styles.gateBadge} transform={`translate(${CELL - 10} 11)`}>
            <circle r={7.5} />
            {g.left != null ? (
              <text data-left>{g.left}</text>
            ) : (
              <g className={styles.lock}>
                <path d="M-2.6 -1 V-3 A2.6 2.6 0 0 1 2.6 -3 V-1" />
                <rect x={-4} y={-1} width={8} height={5.5} rx={1} />
              </g>
            )}
          </g>
        </g>
      ))}
      </g>
    </svg>
  );
}

// Чем рисовать предмет: явный icon, иначе свиток — если он показывает
// пароль, иначе монетка
type ItemSpec = NonNullable<Level["objects"]>[string] | undefined;
function itemIcon(spec: ItemSpec): "coin" | "scroll" | "sack" {
  return spec?.icon ?? (spec?.reveals ? "scroll" : "coin");
}

// Паутина: узел выше центра, нити к краям клетки, три кольца. Нижние нити
// короче — внизу просвет, в который герой и проползает
const WEB_HUB: [number, number] = [0, -7];
// По кругу от левого нижнего края до правого нижнего: кольца идут по ним
// подряд, поэтому порядок — угловой
const WEB_SPOKES: Array<[number, number]> = [
  [-14, 14],
  [-22, 6],
  [-22, -8],
  [-22, -22],
  [-8, -22],
  [8, -22],
  [22, -22],
  [22, -8],
  [22, 6],
  [14, 14],
];
const WEB_RINGS = [0.3, 0.55, 0.8];

function Web() {
  const [hx, hy] = WEB_HUB;
  const at = (p: [number, number], t: number): [number, number] => [hx + (p[0] - hx) * t, hy + (p[1] - hy) * t];
  return (
    <g className={styles.web}>
      {WEB_SPOKES.map((p, i) => (
        <line key={`s${i}`} x1={hx} y1={hy} x2={p[0]} y2={p[1]} />
      ))}
      {WEB_RINGS.map((t) => {
        // Кольцо — ломаная по нитям, чуть провисающая между ними
        const pts = WEB_SPOKES.map((p) => at(p, t));
        let d = `M${pts[0][0]} ${pts[0][1]}`;
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1];
          const [bx, by] = pts[i];
          d += ` Q${(ax + bx) / 2 + (hx - (ax + bx) / 2) * 0.18} ${(ay + by) / 2 + (hy - (ay + by) / 2) * 0.18} ${bx} ${by}`;
        }
        return <path key={t} d={d} />;
      })}
      <circle className={styles.webHub} cx={hx} cy={hy} r={1.8} />
    </g>
  );
}

// Завал: горка камней в цветах валунов со скалы, чтобы читался как
// «обвалилось», а не как предмет
const RUBBLE: Array<[number, number, number, number]> = [
  [-19, -2, 16, 11],
  [-4, -4, 18, 12],
  [12, 0, 10, 9],
  [-12, 6, 14, 9],
  [2, 7, 15, 9],
  [-8, -12, 13, 9],
];

function Rubble() {
  return (
    <g className={styles.rubble}>
      <ellipse className={styles.itemShadow} cx={0} cy={13} rx={20} ry={4} />
      {RUBBLE.map(([x, y, w, h], i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={h} rx={h / 2.2} className={styles.rubbleStone} />
          <rect x={x + 3} y={y + 1.5} width={w - 6} height={1.6} rx={0.8} className={styles.rubbleLight} />
        </g>
      ))}
    </g>
  );
}
