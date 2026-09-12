// Сверка двух интерпретаторов: симулятор внутри Pyodide (тот же пакет, что
// уезжает в браузер) против обычного CPython.
//
// Симулятор один, интерпретаторов два, и checksum лога обязан совпадать
// побайтово — иначе медали и перемотка поедут между CI и браузером.
// Запуск из корня репозитория:
//
//     node tools/check_pyodide.mjs
//
// Скрипт гоняет решение каждого уровня из content/levels в Pyodide, а
// эталонный checksum берёт из CPython (backend/.venv). Расхождение — ошибка.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIM = join(ROOT, "simulator");
const PYTHON = join(ROOT, "backend", ".venv", "Scripts", "python.exe");

// Pyodide стоит в frontend/node_modules — берём его оттуда же, откуда сборка
const require = createRequire(join(ROOT, "frontend", "package.json"));
const pyodideDir = dirname(require.resolve("pyodide/package.json"));
const { loadPyodide } = await import(pathToFileURL(join(pyodideDir, "pyodide.mjs")).href);

const py = await loadPyodide();
py.FS.mkdir("/sim");
py.FS.mkdir("/sim/simulator");
for (const name of readdirSync(SIM).filter((f) => f.endsWith(".py"))) {
  py.FS.writeFile(`/sim/simulator/${name}`, readFileSync(join(SIM, name), "utf-8"));
}
py.runPython("import sys; sys.path.insert(0, '/sim')");
const runner = py.pyimport("simulator.runner");
const pyodideVersion = py.runPython("import sys; sys.version.split()[0]");

// Уровни и эталоны считает CPython — там есть YAML и схема
const reference = JSON.parse(
  execFileSync(
    PYTHON,
    [
      "-c",
      `
import json, sys
sys.path.insert(0, ".")
from simulator import run
from tools.level_schema import level_paths, load_level
out = {}
for path in level_paths():
    level = load_level(path)
    public = level.public_dict()
    log = run(level.solution, public)
    out[level.id] = {"level": public, "solution": level.solution, "checksum": log["checksum"],
                     "status": log["outcome"]["status"], "python": sys.version.split()[0]}
print(json.dumps(out))
`,
    ],
    { cwd: ROOT, encoding: "utf-8" },
  ),
);

let bad = 0;
for (const [id, ref] of Object.entries(reference)) {
  const log = JSON.parse(runner.run_json(ref.solution, JSON.stringify(ref.level), 0, null));
  const same = log.checksum === ref.checksum && log.outcome.status === ref.status;
  if (!same) bad++;
  console.log(
    `${same ? "✓" : "✗"} ${id}  CPython ${ref.python}: ${ref.checksum.slice(0, 12)} ${ref.status}` +
      `  Pyodide ${pyodideVersion}: ${log.checksum.slice(0, 12)} ${log.outcome.status}`,
  );
}
process.exit(bad ? 1 : 0);
