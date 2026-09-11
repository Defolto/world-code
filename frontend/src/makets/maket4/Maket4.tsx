import { DemoScene } from "../../components/DemoScene";
import { BADGES, FEATURES, MEDALS } from "../content";
import styles from "./Maket4.module.css";

const GLYPHS = ["Py", "◉", "↻", "⇄"] as const;

// Светлячки над первым экраном: позиции и задержки — данные, а не CSS
const FIREFLIES = [
  { left: "8%", top: "22%", delay: "0s" },
  { left: "17%", top: "58%", delay: "2.1s" },
  { left: "83%", top: "30%", delay: "1.2s" },
  { left: "91%", top: "64%", delay: "3.4s" },
  { left: "72%", top: "12%", delay: "4.6s" },
  { left: "28%", top: "80%", delay: "0.8s" },
] as const;

export function Maket4() {
  return (
    <>
      <header className={styles.header}>
        <div className={`shell ${styles.headerInner}`}>
          <a href="#top" className={styles.logo}>
            <span className={styles.logoMark} aria-hidden="true" />
            мирКод
          </a>
          <nav className={styles.nav}>
            <a href="#how">Как это работает</a>
            <a href="#medals">Медали</a>
            <a href="#start" className={`${styles.btn} ${styles.btnGold} ${styles.btnSmall}`}>
              Начать
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className={styles.hero}>
          {FIREFLIES.map((f, i) => (
            <span
              key={i}
              className={styles.firefly}
              style={{ left: f.left, top: f.top, animationDelay: f.delay }}
              aria-hidden="true"
            />
          ))}
          <div className="shell">
            <p className={styles.eyebrow}>Настоящий Python прямо в браузере</p>
            <h1 className={styles.h1}>
              Пиши код — <span className={styles.accent}>и герой пойдёт</span>
            </h1>
            <p className={styles.lead}>
              Не блоки и не игрушечный язык. Тот самый Python, на котором
              пишут взрослые программисты, — только здесь видно, что делает
              каждая твоя строчка.
            </p>
            <div className={styles.actions}>
              <a href="#start" className={`${styles.btn} ${styles.btnGold}`}>
                Начать бесплатно
              </a>
              <a href="#how" className={`${styles.btn} ${styles.btnGhost}`}>
                Как это работает
              </a>
            </div>
            <ul className={styles.badges}>
              {BADGES.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>

            <div className={styles.demoWrap}>
              <DemoScene />
            </div>
          </div>

          <svg
            className={styles.trees}
            viewBox="0 0 1200 120"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M0 120 L0 92 L40 60 L80 96 L110 40 L150 90 L190 70 L230 100 L270 50 L310 95 L340 65 L380 100 L420 45 L460 92 L500 72 L540 98 L580 38 L620 90 L660 68 L700 100 L740 55 L780 95 L820 62 L860 100 L900 42 L940 90 L980 70 L1020 98 L1060 52 L1100 94 L1140 66 L1200 100 L1200 120 Z"
            />
          </svg>
        </section>

        <section id="how" className={`${styles.section} ${styles.sectionDeep}`}>
          <div className="shell">
            <h2 className={styles.h2}>Почему здесь получается</h2>
            <p className={styles.sub}>
              Программировать сложно не потому, что это трудно, а потому, что
              обычно непонятно, что происходит. Мы это чиним.
            </p>
            <div className={styles.grid4}>
              {FEATURES.map((f, i) => (
                <article key={f.title} className={styles.card}>
                  <span className={`${styles.cardGlyph} ${styles[f.accent]}`} aria-hidden="true">
                    {GLYPHS[i]}
                  </span>
                  <h3 className={styles.h3}>{f.title}</h3>
                  <p className={styles.cardText}>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="medals" className={styles.section}>
          <div className="shell">
            <h2 className={styles.h2}>Пройти уровень легко. Пройти красиво — вот задача.</h2>
            <p className={styles.sub}>
              За каждую задачу можно получить три медали. Первую получают все.
              За остальными придётся подумать.
            </p>
            <div className={styles.medals}>
              {MEDALS.map((m) => (
                <article key={m.name} className={styles.medal}>
                  <span className={styles.medalIcon} aria-hidden="true">
                    {m.icon}
                  </span>
                  <h3 className={styles.h3}>{m.name}</h3>
                  <p className={styles.cardText}>{m.text}</p>
                </article>
              ))}
            </div>
            <p className={styles.note}>
              Медали считаются на нулевых характеристиках. Прокачка помогает
              пройти уровень, но на оценку не влияет — стать лучшим за счёт
              гринда нельзя.
            </p>
          </div>
        </section>

        <section id="start" className={styles.section}>
          <div className="shell">
            <div className={styles.startBox}>
              <h2 className={styles.h2}>Первые задачи — просто заходи</h2>
              <p className={styles.sub}>
                Регистрация не нужна, чтобы начать. Она нужна, чтобы не
                потерять прогресс. Только ник и почта родителя.
              </p>
              <div className={styles.startActions}>
                <button type="button" className={`${styles.btn} ${styles.btnGold}`}>
                  Начать бесплатно
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={`shell ${styles.footer}`}>
        <span>мирКод</span>
        <span>Учим программировать на настоящем Python</span>
      </footer>
    </>
  );
}
