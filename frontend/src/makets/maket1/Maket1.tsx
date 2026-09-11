import { DemoScene } from "../../components/DemoScene";
import { BADGES, FEATURES, MEDALS } from "../content";
import styles from "./Maket1.module.css";

export function Maket1() {
  return (
    <>
      <header className={styles.header}>
        <div className={`shell ${styles.headerInner}`}>
          <a href="#top" className={styles.logo}>
            мир<em>Код</em>
          </a>
          <nav className={styles.nav}>
            <a href="#how">Как это работает</a>
            <a href="#medals">Медали</a>
            <a href="#start">Начать</a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className={styles.hero}>
          <div className={`shell ${styles.heroGrid}`}>
            <div>
              <p className={styles.eyebrow}>Урок 1. Настоящий Python в браузере</p>
              <h1 className={styles.h1}>
                Пиши код — <span className={styles.mark}>и герой пойдёт</span>
              </h1>
              <p className={styles.lead}>
                Не блоки и не игрушечный язык. Тот самый Python, на котором
                пишут взрослые программисты, — только здесь видно, что делает
                каждая твоя строчка.
              </p>
              <div className={styles.actions}>
                <a href="#start" className={styles.btnPrimary}>
                  Начать бесплатно
                </a>
                <a href="#how" className={styles.btnGhost}>
                  Как это работает
                </a>
              </div>
              <ul className={styles.badges}>
                {BADGES.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className={styles.demoCard}>
                <DemoScene />
              </div>
              <p className={styles.caption}>
                Рис. 1. Десять строк — и герой сам добирается до монеты.
              </p>
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
              {FEATURES.map((f) => (
                <article key={f.title} className={`${styles.card} ${styles[f.accent]}`}>
                  <h3 className={styles.h3}>{f.title}</h3>
                  <p className={styles.cardText}>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="medals" className={styles.section}>
          <div className="shell">
            <h2 className={styles.h2}>Пройти уровень легко. Пройти красиво — задача.</h2>
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
              Медали считаются на нулевых характеристиках. Прокачка помогает
              пройти уровень, но на оценку не влияет — стать лучшим за счёт
              гринда нельзя.
            </p>
          </div>
        </section>

        <section id="start" className={styles.start}>
          <div className="shell">
            <div className={styles.startBox}>
              <h2 className={styles.h2}>Первые задачи — просто заходи</h2>
              <p className={styles.sub}>
                Регистрация не нужна, чтобы начать. Она нужна, чтобы не
                потерять прогресс. Только ник и почта родителя.
              </p>
              <button type="button" className={styles.btnBig}>
                Начать бесплатно
              </button>
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
