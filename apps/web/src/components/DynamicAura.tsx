import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * A shader-inspired atmosphere built from composited layers. The movement is
 * intentionally limited to transform and opacity so it stays cheap, legible,
 * and respectful of reduced-motion preferences.
 */
export function DynamicAura() {
  const reduced = useReducedMotion();
  const auraRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const aura = auraRef.current;
    if (!aura || reduced) return undefined;

    const onPointerMove = (event: PointerEvent): void => {
      const x = (event.clientX / window.innerWidth - 0.5) * 2;
      const y = (event.clientY / window.innerHeight - 0.5) * 2;
      aura.style.setProperty('--pointer-x', x.toFixed(3));
      aura.style.setProperty('--pointer-y', y.toFixed(3));
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [reduced]);

  return (
    <div ref={auraRef} className={`dynamic-aura ${reduced ? 'is-static' : ''}`} aria-hidden="true">
      <div className="aura-grid" />
      <div className="aura-orb aura-orb-primary" />
      <div className="aura-orb aura-orb-secondary" />
      <div className="aura-orb aura-orb-horizon" />
      <div className="aura-scanline" />
      <div className="aura-grain" />
    </div>
  );
}
