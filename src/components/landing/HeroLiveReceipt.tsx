import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  ChevronDown,
  Plus,
  QrCode,
  RotateCcw,
  SlidersHorizontal,
  Stamp,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Link } from '../../lib/router';
import {
  calculateReceiptTotals,
  formatKobo,
  formatLagosDateOnly,
  koboToWords,
  parseAmountToKobo,
} from '../../shared/money';
import type { ReceiptTemplate } from '../../shared/schemas';
import { RubberStamp, TallymarkEmblem } from '../TallymarkLogo';

interface DemoItemPreset {
  id: string;
  description: string;
  unitPriceKobo: number;
}

const ITEM_PRESETS: DemoItemPreset[] = [
  { id: 'adire', description: 'Silk Adire Boubou', unitPriceKobo: 2850000 },
  { id: 'braids', description: 'Knotless Braids', unitPriceKobo: 1800000 },
  { id: 'ankara', description: 'Ankara Wax Print (6 yds)', unitPriceKobo: 1450000 },
  { id: 'tray', description: 'Jollof & Chicken Pack', unitPriceKobo: 650000 },
  { id: 'charger', description: 'USB-C Charger 30W', unitPriceKobo: 1200000 },
];

const BRAND_SWATCHES = [
  { label: 'Emerald', hex: '#064E3B' },
  { label: 'Navy', hex: '#1E40AF' },
  { label: 'Charcoal', hex: '#18181B' },
] as const;

interface BuilderRow {
  id: string;
  description: string;
  qty: number;
  unitPriceKobo: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useCountUpNumber(target: number, durationMs = 300): number {
  const [displayed, setDisplayed] = useState(target);
  const currentRef = useRef(target);

  useEffect(() => {
    const startVal = currentRef.current;
    if (startVal === target || prefersReducedMotion()) {
      currentRef.current = target;
      setDisplayed(target);
      return;
    }

    let rafId = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(startVal + (target - startVal) * eased);
      currentRef.current = next;
      setDisplayed(next);
      if (progress < 1) {
        rafId = window.requestAnimationFrame(step);
      } else {
        currentRef.current = target;
        setDisplayed(target);
      }
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [target, durationMs]);

  return displayed;
}

function useDemoQrDataUrl(publicId: string): string {
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    let active = true;
    const targetUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/r/${publicId}`
        : `https://tallymark.app/r/${publicId}`;

    QRCode.toDataURL(targetUrl, {
      width: 144,
      margin: 1,
      color: { dark: '#111827', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrUrl(url);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [publicId]);

  return qrUrl;
}

export function HeroLiveReceipt({ isSignedIn }: { isSignedIn: boolean }) {
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
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [verifiedFlip, setVerifiedFlip] = useState(false);
  const [stampedNotice, setStampedNotice] = useState(false);
  const [formHint, setFormHint] = useState<string | null>(null);
  const [recentRow, setRecentRow] = useState<{ id: string; seq: number } | null>(null);

  const stampTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (stampTimeoutRef.current !== null) {
        window.clearTimeout(stampTimeoutRef.current);
      }
    };
  }, []);

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

  const animatedTotalKobo = useCountUpNumber(totals.totalKobo, 300);
  const qrUrl = useDemoQrDataUrl('demo-lekki-0042');
  const words = useMemo(() => koboToWords(totals.totalKobo, 'NGN'), [totals.totalKobo]);
  const displayCustomer = customerName.trim() || 'Walk-in Customer';

  const receiptItems = useMemo(() => {
    const safeRows =
      rows.length > 0
        ? rows
        : [{ id: 'empty', description: 'Sample Counter Sale', qty: 1, unitPriceKobo: 0 }];
    return safeRows.map((row, idx) => ({
      id: row.id,
      description: totals.items[idx]?.description ?? row.description,
      qty: totals.items[idx]?.qty ?? row.qty,
      unitPriceKobo: totals.items[idx]?.unitPriceKobo ?? row.unitPriceKobo,
      lineTotalKobo: totals.items[idx]?.lineTotalKobo ?? row.qty * row.unitPriceKobo,
    }));
  }, [rows, totals.items]);

  const handleAddPreset = (preset: DemoItemPreset) => {
    setFormHint(null);
    setVerifiedFlip(false);
    let targetId = '';
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.description === preset.description);
      if (idx >= 0) {
        const next = [...prev];
        targetId = next[idx].id;
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      targetId = `${preset.id}-${Date.now()}`;
      return [
        ...prev,
        {
          id: targetId,
          description: preset.description,
          qty: 1,
          unitPriceKobo: preset.unitPriceKobo,
        },
      ];
    });
    setRecentRow((prev) => ({ id: targetId, seq: (prev?.seq ?? 0) + 1 }));
    api.trackAnalyticsEvent('hero_receipt_updated', '/');
  };

  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    const desc = newDesc.trim();
    const kobo = parseAmountToKobo(newPriceNaira);
    if (!desc) {
      setFormHint('Add an item name.');
      return;
    }
    if (kobo <= 0) {
      setFormHint('Enter a price.');
      return;
    }
    setFormHint(null);
    setVerifiedFlip(false);
    const id = `custom-${Date.now()}`;
    setRows((prev) => [...prev, { id, description: desc, qty: 1, unitPriceKobo: kobo }]);
    setRecentRow((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
    setNewDesc('');
    setNewPriceNaira('');
    api.trackAnalyticsEvent('hero_receipt_updated', '/');
  };

  const handleRemoveRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    api.trackAnalyticsEvent('hero_receipt_updated', '/');
  };

  const handleStamp = () => {
    setVerifiedFlip(false);
    setStampedNotice(true);
    if (stampTimeoutRef.current !== null) {
      window.clearTimeout(stampTimeoutRef.current);
    }
    stampTimeoutRef.current = window.setTimeout(() => setStampedNotice(false), 1400);
    api.trackAnalyticsEvent('hero_receipt_stamped', '/');
  };

  const isClassic = template === 'classic';
  const isModern = template === 'modern';

  return (
    <div className="space-y-8">
      {/* Single unified surface: no nested grey-in-white-in-grey cards */}
      <div className="landing-card bg-white p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
          {/* Left column: Mobile-ordered interactive builder */}
          <div className="lg:col-span-6 space-y-6">
            {/* Prompt + live running total */}
            <div className="flex items-baseline justify-between gap-4 pb-4 border-b border-[#E5E7EB]">
              <p className="text-[16px] font-normal leading-[1.5] text-[#374151]">
                Tap an item to add it.
              </p>
              <span className="tabular-nums-ui text-[18px] font-semibold text-[#111827] shrink-0">
                {formatKobo(animatedTotalKobo, 'NGN')}
              </span>
            </div>

            {/* 1. Tappable item chips: two-line wrap (name above price, no truncation) */}
            <div
              className="grid grid-cols-2 sm:grid-cols-3 gap-2"
              role="group"
              aria-label="Sample items"
            >
              {ITEM_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleAddPreset(preset)}
                  className="landing-btn group min-h-[64px] w-full rounded-[12px] border border-[#E5E7EB] bg-[#F8F9FA] hover:border-[#064E3B] hover:bg-[#ECFDF5] px-3 py-2.5 text-left flex flex-col justify-between gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
                >
                  <span className="text-[14px] font-semibold leading-[1.3] text-[#111827] group-hover:text-[#064E3B] break-words">
                    {preset.description}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums-ui text-[13px] font-normal text-[#4B5563] group-hover:text-[#064E3B]">
                    <Plus className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span>{formatKobo(preset.unitPriceKobo, 'NGN')}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* Custom item quick-add */}
            <form onSubmit={handleAddCustomItem} className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-6">
                  <label htmlFor="hero-item-desc" className="sr-only">
                    Item name
                  </label>
                  <input
                    id="hero-item-desc"
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Type an item"
                    className="w-full min-h-[44px] rounded-[12px] border border-[#D1D5DB] bg-white px-3.5 py-2.5 text-[16px] font-normal text-[#111827] placeholder:text-[#59626E] focus:outline-none focus:border-[#064E3B] focus:ring-2 focus:ring-[#064E3B]/20"
                  />
                </div>
                <div className="grid grid-cols-12 sm:col-span-6 gap-2">
                  <div className="col-span-7">
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
                      className="w-full min-h-[44px] rounded-[12px] border border-[#D1D5DB] bg-white px-3.5 py-2.5 text-[16px] font-normal tabular-nums-ui text-[#111827] placeholder:text-[#59626E] focus:outline-none focus:border-[#064E3B] focus:ring-2 focus:ring-[#064E3B]/20"
                    />
                  </div>
                  <div className="col-span-5">
                    <button
                      type="submit"
                      className="landing-btn w-full min-h-[44px] rounded-[12px] bg-[#064E3B] hover:bg-[#04392B] text-white text-[15px] font-semibold px-4 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
              {formHint && (
                <p role="alert" className="text-[14px] font-normal text-[#B45309]">
                  {formHint}
                </p>
              )}
            </form>

            {/* 2. Selected items */}
            {rows.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Selected items">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className="inline-flex items-center rounded-[12px] border border-[#E5E7EB] bg-[#F8F9FA] pl-3 pr-0.5 min-h-[44px] max-w-full"
                  >
                    <span className="text-[14px] font-normal text-[#111827] leading-snug py-1.5 break-words">
                      <span className="tabular-nums-ui font-semibold">{r.qty}×</span> {r.description}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(r.id)}
                      aria-label={`Remove ${r.description}`}
                      className="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-[10px] text-[#4B5563] hover:text-[#B91C1C] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
                    >
                      <X className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 3. Customer name */}
            <div>
              <label htmlFor="hero-customer-name" className="sr-only">
                Customer name
              </label>
              <input
                id="hero-customer-name"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer name"
                className="w-full min-h-[44px] rounded-[12px] border border-[#D1D5DB] bg-white px-3.5 py-2.5 text-[16px] font-normal text-[#111827] placeholder:text-[#59626E] focus:outline-none focus:border-[#064E3B] focus:ring-2 focus:ring-[#064E3B]/20"
              />
            </div>

            {/* 4. Payment method: 44px segmented control */}
            <div
              className="grid grid-cols-3 gap-1 rounded-[12px] border border-[#E5E7EB] bg-[#F3F4F6] p-1"
              role="group"
              aria-label="Payment method"
            >
              {(['Transfer', 'Cash', 'POS'] as const).map((method) => {
                const active = paymentMethod === method;
                return (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPaymentMethod(method)}
                    className={`min-h-[44px] rounded-[8px] px-3 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B] ${
                      active
                        ? 'bg-[#064E3B] text-white shadow-[0_1px_2px_rgba(17,24,39,0.08)]'
                        : 'text-[#374151] hover:text-[#111827]'
                    }`}
                  >
                    {method}
                  </button>
                );
              })}
            </div>

            {/* 5. Collapsed "Customise" row (closed by default) */}
            <div className="border-t border-[#E5E7EB] pt-2">
              <button
                type="button"
                aria-expanded={customiseOpen}
                aria-controls="demo-customise-panel"
                onClick={() => setCustomiseOpen((v) => !v)}
                className="w-full min-h-[44px] flex items-center justify-between gap-3 py-2 text-left text-[15px] font-semibold text-[#111827] hover:text-[#064E3B] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B] rounded-[8px]"
              >
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal
                    className="w-4 h-4 text-[#064E3B]"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span>Customise</span>
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-[#4B5563] transition-transform duration-200 ${
                    customiseOpen ? 'rotate-180 text-[#064E3B]' : ''
                  }`}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>

              <div
                id="demo-customise-panel"
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  customiseOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="pt-3 pb-1 space-y-4">
                    {/* Brand colours: 44px tap targets, distinct swatches */}
                    <div
                      className="flex flex-wrap items-center justify-between gap-3"
                      role="group"
                      aria-label="Receipt color"
                    >
                      <span className="text-[14px] font-normal text-[#4B5563]">Color</span>
                      <div className="flex items-center gap-2">
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
                              aria-label={`Select ${sw.label} color`}
                              aria-pressed={active}
                              className="w-11 h-11 rounded-full flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
                            >
                              <span
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform ${
                                  active
                                    ? 'ring-2 ring-offset-2 ring-[#064E3B] scale-105'
                                    : 'ring-1 ring-black/15'
                                }`}
                                style={{ backgroundColor: sw.hex }}
                              >
                                {active && (
                                  <Check
                                    className="w-3.5 h-3.5 text-white"
                                    strokeWidth={1.75}
                                    aria-hidden="true"
                                  />
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Format selector */}
                    <div
                      className="grid grid-cols-3 gap-1 rounded-[12px] border border-[#E5E7EB] bg-[#F3F4F6] p-1"
                      role="group"
                      aria-label="Receipt template"
                    >
                      {(['compact', 'modern', 'classic'] as ReceiptTemplate[]).map((tpl) => {
                        const active = template === tpl;
                        return (
                          <button
                            key={tpl}
                            type="button"
                            aria-pressed={active}
                            onClick={() => {
                              setTemplate(tpl);
                              setVerifiedFlip(false);
                              api.trackAnalyticsEvent('hero_template_switched', '/');
                            }}
                            className={`min-h-[44px] rounded-[8px] px-3 text-[14px] font-semibold capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B] ${
                              active
                                ? 'bg-[#064E3B] text-white'
                                : 'text-[#374151] hover:text-[#111827]'
                            }`}
                          >
                            {tpl === 'compact' ? '80mm' : tpl}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right column (sticky on desktop >=1024px, directly below controls on mobile): Live Receipt */}
          <div className="lg:col-span-6 lg:sticky lg:top-[72px] pt-6 lg:pt-0 border-t lg:border-t-0 lg:border-l border-[#E5E7EB] lg:pl-10 space-y-4">
            {/* Action bar: Stamp paid + Verify QR */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleStamp}
                className="landing-btn inline-flex items-center gap-2 min-h-[44px] rounded-[12px] bg-[#ECFDF5] hover:bg-[#D1FAE5] px-4 py-2 text-[14px] font-semibold text-[#064E3B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
              >
                <Stamp className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span>{stampedNotice ? 'Stamped paid' : 'Stamp paid'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setVerifiedFlip((v) => !v);
                  api.trackAnalyticsEvent('hero_qr_verified', '/');
                }}
                className="landing-btn inline-flex items-center gap-2 min-h-[44px] rounded-[12px] border border-[#E5E7EB] bg-white hover:bg-[#F8F9FA] px-4 py-2 text-[14px] font-semibold text-[#111827] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
              >
                {verifiedFlip ? (
                  <>
                    <RotateCcw className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span>Back to receipt</span>
                  </>
                ) : (
                  <>
                    <QrCode
                      className="w-4 h-4 shrink-0 text-[#064E3B]"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span>Verify QR</span>
                  </>
                )}
              </button>
            </div>

            {/* Live Receipt Preview or QR Verification Check (single container surface, zero nested cards) */}
            {verifiedFlip ? (
              <div className="pt-4 border-t border-[#E5E7EB] space-y-5">
                <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] pb-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-normal text-[#4B5563]">Public check</p>
                    <p className="font-mono-num text-[14px] font-semibold text-[#111827] mt-1 break-words">
                      RCT-0042 · Kemi Fabrics
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] text-[#064E3B] px-3 py-1 text-[13px] font-semibold shrink-0">
                    <Check className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden="true" />
                    <span>Verified</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-normal text-[#4B5563]">Customer</p>
                    <p className="text-[15px] font-semibold text-[#111827] mt-0.5 break-words">
                      {displayCustomer}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-normal text-[#4B5563]">Total</p>
                    <p className="font-mono-num text-[15px] font-semibold text-[#111827] mt-0.5">
                      {formatKobo(animatedTotalKobo, 'NGN')}
                    </p>
                  </div>
                </div>

                <p className="text-[15px] font-normal text-[#374151] leading-[1.5]">
                  Anyone with the QR code can verify this receipt.
                </p>
              </div>
            ) : (
              <div className="pt-4 border-t border-[#E5E7EB] space-y-4">
                {isModern && (
                  <div
                    className="h-1.5 w-full rounded-full"
                    style={{ backgroundColor: brandColor }}
                    aria-hidden="true"
                  />
                )}

                {/* Business header */}
                <div
                  className={
                    isModern
                      ? 'flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#E5E7EB]'
                      : isClassic
                        ? 'text-center py-3 border-y-2'
                        : 'text-center pb-4 border-b border-dashed border-[#D1D5DB]'
                  }
                  style={isClassic ? { borderColor: brandColor } : undefined}
                >
                  <div>
                    <p className="text-[17px] font-semibold text-[#111827] tracking-[-0.015em]">
                      Kemi Fabrics
                    </p>
                    <p className="text-[12px] font-normal text-[#4B5563] mt-0.5">
                      14 Admiralty Way, Lekki Phase 1, Lagos
                    </p>
                    <p className="font-mono-num text-[11px] text-[#4B5563] mt-0.5">
                      +234 803 000 0142 · sales@kemifabrics.ng
                    </p>
                  </div>
                  {isModern && (
                    <div className="text-left sm:text-right">
                      <p className="text-[12px] font-semibold" style={{ color: brandColor }}>
                        Receipt
                      </p>
                      <p className="font-mono-num text-[15px] font-semibold text-[#111827]">
                        RCT-0042
                      </p>
                    </div>
                  )}
                </div>

                {/* Receipt metadata */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] pb-4 border-b border-dashed border-[#D1D5DB]">
                  <div>
                    <span className="text-[#4B5563] block">Receipt</span>
                    <span className="font-mono-num font-semibold text-[#111827]">RCT-0042</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[#4B5563] block">Date</span>
                    <span className="font-mono-num text-[#111827]">
                      {formatLagosDateOnly('2026-11-18')}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[#4B5563] block">Customer</span>
                    <span className="font-semibold text-[#111827] block truncate">
                      {displayCustomer}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[#4B5563] block">Sold by</span>
                    <span className="text-[#111827]">Tunde</span>
                  </div>
                </div>

                {/* Line items: 3-column grid (description left | qty x price middle | line total right) */}
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2.5 sm:gap-x-4 pb-1.5 border-b border-[#E5E7EB] text-[11px] font-semibold text-[#4B5563]">
                    <span>Item</span>
                    <span className="text-right whitespace-nowrap">Qty × Price</span>
                    <span className="text-right whitespace-nowrap">Total</span>
                  </div>

                  <div className="divide-y divide-[#F3F4F6]">
                    {receiptItems.map((item) => {
                      const isRecent = recentRow?.id === item.id;
                      return (
                        <div
                          key={isRecent ? `${item.id}-${recentRow.seq}` : item.id}
                          className={`grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2.5 sm:gap-x-4 items-baseline py-2 px-1 -mx-1 rounded-[8px] ${
                            isRecent ? 'receipt-row-enter' : ''
                          }`}
                        >
                          <span className="min-w-0 text-[12.5px] sm:text-[13px] font-semibold text-[#111827] leading-snug break-words">
                            {item.description}
                          </span>
                          <span className="font-mono-num text-[10.5px] sm:text-[12px] text-[#4B5563] whitespace-nowrap text-right">
                            {item.qty} × {formatKobo(item.unitPriceKobo, 'NGN')}
                          </span>
                          <span className="font-mono-num text-[11.5px] sm:text-[13px] font-semibold text-[#111827] whitespace-nowrap text-right">
                            {formatKobo(item.lineTotalKobo, 'NGN')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Totals with 300ms animated count-up */}
                <div className="pt-3 border-t border-dashed border-[#D1D5DB] space-y-1.5 font-mono-num text-[12px]">
                  <div className="flex items-baseline justify-between gap-4 text-[#4B5563]">
                    <span>Subtotal</span>
                    <span>{formatKobo(animatedTotalKobo, 'NGN')}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 pt-2 border-t border-[#E5E7EB] text-[15px] font-semibold text-[#111827]">
                    <span>TOTAL</span>
                    <span>{formatKobo(animatedTotalKobo, 'NGN')}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 text-[#4B5563]">
                    <span>Paid ({paymentMethod})</span>
                    <span className="font-semibold text-[#111827]">
                      {formatKobo(animatedTotalKobo, 'NGN')}
                    </span>
                  </div>
                </div>

                <p className="pt-3 border-t border-dashed border-[#D1D5DB] text-[11.5px] leading-snug text-[#4B5563]">
                  <span className="font-semibold text-[#111827]">In words:</span> {words}
                </p>

                {/* Stamp + QR footer */}
                <div className="pt-3 border-t border-dashed border-[#D1D5DB] flex items-center justify-between gap-4">
                  <div className="space-y-2">
                    <RubberStamp status="PAID" compact />
                    <div className="flex items-center gap-1.5 text-[11px] text-[#4B5563]">
                      <TallymarkEmblem className="w-3.5 h-3.5 shrink-0" strokeColor={brandColor} />
                      <span>Issued with Tallymark</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="h-16 w-16 rounded-[8px] border border-[#E5E7EB] bg-white p-1 flex items-center justify-center">
                      {qrUrl && (
                        <img
                          src={qrUrl}
                          alt="Receipt verification QR code"
                          width={56}
                          height={56}
                          className="h-14 w-14"
                        />
                      )}
                    </div>
                    <span
                      className="text-[10px] font-semibold tracking-[0.04em]"
                      style={{ color: brandColor }}
                    >
                      Scan QR to verify
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Primary CTA directly after the interactive demo */}
      <div className="flex justify-center">
        <Link
          to={isSignedIn ? '/app/new' : '/login'}
          onClick={() => api.trackAnalyticsEvent('hero_make_yours_clicked', '/')}
          className="landing-btn inline-flex items-center justify-center bg-[#064E3B] hover:bg-[#04392B] text-white text-[16px] font-semibold px-7 py-3.5 min-h-[48px] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#064E3B]"
        >
          Make your first receipt
        </Link>
      </div>
    </div>
  );
}
