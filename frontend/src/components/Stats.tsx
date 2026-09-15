import { useEffect, useMemo, useState, type FormEvent } from "react";
import levels from "virtual:levels";
import type { AttemptRecord, RunRecord } from "../engine/attempts";
import type { Level } from "../engine/types";
import styles from "./Stats.module.css";

// Страница методиста: по каждому уровню — как его проходили. Данные
// отдаёт /stats/data под паролем (HTTP Basic). На проде браузер
// спрашивает его ещё на входе в /stats/ и сам подставляет в запросы
// «под» этим путём; в деве страницу отдаёт Vite без пароля, поэтому на
// 401 показываем свою форму и дальше шлём заголовок сами. Пароль живёт
// в sessionStorage — до закрытия вкладки.

const PASSWORD_KEY = "mirkod.stats.password";

function loadPassword(): string {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) ?? "";
  } catch {
    return "";
  }
}

function savePassword(password: string) {
  try {
    sessionStorage.setItem(PASSWORD_KEY, password);
  } catch {
    /* хранилище закрыто — спросим ещё раз после перезагрузки */
  }
}

// Basic-заголовок: base64 от "логин:пароль", логин любой. btoa не
// умеет не-latin1, поэтому сначала в UTF-8 байты
const basic = (password: string) =>
  "Basic " + btoa(String.fromCharCode(...new TextEncoder().encode(`stats:${password}`)));

const ORDER: Level[] = Object.values(levels).sort(
  (a, b) => a.lesson - b.lesson || a.id.localeCompare(b.id),
);

const STATUS_TEXT: Record<RunRecord["status"], string> = {
  win: "пройден",
  lose: "не дошёл",
  timeout: "слишком долго",
  error: "ошибка в коде",
  engine: "сбой движка",
};

// Вердикт по уровню — грубая эвристика, чтобы глаз цеплялся за строку.
// Решает всё равно человек, глядя на хронику
type Verdict = "none" | "few" | "easy" | "hard" | "ok";
const VERDICT_TEXT: Record<Verdict, string> = {
  none: "нет данных",
  few: "мало данных",
  easy: "слишком простой?",
  hard: "проблемный?",
  ok: "норм",
};

interface Summary {
  level: Level;
  /** Версия уровня, к которой относятся попытки; "" — записи без версии */
  version: string;
  /** Это версия, которая сейчас в content/levels. Остальные — прежние
   *  редакции уровня, их строки идут следом за текущей */
  current: boolean;
  /** Все попытки: пройденные и брошенные */
  attempts: AttemptRecord[];
  passed: number;
  /** Доля попыток, брошенных без победы */
  leftShare: number;
  students: number;
  medianRuns: number;
  medianSeconds: number;
  firstTry: number; // доля прохождений с первого запуска
  errorShare: number; // доля запусков с ошибкой в коде
  verdict: Verdict;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(level: Level, version: string, current: boolean, attempts: AttemptRecord[]): Summary {
  const wins = attempts.filter((a) => a.passed);
  const runs = attempts.flatMap((a) => a.runs);
  // Запуски и время считаем по победам: у брошенных попыток ни того,
  // ни другого «до конца» нет
  const medianRuns = median(wins.map((a) => a.runs.length));
  const medianSeconds = median(wins.map((a) => a.seconds));
  const firstTry = wins.length ? wins.filter((a) => a.runs.length === 1).length / wins.length : 0;
  const errorShare = runs.length ? runs.filter((r) => r.status === "error").length / runs.length : 0;
  const leftShare = attempts.length ? (attempts.length - wins.length) / attempts.length : 0;

  let verdict: Verdict;
  if (attempts.length === 0) verdict = "none";
  else if (attempts.length < 3) verdict = "few";
  else if (leftShare > 0.3 || medianRuns >= 5 || medianSeconds > 600 || errorShare > 0.4) verdict = "hard";
  else if (wins.length >= 3 && medianRuns <= 1 && medianSeconds < 90) verdict = "easy";
  else verdict = "ok";

  return {
    level,
    version,
    current,
    attempts,
    passed: wins.length,
    leftShare,
    students: new Set(attempts.map((a) => a.student)).size,
    medianRuns,
    medianSeconds,
    firstTry,
    errorShare,
    verdict,
  };
}

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m} мин ${r.toString().padStart(2, "0")} с` : `${r} с`;
};
const fmtPct = (x: number) => `${Math.round(x * 100)}%`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Stats() {
  const [data, setData] = useState<AttemptRecord[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [password, setPassword] = useState(loadPassword);
  // null — пароль не спрашивали; строка — текст ошибки под полем
  const [askPassword, setAskPassword] = useState<string | null>(null);

  const load = (pwd = password) => {
    setProblem(null);
    fetch("/stats/data", { headers: pwd ? { Authorization: basic(pwd) } : {} })
      .then(async (res) => {
        if (res.status === 401) {
          setAskPassword(pwd ? "Пароль не подошёл" : "");
          return null;
        }
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        return (await res.json()) as AttemptRecord[];
      })
      .then((result) => {
        if (!result) return;
        setAskPassword(null);
        setData(result);
      })
      .catch((err: unknown) =>
        setProblem(
          err instanceof TypeError
            ? "сервер не отвечает. В деве нужен и бэкенд: npm run dev, а не dev:web"
            : err instanceof Error
              ? err.message
              : String(err),
        ),
      );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), []);

  // Удаление — тестовые прогоны методиста, дубли, чужие эксперименты.
  // Сервер вычёркивает строку из файла, мы — запись из стейта
  const remove = async (id: string) => {
    const res = await fetch(`/stats/data/${id}`, {
      method: "DELETE",
      headers: password ? { Authorization: basic(password) } : {},
    });
    if (!res.ok && res.status !== 404) throw new Error(`${res.status}: ${await res.text()}`);
    setData((d) => d && d.filter((a) => a.id !== id));
  };

  const submitPassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pwd = new FormData(e.currentTarget).get("password");
    if (typeof pwd !== "string" || !pwd) return;
    setPassword(pwd);
    savePassword(pwd);
    load(pwd);
  };

  const summaries = useMemo(() => {
    // «Ушёл» и «прошёл» с одной страницы (тот же opened_at) — одна
    // попытка: страница вернулась из bfcache, и ребёнок всё же прошёл
    const key = (a: AttemptRecord) => `${a.student}/${a.level}/${a.opened_at}`;
    const passedKeys = new Set((data ?? []).filter((a) => a.passed).map(key));
    const byLevel = new Map<string, AttemptRecord[]>();
    for (const a of data ?? []) {
      if (!a.passed && passedKeys.has(key(a))) continue;
      byLevel.set(a.level, [...(byLevel.get(a.level) ?? []), a]);
    }
    // Уровень → строка текущей версии (даже пустая), за ней — прежние
    // версии, что встречаются в записях, от свежей к старой
    const rows = (level: Level, attempts: AttemptRecord[]): Summary[] => {
      const byVersion = new Map<string, AttemptRecord[]>();
      for (const a of attempts) {
        const v = a.version ?? "";
        byVersion.set(v, [...(byVersion.get(v) ?? []), a]);
      }
      const older = [...byVersion.keys()]
        .filter((v) => v !== level.version)
        .sort((a, b) => (byVersion.get(b)!.at(-1)!.received_at > byVersion.get(a)!.at(-1)!.received_at ? 1 : -1));
      return [
        summarize(level, level.version, true, byVersion.get(level.version) ?? []),
        ...older.map((v) => summarize(level, v, false, byVersion.get(v)!)),
      ];
    };
    const known = ORDER.flatMap((l) => rows(l, byLevel.get(l.id) ?? []));
    // Уровни, которых уже нет в content/levels, но записи по ним есть
    const gone = [...byLevel.keys()]
      .filter((id) => !levels[id])
      .flatMap((id) =>
        // Текущей версии у удалённого уровня нет — строка с пустым хэшем
        // окажется пустой, отбрасываем её
        rows({ id, version: "", lesson: 0, title: `${id} (удалён)` } as Level, byLevel.get(id) ?? []).filter(
          (s) => s.attempts.length > 0,
        ),
      );
    return [...known, ...gone];
  }, [data]);

  const students = useMemo(() => new Set((data ?? []).map((a) => a.student)).size, [data]);

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a href="/" className={styles.back}>
          ← мирКод
        </a>
        <h1 className={styles.title}>Статистика уровней</h1>
        {data && (
          <span className={styles.total}>
            {data.filter((a) => a.passed).length} прохождений · {data.filter((a) => !a.passed).length} брошенных ·{" "}
            {students} учеников
          </span>
        )}
        <button type="button" className={styles.reload} onClick={() => load()}>
          Обновить
        </button>
      </header>

      {problem && (
        <p className={styles.problem} role="alert">
          Не удалось получить данные — {problem}
        </p>
      )}
      {askPassword !== null && (
        <form className={styles.login} onSubmit={submitPassword}>
          <label htmlFor="stats-password">Пароль к статистике</label>
          <input id="stats-password" name="password" type="password" autoComplete="current-password" autoFocus />
          <button type="submit" className={styles.reload}>
            Войти
          </button>
          {askPassword && <span className={styles.bad}>{askPassword}</span>}
        </form>
      )}
      {!data && !problem && askPassword === null && <p className={styles.muted}>Загружаем…</p>}

      {data && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Занятие</th>
                <th>Уровень</th>
                <th className={styles.num}>Прошли</th>
                <th className={styles.num} title="Доля попыток, брошенных без победы">
                  Бросили
                </th>
                <th className={styles.num}>Учеников</th>
                <th className={styles.num} title="Медиана числа запусков до победы">
                  Запусков
                </th>
                <th className={styles.num} title="Доля прохождений с первого запуска">
                  С 1-го раза
                </th>
                <th className={styles.num} title="Доля запусков, упавших с ошибкой Python">
                  Ошибок
                </th>
                <th className={styles.num} title="Медиана времени от открытия уровня до победы">
                  Время
                </th>
                <th>Вердикт</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => {
                const key = `${s.level.id}@${s.version}`;
                return (
                  <LevelRow key={key} s={s} open={open === key} onToggle={() => setOpen(open === key ? null : key)} onRemove={remove} />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LevelRow({
  s,
  open,
  onToggle,
  onRemove,
}: {
  s: Summary;
  open: boolean;
  onToggle: () => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const has = s.attempts.length > 0;
  return (
    <>
      <tr
        className={`${styles.row} ${has ? styles.rowClickable : ""} ${open ? styles.rowOpen : ""} ${s.current ? "" : styles.rowOld}`}
        onClick={has ? onToggle : undefined}
      >
        <td className={styles.muted}>{s.current ? s.level.lesson || "—" : ""}</td>
        <td>
          {s.current ? (
            <>
              <span className={styles.levelId}>{s.level.id}</span> {s.level.title}
            </>
          ) : (
            <span className={styles.muted} title="Попытки на прежней редакции уровня: до правки карты, заготовки или условия">
              ↳ прежняя версия <span className={styles.levelId}>{s.version || "без версии"}</span> · до{" "}
              {fmtDate(s.attempts.at(-1)!.received_at)}
            </span>
          )}
        </td>
        <td className={styles.num}>{s.passed}</td>
        <td className={`${styles.num} ${s.leftShare > 0.3 ? styles.bad : ""}`}>{has ? fmtPct(s.leftShare) : ""}</td>
        <td className={styles.num}>{has ? s.students : ""}</td>
        <td className={styles.num}>{s.passed ? s.medianRuns : ""}</td>
        <td className={styles.num}>{s.passed ? fmtPct(s.firstTry) : ""}</td>
        <td className={styles.num}>{has ? fmtPct(s.errorShare) : ""}</td>
        <td className={styles.num}>{s.passed ? fmtTime(s.medianSeconds) : ""}</td>
        <td>
          <span className={`${styles.verdict} ${styles[`verdict_${s.verdict}`]}`}>{VERDICT_TEXT[s.verdict]}</span>
        </td>
      </tr>
      {open && (
        <tr className={styles.detailsRow}>
          <td colSpan={10}>
            <div className={styles.details}>
              {[...s.attempts].reverse().map((a) => (
                <AttemptCard key={a.id} a={a} onRemove={() => onRemove(a.id)} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AttemptCard({ a, onRemove }: { a: AttemptRecord; onRemove: () => Promise<void> }) {
  // Какой запуск показываем: по умолчанию — последний (у прошедших победный)
  const [pick, setPick] = useState<number | null>(null);
  // Удаление в два клика, без window.confirm: «Удалить» → «Точно?»
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const confirmRemove = async () => {
    setRemoving("…");
    try {
      await onRemove();
    } catch (err) {
      setRemoving(err instanceof Error ? err.message : String(err));
      setConfirming(false);
    }
  };
  const run = pick === null ? a.runs.at(-1) : a.runs[pick];
  const errors = a.runs.filter((r) => r.status === "error").length;
  return (
    <article className={`${styles.attempt} ${a.passed ? "" : styles.attemptLeft}`}>
      <header className={styles.attemptHead}>
        <span className={styles.student} title="Ученик">
          {a.student}
        </span>
        {!a.passed && <span className={`${styles.verdict} ${styles.verdict_hard}`}>ушёл без победы</span>}
        <span className={styles.muted}>{fmtDate(a.received_at)}</span>
        <span>{fmtTime(a.seconds)}</span>
        <span>
          {a.runs.length} {plural(a.runs.length, "запуск", "запуска", "запусков")}
          {errors ? `, ${errors} с ошибкой` : ""}
        </span>
        {a.passed && (
          <span className={styles.muted}>
            тиков {a.ticks} · строк {a.lines}
          </span>
        )}
        <span className={styles.removeBox}>
          {removing === "…" ? (
            <span className={styles.muted}>удаляем…</span>
          ) : confirming ? (
            <>
              <span>Точно удалить?</span>
              <button type="button" className={`${styles.removeBtn} ${styles.removeYes}`} onClick={confirmRemove}>
                Да
              </button>
              <button type="button" className={styles.removeBtn} onClick={() => setConfirming(false)}>
                Нет
              </button>
            </>
          ) : (
            <button type="button" className={styles.removeBtn} onClick={() => setConfirming(true)} title="Убрать эту попытку из статистики">
              Удалить
            </button>
          )}
          {removing && removing !== "…" && <span className={styles.bad}>{removing}</span>}
        </span>
      </header>
      {/* Лента запусков: цвет — исход, клик — код и ошибка этого запуска */}
      <div className={styles.runs} role="tablist" aria-label="Запуски">
        {a.runs.map((r, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={run === r}
            className={`${styles.run} ${styles[`run_${r.status}`]} ${run === r ? styles.runActive : ""}`}
            title={`${STATUS_TEXT[r.status]}${r.error ? `: ${r.error.type}` : r.reason ? `: ${r.reason}` : ""}`}
            onClick={() => setPick(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>
      {run && (
        <div className={styles.runBody}>
          <div className={styles.runMeta}>
            <span className={`${styles.verdict} ${styles[`run_${run.status}`]}`}>{STATUS_TEXT[run.status]}</span>
            {run.error && (
              <code className={styles.error}>
                {run.error.type}
                {run.error.line ? `, строка ${run.error.line}` : ""}: {run.error.message}
              </code>
            )}
            {!run.error && run.reason && <span className={styles.muted}>{run.reason}</span>}
          </div>
          <pre className={styles.code}>{run.code || "(пусто)"}</pre>
        </div>
      )}
    </article>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
