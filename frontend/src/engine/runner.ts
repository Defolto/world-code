// Клиент воркера исполнения. Модульный синглтон, а не useEffect: в
// StrictMode эффект отработает дважды и поднимет два Pyodide по семь
// мегабайт каждый.
//
//   warmUp()                      — начать грузить Pyodide, пока ребёнок читает условие
//   runProgram(source, level)     — прогон, возвращает лог кадров
//   onStatus(cb)                  — «грузится» / «готов» для индикатора

import type { WorkerIn, WorkerOut } from "./pyodide.worker";
import { EMPTY_LOADOUT, type FrameLog, type Level, type Loadout } from "./types";

export type EngineStatus = "idle" | "loading" | "ready" | "failed";

// Симулятор сам режет бесконечные циклы бюджетом строк, поэтому таймаут
// здесь — страховка от зависшего wasm, а не от кода ученика.
const HANG_MS = 20_000;

let worker: Worker | null = null;
let status: EngineStatus = "idle";
let nextId = 1;
const pending = new Map<number, { resolve: (log: FrameLog) => void; reject: (e: Error) => void }>();
const listeners = new Set<(s: EngineStatus) => void>();

function setStatus(s: EngineStatus) {
  status = s;
  listeners.forEach((cb) => cb(s));
}

function spawn(): Worker {
  const w = new Worker(new URL("./pyodide.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<WorkerOut>) => {
    const msg = e.data;
    if (msg.type === "status") {
      setStatus(msg.stage);
    } else if (msg.type === "result") {
      pending.get(msg.id)?.resolve(msg.log);
      pending.delete(msg.id);
    } else if (msg.id === null) {
      setStatus("failed");
      failAll(new Error(msg.message));
    } else {
      pending.get(msg.id)?.reject(new Error(msg.message));
      pending.delete(msg.id);
    }
  };
  w.onerror = (e) => {
    setStatus("failed");
    failAll(new Error(e.message || "Ошибка воркера"));
  };
  return w;
}

function failAll(err: Error) {
  pending.forEach((p) => p.reject(err));
  pending.clear();
}

export function warmUp(): void {
  if (!worker) {
    setStatus("loading");
    worker = spawn();
  }
}

export function getStatus(): EngineStatus {
  return status;
}

export function onStatus(cb: (s: EngineStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function runProgram(
  source: string,
  level: Level,
  seed = 0,
  loadout: Loadout = EMPTY_LOADOUT,
): Promise<FrameLog> {
  warmUp();
  const id = nextId++;
  const msg: WorkerIn = { type: "run", id, source, level, seed, loadout };
  return new Promise<FrameLog>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Зависший воркер убиваем целиком: следующий прогон поднимет новый
      pending.delete(id);
      worker?.terminate();
      worker = null;
      setStatus("idle");
      reject(new Error("Исполнение зависло, движок перезапущен. Попробуй ещё раз."));
    }, HANG_MS);
    pending.set(id, {
      resolve: (log) => {
        clearTimeout(timer);
        resolve(log);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    worker!.postMessage(msg);
  });
}
