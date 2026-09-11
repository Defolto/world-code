import { useEffect, useRef, useState } from "react";
import { CELL, COLS, DISPLAY_CELL, DemoPlayer, ROW, ROWS, type SceneRefs } from "../scene/demoPlayer";
import { CODE_LINES, COIN_COL, GOBLIN_COL, HERO_START_COL } from "../scene/demoScript";
import { HeroSprite } from "./HeroSprite";
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
  const heroArmBack = useRef<SVGGElement>(null);
  const heroLegFront = useRef<SVGGElement>(null);
  const heroLegBack = useRef<SVGGElement>(null);
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
      heroArmBack: heroArmBack.current ?? undefined,
      heroLegFront: heroLegFront.current ?? undefined,
      heroLegBack: heroLegBack.current ?? undefined,
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
          // Реальный размер: клетка 80px, как будет в игре. Уже контейнера —
          // сцена сжимается целиком (max-width в .svg), пропорции те же.
          style={{ width: COLS * DISPLAY_CELL }}
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

          {/* Герой. Внешняя группа — положение, суставы внутри HeroSprite. */}
          <g ref={hero}>
            <HeroSprite
              body={heroBody}
              armFront={heroArm}
              armBack={heroArmBack}
              legFront={heroLegFront}
              legBack={heroLegBack}
            />
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
