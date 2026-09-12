// Воркер исполнения. Внутри — Pyodide, а в нём рядом код ученика и
// симулятор мира (тот же simulator/ из корня репозитория, что гоняется в CI).
//
// Границу воркер ↔ главный поток пересекают только строки: исходник туда,
// JSON лога обратно. Никаких PyProxy наружу — им нужно ручное освобождение,
// и течь они начинают тихо.

import type { PyodideInterface } from "pyodide";
import type { FrameLog, Level, Loadout } from "./types";

export type WorkerIn = {
  type: "run";
  id: number;
  source: string;
  level: Level;
  seed: number;
  loadout: Loadout;
};

export type WorkerOut =
  | { type: "status"; stage: "loading" | "ready" }
  | { type: "result"; id: number; log: FrameLog }
  | { type: "failure"; id: number | null; message: string };

// Исходники симулятора попадают в бандл как текст. Только верхний
// уровень пакета: tests/ в браузере не нужны.
const SIMULATOR = import.meta.glob("../../../simulator/*.py", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const post = (msg: WorkerOut) => self.postMessage(msg);

async function boot(): Promise<(source: string, level: string, seed: number, loadout: string) => string> {
  post({ type: "status", stage: "loading" });
  // Pyodide раздаётся по /pyodide/ как есть (см. vite.config.ts), а не
  // бандлится: import по URL, чтобы Vite не пытался его переваривать.
  const base = `${self.location.origin}/pyodide/`;
  const { loadPyodide } = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as {
    loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInterface>;
  };
  const py = await loadPyodide({ indexURL: base });

  py.FS.mkdir("/sim");
  py.FS.mkdir("/sim/simulator");
  for (const [path, text] of Object.entries(SIMULATOR)) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    py.FS.writeFile(`/sim/simulator/${name}`, text);
  }
  py.runPython("import sys; sys.path.insert(0, '/sim')");
  const runner = py.pyimport("simulator.runner");
  post({ type: "status", stage: "ready" });
  return runner.run_json;
}

const ready = boot();

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type !== "run") return;
  try {
    const runJson = await ready;
    const out = runJson(msg.source, JSON.stringify(msg.level), msg.seed, JSON.stringify(msg.loadout));
    post({ type: "result", id: msg.id, log: JSON.parse(out) as FrameLog });
  } catch (err) {
    post({ type: "failure", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};

ready.catch((err) => post({ type: "failure", id: null, message: `Pyodide не загрузился: ${String(err)}` }));
