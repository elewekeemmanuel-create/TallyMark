import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, CheckCheck, Mic, Receipt, BookOpen } from 'lucide-react';
import { usePrefersReducedMotion } from './DesktopPolish';

interface StoryStep {
  step: string;
  title: string;
  summary: string;
  detail: string;
}

const STORY_STEPS: StoryStep[] = [
  {
    step: '01',
    title: 'Type or speak the sale',
    summary: 'Enter items on a thumb-sized keypad or dictate naturally in plain English.',
    detail:
      'Tap saved customers and prices, or tap the mic at the counter. Your draft stays safe on the phone even if the network blinks.',
  },
  {
    step: '02',
    title: 'Share the receipt on WhatsApp',
    summary: 'Send a numbered receipt with a crisp link preview and QR check in one tap.',
    detail:
      'No blurry photo of a carbon booklet. Customers open their verified link or download a clean PDF immediately.',
  },
  {
    step: '03',
    title: 'Close the day and see the summary',
    summary: 'Every sale, debt payment, and expense lands in your daily cash book automatically.',
    detail:
      'Compare actual cash in the drawer against your expected cash, keep Transfer and POS separate, and lock the day cleanly.',
  },
];

export function ScrollStorySection() {
  const reducedMotion = usePrefersReducedMotion();
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const observers: IntersectionObserver[] = [];

    stepRefs.current.forEach((el, idx) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
              setActiveStep(idx);
            }
          });
        },
        { threshold: [0.45, 0.7], rootMargin: '-18% 0px -30% 0px' }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  return (
    <section
      id="how-it-works"
      className="border-t border-[#E5DEC9] dark:border-[#242D28] bg-[#F3EFE6]/65 dark:bg-[#111714]"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
        <div className="max-w-2xl mb-10 lg:mb-14">
          <p className="label-caps text-[#064E3B] dark:text-[#10B981]">How it works</p>
          <h2 className="mt-2 font-display text-[34px] sm:text-[46px] leading-[1.03] text-[#121513] dark:text-[#F4F1EA] [text-wrap:balance]">
            From the shop counter to a closed cash book in three steps.
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left: Scroll & Click Trigger Beats */}
          <div className="lg:col-span-5 space-y-4">
            {STORY_STEPS.map((item, idx) => {
              const isActive = activeStep === idx;
              return (
                <button
                  key={item.step}
                  ref={(el) => {
                    stepRefs.current[idx] = el;
                  }}
                  type="button"
                  onClick={() => setActiveStep(idx)}
                  aria-current={isActive ? 'step' : undefined}
                  className={`w-full text-left rounded-2xl border p-5 sm:p-6 transition-colors min-h-[112px] ${
                    isActive
                      ? 'border-[#064E3B] dark:border-[#10B981] bg-white dark:bg-[#151B18] shadow-sm'
                      : 'border-[#DED6C2] dark:border-[#242D28] bg-white/50 dark:bg-[#151B18]/40 hover:bg-white dark:hover:bg-[#151B18]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-num text-xs font-semibold text-[#064E3B] dark:text-[#10B981]">
                      Step {item.step}
                    </span>
                    <span className="font-mono-num text-[10px] uppercase tracking-[0.12em] text-[#5C635D] dark:text-[#9BA39D]">
                      {isActive ? 'Active' : 'Select'}
                    </span>
                  </div>
                  <h3 className="mt-2 font-display text-2xl sm:text-[26px] leading-tight text-[#121513] dark:text-[#F4F1EA]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm text-[#121513]/85 dark:text-[#F4F1EA]/85 font-medium">
                    {item.summary}
                  </p>
                  <p className="mt-1.5 text-xs text-[#5C635D] dark:text-[#9BA39D] leading-relaxed">
                    {item.detail}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Right: Sticky Transforming Product Visual */}
          <div className="lg:col-span-7 lg:sticky lg:top-24">
            <div className="rounded-2xl border border-[#DED6C2] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-4 sm:p-7 shadow-sm min-h-[410px] flex flex-col justify-between">
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#ECE6D8] dark:border-[#242D28]">
                <span className="label-caps text-[#5C635D] dark:text-[#9BA39D]">
                  Step {STORY_STEPS[activeStep].step} · {STORY_STEPS[activeStep].title}
                </span>
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  {STORY_STEPS.map((s, idx) => (
                    <span
                      key={s.step}
                      className={`h-1.5 rounded-sm transition-all ${
                        idx === activeStep
                          ? 'w-7 bg-[#064E3B] dark:bg-[#10B981]'
                          : 'w-2 bg-[#DED6C2] dark:bg-[#2B352F]'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="py-6 flex-1 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  {activeStep === 0 && (
                    <motion.div
                      key="story-0"
                      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reducedMotion ? undefined : { opacity: 0, y: -12 }}
                      transition={{ duration: 0.28 }}
                      className="w-full max-w-md space-y-4"
                    >
                      <div className="rounded-xl border border-[#DED6C2] dark:border-[#2A352F] bg-[#FAF8F3] dark:bg-[#111714] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="label-caps text-[#064E3B] dark:text-[#10B981]">
                            Counter Entry
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono-num text-[#5C635D] dark:text-[#9BA39D]">
                            <Mic className="w-3.5 h-3.5 text-[#064E3B] dark:text-[#10B981]" />
                            en-NG ready
                          </span>
                        </div>
                        <p className="text-sm text-[#121513] dark:text-[#F4F1EA] font-medium leading-relaxed">
                          “Sold two 50kg bags of rice to Chidi for ₦92,000 by transfer, paid ₦70,000 now and ₦22,000 on Friday.”
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#064E3B]/25 dark:border-[#10B981]/30 bg-white dark:bg-[#18201C] p-4 space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#121513] dark:text-[#F4F1EA]">
                            2× 50kg Parboiled Rice — Chidi O.
                          </span>
                          <span className="font-mono-num font-semibold text-[#121513] dark:text-[#F4F1EA]">
                            ₦92,000.00
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-[#5C635D] dark:text-[#9BA39D] pt-2 border-t border-[#ECE6D8] dark:border-[#242D28]">
                          <span>Paid today (Transfer): ₦70,000.00</span>
                          <span className="font-mono-num font-semibold text-[#B45309] dark:text-amber-400">
                            Balance: ₦22,000.00
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {activeStep === 1 && (
                    <motion.div
                      key="story-1"
                      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reducedMotion ? undefined : { opacity: 0, y: -12 }}
                      transition={{ duration: 0.28 }}
                      className="w-full max-w-[340px]"
                    >
                      {/* Realistic WhatsApp chat phone frame */}
                      <div className="rounded-2xl border-2 border-[#1C231F] bg-[#EFEAE2] dark:bg-[#0F1713] overflow-hidden shadow-md">
                        <div className="bg-[#075E54] text-white px-4 py-2.5 flex items-center justify-between">
                          <div>
                            <p className="text-xs font-semibold leading-none">Chidi Okafor</p>
                            <p className="text-[10px] opacity-80 mt-0.5">WhatsApp · Receipt Share</p>
                          </div>
                          <Receipt className="w-4 h-4 opacity-85" />
                        </div>

                        <div className="p-3.5 space-y-3">
                          <motion.div
                            initial={reducedMotion ? false : { scale: 0.94, opacity: 0, y: 10 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            transition={{ duration: 0.35, delay: 0.08 }}
                            className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-[#D9FDD3] dark:bg-[#134D37] text-[#111B21] dark:text-[#F4F1EA] p-2.5 shadow-sm space-y-2"
                          >
                            {/* Rich link preview card inside chat bubble */}
                            <div className="rounded-lg bg-white/90 dark:bg-[#0D1411] border border-black/10 p-2.5 space-y-1">
                              <div className="flex items-center justify-between text-[10px] font-mono-num text-[#064E3B] dark:text-[#10B981] font-semibold">
                                <span>RCT-0108 · PART PAID</span>
                                <span>Valid</span>
                              </div>
                              <p className="text-xs font-semibold text-[#121513] dark:text-[#F4F1EA]">
                                Mama Tosin Provision Store
                              </p>
                              <p className="font-mono-num text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
                                Total ₦92,000 · Paid ₦70,000
                              </p>
                            </div>

                            <p className="text-xs leading-snug">
                              Hello Chidi, here is your official receipt <strong>RCT-0108</strong> for ₦92,000 (Paid: ₦70,000, Balance: ₦22,000). Verify anytime: https://tallymark.ng/r/9xK4m…
                            </p>
                            <div className="flex items-center justify-end gap-1 text-[10px] opacity-70 font-mono-num">
                              <span>16:42</span>
                              <CheckCheck className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#38BDF8]" />
                            </div>
                          </motion.div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {activeStep === 2 && (
                    <motion.div
                      key="story-2"
                      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reducedMotion ? undefined : { opacity: 0, y: -12 }}
                      transition={{ duration: 0.28 }}
                      className="w-full max-w-md space-y-3"
                    >
                      <div className="rounded-xl border border-[#DED6C2] dark:border-[#2A352F] bg-[#FAF8F3] dark:bg-[#111714] p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
                            <span className="text-xs font-semibold text-[#121513] dark:text-[#F4F1EA]">
                              Daily Cash Book · Closed 19:05 WAT
                            </span>
                          </div>
                          <span className="font-mono-num text-[11px] font-semibold text-[#064E3B] dark:text-[#10B981] inline-flex items-center gap-1">
                            <Check className="w-3 h-3" /> Balanced
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 font-mono-num text-xs">
                          <div className="rounded-lg bg-white dark:bg-[#151B18] border border-[#ECE6D8] dark:border-[#242D28] p-2.5">
                            <p className="text-[10px] uppercase text-[#5C635D] dark:text-[#9BA39D]">Cash</p>
                            <p className="font-semibold text-[#121513] dark:text-[#F4F1EA] mt-0.5">₦64,500</p>
                          </div>
                          <div className="rounded-lg bg-white dark:bg-[#151B18] border border-[#ECE6D8] dark:border-[#242D28] p-2.5">
                            <p className="text-[10px] uppercase text-[#5C635D] dark:text-[#9BA39D]">Transfer</p>
                            <p className="font-semibold text-[#121513] dark:text-[#F4F1EA] mt-0.5">₦118,000</p>
                          </div>
                          <div className="rounded-lg bg-white dark:bg-[#151B18] border border-[#ECE6D8] dark:border-[#242D28] p-2.5">
                            <p className="text-[10px] uppercase text-[#5C635D] dark:text-[#9BA39D]">POS</p>
                            <p className="font-semibold text-[#121513] dark:text-[#F4F1EA] mt-0.5">₦34,000</p>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-[#ECE6D8] dark:border-[#242D28] flex items-center justify-between text-xs font-mono-num">
                          <span className="text-[#5C635D] dark:text-[#9BA39D]">
                            Net (money in minus money out)
                          </span>
                          <span className="font-semibold text-[#064E3B] dark:text-[#10B981] text-sm">
                            +₦178,500.00
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="pt-3 border-t border-[#ECE6D8] dark:border-[#242D28] flex items-center justify-between text-xs text-[#5C635D] dark:text-[#9BA39D]">
                <span>Illustrative counter flow</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveStep((s) => (s + 2) % 3)}
                    className="px-2.5 py-1 rounded-md border border-[#DED6C2] dark:border-[#2B352F] hover:text-[#121513] dark:hover:text-[#F4F1EA]"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStep((s) => (s + 1) % 3)}
                    className="px-2.5 py-1 rounded-md border border-[#DED6C2] dark:border-[#2B352F] hover:text-[#121513] dark:hover:text-[#F4F1EA]"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
