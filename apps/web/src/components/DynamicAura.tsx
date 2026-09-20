import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * One soft light source behind the page, nudged by the pointer.
 *
 * Deliberately a single blurred element: large blurred layers are the most
 * expensive thing a background can do on a phone, so there is exactly one.
 * The pointer writes CSS custom properties directly rather than React state,
 * so moving the mouse never re-renders the tree.
 */
export function DynamicAura({ paused = false }: { readonly paused?: boolean }) {
  const reduced = useReducedMotion();
  const auraRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const aura = auraRef.current;
    if (!aura || reduced || paused) return undefined;

    let frame = 0;
    const onPointerMove = (event: PointerEvent): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        aura.style.setProperty('--pointer-x', x.toFixed(3));
        aura.style.setProperty('--pointer-y', y.toFixed(3));
      });
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [paused, reduced]);

  return (
    <div ref={auraRef} className={`dynamic-aura ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      <div className="aura-orb" />
      <div className="aura-grain" />
    </div>
  );
}
