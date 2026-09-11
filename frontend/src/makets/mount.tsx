import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Switcher } from "./Switcher";
import "../styles/global.css";

/**
 * Монтирует макет: общий сброс стилей, сама страница, переключатель.
 * Тему макет подключает сам, после этого модуля — так её :root
 * переопределяет токены из global.css, а не наоборот.
 */
export function mount(page: ReactNode, current: number) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Нет #root в index.html");

  createRoot(root).render(
    <StrictMode>
      {page}
      <Switcher current={current} />
    </StrictMode>,
  );
}
