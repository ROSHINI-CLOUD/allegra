import { useCallback, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * Pointer-driven press state mirrored onto `data-pressed`.
 *
 * CSS :active is unreliable on iOS Safari, where it can fail to fire or stick
 * after a scroll, so controls that need dependable press feedback read the
 * attribute instead. Spread onto the element alongside its own handlers.
 */
export function usePress(): {
  readonly 'data-pressed': 'true' | undefined;
  readonly onPointerDown: (event: ReactPointerEvent) => void;
  readonly onPointerUp: () => void;
  readonly onPointerLeave: () => void;
  readonly onPointerCancel: () => void;
} {
  const [pressed, setPressed] = useState(false);
  const release = useCallback((): void => setPressed(false), []);
  const press = useCallback((event: ReactPointerEvent): void => {
    if (event.button === 0) setPressed(true);
  }, []);

  return {
    'data-pressed': pressed ? 'true' : undefined,
    onPointerDown: press,
    onPointerUp: release,
    onPointerLeave: release,
    onPointerCancel: release
  };
}
