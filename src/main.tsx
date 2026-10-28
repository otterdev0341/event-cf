import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import "@fontsource/noto-sans-thai/800.css";
import App from "./App";
import "./tailwind.css";
import "./styles.css";
import "./ui-refinement.css";
import "./workspace-design.css";
import "./minimal-workspace.css";
import "./redesign.css";
import "./pickers.css";
import "./button-motion.css";
import { InterfaceMotion } from './components/InterfaceMotion';

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InterfaceMotion />
    <App />
  </StrictMode>,
);
