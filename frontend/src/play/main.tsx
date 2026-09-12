import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Play } from "../components/Play";
import "../styles/global.css";

// Уровень выбирается параметром: /play/?level=start-01. Роутера пока нет —
// одна страница, один параметр; появится список уроков — появится и роутер.
const params = new URLSearchParams(window.location.search);
const levelId = params.get("level") ?? "start-01";

const root = document.getElementById("root");
if (!root) throw new Error("Нет #root в index.html");

createRoot(root).render(
  <StrictMode>
    <Play levelId={levelId} />
  </StrictMode>,
);
