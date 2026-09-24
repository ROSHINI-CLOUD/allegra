import { useEffect, useState } from 'react';

/**
 * True below the app's phone breakpoint (matches the `@media (max-width: 900px)`
 * rules in app.css). Used to gate mobile-only interactions - e.g. swipe gestures -
 * that have no equivalent affordance on desktop.
 */
export function useNarrowViewport(breakpoint = 900): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = (): void => setIsNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [breakpoint]);

  return isNarrow;
}
