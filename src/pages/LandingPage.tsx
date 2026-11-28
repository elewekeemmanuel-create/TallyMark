import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Receipt,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import { SITE_CONFIG } from '../shared/siteConfig';
import { TallymarkEmblem } from '../components/TallymarkLogo';
import { HeroLiveReceipt } from '../components/landing/HeroLiveReceipt';

const TRUST_ITEMS = [
  'Numbered receipts. None missing.',
  'Cash, transfer, POS. Tracked apart.',
  "Customers scan the QR to confirm it's real.",
] as const;

const FEATURE_CARDS = [
  {
    title: 'Receipts',
    body: 'Numbered, verifiable, sent on WhatsApp in one tap.',
    icon: Receipt,
    highlight: true,
  },
  {
    title: 'Cash book',
    body: 'Record every sale and expense in seconds.',
    icon: BookOpen,
    highlight: false,
  },
  {
    title: 'Debtors',
    body: 'Every credit sale recorded. See who owes you, and how much.',
    icon: Users,
    highlight: false,
  },
  {
    title: 'Invoices & quotes',
    body: 'Quote it, invoice it, get paid. The receipt follows.',
    icon: FileText,
    highlight: false,
  },
  {
    title: 'Close the day',
    body: 'See what you earned, spent and are still owed.',
    icon: CheckCircle2,
    highlight: false,
  },
] as const;

const STEPS = [
  {
    number: '1',
    title: 'Add the sale',
    body: 'Type in what you sold.',
  },
  {
    number: '2',
    title: 'Send the receipt',
    body: 'Your customer gets it on WhatsApp.',
  },
  {
    number: '3',
    title: 'Close the day',
    body: 'See what you earned, spent and are owed.',
  },
] as const;

const FAQ_ITEMS = [
  {
    q: 'Is it really free?',
    a: "Yes, during early access. We'll tell you well before that changes.",
  },
  {
    q: 'How do I sign in?',
    a: 'Tap Start free and continue with Google. No new password to remember.',
  },
  {
    q: 'Do I need to install anything?',
    a: "No. Open it in your phone's browser and start.",
  },
  {
    q: 'How do I make a receipt?',
    a: 'Add the items, pick Cash, Transfer or POS, then send it to your customer on WhatsApp.',
  },
  {
    q: 'How do customers know my receipt is real?',
    a: "Every receipt is numbered and carries a QR code they scan to confirm it's genuine. They don't need an account.",
  },
  {
    q: "What's the difference between a quotation, an invoice and a receipt?",
    a: "A quotation is your price offer. An invoice is what a customer owes you. A receipt is proof they've paid. Tallymark makes all three.",
  },
  {
    q: 'Can I turn a quotation into an invoice?',
    a: "Yes. Convert it without retyping anything. Once it's paid, the receipt follows.",
  },
  {
    q: 'What if my customer pays by transfer?',
    a: "They tap 'I've paid' and upload their transfer proof. You confirm it, then they get their receipt.",
  },
  {
    q: 'How does the cash book work?',
    a: "Record each sale and expense as it happens. At day's end, close the day to see what came in, what went out and who still owes you.",
  },
  {
    q: 'Can I track expenses and customers who owe me?',
    a: 'Yes. Log every expense. Record credit sales and the debtors list shows who owes you, and how much.',
  },
  {
    q: 'Is my data safe?',
    a: 'Your records are private to your account and protected by Google sign-in.',
  },
] as const;

function Reveal({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setVisible(true);
      return;
    }

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -24px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`landing-reveal ${visible ? 'landing-reveal-visible' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

function LandingLogo({
  size = 'md',
  inverted = false,
}: {
  size?: 'sm' | 'md';
  inverted?: boolean;
}) {
  const iconCls = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const textCls = size === 'sm' ? 'text-[17px]' : 'text-[19px]';
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 select-none">
      <TallymarkEmblem
        className={iconCls}
        strokeColor={inverted ? '#FFFFFF' : '#064E3B'}
        slashColor={inverted ? '#6EE7B7' : '#047857'}
      />
      <span
        className={`font-semibold tracking-[-0.02em] ${textCls} ${
          inverted ? 'text-white' : 'text-[#111827]'
        }`}
      >
        Tallymark
      </span>
    </span>
  );
}

function HeroPhoneMockup() {
  return (
    <div className="mx-auto w-full max-w-[312px]">
      {/* Phone chassis */}
      <div
        aria-label="Receipt preview on phone"
        className="rounded-[32px] bg-[#111827] p-2 shadow-[0_2px_6px_rgba(17,24,39,0.12),0_18px_40px_-16px_rgba(17,24,39,0.28)]"
      >
        {/* Top speaker bar */}
        <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-white/20" aria-hidden="true" />

        {/* Crisp white receipt screen */}
        <div className="rounded-[24px] bg-white p-4 text-[#111827]">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#E5E7EB]">
            <div>
              <p className="text-[14px] font-semibold text-[#111827]">Kemi Fabrics</p>
              <p className="text-[11px] font-normal text-[#4B5563] mt-0.5">Lekki Phase 1, Lagos</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] text-[#064E3B] px-2.5 py-0.5 text-[11px] font-semibold shrink-0">
              <Check className="w-3 h-3" strokeWidth={1.75} aria-hidden="true" />
              Paid
            </span>
          </div>

          <div className="flex items-center justify-between py-2 text-[11px] text-[#4B5563] border-b border-[#E5E7EB]">
            <span className="font-mono-num text-[#111827] font-semibold">RCT-0042</span>
            <span className="font-mono-num">18 Nov 2026</span>
          </div>

          {/* 3-column grid rows: description | qty x price | line total */}
          <div className="py-3 space-y-2.5 border-b border-[#E5E7EB]">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2.5 items-baseline">
              <span className="text-[12px] font-semibold text-[#111827] leading-snug">
                Silk Adire Boubou
              </span>
              <span className="font-mono-num text-[11px] text-[#4B5563] whitespace-nowrap">
                1 × ₦28,500
              </span>
              <span className="font-mono-num text-[12px] font-semibold text-[#111827] whitespace-nowrap text-right">
                ₦28,500
              </span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2.5 items-baseline">
              <span className="text-[12px] font-semibold text-[#111827] leading-snug">
                Ankara Wax Print
              </span>
              <span className="font-mono-num text-[11px] text-[#4B5563] whitespace-nowrap">
                1 × ₦14,500
              </span>
              <span className="font-mono-num text-[12px] font-semibold text-[#111827] whitespace-nowrap text-right">
                ₦14,500
              </span>
            </div>
          </div>

          <div className="py-3 flex items-baseline justify-between gap-3 border-b border-[#E5E7EB]">
            <div>
              <p className="text-[11px] font-semibold text-[#111827]">Amaka Okafor</p>
              <p className="text-[11px] font-normal text-[#4B5563]">Transfer</p>
            </div>
            <span className="font-mono-num text-[18px] font-semibold text-[#111827]">₦43,000</span>
          </div>

          <div className="pt-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold text-[#064E3B]">Verified receipt</p>
              <p className="font-mono-num text-[10px] text-[#4B5563] mt-0.5">
                tallymark.app/r/0042
              </p>
            </div>
            <svg
              viewBox="0 0 40 40"
              className="w-9 h-9 shrink-0 text-[#111827]"
              aria-hidden="true"
            >
              <rect
                x="2"
                y="2"
                width="12"
                height="12"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <rect x="6" y="6" width="4" height="4" fill="currentColor" />
              <rect
                x="26"
                y="2"
                width="12"
                height="12"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <rect x="30" y="6" width="4" height="4" fill="currentColor" />
              <rect
                x="2"
                y="26"
                width="12"
                height="12"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <rect x="6" y="30" width="4" height="4" fill="currentColor" />
              <rect x="18" y="4" width="3" height="3" fill="currentColor" />
              <rect x="18" y="10" width="3" height="3" fill="currentColor" />
              <rect x="18" y="18" width="4" height="4" fill="#064E3B" />
              <rect x="26" y="18" width="3" height="3" fill="currentColor" />
              <rect x="33" y="18" width="5" height="3" fill="currentColor" />
              <rect x="4" y="18" width="4" height="3" fill="currentColor" />
              <rect x="11" y="18" width="3" height="3" fill="currentColor" />
              <rect x="18" y="26" width="3" height="5" fill="currentColor" />
              <rect x="25" y="25" width="4" height="4" fill="currentColor" />
              <rect x="33" y="26" width="5" height="3" fill="currentColor" />
              <rect x="24" y="33" width="6" height="4" fill="currentColor" />
              <rect x="33" y="33" width="5" height="4" fill="currentColor" />
            </svg>
          </div>
        </div>
      </div>

      {/* Floating paid chip: sits cleanly beneath the phone bezel, never overlaps edges or clips */}
      <div className="mt-3 flex justify-center lg:justify-start">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-4 py-2 shadow-[0_1px_2px_rgba(17,24,39,0.05),0_8px_20px_-6px_rgba(17,24,39,0.12)]">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#064E3B] text-[#6EE7B7]">
            <Check className="w-3 h-3" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="tabular-nums-ui text-[14px] font-semibold text-[#111827]">
            ₦43,000 paid
          </span>
        </div>
      </div>
    </div>
  );
}

export function LandingPage({ isSignedIn }: { isSignedIn: boolean }) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [headerScrolled, setHeaderScrolled] = useState(false);

  useEffect(() => {
    api.trackAnalyticsEvent('landing_view', '/');
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setHeaderScrolled(window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const primaryCtaTo = isSignedIn ? '/app' : '/login';
  const navCtaLabel = isSignedIn ? 'Open app' : 'Start free';
  const inlineCtaLabel = 'Make your first receipt';
  const inlineCtaTo = isSignedIn ? '/app/new' : '/login';

  const trackPrimaryCta = () => {
    api.trackAnalyticsEvent(
      isSignedIn ? 'cta_open_app_clicked' : 'cta_get_started_clicked',
      '/'
    );
  };

  return (
    <div className="landing-page min-h-screen bg-white text-[#111827] antialiased">
      {/* 1. Slim 56px sticky header with scroll-triggered hairline border & safe-area insets */}
      <header
        className={`sticky top-0 z-40 bg-white border-b transition-colors duration-200 pt-[env(safe-area-inset-top)] ${
          headerScrolled ? 'border-[#E5E7EB]' : 'border-transparent'
        }`}
      >
        <div className="max-w-[1120px] mx-auto h-14 pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <a
            href="#top"
            aria-label="Tallymark home"
            className="inline-flex items-center min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B] rounded-[8px]"
          >
            <LandingLogo size="md" />
          </a>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {!isSignedIn && (
              <Link
                to="/login"
                onClick={trackPrimaryCta}
                className="inline-flex items-center justify-center min-h-[44px] px-3 text-[15px] font-semibold text-[#374151] hover:text-[#111827] transition-colors whitespace-nowrap shrink-0 rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
              >
                Log in
              </Link>
            )}
            <Link
              to={primaryCtaTo}
              onClick={trackPrimaryCta}
              className="landing-btn inline-flex items-center justify-center min-h-[44px] bg-[#064E3B] hover:bg-[#04392B] text-white text-[15px] font-semibold px-4 sm:px-5 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
            >
              {navCtaLabel}
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        {/* 2. Hero: <=32px top padding so phone mockup peeks above the fold on 390x844 */}
        <section className="bg-white pt-6 pb-14 lg:pt-14 lg:pb-20">
          <div className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            <div className="lg:col-span-7 space-y-4 sm:space-y-5">
              <span className="inline-flex items-center rounded-full bg-[#ECFDF5] text-[#064E3B] px-3 py-1 text-[13px] font-semibold">
                Free during early access
              </span>

              <h1 className="text-[34px] sm:text-[42px] lg:text-[48px] font-semibold leading-[1.12] tracking-[-0.025em] text-[#111827] text-balance">
                Every sale on record.{' '}
                <span className="text-[#047857]">Every naira accounted for.</span>
              </h1>

              <p className="text-[16px] lg:text-[18px] font-normal text-[#374151] leading-[1.5] max-w-[520px]">
                Type the sale, send a verified receipt on WhatsApp, and close the day knowing what
                you made.
              </p>

              {/* Primary CTA + visible gap to secondary link */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center items-start gap-4 sm:gap-6">
                <Link
                  to={inlineCtaTo}
                  onClick={trackPrimaryCta}
                  className="landing-btn inline-flex items-center justify-center bg-[#064E3B] hover:bg-[#04392B] text-white text-[16px] font-semibold px-6 py-3 min-h-[48px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
                >
                  {inlineCtaLabel}
                </Link>
                <a
                  href="#demo"
                  className="inline-flex items-center min-h-[44px] text-[15px] font-semibold text-[#064E3B] hover:text-[#047857] underline decoration-[#064E3B]/40 underline-offset-4 transition-colors rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
                >
                  See a sample receipt
                </a>
              </div>
            </div>

            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <HeroPhoneMockup />
            </div>
          </div>
        </section>

        {/* 3. Compact Trust Strip: ONE card, 3 hairline-divided rows on mobile, 3 columns on desktop */}
        <section className="bg-[#F6F7F8] py-8 lg:py-10">
          <div className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-8">
            <Reveal>
              <div className="landing-card bg-white grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-[#E5E7EB]">
                {TRUST_ITEMS.map((item) => (
                  <div key={item} className="flex items-center gap-3 px-5 py-3.5 lg:px-6 lg:py-4">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] text-[#064E3B]">
                      <Check className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <p className="text-[15px] font-semibold text-[#111827] leading-[1.4]">
                      {item}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* 4. Interactive Demo (single container surface, sticky live receipt on desktop) */}
        <section id="demo" className="bg-white py-14 sm:py-[72px] lg:py-24 scroll-mt-16">
          <div className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <Reveal>
              <div className="space-y-2 max-w-[600px]">
                <h2 className="text-[28px] sm:text-[34px] lg:text-[40px] font-semibold leading-[1.16] tracking-[-0.025em] text-[#111827] text-balance">
                  Make a receipt <span className="text-[#047857]">now.</span>
                </h2>
                <p className="text-[16px] font-normal text-[#374151] leading-[1.5]">
                  No sign-in needed. Nothing you type here is saved.
                </p>
              </div>
            </Reveal>

            <Reveal>
              <HeroLiveReceipt isSignedIn={isSignedIn} />
            </Reveal>
          </div>
        </section>

        {/* 5. Features: compact horizontal cards, neutral white surface, Receipts as single deep-green highlight */}
        <section className="bg-[#F6F7F8] py-14 sm:py-[72px] lg:py-24">
          <div className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <Reveal>
              <h2 className="text-[28px] sm:text-[34px] lg:text-[40px] font-semibold leading-[1.16] tracking-[-0.025em] text-[#111827] max-w-[640px] text-balance">
                Stop trusting your memory with your{' '}
                <span className="text-[#047857]">money.</span>
              </h2>
            </Reveal>

            <Reveal>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {FEATURE_CARDS.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.title}
                      className={`landing-card-hover flex items-start gap-4 p-4 sm:p-5 ${
                        card.highlight
                          ? 'landing-card-dark bg-[#064E3B] text-white lg:col-span-2'
                          : 'landing-card bg-white text-[#111827]'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          card.highlight
                            ? 'bg-white/15 text-[#6EE7B7]'
                            : 'bg-[#ECFDF5] text-[#064E3B]'
                        }`}
                      >
                        <Icon className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <h3
                          className={`text-[17px] font-semibold leading-[1.3] tracking-[-0.015em] text-balance ${
                            card.highlight ? 'text-white' : 'text-[#111827]'
                          }`}
                        >
                          {card.title}
                        </h3>
                        <p
                          className={`text-[16px] font-normal leading-[1.5] ${
                            card.highlight ? 'text-[#D1FAE5]' : 'text-[#374151]'
                          }`}
                        >
                          {card.body}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Reveal>
          </div>
        </section>

        {/* 6. How it works: vertical stepper on mobile, horizontal stepper on desktop */}
        <section className="bg-white py-14 sm:py-[72px] lg:py-24">
          <div className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8 lg:space-y-12">
            <Reveal>
              <h2 className="text-[28px] sm:text-[34px] lg:text-[40px] font-semibold leading-[1.16] tracking-[-0.025em] text-[#111827] text-balance">
                Three steps. <span className="text-[#047857]">Done.</span>
              </h2>
            </Reveal>

            <Reveal>
              <ol className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:gap-8">
                {STEPS.map((step, idx) => {
                  const isLast = idx === STEPS.length - 1;
                  return (
                    <li
                      key={step.title}
                      className={`relative flex lg:flex-col items-start gap-4 ${
                        isLast ? 'pb-0' : 'pb-6 lg:pb-0'
                      }`}
                    >
                      {/* Mobile vertical connector line */}
                      {!isLast && (
                        <span
                          aria-hidden="true"
                          className="lg:hidden absolute left-[17px] top-9 bottom-0 w-px bg-[#D1D5DB]"
                        />
                      )}

                      {/* Desktop horizontal connector line */}
                      {!isLast && (
                        <span
                          aria-hidden="true"
                          className="hidden lg:block absolute top-[17px] left-11 right-[-32px] h-px bg-[#D1D5DB]"
                        />
                      )}

                      <span className="relative z-10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#064E3B] text-white text-[15px] font-semibold tabular-nums-ui">
                        {step.number}
                      </span>

                      <div className="min-w-0 pt-0.5 lg:pt-0 space-y-1">
                        <h3 className="text-[17px] font-semibold leading-[1.3] text-[#111827] text-balance">
                          {step.title}
                        </h3>
                        <p className="text-[16px] font-normal text-[#374151] leading-[1.5]">
                          {step.body}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* 7. FAQ: refined single-card accordion, >=56px rows, 200ms height animation */}
        <section className="bg-[#F6F7F8] py-14 sm:py-[72px] lg:py-24">
          <div className="max-w-[780px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <Reveal>
              <h2 className="text-[28px] sm:text-[34px] lg:text-[40px] font-semibold leading-[1.16] tracking-[-0.025em] text-[#111827] text-balance">
                Quick <span className="text-[#047857]">answers</span>
              </h2>
            </Reveal>

            <Reveal>
              <div className="landing-card bg-white divide-y divide-[#E5E7EB]">
                {FAQ_ITEMS.map((item, idx) => {
                  const isOpen = openFaq === idx;
                  const triggerId = `faq-trigger-${idx}`;
                  const panelId = `faq-panel-${idx}`;
                  return (
                    <div key={item.q}>
                      <button
                        id={triggerId}
                        type="button"
                        onClick={() => {
                          setOpenFaq(isOpen ? null : idx);
                          api.trackAnalyticsEvent('faq_toggled', '/');
                        }}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        className="w-full min-h-[56px] px-5 sm:px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-[#F8F9FA]/70 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#064E3B]"
                      >
                        <span className="text-[16px] font-semibold leading-[1.4] text-[#111827]">
                          {item.q}
                        </span>
                        <ChevronDown
                          className={`w-5 h-5 shrink-0 text-[#4B5563] transition-transform duration-200 ${
                            isOpen ? 'rotate-180 text-[#064E3B]' : ''
                          }`}
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      </button>

                      <div
                        id={panelId}
                        role="region"
                        aria-labelledby={triggerId}
                        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                        }`}
                      >
                        <div className="overflow-hidden">
                          <p className="px-5 sm:px-6 pb-5 pt-0.5 text-[16px] font-normal text-[#374151] leading-[1.5]">
                            {item.a}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Reveal>
          </div>
        </section>

        {/* 8. Final CTA: deep green block with mint button, <=48px gap above footer */}
        <section className="bg-white pt-14 pb-10 lg:pt-20 lg:pb-12">
          <div className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-8">
            <Reveal>
              <div className="landing-card-dark bg-[#064E3B] px-6 py-12 sm:px-12 sm:py-16 text-center space-y-6">
                <h2 className="text-[28px] sm:text-[34px] lg:text-[40px] font-semibold leading-[1.16] tracking-[-0.025em] text-white text-balance max-w-[560px] mx-auto">
                  Close tonight knowing what you <span className="text-[#6EE7B7]">made.</span>
                </h2>
                <div>
                  <Link
                    to={inlineCtaTo}
                    onClick={trackPrimaryCta}
                    className="landing-btn inline-flex items-center justify-center bg-[#6EE7B7] hover:bg-[#A7F3D0] text-[#052E23] text-[16px] font-semibold px-7 py-3.5 min-h-[48px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6EE7B7]"
                  >
                    {inlineCtaLabel}
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* 9. Minimal dark green footer */}
      <footer className="bg-[#053B2C] text-white pt-8 pb-[max(32px,env(safe-area-inset-bottom))]">
        <div className="max-w-[1120px] mx-auto pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] sm:px-6 lg:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[14px] font-normal text-[#D1FAE5]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <LandingLogo size="sm" inverted />
            <span className="text-[#D1FAE5]">Built by Emmanuel Eleweke of ZedTech</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a
              href={`mailto:${SITE_CONFIG.contactEmail}`}
              className="inline-flex items-center min-h-[44px] hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6EE7B7] rounded-[6px]"
            >
              {SITE_CONFIG.contactEmail}
            </a>
            <Link
              to="/privacy"
              className="inline-flex items-center min-h-[44px] hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6EE7B7] rounded-[6px]"
            >
              Privacy
            </Link>
            <Link
              to="/terms"
              className="inline-flex items-center min-h-[44px] hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6EE7B7] rounded-[6px]"
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
