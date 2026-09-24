import { useEffect } from 'react';

/**
 * Traps keyboard focus inside an overlay and hands it back on close.
 *
 * Covers the two focus rules in DESIGN.md §7 that scroll-locking and an
 * Escape handler do not: Tab must not leave the overlay while it is open,
 * and focus must return to the control that opened it once it closes. It
 * does not touch scroll locking or Escape — those already live with each
 * overlay (App.tsx for the player, each dialog's own keydown effect).
 *
 * A component that already moves focus somewhere specific on open (a field,
 * a close button) keeps doing that: this hook only steps in when nothing
 * inside the container is focused yet, so it layers on top rather than
 * fighting it.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function useFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement | null>): void {
  // Capture the opener and move focus in, restoring on close/unmount via this effect's cleanup.
  useEffect(() => {
    if (!active) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = containerRef.current;
    if (container && !container.contains(document.activeElement)) {
      focusableElements(container)[0]?.focus();
    }

    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [active, containerRef]);

  // Cycle Tab/Shift+Tab between the container's own focusable elements while open.
  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(container);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey) {
        if (current === first) {
          event.preventDefault();
          last?.focus();
        }
      } else if (current === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [active, containerRef]);
}
