import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import "@fontsource/noto-sans-thai/800.css";
import "@fontsource/inter/400.css";
import App from "./App";
import "./styles.css";
import "./ui-refinement.css";
import "./workspace-design.css";
import "./minimal-workspace.css";
import "./dashboard.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { InterfaceMotion } from './components/InterfaceMotion';

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InterfaceMotion />
    <App />
  </StrictMode>,
);
