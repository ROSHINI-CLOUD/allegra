/**
 * Ref-counted page scroll lock. Several overlays (auth dialog, immersive player,
 * artist card) can be open at once; each saving/restoring `overflow` on its own
 * lets a later restore write "hidden" back and freeze the page. Count instead:
 * the first lock applies, the last unlock clears.
 */
let locks = 0;

export function lockScroll(): () => void {
  const root = document.documentElement;
  const body = document.body;
  locks += 1;
  if (locks === 1) {
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0) {
      root.style.overflow = '';
      body.style.overflow = '';
      root.style.overscrollBehavior = '';
      body.style.overscrollBehavior = '';
    }
  };
}
