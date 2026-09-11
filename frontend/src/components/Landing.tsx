import { useState } from "react";
import { DemoScene } from "./DemoScene";
import styles from "./Landing.module.css";

const FEATURES = [
  {
    accent: "emerald",
    title: "Настоящий Python",
    text: "Ты пишешь hero.move_right(), а не тащишь блоки мышкой. Этот же код работает и за пределами игры — в школе, на олимпиаде, на работе.",
  },
  {
    accent: "gold",
    title: "Мир видно целиком",
    text: "Карта, враги, их здоровье и урон — всё на экране ещё до запуска. Если герой погиб, это можно было посчитать заранее. Невезения тут нет.",
  },
  {
    accent: "crimson",
    title: "Ошибаться не страшно",
    text: "Не получилось — жми «Запуск» ещё раз. Никаких жизней, таймеров и штрафов. А что именно пошло не так, игра объяснит по-человечески.",
  },
  {
    accent: "steel",
    title: "Шаг вперёд, шаг назад",
    text: "Смотри, как выполняется каждая строка, останови в любой момент и перемотай назад. Видно даже, как меняются твои переменные.",
  },
] as const;

const MEDALS = [
  { icon: "✦", name: "Решено", text: "Герой дошёл до цели живым." },
  { icon: "✧", name: "Кратко", text: "Ты уложился в немного кода." },
  { icon: "✶", name: "Чисто", text: "Ты не повторял одно и то же. Вот здесь и рождается цикл." },
] as const;

const STATS = [
  { name: "Сила", text: "Бьёшь больнее", fixes: "если не хватило урона" },
  { name: "Ловкость", text: "Успеваешь больше за ход", fixes: "если не успел добить" },
  { name: "Выносливость", text: "Хватает энергии до конца боя", fixes: "если замер посреди схватки" },
] as const;

export function Landing() {
  const [asked, setAsked] = useState(false);

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
            <a href="#start" className={styles.navCta}>
              Начать
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        {/* ─── Первый экран ─── */}
        <section className={styles.hero}>
          <div className="shell">
            <p className={styles.eyebrow}>Настоящий Python прямо в браузере</p>
            <h1 className={styles.h1}>
              Пиши код — <span className={styles.accent}>и герой пойдёт</span>
            </h1>
            <p className={styles.lead}>
              Не блоки и не игрушечный язык. Тот самый Python, на котором пишут
              взрослые программисты, — только здесь видно, что делает каждая
              твоя строчка.
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
              <li>Ничего не нужно скачивать</li>
              <li>Регистрация не нужна</li>
              <li>Бесплатно</li>
            </ul>
          </div>

          {/* Вне .shell: сцена в реальных 80px на клетку плюс код рядом
              в 1120px не помещаются */}
          <div className={styles.demoWrap}>
            <DemoScene />
          </div>
        </section>

        {/* ─── Почему тут получается ─── */}
        <section id="how" className={styles.section}>
          <div className="shell">
            <h2 className={styles.h2}>Почему здесь получается</h2>
            <p className={styles.sub}>
              Программировать сложно не потому, что это трудно, а потому, что
              обычно непонятно, что происходит. Мы это чиним.
            </p>
            <div className={styles.grid4}>
              {FEATURES.map((f) => (
                <article key={f.title} className={styles.card}>
                  <span
                    className={`${styles.bar} ${styles[f.accent]}`}
                    aria-hidden="true"
                  />
                  <h3 className={styles.h3}>{f.title}</h3>
                  <p className={styles.cardText}>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Медали ─── */}
        <section id="medals" className={`${styles.section} ${styles.sectionAlt}`}>
          <div className="shell">
            <h2 className={`${styles.h2} ${styles.h2Wide}`}>
              Пройти уровень легко.
              <br />
              Пройти его красиво — вот это задача.
            </h2>
            <p className={styles.sub}>
              За каждую задачу можно получить три медали. Первую получают все.
              За остальными придётся подумать.
            </p>
            <div className={styles.grid3}>
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

        {/* ─── Прокачка ─── */}
        <section className={styles.section}>
          <div className="shell">
            <h2 className={styles.h2}>За решённые задачи дают монеты</h2>
            <p className={styles.sub}>
              Монеты идут на характеристики и снаряжение. Каждая характеристика
              лечит свою причину провала.
            </p>
            <div className={styles.grid3}>
              {STATS.map((s) => (
                <article key={s.name} className={styles.stat}>
                  <h3 className={styles.h3}>{s.name}</h3>
                  <p className={styles.cardText}>{s.text}</p>
                  <p className={styles.statFix}>Помогает, {s.fixes}</p>
                </article>
              ))}
            </div>
            <p className={styles.note}>
              Монеты нельзя купить за деньги. Ни за какие и никогда — их можно
              только заработать.
            </p>
          </div>
        </section>

        {/* ─── Призыв ─── */}
        <section id="start" className={styles.startSection}>
          <div className="shell">
            <div className={styles.startBox}>
              <h2 className={styles.h2}>Первые задачи — просто заходи</h2>
              <p className={styles.sub}>
                Чтобы начать, регистрация не нужна. Она нужна, чтобы не
                потерять: прогресс, монеты, медали и снаряжение останутся с
                тобой на любом компьютере.
              </p>
              <ul className={styles.privacy}>
                <li>Нужен только ник и почта родителя</li>
                <li>Ни телефона, ни настоящего имени, ни адреса</li>
              </ul>

              <button
                type="button"
                className={styles.btnBig}
                onClick={() => setAsked(true)}
              >
                Начать бесплатно
              </button>

              <p className={styles.startNote} role="status">
                {asked
                  ? "Мы ещё строим первый уровень. Скоро тут откроется лес с гоблинами."
                  : "После третьей решённой задачи предложим сохранить прогресс."}
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`shell ${styles.footerInner}`}>
          <span className={styles.logo}>
            <span className={styles.logoMark} aria-hidden="true" />
            мирКод
          </span>
          <span className={styles.footerText}>
            Учим программировать на настоящем Python
          </span>
        </div>
      </footer>
    </>
  );
}
