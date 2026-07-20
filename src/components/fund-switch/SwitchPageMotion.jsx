import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

function setStaticState(root) {
  const items = gsap.utils.toArray('[data-switch-motion-item]', root);
  if (items.length) gsap.set(items, { autoAlpha: 1, y: 0, clearProps: 'transform,visibility' });
}

export function SwitchPageMotion({ children, className = '', motionKey = '' }) {
  const rootRef = useRef(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          reduceMotion: '(prefers-reduced-motion: reduce)'
        },
        ({ conditions }) => {
          const items = gsap.utils.toArray('[data-switch-motion-item]', rootRef.current);
          if (!items.length || conditions.reduceMotion) {
            setStaticState(rootRef.current);
            return undefined;
          }

          const timeline = gsap.timeline({
            defaults: { duration: 0.34, ease: 'power2.out' }
          });
          timeline.fromTo(
            items,
            { autoAlpha: 0, y: 12 },
            { autoAlpha: 1, y: 0, stagger: 0.055, clearProps: 'transform,visibility' }
          );
          return () => timeline.kill();
        },
        rootRef
      );

      return () => media.revert();
    },
    { scope: rootRef, dependencies: [motionKey], revertOnUpdate: true }
  );

  return (
    <div ref={rootRef} className={className} data-switch-motion-root>
      {children}
    </div>
  );
}

export function SwitchReveal({ children, className = '' }) {
  const rootRef = useRef(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        { reduceMotion: '(prefers-reduced-motion: reduce)' },
        ({ conditions }) => {
          if (!rootRef.current || conditions.reduceMotion) {
            if (rootRef.current) gsap.set(rootRef.current, { autoAlpha: 1, y: 0 });
            return undefined;
          }
          const tween = gsap.fromTo(
            rootRef.current,
            { autoAlpha: 0, y: 10 },
            { autoAlpha: 1, y: 0, duration: 0.28, ease: 'power2.out', clearProps: 'transform,visibility' }
          );
          return () => tween.kill();
        },
        rootRef
      );
      return () => media.revert();
    },
    { scope: rootRef }
  );

  return (
    <div ref={rootRef} className={className} data-switch-reveal>
      {children}
    </div>
  );
}
