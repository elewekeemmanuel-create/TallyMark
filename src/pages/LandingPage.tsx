import React, { useEffect, useState } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  FileCheck2,
  Menu,
  Mic,
  Moon,
  Paperclip,
  QrCode,
  ShieldCheck,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import { useTheme } from '../lib/theme';
import { SITE_CONFIG } from '../shared/siteConfig';
import { TallymarkWordmark } from '../components/TallymarkLogo';
import {
  DesktopContextCursor,
  MagneticWrap,
  usePrefersReducedMotion,
} from '../components/landing/DesktopPolish';
import { ReceiptPreloader } from '../components/landing/ReceiptPreloader';
import { HeroLiveReceipt } from '../components/landing/HeroLiveReceipt';
import { ScrollStorySection } from '../components/landing/ScrollStorySection';
import { InteractiveSummaryPreview } from '../components/landing/InteractiveSummaryPreview';

const WHO_ITS_FOR = [
  {
    sector: 'Boutiques',
    example: 'Track part-paid ready-to-wear deposits, fittings, and balance receipts without digging through three notebooks.',
  },
  {
    sector: 'Food vendors',
    example: 'Log trays, bowl orders, delivery rider transport expenses, and end-of-day transfer alerts before going home.',
  },
  {
    sector: 'Salons',
    example: 'Send clean WhatsApp receipts after braids, wigs, or treatments and know which stylist closed the sale.',
  },
  {
    sector: 'Pharmacies',
    example: 'Print crisp 80mm counter slips or A4 receipts with optional 7.5% VAT clearly separated.',
  },
  {
    sector: 'Phone & fabric shops',
    example: 'Keep high-ticket transfers, POS settlements, and supplier creditor due dates in one reconciled cash book.',
  },
  {
    sector: 'Service providers',
    example: 'Record tailoring, repairs, photography, or logistics milestones with verifiable public receipt links.',
  },
] as const;

const FAQ_ITEMS = [
  {
    question: 'Is it free?',
    answer: SITE_CONFIG.faqIsItFreeAnswer,
  },
  {
    question: 'Do I need to install anything?',
    answer:
      'No app store download is required. Tallymark opens directly in Chrome or Safari on your phone, tablet, or laptop. You can also tap "Add to Home Screen" so it works like an installed app with offline-safe draft saving.',
  },
  {
    question: 'Is my data safe?',
    answer:
      'Your data stays yours. Every business ledger is isolated to your owner account with strict row-level database rules, expense proof photos stay in private storage, and you can export your complete JSON archive or delete your account anytime from Settings.',
  },
  {
    question: 'Can I add VAT?',
    answer:
      'Yes. You can switch on Nigeria’s 7.5% VAT in onboarding or Settings anytime, and choose between VAT-inclusive or VAT-exclusive calculation. It stays off by default if your business does not charge VAT.',
  },
  {
    question: 'Can I print receipts?',
    answer:
      'Yes. Choose between Modern, Classic, and Compact 80mm thermal layouts. You can print directly from any browser printer dialog, download an offline-ready PDF with Naira symbol support, or share a public receipt link on WhatsApp.',
  },
  {
    question: 'Does it replace my cash book?',
    answer:
      'Yes. Every receipt, quick sale, credit sale, debt payment, and expense writes automatically into your daily cash book in time order, tracking Cash in hand separately from Transfer and POS money.',
  },
] as const;

export function LandingPage({ isSignedIn }: { isSignedIn: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [verifyDemoStatus, setVerifyDemoStatus] = useState<'VALID' | 'VOID'>('VALID');
  const [verifyFlipped, setVerifyFlipped] = useState(false);

  const { scrollY } = useScroll();
  const heroPaperParallax = useTransform(scrollY, [0, 500], [0, reducedMotion ? 0 : -18]);

  const primaryCtaLabel = isSignedIn ? 'Open app' : 'Get started';
  const primaryCtaHref = isSignedIn ? '/app' : '/login';

  useEffect(() => {
    api.trackAnalyticsEvent('landing_view', '/');
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  const handlePrimaryCtaClick = () => {
    api.trackAnalyticsEvent(isSignedIn ? 'cta_open_app_clicked' : 'cta_get_started_clicked', '/');
  };

  return (
    <div className="min-h-screen bg-[#FAF8F3] dark:bg-[#0D110F] text-[#121513] dark:text-[#F4F1EA]">
      <ReceiptPreloader />
      <DesktopContextCursor />

      {/* 1. Sticky 3-Zone Navigation */}
      <header className="sticky top-0 z-30 border-b border-[#E5DEC9] dark:border-[#242D28] bg-[#FAF8F3]/95 dark:bg-[#0D110F]/95 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <Link to="/" className="whitespace-nowrap shrink-0">
            <TallymarkWordmark size="md" />
          </Link>

          <nav
            aria-label="Primary sections"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-[#5C635D] dark:text-[#9BA39D]"
          >
            <a
              href="#problem"
              className="hover:text-[#121513] dark:hover:text-[#F4F1EA] transition-colors whitespace-nowrap shrink-0"
            >
              Why Tallymark
            </a>
            <a
              href="#how-it-works"
              className="hover:text-[#121513] dark:hover:text-[#F4F1EA] transition-colors whitespace-nowrap shrink-0"
            >
              How it works
            </a>
            <a
              href="#features"
              className="hover:text-[#121513] dark:hover:text-[#F4F1EA] transition-colors whitespace-nowrap shrink-0"
            >
              Features
            </a>
            <a
              href="#verify"
              className="hover:text-[#121513] dark:hover:text-[#F4F1EA] transition-colors whitespace-nowrap shrink-0"
            >
              Verify receipt
            </a>
            <a
              href="#faq"
              className="hover:text-[#121513] dark:hover:text-[#F4F1EA] transition-colors whitespace-nowrap shrink-0"
            >
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <MagneticWrap>
              <Link
                to={primaryCtaHref}
                onClick={handlePrimaryCtaClick}
                className="inline-flex items-center gap-2 rounded-xl bg-[#064E3B] hover:bg-[#04392B] px-4 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap min-h-[44px]"
              >
                <span>{primaryCtaLabel}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </MagneticWrap>

            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-expanded={mobileNavOpen}
              aria-label="Toggle navigation menu"
              className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] text-[#121513] dark:text-[#F4F1EA]"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileNavOpen && (
          <div className="md:hidden border-t border-[#E5DEC9] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#0D110F] px-4 py-4 space-y-1">
            {[
              { href: '#problem', label: 'Why Tallymark' },
              { href: '#how-it-works', label: 'How it works' },
              { href: '#features', label: 'Features' },
              { href: '#verify', label: 'Verify receipt' },
              { href: '#who-its-for', label: 'Who it’s for' },
              { href: '#faq', label: 'FAQ' },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileNavOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm font-medium text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#171E1A]"
              >
                {item.label}
              </a>
            ))}
            <div className="pt-2 border-t border-[#E5DEC9] dark:border-[#242D28] flex items-center justify-between px-3 py-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-2 text-xs font-medium text-[#5C635D] dark:text-[#9BA39D] min-h-[40px]"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span>
              </button>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* 2. Hero + Interactive Live Hero Receipt */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-16 lg:pt-16 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
            <div className="lg:col-span-6 space-y-6 lg:pt-4">
              {/* Honest typographic markers (zero pill clutter) */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#E5DEC9] dark:border-[#242D28] pb-3 text-[11px] font-mono-num uppercase tracking-[0.12em] text-[#5C635D] dark:text-[#9BA39D]">
                <span className="text-[#064E3B] dark:text-[#10B981] font-semibold">
                  {SITE_CONFIG.earlyAccessTag}
                </span>
                <span aria-hidden="true">/</span>
                <span>{SITE_CONFIG.trustTag}</span>
                <span aria-hidden="true">/</span>
                <span>Built for Nigerian shops</span>
              </div>

              <motion.h1
                initial={reducedMotion ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="font-display text-[44px] sm:text-[58px] lg:text-[66px] leading-[0.98] tracking-[-0.02em] text-[#121513] dark:text-[#F4F1EA] [text-wrap:balance]"
              >
                Replace the paper cash book and write receipts in{' '}
                <em className="italic text-[#064E3B] dark:text-[#10B981]">seconds.</em>
              </motion.h1>

              <p className="text-base sm:text-lg text-[#5C635D] dark:text-[#9BA39D] leading-relaxed max-w-xl">
                {SITE_CONFIG.tagline} Issue numbered Nigerian Naira receipts at the counter, track what customers still owe, speak your day out loud, and close your book before you lock the shop.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <MagneticWrap>
                  <Link
                    to={primaryCtaHref}
                    onClick={handlePrimaryCtaClick}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#064E3B] hover:bg-[#04392B] px-6 py-3.5 text-sm font-semibold text-white transition-colors min-h-[48px]"
                  >
                    <span>{primaryCtaLabel}</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </MagneticWrap>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-5 py-3.5 text-sm font-medium text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#1D2621] transition-colors min-h-[48px]"
                >
                  See how it works
                </a>
              </div>

              {/* Clean architectural spec line */}
              <dl className="pt-5 border-t border-[#E5DEC9] dark:border-[#242D28] grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <dt className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Numbering</dt>
                  <dd className="mt-1 font-medium text-[#121513] dark:text-[#F4F1EA]">
                    Gap-free sequential receipts
                  </dd>
                </div>
                <div>
                  <dt className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Cash drawers</dt>
                  <dd className="mt-1 font-medium text-[#121513] dark:text-[#F4F1EA]">
                    Cash, Transfer &amp; POS separated
                  </dd>
                </div>
                <div>
                  <dt className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Counter speed</dt>
                  <dd className="mt-1 font-medium text-[#121513] dark:text-[#F4F1EA]">
                    Type, tap presets, or dictate
                  </dd>
                </div>
              </dl>
            </div>

            <motion.div
              className="lg:col-span-6"
              style={{ y: heroPaperParallax }}
            >
              <HeroLiveReceipt isSignedIn={isSignedIn} />
            </motion.div>
          </div>
        </section>

        {/* 3. The Problem */}
        <section
          id="problem"
          className="border-t border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#141A17]"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5 space-y-4">
              <p className="label-caps text-[#B45309] dark:text-amber-400">The daily paper problem</p>
              <h2 className="font-display text-[34px] sm:text-[44px] leading-[1.03] text-[#121513] dark:text-[#F4F1EA] [text-wrap:balance]">
                You already did the work. Writing the book at 9pm shouldn’t be the hardest part.
              </h2>
              <p className="text-sm sm:text-base text-[#5C635D] dark:text-[#9BA39D] leading-relaxed">
                Most shop owners run all day on memory, torn receipt slips, and WhatsApp bank alerts — then spend closing time trying to make the numbers agree.
              </p>
            </div>

            <div className="lg:col-span-7 divide-y divide-[#E5DEC9] dark:divide-[#26302B] border-y border-[#E5DEC9] dark:border-[#26302B]">
              <div className="py-6 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-6 items-baseline">
                <span className="sm:col-span-2 font-mono-num text-xs font-semibold text-[#5C635D] dark:text-[#9BA39D]">
                  01 / Receipts
                </span>
                <div className="sm:col-span-10 space-y-1.5">
                  <h3 className="font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
                    Handwritten booklets that fade and misadd
                  </h3>
                  <p className="text-sm text-[#5C635D] dark:text-[#9BA39D] leading-relaxed">
                    Carbon copies smudge, customers lose the paper by Friday, and when someone pays half now and half later, finding the old page takes ten minutes of flipping.
                  </p>
                </div>
              </div>

              <div className="py-6 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-6 items-baseline">
                <span className="sm:col-span-2 font-mono-num text-xs font-semibold text-[#5C635D] dark:text-[#9BA39D]">
                  02 / Cash Book
                </span>
                <div className="sm:col-span-10 space-y-1.5">
                  <h3 className="font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
                    A paper cash book written up at night
                  </h3>
                  <p className="text-sm text-[#5C635D] dark:text-[#9BA39D] leading-relaxed">
                    Trying to remember who paid cash, which transfer landed, what went to rider transport, and why the drawer is ₦4,500 short when you just want to go home.
                  </p>
                </div>
              </div>

              <div className="py-6 grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-6 items-baseline">
                <span className="sm:col-span-2 font-mono-num text-xs font-semibold text-[#5C635D] dark:text-[#9BA39D]">
                  03 / Clarity
                </span>
                <div className="sm:col-span-10 space-y-1.5">
                  <h3 className="font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
                    Not knowing how the day actually went
                  </h3>
                  <p className="text-sm text-[#5C635D] dark:text-[#9BA39D] leading-relaxed">
                    Credit sales feel like revenue until stock runs low. Mixing money in, expenses, and unpaid balances leaves you guessing whether today made money or just moved cash.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. How It Works (Sticky 3-Step Scroll Story + WhatsApp Mockup) */}
        <ScrollStorySection />

        {/* 5. Features in Varied Asymmetric Layout with Real Product UI */}
        <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24 space-y-12 lg:space-y-16">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#E5DEC9] dark:border-[#242D28]">
            <div className="max-w-2xl">
              <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Inside Tallymark</p>
              <h2 className="mt-2 font-display text-[34px] sm:text-[46px] leading-[1.03] text-[#121513] dark:text-[#F4F1EA] [text-wrap:balance]">
                Built like the counter tools you actually reach for.
              </h2>
            </div>
            <p className="text-sm text-[#5C635D] dark:text-[#9BA39D] max-w-sm">
              Every module writes cleanly into the same book — receipts, quick sales, customer debts, expenses, voice drafts, and reports.
            </p>
          </div>

          {/* Row A: Daily Cash Book (7 cols) + Receipts Stack (5 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Real UI: Daily Cash Book */}
            <div className="lg:col-span-7 rounded-2xl border border-[#DED6C2] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-5 sm:p-6 flex flex-col justify-between space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="label-caps text-[#064E3B] dark:text-[#10B981]">Daily Cash Book</span>
                  <h3 className="mt-1.5 font-display text-2xl sm:text-3xl text-[#121513] dark:text-[#F4F1EA]">
                    Opening balance to closing cash, in time order
                  </h3>
                </div>
                <BookOpen className="w-5 h-5 text-[#064E3B] dark:text-[#10B981] shrink-0 mt-1" />
              </div>

              <div className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] overflow-hidden text-xs">
                <div className="grid grid-cols-12 gap-2 px-3.5 py-2.5 border-b border-[#ECE6D8] dark:border-[#242D28] label-caps text-[#5C635D] dark:text-[#9BA39D]">
                  <span className="col-span-2">Time</span>
                  <span className="col-span-5">Entry</span>
                  <span className="col-span-2">Method</span>
                  <span className="col-span-3 text-right">Running</span>
                </div>
                <div className="divide-y divide-[#ECE6D8] dark:divide-[#242D28] font-mono-num">
                  <div className="grid grid-cols-12 gap-2 px-3.5 py-2.5 items-center">
                    <span className="col-span-2 text-[#5C635D] dark:text-[#9BA39D]">08:00</span>
                    <span className="col-span-5 font-sans-ui font-medium text-[#121513] dark:text-[#F4F1EA]">
                      Opening cash carried forward
                    </span>
                    <span className="col-span-2 text-[#5C635D] dark:text-[#9BA39D]">Cash</span>
                    <span className="col-span-3 text-right font-semibold">₦18,000</span>
                  </div>
                  <div className="grid grid-cols-12 gap-2 px-3.5 py-2.5 items-center">
                    <span className="col-span-2 text-[#5C635D] dark:text-[#9BA39D]">10:14</span>
                    <span className="col-span-5 font-sans-ui font-medium text-[#121513] dark:text-[#F4F1EA]">
                      RCT-0107 · 2× Adire Set
                    </span>
                    <span className="col-span-2 text-[#5C635D] dark:text-[#9BA39D]">Transfer</span>
                    <span className="col-span-3 text-right font-semibold text-[#064E3B] dark:text-[#10B981]">
                      +₦54,000
                    </span>
                  </div>
                  <div className="grid grid-cols-12 gap-2 px-3.5 py-2.5 items-center">
                    <span className="col-span-2 text-[#5C635D] dark:text-[#9BA39D]">13:40</span>
                    <span className="col-span-5 font-sans-ui font-medium text-[#121513] dark:text-[#F4F1EA]">
                      Dispatch rider (Lekki)
                    </span>
                    <span className="col-span-2 text-[#5C635D] dark:text-[#9BA39D]">Cash</span>
                    <span className="col-span-3 text-right font-semibold text-[#B45309] dark:text-amber-400">
                      −₦3,500
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                Close the day with a counted-cash check. Closed days lock against silent edits — mistakes show as transparent correction entries.
              </p>
            </div>

            {/* Real UI: Receipts & Part Payments */}
            <div className="lg:col-span-5 rounded-2xl border border-[#DED6C2] dark:border-[#26302B] bg-[#F3EFE6]/70 dark:bg-[#121815] p-5 sm:p-6 flex flex-col justify-between space-y-5">
              <div>
                <span className="label-caps text-[#064E3B] dark:text-[#10B981]">Receipts</span>
                <h3 className="mt-1.5 font-display text-2xl sm:text-3xl text-[#121513] dark:text-[#F4F1EA]">
                  Part payments &amp; 3 print styles
                </h3>
                <p className="mt-2 text-xs text-[#5C635D] dark:text-[#9BA39D] leading-relaxed">
                  Issue Modern, Classic, or 80mm thermal receipts with amount in words, saved customer autosuggest, and automatic linked balance receipts.
                </p>
              </div>

              <div className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono-num font-semibold text-[#121513] dark:text-[#F4F1EA]">
                    RCT-0108 · Chidi Okafor
                  </span>
                  <span className="border border-[#B45309]/40 bg-[#FFFBEB] dark:bg-amber-950/40 text-[#B45309] dark:text-amber-300 px-2 py-0.5 rounded-sm font-mono-num text-[10px] font-semibold uppercase">
                    PART PAID
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#ECE6D8] dark:border-[#242D28] font-mono-num text-xs">
                  <div>
                    <p className="text-[10px] text-[#5C635D] dark:text-[#9BA39D]">Total</p>
                    <p className="font-semibold">₦92,000</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#5C635D] dark:text-[#9BA39D]">Paid</p>
                    <p className="font-semibold text-[#064E3B] dark:text-[#10B981]">₦70,000</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#5C635D] dark:text-[#9BA39D]">Balance</p>
                    <p className="font-semibold text-[#B45309] dark:text-amber-400">₦22,000</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Row B: Speak Your Day (5 cols) + Debtors & Expenses (7 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Real UI: Speak Your Day */}
            <div className="lg:col-span-5 rounded-2xl border border-[#DED6C2] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-5 sm:p-6 space-y-4 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="label-caps text-[#064E3B] dark:text-[#10B981]">Speak Your Day</span>
                  <Mic className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
                </div>
                <h3 className="font-display text-2xl sm:text-3xl text-[#121513] dark:text-[#F4F1EA]">
                  Talk naturally. Review before saving.
                </h3>
                <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                  Drafted for you. Please check before saving. Nothing hits your book until you edit and tap Confirm.
                </p>
              </div>

              <div className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-3.5 space-y-2.5 text-xs">
                <p className="italic text-[#5C635D] dark:text-[#9BA39D]">
                  “Spent 5k on transport, 12k on stock, Mama Ngozi owes 8k, sold 2 bags 20k cash.”
                </p>
                <div className="space-y-1.5 pt-2 border-t border-[#ECE6D8] dark:border-[#242D28] font-mono-num">
                  <div className="flex justify-between">
                    <span className="font-sans-ui text-[#121513] dark:text-[#F4F1EA]">Sale · 2 bags</span>
                    <span className="font-semibold text-[#064E3B] dark:text-[#10B981]">₦20,000</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans-ui text-[#121513] dark:text-[#F4F1EA]">Expense · Transport</span>
                    <span className="font-semibold text-[#B45309] dark:text-amber-400">₦5,000</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans-ui text-[#121513] dark:text-[#F4F1EA]">Credit · Mama Ngozi</span>
                    <span className="font-semibold text-[#121513] dark:text-[#F4F1EA]">₦8,000</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Real UI: Debtors + Expenses */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-[#DED6C2] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-5 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="label-caps text-[#064E3B] dark:text-[#10B981]">Debtors</span>
                    <Users className="w-4 h-4 text-[#5C635D] dark:text-[#9BA39D]" />
                  </div>
                  <h3 className="mt-1.5 font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
                    Who owes &amp; how long
                  </h3>
                </div>

                <div className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#121513] dark:text-[#F4F1EA]">Mama Ngozi</span>
                    <span className="font-mono-num text-[11px] text-[#B45309] dark:text-amber-400">
                      9 days old
                    </span>
                  </div>
                  <p className="font-mono-num text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">
                    ₦18,500.00 owed
                  </p>
                  <p className="text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
                    Record payment issues a linked receipt and updates the cash book atomically, or send a polite WhatsApp reminder link.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-[#DED6C2] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-5 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="label-caps text-[#064E3B] dark:text-[#10B981]">Expenses</span>
                    <Paperclip className="w-4 h-4 text-[#5C635D] dark:text-[#9BA39D]" />
                  </div>
                  <h3 className="mt-1.5 font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
                    Every Naira spent, with proof
                  </h3>
                </div>

                <div className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-mono-num">
                    <span className="font-sans-ui font-semibold text-[#121513] dark:text-[#F4F1EA]">
                      Stock · Balogun Market
                    </span>
                    <span className="font-semibold">₦42,000</span>
                  </div>
                  <p className="text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
                    Categorise Stock, Rent, Transport, Salaries, or Utilities. Snap a private receipt proof photo stored strictly for your business.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Row C: Interactive Daily Summary & Reports Component */}
          <InteractiveSummaryPreview />
        </section>

        {/* 6. The Verified Receipt Explained + Click-to-Verify */}
        <section
          id="verify"
          className="border-t border-[#E5DEC9] dark:border-[#242D28] bg-[#F3EFE6]/65 dark:bg-[#111714]"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6 space-y-5">
              <p className="label-caps text-[#064E3B] dark:text-[#10B981]">
                The Verified Receipt
              </p>
              <h2 className="font-display text-[34px] sm:text-[46px] leading-[1.03] text-[#121513] dark:text-[#F4F1EA] [text-wrap:balance]">
                Every receipt carries its own unguessable verification page.
              </h2>
              <p className="text-sm sm:text-base text-[#5C635D] dark:text-[#9BA39D] leading-relaxed">
                When you share a receipt link or your customer scans the QR code, Tallymark opens a public verification view at <span className="font-mono-num text-[#121513] dark:text-[#F4F1EA]">/r/…</span> showing only that receipt’s exact items, total, and live <strong className="text-[#121513] dark:text-[#F4F1EA]">Valid</strong> or <strong className="text-[#121513] dark:text-[#F4F1EA]">Void</strong> status.
              </p>

              <ul className="space-y-2.5 text-sm text-[#121513] dark:text-[#F4F1EA]">
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-[#064E3B] dark:text-[#10B981] shrink-0 mt-0.5" />
                  <span>Receipts are immutable once issued — numbers stay gap-free.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <FileCheck2 className="w-4 h-4 text-[#064E3B] dark:text-[#10B981] shrink-0 mt-0.5" />
                  <span>If a sale is cancelled, voiding keeps the receipt visibly marked VOID with the written reason.</span>
                </li>
              </ul>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setVerifyDemoStatus('VALID');
                    setVerifyFlipped(true);
                    api.trackAnalyticsEvent('hero_qr_verified', '/');
                  }}
                  className={`rounded-lg px-3.5 py-2 text-xs font-semibold border transition-colors min-h-[40px] ${
                    verifyDemoStatus === 'VALID'
                      ? 'bg-[#064E3B] text-white border-[#064E3B]'
                      : 'border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18]'
                  }`}
                >
                  Preview Valid badge
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVerifyDemoStatus('VOID');
                    setVerifyFlipped(true);
                    api.trackAnalyticsEvent('hero_qr_verified', '/');
                  }}
                  className={`rounded-lg px-3.5 py-2 text-xs font-semibold border transition-colors min-h-[40px] ${
                    verifyDemoStatus === 'VOID'
                      ? 'bg-[#B91C1C] text-white border-[#B91C1C]'
                      : 'border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18]'
                  }`}
                >
                  Preview Void badge
                </button>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="rounded-2xl border border-[#DED6C2] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-[#ECE6D8] dark:border-[#242D28]">
                  <span className="font-mono-num text-xs text-[#5C635D] dark:text-[#9BA39D]">
                    tallymark.ng/r/k9P2mV…
                  </span>
                  <button
                    type="button"
                    data-cursor="Open"
                    onClick={() => {
                      setVerifyFlipped((v) => !v);
                      api.trackAnalyticsEvent('hero_qr_verified', '/');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#064E3B] dark:text-[#10B981] hover:underline min-h-[36px]"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>{verifyFlipped ? 'Show QR code' : 'Click QR to verify'}</span>
                  </button>
                </div>

                {!verifyFlipped ? (
                  <button
                    type="button"
                    data-cursor="Open"
                    onClick={() => {
                      setVerifyFlipped(true);
                      api.trackAnalyticsEvent('hero_qr_verified', '/');
                    }}
                    className="w-full rounded-xl border border-dashed border-[#C9B99A] dark:border-[#2F3B34] bg-[#FAF8F3] dark:bg-[#111714] p-6 text-center space-y-3 hover:border-[#064E3B] transition-colors"
                  >
                    <div className="mx-auto w-20 h-20 rounded-lg border border-[#DED6C2] bg-white flex items-center justify-center text-[#121513]">
                      <QrCode className="w-12 h-12" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">
                        Tap to open public verification view
                      </p>
                      <p className="text-xs text-[#5C635D] dark:text-[#9BA39D] mt-1">
                        Simulates scanning the receipt QR code on any customer phone.
                      </p>
                    </div>
                  </button>
                ) : (
                  <div className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">
                          ZedTech Counter Store
                        </p>
                        <h3 className="font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
                          Receipt RCT-0108
                        </h3>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border font-mono-num text-[11px] font-semibold uppercase tracking-[0.08em] ${
                          verifyDemoStatus === 'VALID'
                            ? 'border-[#064E3B] bg-[#ECFDF5] text-[#064E3B]'
                            : 'border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]'
                        }`}
                      >
                        {verifyDemoStatus === 'VALID' && <Check className="w-3.5 h-3.5" />}
                        {verifyDemoStatus === 'VALID' ? 'Valid Receipt' : 'Voided Receipt'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs border-y border-[#ECE6D8] dark:border-[#242D28] py-3 font-mono-num">
                      <div>
                        <p className="text-[10px] uppercase text-[#5C635D] dark:text-[#9BA39D]">
                          Issued Date
                        </p>
                        <p className="font-semibold text-[#121513] dark:text-[#F4F1EA] mt-0.5">
                          18 Nov 2026
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase text-[#5C635D] dark:text-[#9BA39D]">
                          Verified Total
                        </p>
                        <p className="font-semibold text-[#121513] dark:text-[#F4F1EA] mt-0.5">
                          ₦92,000.00
                        </p>
                      </div>
                    </div>

                    {verifyDemoStatus === 'VOID' ? (
                      <p className="text-xs text-[#B91C1C] dark:text-red-400 font-medium">
                        Void reason: Duplicate transfer entry — replaced by RCT-0109.
                      </p>
                    ) : (
                      <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                        Matches store ledger record. Customer private phone numbers and internal shop balances are never shown publicly.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 7. Who It's For */}
        <section id="who-its-for" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
          <div className="max-w-2xl mb-10">
            <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Who it’s for</p>
            <h2 className="mt-2 font-display text-[34px] sm:text-[46px] leading-[1.03] text-[#121513] dark:text-[#F4F1EA] [text-wrap:balance]">
              Built for Nigerian counters where cash, transfer, and POS move fast.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 border-t border-[#E5DEC9] dark:border-[#242D28]">
            {WHO_ITS_FOR.map((item, idx) => (
              <div
                key={item.sector}
                className="py-6 border-b border-[#E5DEC9] dark:border-[#242D28] grid grid-cols-12 gap-4 items-baseline"
              >
                <span className="col-span-2 font-mono-num text-xs text-[#5C635D] dark:text-[#9BA39D]">
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <div className="col-span-10 space-y-1">
                  <h3 className="font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
                    {item.sector}
                  </h3>
                  <p className="text-sm text-[#5C635D] dark:text-[#9BA39D] leading-relaxed">
                    {item.example}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 8. FAQ */}
        <section
          id="faq"
          className="border-t border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#141A17]"
        >
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
            <div className="mb-10">
              <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Questions</p>
              <h2 className="mt-2 font-display text-[34px] sm:text-[44px] leading-[1.03] text-[#121513] dark:text-[#F4F1EA]">
                Plain answers before you start
              </h2>
            </div>

            <div className="divide-y divide-[#E5DEC9] dark:divide-[#26302B] border-y border-[#E5DEC9] dark:border-[#26302B]">
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = openFaqIdx === idx;
                return (
                  <div key={item.question}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => {
                        setOpenFaqIdx(isOpen ? null : idx);
                        api.trackAnalyticsEvent('faq_toggled', '/');
                      }}
                      className="w-full py-5 flex items-center justify-between gap-4 text-left min-h-[56px]"
                    >
                      <span className="font-display text-2xl sm:text-[26px] text-[#121513] dark:text-[#F4F1EA]">
                        {item.question}
                      </span>
                      <ChevronDown
                        className={`w-5 h-5 text-[#5C635D] dark:text-[#9BA39D] shrink-0 transition-transform duration-200 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="pb-5 pr-8 text-sm text-[#5C635D] dark:text-[#9BA39D] leading-relaxed">
                        {item.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 9. Final CTA */}
        <section className="bg-[#064E3B] text-[#FAF8F3]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="max-w-2xl space-y-3">
              <p className="label-caps text-[#A7F3D0]">
                {SITE_CONFIG.earlyAccessTag} · {SITE_CONFIG.trustTag}
              </p>
              <h2 className="font-display text-[36px] sm:text-[50px] leading-[1.02] text-white [text-wrap:balance]">
                Issue the receipt. Keep the book. Know your day.
              </h2>
              <p className="text-sm sm:text-base text-[#D1FAE5]/85">
                Set up your business name, logo, and receipt prefix in under a minute — ready for today’s very next sale.
              </p>
            </div>

            <div className="shrink-0">
              <MagneticWrap>
                <Link
                  to={primaryCtaHref}
                  onClick={handlePrimaryCtaClick}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#FAF8F3] hover:bg-white text-[#064E3B] px-7 py-4 text-sm font-semibold transition-colors min-h-[52px]"
                >
                  <span>{primaryCtaLabel}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </MagneticWrap>
            </div>
          </div>
        </section>
      </main>

      {/* 10. Footer */}
      <footer className="border-t border-[#E5DEC9] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#0D110F] py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-xs text-[#5C635D] dark:text-[#9BA39D]">
          <div className="flex flex-wrap items-center gap-3">
            <TallymarkWordmark size="sm" />
            <span aria-hidden="true">·</span>
            <span>{SITE_CONFIG.creditLine}</span>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <a
              href={`mailto:${SITE_CONFIG.contactEmail}`}
              className="hover:text-[#121513] dark:hover:text-[#F4F1EA] underline-offset-4 hover:underline"
            >
              {SITE_CONFIG.contactEmail}
            </a>
            <Link to="/privacy" className="hover:text-[#121513] dark:hover:text-[#F4F1EA]">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-[#121513] dark:hover:text-[#F4F1EA]">
              Terms
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-1.5 hover:text-[#121513] dark:hover:text-[#F4F1EA] min-h-[36px]"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
