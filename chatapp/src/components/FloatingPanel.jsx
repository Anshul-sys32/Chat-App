import { createPortal } from "react-dom";
const MARGIN = 8;

export default function FloatingPanel({ open, panelRef, style, children, className = "" }) {
  if (!open) return null;
  const portalRoot = document.querySelector(".app-theme") || document.body;
  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: style?.left ?? MARGIN,
        top: style?.top ?? MARGIN,
        width: style?.width,
        maxWidth: style?.maxWidth ?? `calc(100vw - ${MARGIN * 2}px)`,
        maxHeight: style?.maxHeight ?? `calc(100dvh - ${MARGIN * 2}px)`,
        visibility: style ? "visible" : "hidden",
      }}
      className={`z-[100] overflow-y-auto overscroll-contain ${className}`}
    >
      {children}
    </div>,
    portalRoot,
  );
}
