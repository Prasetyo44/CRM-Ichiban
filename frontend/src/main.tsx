import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AppShell from "./AppShell";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root tidak ditemukan");

createRoot(root).render(
  <StrictMode>
    <AppShell
      apiBaseUrl={import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000"}
      agentId={import.meta.env.VITE_AGENT_ID ?? ""}
    />
  </StrictMode>,
);
