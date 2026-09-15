import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Stats } from "../components/Stats";
import "../styles/global.css";

// Страница методиста: /stats/. Пароль спрашивает сервер (HTTP Basic),
// здесь только таблица
const root = document.getElementById("root");
if (!root) throw new Error("Нет #root в index.html");

createRoot(root).render(
  <StrictMode>
    <Stats />
  </StrictMode>,
);
