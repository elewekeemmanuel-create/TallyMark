import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  Check,
  Plus,
  QrCode,
  RotateCcw,
  Stamp,
  Trash2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Link } from '../../lib/router';
import { calculateReceiptTotals, formatKobo, parseAmountToKobo } from '../../shared/money';
import type { ReceiptTemplate } from '../../shared/schemas';
import type { PublicReceiptRecord } from '../../shared/types';
import { ReceiptTemplateView } from '../ReceiptTemplates';
import { SpeechInput } from '../SpeechInput';
import { usePrefersReducedMotion } from './DesktopPolish';

interface DemoItemPreset {
  id: string;
  description: string;
  unitPriceKobo: number;
}

const ITEM_PRESETS: DemoItemPreset[] = [
  { id: 'adire', description: 'Silk Adire Boubou', unitPriceKobo: 2850000 },
  { id: 'braids', description: 'Knotless Braids Session', unitPriceKobo: 1800000 },
  { id: 'ankara', description: 'Ankara Wax Print (6 yds)', unitPriceKobo: 1450000 },
  { id: 'tray', description: 'Jollof & Grilled Chicken Pack', unitPriceKobo: 650000 },
  { id: 'charger', description: 'USB-C Fast Charger 30W', unitPriceKobo: 1200000 },
];

const BRAND_SWATCHES = [
  { label: 'Forest Ink', hex: '#064E3B' },
  { label: 'Terracotta', hex: '#7C2D12' },
  { label: 'Lagos Slate', hex: '#1E3A5F' },
  { label: 'Warm Umber', hex: '#78350F' },
  { label: 'Charcoal', hex: '#18181B' },
] as const;

interface BuilderRow {
  id: string;
  description: string;
  qty: number;
  unitPriceKobo: number;
}

export function HeroLiveReceipt({ isSignedIn }: { isSignedIn: boolean }) {
  const reducedMotion = usePrefersReducedMotion();
  const [rows, setRows] = useState<BuilderRow[]>([
    { id: 'init-1', description: 'Silk Adire Boubou', qty: 1, unitPriceKobo: 2850000 },
    { id: 'init-2', description: 'Ankara Wax Print (6 yds)', qty: 1, unitPriceKobo: 1450000 },
  ]);
  const [customerName, setCustomerName] = useState('Amaka Okafor');
  const [newDesc, setNewDesc] = useState('');
  const [newPriceNaira, setNewPriceNaira] = useState('');
  const [template, setTemplate] = useState<ReceiptTemplate>('compact');
  const [brandColor, setBrandColor] = useState<string>('#064E3B');
  const [paymentMethod, setPaymentMethod] = useState<'Transfer' | 'Cash' | 'POS'>('Transfer');
  const [stampedKey, setStampedKey] = useState(1);
  const [verifiedFlip, setVerifiedFlip] = useState(false);
  const [printFeedNonce, setPrintFeedNonce] = useState(1);
  const [formHint, setFormHint] = useState<string | null>(null);

  const totals = useMemo(() => {
    const safeRows =
      rows.length > 0
        ? rows
        : [{ id: 'empty', description: 'Sample Counter Sale', qty: 1, unitPriceKobo: 0 }];
    return calculateReceiptTotals(
      safeRows.map((r) => ({
        description: r.description,
        qty: r.qty,
        unitPriceKobo: r.unitPriceKobo,
        discountKobo: 0,
      })),
      false,
      'exclusive',
      750
    );
  }, [rows]);

  const demoReceipt: PublicReceiptRecord = useMemo(
    () => ({
      publicId: 'demo-lekki-0042',
      receiptNumber: 'RCT-0042',
      receiptKind: 'SALE',
      parentReceiptNumber: null,
      businessName: 'ZedTech Counter Store',
      businessLogoDataUrl: null,
      businessAddress: '14 Admiralty Way, Lekki Phase 1, Lagos',
      businessPhone: '+234 803 000 0142',
      businessEmail: 'sales@zedtech.ng',
      brandColor,
      currency: 'NGN',
      customerName: customerName.trim() || 'Walk-in Customer',
      customerPhone: '',
      items: totals.items,
      subtotalKobo: totals.subtotalKobo,
      discountTotalKobo: 0,
      vatEnabled: false,
      vatMode: 'exclusive',
      vatRateBps: 750,
      vatKobo: 0,
      totalKobo: totals.totalKobo,
      amountPaidKobo: totals.totalKobo,
      balanceDueKobo: 0,
      paymentMethod,
      note: 'Thank you for your patronage.',
      soldBy: 'Tunde',
      template,
      status: 'PAID',
      voidReason: null,
      voidedAt: null,
      issuedDateLagos: '2026-11-18',
      issuedAt: '2026-11-18T11:30:00.000Z',
    }),
    [brandColor, customerName, paymentMethod, template, totals]
  );

  const handleTogglePreset = (preset: DemoItemPreset) => {
    setFormHint(null);
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.description === preset.description);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [
        ...prev,
        {
          id: `${preset.id}-${Date.now()}`,
          description: preset.description,
          qty: 1,
          unitPriceKobo: preset.unitPriceKobo,
        },
      ];
    });
    setPrintFeedNonce((n) => n + 1);
    api.trackAnalyticsEvent('hero_receipt_updated', '/');
  };

  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    const desc = newDesc.trim();
    const kobo = parseAmountToKobo(newPriceNaira);
    if (!desc) {
      setFormHint('Type or dictate an item name first.');
      return;
    }
    if (kobo <= 0) {
      setFormHint('Enter a price in Naira above zero.');
      return;
    }
    setFormHint(null);
    setRows((prev) => [
      ...prev,
      { id: `custom-${Date.now()}`, description: desc, qty: 1, unitPriceKobo: kobo },
    ]);
    setNewDesc('');
    setNewPriceNaira('');
    setStampedKey((k) => k + 1);
    setPrintFeedNonce((n) => n + 1);
    api.trackAnalyticsEvent('hero_receipt_updated', '/');
  };

  const handleRemoveRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    api.trackAnalyticsEvent('hero_receipt_updated', '/');
  };

  const handleStampSlam = () => {
    setStampedKey((k) => k + 1);
    setVerifiedFlip(false);
    api.trackAnalyticsEvent('hero_receipt_stamped', '/');
  };

  return (
    <div className="space-y-4">
      {/* Interactive Builder Controls */}
      <div className="rounded-2xl border border-[#DED6C2] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#ECE6D8] dark:border-[#242D28]">
          <div>
            <p className="label-caps text-[#064E3B] dark:text-[#10B981]">
              Try it right now · Nothing saved
            </p>
            <p className="text-xs text-[#5C635D] dark:text-[#9BA39D] mt-0.5">
              Tap items or type one below — watch the receipt update in real kobo math.
            </p>
          </div>
          <span className="font-mono-num text-base font-semibold text-[#121513] dark:text-[#F4F1EA]">
            {formatKobo(totals.totalKobo, 'NGN')}
          </span>
        </div>

        {/* Item presets */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sample shop items">
          {ITEM_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleTogglePreset(preset)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-2.5 py-1.5 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] hover:border-[#064E3B] dark:hover:border-[#10B981] transition-colors min-h-[36px]"
            >
              <Plus className="w-3 h-3 text-[#064E3B] dark:text-[#10B981]" />
              <span>{preset.description}</span>
              <span className="font-mono-num text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
                {formatKobo(preset.unitPriceKobo, 'NGN')}
              </span>
            </button>
          ))}
        </div>

        {/* Custom item form + Web Speech mic */}
        <form onSubmit={handleAddCustomItem} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
          <div className="sm:col-span-6">
            <label htmlFor="hero-item-desc" className="sr-only">
              Item description
            </label>
            <SpeechInput
              id="hero-item-desc"
              value={newDesc}
              onChangeValue={setNewDesc}
              placeholder="Type or dictate item…"
              micLabel="Dictate item description"
              className="text-xs"
            />
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="hero-item-price" className="sr-only">
              Price in Naira
            </label>
            <input
              id="hero-item-price"
              type="text"
              inputMode="decimal"
              value={newPriceNaira}
              onChange={(e) => setNewPriceNaira(e.target.value)}
              placeholder="₦ Price"
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2.5 text-xs font-mono-num text-[#121513] dark:text-[#F4F1EA] placeholder:text-[#8B918B] focus:outline-none focus:ring-2 focus:ring-[#064E3B]/30 min-h-[44px]"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              className="w-full rounded-xl bg-[#064E3B] hover:bg-[#04392B] text-white text-xs font-semibold px-3 py-2.5 min-h-[44px] transition-colors"
            >
              Add line
            </button>
          </div>
        </form>
        {formHint && <p className="text-xs text-[#B45309] dark:text-amber-400">{formHint}</p>}

        {/* Active line list (compact remove/customer row) */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center pt-1">
          <div className="sm:col-span-6">
            <label htmlFor="hero-customer-name" className="sr-only">
              Customer name
            </label>
            <input
              id="hero-customer-name"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name (optional)"
              className="w-full rounded-lg border border-[#ECE6D8] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-1.5 text-xs text-[#121513] dark:text-[#F4F1EA] focus:outline-none focus:border-[#064E3B] min-h-[38px]"
            />
          </div>
          <div className="sm:col-span-6 flex items-center gap-1 justify-start sm:justify-end">
            {(['Transfer', 'Cash', 'POS'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMethod(m)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors min-h-[36px] ${
                  paymentMethod === m
                    ? 'bg-[#121513] dark:bg-[#F4F1EA] text-white dark:text-[#121513]'
                    : 'border border-[#DED6C2] dark:border-[#2B352F] text-[#5C635D] dark:text-[#9BA39D]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {rows.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#E5DEC9] dark:border-[#28322D] bg-[#FAF8F3] dark:bg-[#111714] px-2 py-1 text-[11px] text-[#121513] dark:text-[#F4F1EA]"
              >
                <span className="truncate max-w-[140px]">
                  {r.qty}× {r.description}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveRow(r.id)}
                  aria-label={`Remove ${r.description}`}
                  className="text-[#5C635D] hover:text-[#B91C1C] p-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Style Bar: Color Swatches + Template Switcher + Stamp button */}
        <div className="pt-3 border-t border-[#ECE6D8] dark:border-[#242D28] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2" role="group" aria-label="Brand color picker">
            <span className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Ink</span>
            {BRAND_SWATCHES.map((sw) => {
              const active = brandColor === sw.hex;
              return (
                <button
                  key={sw.hex}
                  type="button"
                  onClick={() => {
                    setBrandColor(sw.hex);
                    api.trackAnalyticsEvent('hero_color_switched', '/');
                  }}
                  title={sw.label}
                  aria-label={`Select ${sw.label} brand color`}
                  aria-pressed={active}
                  className={`w-6 h-6 rounded-md border transition-transform ${
                    active
                      ? 'scale-110 ring-2 ring-offset-2 ring-[#121513] dark:ring-[#F4F1EA] dark:ring-offset-[#151B18]'
                      : 'border-black/15 hover:scale-105'
                  }`}
                  style={{ backgroundColor: sw.hex }}
                />
              );
            })}
          </div>

          <div
            className="inline-flex items-center gap-1 rounded-lg border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] p-0.5"
            role="group"
            aria-label="Receipt template switcher"
          >
            {(['compact', 'modern', 'classic'] as ReceiptTemplate[]).map((tpl) => (
              <button
                key={tpl}
                type="button"
                onClick={() => {
                  setTemplate(tpl);
                  setVerifiedFlip(false);
                  api.trackAnalyticsEvent('hero_template_switched', '/');
                }}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors min-h-[32px] ${
                  template === tpl
                    ? 'bg-[#064E3B] text-white'
                    : 'text-[#5C635D] dark:text-[#9BA39D] hover:text-[#121513] dark:hover:text-[#F4F1EA]'
                }`}
              >
                {tpl === 'compact' ? '80mm' : tpl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Receipt Slot Printer Output */}
      <div className="relative">
        {/* Realistic machined slot lip */}
        <div className="mx-4 sm:mx-8 h-3.5 rounded-t-lg bg-[#1A201D] dark:bg-[#212925] border-x border-t border-[#2E3833] flex items-center justify-between px-4">
          <span className="h-0.5 w-16 bg-[#B89B6A]/70 rounded-full" />
          <span className="font-mono-num text-[9px] uppercase tracking-[0.18em] text-[#9BA39D]">
            {verifiedFlip ? 'Public Check' : 'Live Paper Output'}
          </span>
        </div>

        <div className="rounded-b-2xl border border-[#DED6C2] dark:border-[#26302B] bg-[#EFE9DA] dark:bg-[#111614] p-3 sm:p-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <button
              type="button"
              data-cursor="Stamp"
              onClick={handleStampSlam}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#064E3B]/30 dark:border-[#10B981]/30 bg-white dark:bg-[#151B18] px-3 py-1.5 text-xs font-semibold text-[#064E3B] dark:text-[#10B981] hover:bg-[#064E3B] hover:text-white transition-colors min-h-[36px]"
            >
              <Stamp className="w-3.5 h-3.5" />
              <span>Stamp PAID</span>
            </button>

            <button
              type="button"
              data-cursor="Open"
              onClick={() => {
                setVerifiedFlip((v) => !v);
                api.trackAnalyticsEvent('hero_qr_verified', '/');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3 py-1.5 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] hover:border-[#064E3B] transition-colors min-h-[36px]"
            >
              {verifiedFlip ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Back to receipt</span>
                </>
              ) : (
                <>
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Click-to-verify QR</span>
                </>
              )}
            </button>
          </div>

          <AnimatePresence mode="wait">
            {verifiedFlip ? (
              <motion.div
                key="verified-card"
                initial={reducedMotion ? false : { opacity: 0, rotateY: -12 }}
                animate={{ opacity: 1, rotateY: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="mx-auto max-w-[420px] rounded-xl border border-[#DED6C2] bg-white text-[#121513] p-5 shadow-sm space-y-4"
              >
                <div className="flex items-center justify-between border-b border-[#ECE6D8] pb-3">
                  <div>
                    <p className="label-caps text-[#5C635D]">Public Verification · /r/demo</p>
                    <p className="font-mono-num text-sm font-semibold mt-0.5">
                      {demoReceipt.receiptNumber} · {demoReceipt.businessName}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1.5 border border-[#064E3B] bg-[#ECFDF5] text-[#064E3B] px-2.5 py-1 rounded-sm font-mono-num text-[11px] font-semibold uppercase tracking-[0.08em]">
                    <Check className="w-3.5 h-3.5" />
                    <span>Valid</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="label-caps text-[#5C635D]">Customer</p>
                    <p className="font-medium mt-0.5">{demoReceipt.customerName}</p>
                  </div>
                  <div className="text-right">
                    <p className="label-caps text-[#5C635D]">Total Verified</p>
                    <p className="font-mono-num font-semibold text-sm mt-0.5">
                      {formatKobo(demoReceipt.totalKobo, 'NGN')}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-[#5C635D] leading-relaxed">
                  Anyone with the link or QR code can confirm this receipt is genuine, see the exact items and paid amount, or see if it was later marked VOID with a reason.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key={`${template}-${printFeedNonce}`}
                initial={reducedMotion ? false : { y: -22, opacity: 0.9 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="relative"
              >
                {/* Stamp-slam visual overlay pulse when user hits Stamp PAID */}
                {!reducedMotion && stampedKey > 1 && (
                  <motion.div
                    key={`slam-${stampedKey}`}
                    initial={{ scale: 1.55, opacity: 0, rotate: -14 }}
                    animate={{ scale: [1.55, 0.96, 1], opacity: [0, 0.95, 0], rotate: -7 }}
                    transition={{ duration: 0.65, ease: 'easeOut' }}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-6 top-16 z-20 border-[3px] border-double border-[#064E3B] bg-[#ECFDF5]/90 text-[#064E3B] px-4 py-1 font-mono-num text-sm font-bold tracking-[0.18em] uppercase"
                  >
                    PAID
                  </motion.div>
                )}
                <ReceiptTemplateView receipt={demoReceipt} templateOverride={template} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Below interactive receipt: Make this receipt yours */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
          <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
            Preview only — nothing here is stored until you create your own counter book.
          </p>
          <Link
            to={isSignedIn ? '/app/new' : '/login'}
            onClick={() => api.trackAnalyticsEvent('hero_make_yours_clicked', '/')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#064E3B] hover:bg-[#04392B] text-white text-xs font-semibold px-4 py-2.5 min-h-[44px] whitespace-nowrap shrink-0 transition-colors"
          >
            <span>Make this receipt yours</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
