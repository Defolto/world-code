import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Сборка уезжает в dist/ и деплоем подменяется как static/ в корне сайта.
// base оставляем "/", сайт живёт на своём домене, а не в подпапке.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // Понадобится, когда рядом ляжет Pyodide: разбираться в сборке
    // из семи мегабайт wasm без карт исходников невозможно.
    sourcemap: true,
  },
});
