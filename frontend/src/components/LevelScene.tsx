import type { RefObject } from "react";
import type { Level, TileState } from "../engine/types";
import { CELL, DISPLAY_CELL, PAD, gateKey } from "../scene/grid";
import { HeroSprite, type CharacterId } from "./HeroSprite";
import styles from "./LevelScene.module.css";
import { Tiles } from "./Tiles";

/**
 * Статичная карта уровня плюс герой. Это разметка, не логика: клетки
 * читаются из legend/grid уровня ровно так, как их видит методист.
 * Всё, что движется, двигает LevelPlayer напрямую через ref — героя и
 * ворота (по data-gate="x-y", состояние в data-state).
 */

export interface ParsedMap {
  cols: number;
  rows: number;
  cells: Array<{ x: number; y: number; kind: string }>;
  start: [number, number];
  /** Ворота в состоянии до первого запуска — то же, что первый снимок даст в tiles */
  gates: TileState[];
}

export function parseMap(level: Level): ParsedMap {
  const rows = level.map.grid.replace(/\n$/, "").split("\n");
  const cells: ParsedMap["cells"] = [];
  const gates: TileState[] = [];
  let start: [number, number] = [0, 0];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const kind = level.map.legend[ch] ?? "floor";
      if (kind === "hero") start = [x, y];
      cells.push({ x, y, kind: kind === "hero" ? "floor" : kind });
      const waits = level.objects?.[kind]?.waits_to_open;
      if (waits) gates.push({ x, y, kind, state: "closed", left: waits });
    });
  });
  return { cols: Math.max(...rows.map((r) => r.length)), rows: rows.length, cells, start, gates };
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

      {/* Герой. Внешняя группа — положение и поворот, суставы внутри */}
      <g ref={hero}>
        <HeroSprite character={character} {...joints} />
      </g>

      {/* Ворота — поверх героя, чтобы решётка перекрывала его, а не наоборот.
          Число в углу — сколько ходов рядом ещё постоять */}
      {map.gates.map((g) => (
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
            <text data-left>{g.left}</text>
          </g>
        </g>
      ))}
      </g>
    </svg>
  );
}
