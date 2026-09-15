// Хроника прохождения уровня — то, что уезжает методисту при победе.
//
// Зачем: по одному «пройден / не пройден» не отличить слишком простой
// уровень от проблемного. Отличает их путь: сколько запусков ушло, на
// чём спотыкались, сколько времени сидели и какой код в итоге написали.
// Всё это собирается здесь и одной записью отправляется на сервер, где
// дописывается в файл (backend/server/attempts.py). Просмотр — /stats/.
//
// Типы описывают и то, что шлём, и то, что страница статистики читает
// обратно, поэтому модуль общий для обеих страниц.

import type { FrameLog, Level, Outcome, RunError } from "./types";

/** Один запуск кода. `engine` — Pyodide не смог выполнить программу
 *  вовсе (не ошибка в коде ребёнка, а сбой движка) */
export interface RunRecord {
  at: number;
  code: string;
  status: Outcome | "engine";
  reason: string | null;
  error: RunError | null;
  seed: number | null;
  ticks: number | null;
}

export interface Attempt {
  level: string;
  /** Версия уровня на момент попытки (хэш из сборки). У записей до
   *  появления версий поля нет */
  version?: string;
  lesson: number;
  /** Кто: случайный id из localStorage, живёт, пока живёт браузер.
   *  Аккаунтов нет, но одного ребёнка от другого отличить надо */
  student: string;
  opened_at: number;
  runs: RunRecord[];
}

/** Запись, какой её видит страница статистики: хроника плюс итог
 *  и серверное время. Уходит в двух случаях: победа — и уход со
 *  страницы без победы, если хоть раз нажимали «Запуск». Брошенный
 *  уровень — самый сильный сигнал проблемного, терять его нельзя */
export interface AttemptRecord extends Attempt {
  /** Ставит сервер при чтении — хэш строки в файле; по нему удаляют */
  id: string;
  passed: boolean;
  /** От открытия страницы до победы или до ухода */
  seconds: number;
  /** Победный код — или последний написанный, если ушли без победы */
  code: string;
  ticks: number | null;
  lines: number | null;
  received_at: string;
}

const STUDENT_KEY = "mirkod.student";

function studentId(): string {
  try {
    const saved = localStorage.getItem(STUDENT_KEY);
    if (saved) return saved;
    const fresh = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(STUDENT_KEY, fresh);
    return fresh;
  } catch {
    // Хранилище закрыто — все такие дети сольются в одного. Терпимо
    return "anon";
  }
}

export function newAttempt(level: Level): Attempt {
  return {
    level: level.id,
    version: level.version,
    lesson: level.lesson,
    student: studentId(),
    opened_at: Date.now(),
    runs: [],
  };
}

// Что уже отправили по этой странице. Победа — одна на страницу:
// повторные после первой ничего нового не говорят. «Ушёл» тоже один раз,
// но победа после «ушёл» всё же отправляется: страница могла вернуться из
// bfcache. Страница статистики склеит их по opened_at
const sent = new WeakMap<Attempt, "passed" | "left">();

function post(record: Omit<AttemptRecord, "received_at" | "id">) {
  const body = JSON.stringify(record);
  // При уходе со страницы обычный fetch могут прервать; sendBeacon
  // для того и придуман. Шлём строкой (text/plain): Blob с типом
  // application/json Chrome для beacon не пропускает. Сервер разбирает
  // тело как JSON независимо от заголовка. Сбой сети ребёнка не
  // касается — только предупреждение в консоль
  if (navigator.sendBeacon?.("/api/attempts", body)) return;
  fetch("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch((err: unknown) => console.warn("Хроника не отправлена:", err));
}

/** Победа: хроника с победным кодом и метриками прогона */
export function reportPassed(attempt: Attempt, log: FrameLog) {
  if (sent.get(attempt) === "passed") return;
  sent.set(attempt, "passed");
  post({
    ...attempt,
    passed: true,
    seconds: Math.round((Date.now() - attempt.opened_at) / 1000),
    // Победный запуск ищем по seed: пока плёнка доигрывала, ребёнок мог
    // успеть запустить что-то ещё
    code: attempt.runs.find((r) => r.seed === log.seed)?.code ?? "",
    ticks: log.metrics.ticks,
    lines: log.metrics.lines,
  });
}

/** Уход со страницы без победы. Если «Запуск» не нажимали ни разу —
 *  ребёнок просто листал уровни, это не попытка */
export function reportLeft(attempt: Attempt) {
  if (sent.has(attempt) || attempt.runs.length === 0) return;
  sent.set(attempt, "left");
  post({
    ...attempt,
    passed: false,
    seconds: Math.round((Date.now() - attempt.opened_at) / 1000),
    code: attempt.runs.at(-1)?.code ?? "",
    ticks: null,
    lines: null,
  });
}
