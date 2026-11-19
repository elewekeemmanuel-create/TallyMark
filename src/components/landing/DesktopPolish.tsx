import React, { useEffect, useRef, useState } from 'react';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Desktop-only subtle context cursor for fine pointers (`Stamp`, `Drag`, `Open`).
 * Automatically disabled on touch devices and when prefers-reduced-motion is enabled.
 */
export function DesktopContextCursor() {
  const reducedMotion = usePrefersReducedMotion();
  const [enabled, setEnabled] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const cursorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (reducedMotion || typeof window === 'undefined' || !window.matchMedia) {
      setEnabled(false);
      return;
    }
    const mq = window.matchMedia('(pointer: fine) and (hover: hover)');
    const update = () => setEnabled(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [reducedMotion]);

  useEffect(() => {
    if (!enabled) return;

    let rafId = 0;
    let targetX = -100;
    let targetY = -100;

    const onMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      setVisible(true);

      const target = (e.target as HTMLElement | null)?.closest?.('[data-cursor]');
      const cursorTag = target?.getAttribute('data-cursor') || null;
      setLabel(cursorTag);

      if (!rafId) {
        rafId = window.requestAnimationFrame(() => {
          rafId = 0;
          if (cursorRef.current) {
            cursorRef.current.style.transform = `translate3d(${targetX + 14}px, ${targetY + 14}px, 0)`;
          }
        });
      }
    };

    const onLeave = () => setVisible(false);

    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, [enabled]);

  if (!enabled || !visible || !label) return null;

  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-50 hidden md:flex items-center border border-[#121513]/20 dark:border-[#F4F1EA]/25 bg-[#121513] dark:bg-[#F4F1EA] text-[#FAF8F3] dark:text-[#121513] px-2.5 py-1 rounded-md font-mono-num text-[10px] font-semibold uppercase tracking-[0.12em] shadow-md transition-opacity duration-150"
      style={{ willChange: 'transform' }}
    >
      {label}
    </div>
  );
}

/**
 * Subtle magnetic displacement on desktop fine-pointer buttons, strictly respecting reduced-motion.
 */
export function MagneticWrap({
  children,
  className = '',
  strength = 0.18,
}: {
  children: React.ReactNode;
  className?: string;
  strength?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reducedMotion || !ref.current) return;
    if (typeof window !== 'undefined' && !window.matchMedia('(pointer: fine)').matches) return;
    const rect = ref.current.getBoundingClientRect();
    const dx = (e.clientX - (rect.left + rect.width / 2)) * strength;
    const dy = (e.clientY - (rect.top + rect.height / 2)) * strength;
    ref.current.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
  };

  const handleLeave = () => {
    if (ref.current) {
      ref.current.style.transform = 'translate3d(0px, 0px, 0)';
    }
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`inline-block transition-transform duration-200 ease-out ${className}`}
    >
      {children}
    </div>
  );
}
