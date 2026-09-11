// Локальная разработка одним запуском: npm run dev
//
// Поднимает два процесса и сводит их вывод в один терминал:
//   web  — Vite на http://127.0.0.1:5173, горячая перезагрузка фронтенда;
//   api  — uvicorn на http://127.0.0.1:8010, перезапуск при правке .py.
//
// Открывать нужно Vite: он отдаёт фронтенд сам, а запросы к бэкенду
// (/health, /api/…) проксирует на uvicorn — см. server.proxy в
// frontend/vite.config.ts. Так фронтенд и в деве, и на проде ходит
// по относительным путям, без CORS и без разных адресов в коде.
//
// Ctrl+C гасит оба процесса. Если один из них упал сам — второй тоже
// останавливается, чтобы не оставлять в фоне полуживую пару.
//
// Только фронтенд или только бэкенд:  npm run dev:web / npm run dev:api

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";

const WEB_PORT = 5173;
const API_PORT = 8010;

// venv лежит в backend/.venv, как описано в README. Ищем интерпретатор
// именно там, а не в PATH: системный python может оказаться без starlette.
const venvPython = path.join(
  root,
  "backend",
  ".venv",
  isWindows ? "Scripts/python.exe" : "bin/python",
);

// Vite запускаем напрямую тем же node, а не через `npm run dev`:
// на Windows npm — это npm.cmd, которому нужен shell, а shell с аргументами
// Node считает небезопасным и предупреждает при каждом запуске.
const viteBin = path.join(root, "frontend", "node_modules", "vite", "bin", "vite.js");

const PROCESSES = {
  web: {
    color: "\x1b[36m", // голубой
    cwd: path.join(root, "frontend"),
    command: process.execPath,
    // Хост и порт заданы в vite.config.ts, здесь только запрещаем Vite
    // молча уехать на соседний порт, если этот занят.
    args: [viteBin, "--strictPort"],
    check() {
      if (!fs.existsSync(viteBin)) {
        return "нет frontend/node_modules — выполните: cd frontend && npm install";
      }
    },
  },
  api: {
    color: "\x1b[33m", // жёлтый
    cwd: path.join(root, "backend"),
    command: venvPython,
    args: [
      "-m",
      "uvicorn",
      "asgi:app",
      "--reload",
      "--host",
      "127.0.0.1",
      "--port",
      String(API_PORT),
    ],
    // Сборки в деве может и не быть — тогда бэкенд просто не монтирует
    // статику, а /health честно покажет static_ready: false.
    env: { STATIC_DIR: path.join(root, "frontend", "dist") },
    check() {
      if (!fs.existsSync(venvPython)) {
        return (
          "нет backend/.venv — выполните:\n" +
          "  cd backend && python -m venv .venv && " +
          `${isWindows ? ".venv/Scripts/python" : ".venv/bin/python"} -m pip install -r requirements-dev.txt`
        );
      }
    },
  },
};

const RESET = "\x1b[0m";

function parseArgs(argv) {
  const only = argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
  if (only && !(only in PROCESSES)) {
    console.error(`Неизвестный процесс "${only}". Допустимо: ${Object.keys(PROCESSES).join(", ")}`);
    process.exit(2);
  }
  return only ? [only] : Object.keys(PROCESSES);
}

// Каждую строку вывода помечаем именем процесса, иначе в общем потоке
// не отличить, кто именно ругается — Vite или uvicorn.
function pipeWithPrefix(stream, name, color) {
  let tail = "";
  stream.on("data", (chunk) => {
    const lines = (tail + chunk.toString()).split(/\r?\n/);
    tail = lines.pop() ?? "";
    for (const line of lines) {
      process.stdout.write(`${color}[${name}]${RESET} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (tail) process.stdout.write(`${color}[${name}]${RESET} ${tail}\n`);
  });
}

function start(name) {
  const spec = PROCESSES[name];
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env, FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeWithPrefix(child.stdout, name, spec.color);
  pipeWithPrefix(child.stderr, name, spec.color);
  return child;
}

function main() {
  const names = parseArgs(process.argv.slice(2));

  const problems = names.map((name) => PROCESSES[name].check?.()).filter(Boolean);
  if (problems.length) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    process.exit(1);
  }

  const children = new Map(names.map((name) => [name, start(name)]));
  let shuttingDown = false;

  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children.values()) {
      if (child.exitCode === null) {
        // На Windows child.kill() не трогает потомков (uvicorn --reload
        // порождает рабочий процесс), поэтому валим всё дерево через taskkill.
        if (isWindows) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          child.kill("SIGTERM");
        }
      }
    }
    // Даём процессам мгновение закрыть порты, иначе следующий запуск
    // упрётся в «address already in use».
    setTimeout(() => process.exit(code), 300);
  }

  for (const [name, child] of children) {
    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      const reason = signal ? `по сигналу ${signal}` : `с кодом ${code}`;
      console.error(`\n${PROCESSES[name].color}[${name}]${RESET} завершился ${reason}, останавливаю остальное`);
      shutdown(code ?? 1);
    });
    child.on("error", (error) => {
      console.error(`\n[${name}] не запустился: ${error.message}`);
      shutdown(1);
    });
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  console.log(
    [
      "",
      `  web  http://127.0.0.1:${WEB_PORT}        ← открывать это`,
      `  api  http://127.0.0.1:${API_PORT}/health   (доступен и через web: /health)`,
      "",
    ].join("\n"),
  );
}

main();
