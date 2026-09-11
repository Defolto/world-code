import { DemoScene } from "../../components/DemoScene";
import { BADGES, FEATURES, MEDALS } from "../content";
import styles from "./Maket2.module.css";

export function Maket2() {
  return (
    <>
      <header className={styles.header}>
        <div className={`shell ${styles.headerInner}`}>
          <a href="#top" className={styles.logo}>
            мирКод
          </a>
          <nav className={styles.nav}>
            <a href="#how">Как это работает</a>
            <a href="#medals">Медали</a>
            <a href="#start" className={styles.btn}>
              Играть
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className={styles.hero}>
          <div className="shell">
            <p className={styles.eyebrow}>▼ Нажми любую клавишу</p>
            <h1 className={styles.h1}>
              Пиши код — <span className={styles.accent}>и герой пойдёт</span>
            </h1>
            <p className={styles.lead}>
              Не блоки и не игрушечный язык. Тот самый Python, на котором
              пишут взрослые программисты, — только здесь видно, что делает
              каждая твоя строчка.
            </p>
            <div className={styles.actions}>
              <a href="#start" className={styles.btn}>
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

            <div className={styles.screen}>
              <div className={styles.screenBar}>
                <span>Уровень 3: Лес</span>
                <span>HP ▮▮▮▮▮</span>
              </div>
              <DemoScene />
            </div>
          </div>
        </section>

        <section id="how" className={styles.section}>
          <div className="shell">
            <h2 className={styles.h2}>Почему здесь получается</h2>
            <p className={styles.sub}>
              Программировать сложно не потому, что это трудно, а потому, что
              обычно непонятно, что происходит. Мы это чиним.
            </p>
            <div className={styles.grid4}>
              {FEATURES.map((f, i) => (
                <article key={f.title} className={styles.card}>
                  <span className={`${styles.cardTag} ${styles[f.accent]}`}>
                    0{i + 1}
                  </span>
                  <h3 className={styles.h3}>{f.title}</h3>
                  <p className={styles.cardText}>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="medals" className={`${styles.section} ${styles.sectionAlt}`}>
          <div className="shell">
            <h2 className={styles.h2}>Достижения</h2>
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
                  <div>
                    <h3 className={styles.h3}>{m.name}</h3>
                    <p className={styles.cardText}>{m.text}</p>
                  </div>
                </article>
              ))}
            </div>
            <p className={styles.note}>
              ★ Медали считаются на нулевых характеристиках. Прокачка помогает
              пройти, но на оценку не влияет. Гриндом лучшим не стать.
            </p>
          </div>
        </section>

        <section id="start" className={styles.section}>
          <div className="shell">
            <div className={styles.startBox}>
              <h2 className={styles.h2}>Новая игра</h2>
              <p className={styles.sub}>
                Регистрация не нужна, чтобы начать. Она нужна, чтобы не
                потерять прогресс. Только ник и почта родителя.
              </p>
              <div className={styles.startActions}>
                <button type="button" className={`${styles.btn} ${styles.btnGold}`}>
                  ▶ Начать бесплатно
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={`shell ${styles.footer}`}>
        <span>мирКод</span>
        <span>© 2026 · Настоящий Python</span>
      </footer>
    </>
  );
}
