import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css"; // if you have global styles

const rootElement = document.documentElement;
let viewportUpdateFrame = 0;

const updateViewportMetrics = () => {
  if (viewportUpdateFrame) return;
  viewportUpdateFrame = window.requestAnimationFrame(() => {
    viewportUpdateFrame = 0;
    const visualViewport = window.visualViewport;
    const visibleHeight = visualViewport?.height || window.innerHeight;
    const layoutWidth = rootElement.clientWidth || window.innerWidth;

    rootElement.style.setProperty("--app-height", `${visibleHeight.toFixed(2)}px`);
    rootElement.style.setProperty("--app-width", `${layoutWidth}px`);
  });
};

updateViewportMetrics();
window.addEventListener("resize", updateViewportMetrics, { passive: true });
window.addEventListener("orientationchange", updateViewportMetrics, { passive: true });
window.visualViewport?.addEventListener("resize", updateViewportMetrics, { passive: true });
window.visualViewport?.addEventListener("scroll", updateViewportMetrics, { passive: true });
document.addEventListener("visibilitychange", updateViewportMetrics, { passive: true });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
