import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";

const FRONTEND = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(FRONTEND, "..");

// Отдельные страницы: макеты дизайна (/maketN/) и игра (/play/).
// Лежат в <имя>/index.html, собираются в dist/<имя>/index.html — бэкенд
// отдаёт их как обычную статику.
const MAKETS = ["maket1", "maket2", "maket3", "maket4", "maket5"];
const PAGES = [...MAKETS, "play"];

// Без слеша на конце (/maket1) Vite молча отдал бы главную через SPA-fallback,
// а на сервере Starlette в том же случае перенаправляет на /maket1/. Делаем
// в деве то же самое, чтобы поведение не расходилось.
const trailingSlash: Plugin = {
  name: "pages-trailing-slash",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const [path, query] = (req.url ?? "").split("?");
      if (PAGES.includes(path.slice(1))) {
        res.statusCode = 301;
        res.setHeader("Location", `${path}/${query ? `?${query}` : ""}`);
        res.end();
        return;
      }
      next();
    });
  },
};

// ─── Уровни: content/levels/*.yaml → модуль virtual:levels ───
//
// `solution` и `hints` вырезаются здесь, шагом сборки, а не бэкендом:
// хостинг раздаёт статику, и исполнение целиком клиентское. Список полей
// продублирован в tools/level_schema.py (STRIPPED) — тест сверяет, что
// они совпадают. Валидацию формата делает Pydantic в CI, здесь только
// вырезка: две схемы на один YAML нам не нужны.
const LEVELS_DIR = join(REPO, "content", "levels");
const STRIPPED = ["solution", "hints"];
const LEVELS_ID = "virtual:levels";

const levels: Plugin = {
  name: "levels-from-yaml",
  resolveId(id) {
    return id === LEVELS_ID ? `\0${LEVELS_ID}` : undefined;
  },
  load(id) {
    if (id !== `\0${LEVELS_ID}`) return;
    const all: Record<string, unknown> = {};
    for (const file of readdirSync(LEVELS_DIR).filter((f) => f.endsWith(".yaml")).sort()) {
      const path = join(LEVELS_DIR, file);
      this.addWatchFile(path);
      const level = loadYaml(readFileSync(path, "utf-8")) as Record<string, unknown>;
      for (const key of STRIPPED) delete level[key];
      all[level.id as string] = level;
    }
    return `export default ${JSON.stringify(all)};`;
  },
  configureServer(server) {
    // Правка YAML в деве — перезагрузка страницы, как правка исходника
    server.watcher.add(LEVELS_DIR);
    server.watcher.on("change", (path) => {
      if (path.startsWith(LEVELS_DIR)) {
        const mod = server.moduleGraph.getModuleById(`\0${LEVELS_ID}`);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      }
    });
  },
};

// ─── Pyodide: свой хостинг, без CDN ───
//
// Пакет `pyodide` из npm раздаётся по /pyodide/ как есть: в деве —
// middleware из node_modules, в сборке — копия в dist/pyodide. В бандл
// он не попадает, воркер грузит pyodide.mjs динамическим import по URL:
// Vite плохо переваривает wasm-загрузчик, а самому Pyodide бандлер не
// нужен. Имена файлов без хэша — кэш на них ставит Service Worker (см.
// решения по хостингу), пока — обычный кэш браузера.
const PYODIDE_SRC = join(FRONTEND, "node_modules", "pyodide");
const PYODIDE_FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];
const TYPES: Record<string, string> = {
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
  ".json": "application/json",
};

const pyodide: Plugin = {
  name: "pyodide-static",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "").split("?")[0];
      if (!path.startsWith("/pyodide/")) return next();
      const name = basename(path);
      const file = join(PYODIDE_SRC, name);
      if (!PYODIDE_FILES.includes(name) || !existsSync(file)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("Content-Type", TYPES[extname(name)] ?? "application/octet-stream");
      res.setHeader("Content-Length", statSync(file).size);
      createReadStream(file).pipe(res);
    });
  },
  writeBundle(options) {
    const out = join(options.dir ?? join(FRONTEND, "dist"), "pyodide");
    mkdirSync(out, { recursive: true });
    for (const name of PYODIDE_FILES) copyFileSync(join(PYODIDE_SRC, name), join(out, name));
  },
};

// Порт uvicorn в деве, тот же, что в dev.mjs в корне проекта.
const API = "http://127.0.0.1:8010";

// Сборка уезжает в dist/ и деплоем подменяется как www/ в корне сайта.
// base оставляем "/", сайт живёт на своём домене, а не в подпапке.
export default defineConfig({
  plugins: [react(), trailingSlash, levels, pyodide],
  server: {
    // IPv4 явно: без host Vite слушает только [::1], и часть окружений
    // (WSL, старые прокси, curl из Git Bash) до него не достучится.
    // Бэкенд тоже сидит на 127.0.0.1, так что адреса в браузере и в
    // прокси совпадают, и cookies потом не разъедутся по хостам.
    host: "127.0.0.1",
    port: 5173,
    // Симулятор лежит в корне репозитория (он общий для браузера и CI),
    // воркер импортирует его исходники через ?raw — разрешаем выход из frontend/
    fs: { allow: [REPO] },
    // В деве фронтенд отдаёт Vite, а всё, что относится к бэкенду,
    // уходит на uvicorn. Поэтому в коде клиента только относительные
    // пути — они одинаково работают и здесь, и на проде, где всё
    // раздаёт один ASGI-процесс.
    proxy: {
      "/health": API,
      "/api": API,
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        // Пути относительно root, то есть каталога frontend/
        main: "index.html",
        ...Object.fromEntries(PAGES.map((p) => [p, `${p}/index.html`])),
      },
    },
    // Рядом лежит Pyodide: разбираться в сборке из семи мегабайт wasm
    // без карт исходников невозможно.
    sourcemap: true,
  },
});
