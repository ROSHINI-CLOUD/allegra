import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

import { gsapTokens } from '../motion';

/**
 * Word-by-word entrance for the hero headline. Framer Motion handles the
 * surrounding page/section transitions elsewhere in App.tsx; this is the one
 * spot that wants a hand-tuned stagger timeline, which is GSAP's actual
 * strength over declarative variants.
 */
export function GsapHeroHeadline() {
  const scope = useRef<HTMLHeadingElement>(null);

  useGSAP(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const words = gsap.utils.toArray<HTMLElement>('.gsap-word', scope.current);
    if (words.length === 0) return;

    if (reducedMotion) {
      gsap.set(words, { opacity: 1, y: 0 });
      return;
    }

    gsap.set(words, { opacity: 0, y: gsapTokens.hero.distance });
    gsap.to(words, {
      opacity: 1,
      y: 0,
      duration: gsapTokens.hero.duration,
      ease: gsapTokens.hero.ease,
      stagger: gsapTokens.hero.stagger,
      delay: gsapTokens.hero.delay
    });
  }, { scope });

  return (
    <h1 ref={scope}>
      <span className="gsap-word inline-block will-change-transform">Good</span> <span className="gsap-word inline-block will-change-transform">music.</span>
      <br />
      <em>
        <span className="gsap-word inline-block will-change-transform">Ready</span> <span className="gsap-word inline-block will-change-transform">when</span> <span className="gsap-word inline-block will-change-transform">you</span> <span className="gsap-word inline-block will-change-transform">are.</span>
      </em>
    </h1>
  );
}
