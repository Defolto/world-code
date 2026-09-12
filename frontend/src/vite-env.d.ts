/// <reference types="vite/client" />

// Уровни из content/levels/*.yaml, собирает плагин levels-from-yaml в vite.config.ts.
// Без solution и hints — они вырезаются на сборке.
declare module "virtual:levels" {
  import type { Level } from "./engine/types";
  const levels: Record<string, Level>;
  export default levels;
}
