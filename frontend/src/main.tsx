import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./components/Landing";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Нет #root в index.html");

createRoot(root).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
