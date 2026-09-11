import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Макеты дизайна — отдельные страницы, каждая со своей темой.
// Лежат в maketN/index.html, собираются в dist/maketN/index.html и
// открываются по /maketN/ — бэкенд отдаёт их как обычную статику.
const MAKETS = ["maket1", "maket2", "maket3", "maket4", "maket5"];

// Без слеша на конце (/maket1) Vite молча отдал бы главную через SPA-fallback,
// а на сервере Starlette в том же случае перенаправляет на /maket1/. Делаем
// в деве то же самое, чтобы поведение не расходилось.
const trailingSlash: Plugin = {
  name: "makets-trailing-slash",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // @types/node в проекте нет, поэтому у req по типам нет url
      const [path, query] = ((req as { url?: string }).url ?? "").split("?");
      if (MAKETS.includes(path.slice(1))) {
        res.statusCode = 301;
        res.setHeader("Location", `${path}/${query ? `?${query}` : ""}`);
        res.end();
        return;
      }
      next();
    });
  },
};

// Порт uvicorn в деве, тот же, что в dev.mjs в корне проекта.
const API = "http://127.0.0.1:8010";

// Сборка уезжает в dist/ и деплоем подменяется как static/ в корне сайта.
// base оставляем "/", сайт живёт на своём домене, а не в подпапке.
export default defineConfig({
  plugins: [react(), trailingSlash],
  server: {
    // IPv4 явно: без host Vite слушает только [::1], и часть окружений
    // (WSL, старые прокси, curl из Git Bash) до него не достучится.
    // Бэкенд тоже сидит на 127.0.0.1, так что адреса в браузере и в
    // прокси совпадают, и cookies потом не разъедутся по хостам.
    host: "127.0.0.1",
    port: 5173,
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
        ...Object.fromEntries(MAKETS.map((m) => [m, `${m}/index.html`])),
      },
    },
    // Понадобится, когда рядом ляжет Pyodide: разбираться в сборке
    // из семи мегабайт wasm без карт исходников невозможно.
    sourcemap: true,
  },
});
