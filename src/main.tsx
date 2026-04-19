import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  document.getElementById("static-seo-content")?.remove();
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
