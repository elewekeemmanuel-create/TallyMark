import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TallymarkEmblem } from '../TallymarkLogo';
import { usePrefersReducedMotion } from './DesktopPolish';

const SESSION_PRELOADER_KEY = 'tallymark_landing_intro_seen_v1';

/**
 * Short, skippable receipt-printing intro shown at most once per browser session.
 * Automatically bypassed when `prefers-reduced-motion` is enabled so zero delay occurs.
 */
export function ReceiptPreloader() {
  const reducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    try {
      return window.sessionStorage.getItem(SESSION_PRELOADER_KEY) !== '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!visible || reducedMotion) {
      setVisible(false);
      return;
    }

    try {
      window.sessionStorage.setItem(SESSION_PRELOADER_KEY, '1');
    } catch {
      // ignore storage errors
    }

    const timer = window.setTimeout(() => {
      setVisible(false);
    }, 1050);

    return () => window.clearTimeout(timer);
  }, [visible, reducedMotion]);

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(SESSION_PRELOADER_KEY, '1');
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          className="fixed inset-0 z-50 bg-[#FAF8F3] dark:bg-[#0D110F] flex flex-col items-center justify-center px-6"
          role="dialog"
          aria-label="Opening Tallymark"
        >
          <div className="w-full max-w-[280px]">
            {/* Printer slot lip */}
            <div className="h-3 rounded-t-lg bg-[#1C211E] dark:bg-[#232B27] border-b-2 border-[#B89B6A]" />

            {/* Paper feeding downward */}
            <div className="overflow-hidden px-3">
              <motion.div
                initial={{ y: -135 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                className="receipt-paper-grain receipt-serrated-bottom border-x border-b border-[#DED6C2] px-4 py-5 text-[#121513] shadow-sm space-y-2"
              >
                <div className="flex items-center justify-between text-[11px] font-mono-num text-[#5C635D]">
                  <span>RCT-0001</span>
                  <span>WAT</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <TallymarkEmblem className="w-5 h-5" />
                  <span className="font-display text-2xl leading-none">Tallymark</span>
                </div>
                <div className="border-t border-dashed border-[#C9B99A] pt-2 flex justify-between font-mono-num text-xs">
                  <span>Counter ready</span>
                  <span className="font-semibold text-[#064E3B]">₦0.00</span>
                </div>
              </motion.div>
            </div>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="mt-8 text-xs font-medium text-[#5C635D] dark:text-[#9BA39D] hover:text-[#121513] dark:hover:text-[#F4F1EA] underline underline-offset-4 min-h-[44px] px-4"
          >
            Skip intro
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
