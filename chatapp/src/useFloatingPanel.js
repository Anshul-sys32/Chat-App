import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MARGIN = 8;

export default function useFloatingPanel(open, onDismiss) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [style, setStyle] = useState(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return undefined;
    const updatePosition = () => {
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const trigger = triggerRef.current.getBoundingClientRect();
      const panel = panelRef.current.getBoundingClientRect();
      const maxWidth = Math.max(0, viewportWidth - MARGIN * 2);
      const maxHeight = Math.max(0, viewportHeight - MARGIN * 2);
      const width = Math.min(panel.width, maxWidth);
      const height = Math.min(panel.height, maxHeight);
      const left = Math.min(
        Math.max(trigger.left, viewportLeft + MARGIN),
        viewportLeft + viewportWidth - width - MARGIN,
      );
      const below = trigger.bottom + 6;
      const above = trigger.top - height - 6;
      const top = Math.min(
        Math.max(below + height <= viewportTop + viewportHeight - MARGIN ? below : above, viewportTop + MARGIN),
        viewportTop + viewportHeight - height - MARGIN,
      );
      setStyle({ left, top, width, maxWidth, maxHeight });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event) => {
      if (panelRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      onDismiss?.();
    };
    const dismissOnEscape = (event) => {
      if (event.key === "Escape") onDismiss?.();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open, onDismiss]);

  return { triggerRef, panelRef, style };
}
