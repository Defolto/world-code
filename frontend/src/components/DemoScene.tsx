import { useEffect, useRef, useState } from "react";
import { CELL, COLS, DemoPlayer, ROW, ROWS, type SceneRefs } from "../scene/demoPlayer";
import { CODE_LINES, COIN_COL, GOBLIN_COL, HERO_START_COL } from "../scene/demoScript";
import styles from "./DemoScene.module.css";

/**
 * Витрина на главной: слева код, справа мир, подсветка бежит по строкам.
 *
 * React здесь монтирует разметку и получает редкие события. Всё, что
 * движется, двигает DemoPlayer напрямую через ref — ни один кадр анимации
 * не проходит через состояние React.
 */
export function DemoScene() {
  const hero = useRef<SVGGElement>(null);
  const heroArm = useRef<SVGGElement>(null);
  const heroBody = useRef<SVGGElement>(null);
  const goblin = useRef<SVGGElement>(null);
  const goblinHp = useRef<SVGRectElement>(null);
  const coin = useRef<SVGGElement>(null);
  const spark = useRef<SVGGElement>(null);

  const [line, setLine] = useState(1);
  const [coins, setCoins] = useState(0);

  useEffect(() => {
    const refs: Partial<SceneRefs> = {
      hero: hero.current ?? undefined,
      heroArm: heroArm.current ?? undefined,
      heroBody: heroBody.current ?? undefined,
      goblin: goblin.current ?? undefined,
      goblinHp: goblinHp.current ?? undefined,
      coin: coin.current ?? undefined,
      spark: spark.current ?? undefined,
    };
    if (Object.values(refs).some((el) => !el)) return;

    const player = new DemoPlayer(refs as SceneRefs, {
      onLine: setLine,
      onCoins: setCoins,
    });

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) {
      player.drawStill();
      return;
    }
    player.play();
    return () => player.stop();
  }, []);

  return (
    <div className={styles.demo}>
      <div className={styles.editor}>
        <div className={styles.bar}>
          <span className={styles.tab}>forest_03.py</span>
          <span className={styles.run}>▶ Запуск</span>
        </div>
        <pre className={styles.code}>
          {CODE_LINES.map((text, i) => (
            <span
              key={i}
              className={i === line ? `${styles.row} ${styles.active}` : styles.row}
            >
              <span className={styles.num}>{i + 1}</span>
              <code>{text || " "}</code>
            </span>
          ))}
        </pre>
      </div>

      <div className={styles.world}>
        <svg
          viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
          className={styles.svg}
          role="img"
          aria-label="Герой идёт по карте, побеждает гоблина и забирает монету"
        >
          <defs>
            <radialGradient id="glow">
              <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Пол. Статичный слой — перерисовывается только при ресайзе. */}
          {Array.from({ length: ROWS }, (_, r) =>
            Array.from({ length: COLS }, (_, c) => (
              <rect
                key={`${r}-${c}`}
                x={c * CELL}
                y={r * CELL}
                width={CELL}
                height={CELL}
                className={r === ROW ? styles.tilePath : styles.tile}
              />
            )),
          )}

          {/* Отметки старта и цели — чтобы читалась задача, а не просто движение */}
          <rect
            x={HERO_START_COL * CELL + 8}
            y={ROW * CELL + 8}
            width={CELL - 16}
            height={CELL - 16}
            className={styles.mark}
          />
          <circle
            cx={COIN_COL * CELL + CELL / 2}
            cy={ROW * CELL + CELL / 2}
            r={17}
            fill="url(#glow)"
          />

          {/* Монета */}
          <g ref={coin}>
            <circle r="7" className={styles.coinOuter} />
            <circle r="3.4" className={styles.coinInner} />
          </g>

          {/* Гоблин */}
          <g ref={goblin} transform={`translate(${GOBLIN_COL * CELL + CELL / 2} ${ROW * CELL + CELL / 2})`}>
            <rect x="-13" y="-30" width="26" height="4" rx="2" className={styles.hpBack} />
            <rect ref={goblinHp} x="-13" y="-30" width="26" height="4" rx="2" className={styles.hpFill} />
            <path d="M-9 -12 L-13 -19 L-6 -16 Z" className={styles.goblinSkin} />
            <path d="M9 -12 L13 -19 L6 -16 Z" className={styles.goblinSkin} />
            <rect x="-7" y="0" width="14" height="12" rx="3" className={styles.goblinBody} />
            <circle cy="-8" r="8" className={styles.goblinSkin} />
            <circle cx="-3" cy="-9" r="1.6" className={styles.eye} />
            <circle cx="3" cy="-9" r="1.6" className={styles.eye} />
          </g>

          {/* Вспышка удара */}
          <g ref={spark} style={{ opacity: 0 }} transform={`translate(${GOBLIN_COL * CELL + CELL / 2} ${ROW * CELL + CELL / 2 - 6})`}>
            <path d="M-11 -7 L2 -1 L-6 1 L9 8" className={styles.spark} />
          </g>

          {/* Герой. Внешняя группа — положение, внутренние — суставы. */}
          <g ref={hero}>
            <g ref={heroBody}>
              <path d="M-4 -16 L-11 -14 L-8 6 L-3 2 Z" className={styles.cape} />
              <rect x="-5" y="1" width="4" height="13" rx="1.6" className={styles.legs} />
              <rect x="1" y="1" width="4" height="13" rx="1.6" className={styles.legs} />
              <path d="M-6 -3 L-9 6 L-5 7 L-3 -2 Z" className={styles.armBack} />
              <rect x="-6" y="-16" width="12" height="18" rx="4" className={styles.torso} />
              <circle cy="-22" r="6.4" className={styles.head} />
              <path d="M-6.6 -24 A6.6 6.6 0 0 1 6.6 -24 Z" className={styles.helmet} />
              {/* Плечо: группа стоит в точке сустава, поэтому rotate крутит
                  руку вместе с мечом — отдельной анимации у оружия нет. */}
              <g transform="translate(2 -12)">
                <g ref={heroArm}>
                  <rect x="-2" y="-1" width="4" height="12" rx="2" className={styles.arm} />
                  <rect x="-4.5" y="10" width="9" height="2.6" rx="1.2" className={styles.guard} />
                  <rect x="-1.4" y="12" width="2.8" height="17" rx="1.4" className={styles.blade} />
                </g>
              </g>
            </g>
          </g>
        </svg>

        <div className={styles.hud}>
          <span className={styles.hudItem}>
            <i className={styles.dotGold} /> монет: {coins}
          </span>
          <span className={styles.hudItem}>
            строка {line + 1} из {CODE_LINES.length}
          </span>
        </div>
      </div>
    </div>
  );
}
