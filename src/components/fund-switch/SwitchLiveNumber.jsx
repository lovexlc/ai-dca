import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

export function SwitchLiveNumber({ value, children, className = '' }) {
  const elementRef = useRef(null);
  const previousValueRef = useRef(value);

  useGSAP(() => {
    const current = Number(value);
    const previous = Number(previousValueRef.current);
    previousValueRef.current = value;
    if (!Number.isFinite(current) || !Number.isFinite(previous) || current === previous) return undefined;
    const direction = current >= previous ? -1 : 1;
    const tween = gsap.fromTo(
      elementRef.current,
      { scale: 1.1, y: direction },
      { scale: 1, y: 0, duration: 0.34, ease: 'back.out(1.8)', clearProps: 'transform' }
    );
    return () => tween.kill();
  }, { dependencies: [value], revertOnUpdate: true });

  return (
    <span ref={elementRef} className={className} data-switch-live-number>
      {children}
    </span>
  );
}
