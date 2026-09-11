import { MAKETS } from "./content";
import styles from "./Switcher.module.css";

/**
 * Переключатель макетов. Нарочно не зависит от темы страницы: он один
 * и тот же на всех пяти, чтобы глаз сравнивал страницы, а не его.
 */
export function Switcher({ current }: { current: number }) {
  return (
    <nav className={styles.bar} aria-label="Макеты дизайна">
      <a href="/" className={styles.home}>
        главная
      </a>
      {MAKETS.map((m, i) => (
        <a
          key={m.path}
          href={m.path}
          className={i + 1 === current ? `${styles.item} ${styles.active}` : styles.item}
          aria-current={i + 1 === current ? "page" : undefined}
          title={m.name}
        >
          {i + 1}
        </a>
      ))}
      <span className={styles.name}>{MAKETS[current - 1].name}</span>
    </nav>
  );
}
