import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function useDialogFocus(open, onClose) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const focusable = () => [...dialog.querySelectorAll(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
    (focusable()[0] || dialog).focus({ preventScroll: true });

    const containFocus = (event) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const containFocusTarget = (event) => {
      if (!dialog.contains(event.target)) (focusable()[0] || dialog).focus({ preventScroll: true });
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current?.();
    };
    document.addEventListener('keydown', containFocus, true);
    document.addEventListener('keydown', closeOnEscape, true);
    document.addEventListener('focusin', containFocusTarget, true);
    return () => {
      document.removeEventListener('keydown', containFocus, true);
      document.removeEventListener('keydown', closeOnEscape, true);
      document.removeEventListener('focusin', containFocusTarget, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  return dialogRef;
}
