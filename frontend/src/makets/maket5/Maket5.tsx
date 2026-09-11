import { DemoScene } from "../../components/DemoScene";
import styles from "./Maket5.module.css";

// Детский макет говорит проще, чем остальные, поэтому у него свои тексты:
// одна мысль на блок, без «характеристик» и «нулевых значений».

const STEPS = [
  { title: "Напиши", text: "Скажи герою, что делать. Прямо словами, как программист." },
  { title: "Нажми «Запуск»", text: "Герой пойдёт, подерётся и заберёт монету. Или нет — тогда попробуй ещё." },
  { title: "Смотри", text: "Каждую строчку видно. Можно остановить и отмотать назад." },
] as const;

const FEATURES = [
  { accent: "emerald", icon: "Py", title: "Настоящий язык", text: "Тот же Python, что у взрослых. Не кубики и не мультик." },
  { accent: "gold", icon: "★", title: "Всё видно", text: "Где враги, сколько у них жизней — всё на карте заранее." },
  { accent: "crimson", icon: "↻", title: "Ошибаться можно", text: "Никаких жизней и таймеров. Не вышло — запусти снова." },
  { accent: "steel", icon: "◀", title: "Перемотка", text: "Отмотай назад и посмотри, где герой свернул не туда." },
] as const;

const MEDALS = [
  { icon: "✦", name: "Решено", text: "Герой дошёл живым." },
  { icon: "✧", name: "Кратко", text: "Кода совсем немного." },
  { icon: "✶", name: "Чисто", text: "Ничего не повторял два раза." },
] as const;

function Mascot() {
  // Робот-помощник: круглая голова, антенна, большие глаза, улыбка
  return (
    <svg className={styles.mascot} viewBox="0 0 84 84" aria-hidden="true">
      <line x1="42" y1="6" x2="42" y2="16" stroke="#23324a" strokeWidth="3" strokeLinecap="round" />
      <circle cx="42" cy="5" r="4" fill="#ff6b6b" />
      <rect x="10" y="16" width="64" height="56" rx="20" fill="#4d96ff" />
      <rect x="18" y="26" width="48" height="30" rx="12" fill="#fff" />
      <circle cx="32" cy="41" r="5" fill="#23324a" />
      <circle cx="52" cy="41" r="5" fill="#23324a" />
      <circle cx="34" cy="39" r="1.6" fill="#fff" />
      <circle cx="54" cy="39" r="1.6" fill="#fff" />
      <path d="M33 62 Q42 70 51 62" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="6" cy="44" r="5" fill="#ffd93d" />
      <circle cx="78" cy="44" r="5" fill="#ffd93d" />
    </svg>
  );
}

function Wave({ fill, flip }: { fill: string; flip?: boolean }) {
  return (
    <svg
      className={styles.wave}
      viewBox="0 0 1200 60"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={flip ? { transform: "scaleY(-1)" } : undefined}
    >
      <path
        fill={fill}
        d="M0 30 C150 60 300 0 450 30 C600 60 750 0 900 30 C1050 60 1150 10 1200 30 L1200 60 L0 60 Z"
      />
    </svg>
  );
}

export function Maket5() {
  return (
    <>
      <header className={styles.header}>
        <div className={`shell ${styles.headerInner}`}>
          <a href="#top" className={styles.logo}>
            <span className={styles.logoMark} aria-hidden="true" />
            мирКод
          </a>
          <nav className={styles.nav}>
            <a href="#how">Как играть</a>
            <a href="#medals">Медали</a>
            <a href="#start" className={`${styles.btn} ${styles.btnSmall}`}>
              Играть
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className={styles.hero}>
          <span className={`${styles.blob} ${styles.blobSun}`} aria-hidden="true" />
          <span className={`${styles.blob} ${styles.blobLilac}`} aria-hidden="true" />
          <div className={`shell ${styles.heroGrid}`}>
            <div>
              <div className={styles.mascotWrap}>
                <Mascot />
                <p className={styles.bubble}>Привет! Я Бип. Научу тебя говорить с компьютером.</p>
              </div>
              <h1 className={styles.h1}>
                Напиши код — <span className={styles.sky}>и герой</span>{" "}
                <span className={styles.grass}>пойдёт!</span>
              </h1>
              <p className={styles.lead}>
                Это настоящий Python, как у программистов. Только тут видно,
                что делает каждая строчка.
              </p>
              <div className={styles.actions}>
                <a href="#start" className={styles.btn}>
                  Играть бесплатно
                </a>
                <a href="#how" className={`${styles.btn} ${styles.btnSky}`}>
                  Как играть?
                </a>
              </div>
              <ul className={styles.badges}>
                <li>Без скачивания</li>
                <li>Без регистрации</li>
                <li>Бесплатно</li>
              </ul>
            </div>
            <div className={styles.demoCard}>
              <DemoScene />
            </div>
          </div>
        </section>

        <Wave fill="var(--grass)" />
        <section id="how" className={`${styles.section} ${styles.sectionGrass}`}>
          <div className="shell">
            <h2 className={styles.h2}>Как играть</h2>
            <p className={styles.sub}>Три шага. Потом ещё три. И так пока не станешь программистом.</p>
            <div className={styles.steps}>
              {STEPS.map((s, i) => (
                <article key={s.title} className={styles.step}>
                  <span className={styles.stepNum} aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 className={styles.h3}>{s.title}</h3>
                  <p className={styles.stepText}>{s.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <Wave fill="var(--grass)" flip />

        <section className={styles.section}>
          <div className="shell">
            <h2 className={styles.h2}>Что тут есть</h2>
            <div className={styles.grid4}>
              {FEATURES.map((f) => (
                <article key={f.title} className={styles.card}>
                  <span className={`${styles.cardIcon} ${styles[f.accent]}`} aria-hidden="true">
                    {f.icon}
                  </span>
                  <h3 className={styles.h3}>{f.title}</h3>
                  <p className={styles.cardText}>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <Wave fill="var(--sun)" />
        <section id="medals" className={`${styles.section} ${styles.sectionSun}`}>
          <div className="shell">
            <h2 className={styles.h2}>Собери три медали</h2>
            <p className={styles.sub}>Первую получают все. За остальными придётся подумать.</p>
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
          </div>
        </section>
        <Wave fill="var(--sun)" flip />

        <section id="start" className={styles.section}>
          <div className="shell">
            <div className={styles.startBox}>
              <h2 className={styles.h2}>Ну что, пошли?</h2>
              <p className={styles.sub}>Первые задачи — без регистрации. Просто заходи.</p>
              <div className={styles.startActions}>
                <button type="button" className={styles.btn}>
                  Играть бесплатно
                </button>
              </div>
              <p className={styles.parent}>
                Родителям: чтобы сохранить прогресс, понадобится только ник и ваша почта.
              </p>
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
