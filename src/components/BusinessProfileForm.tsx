import React, { useState } from 'react';
import { Upload, X } from 'lucide-react';
import {
  SUPPORTED_CURRENCIES,
  formatKoboPlainInput,
  parseAmountToKobo,
  type CurrencyCode,
} from '../shared/money';
import type { ReceiptTemplate, VatMode } from '../shared/schemas';
import type { BusinessProfile } from '../shared/types';

const BRAND_SWATCHES = [
  { label: 'Emerald', hex: '#064E3B' },
  { label: 'Obsidian', hex: '#18181B' },
  { label: 'Indigo', hex: '#1E3A8A' },
  { label: 'Burgundy', hex: '#7F1D1D' },
  { label: 'Bronze', hex: '#78350F' },
];

async function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const maxDim = 320;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png', 0.9));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

interface BusinessProfileFormProps {
  initial?: BusinessProfile | null;
  defaultEmail?: string;
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

export function BusinessProfileForm({
  initial,
  defaultEmail = '',
  submitLabel,
  onSubmit,
}: BusinessProfileFormProps) {
  const [name, setName] = useState(initial?.name || '');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(initial?.logoDataUrl || null);
  const [address, setAddress] = useState(initial?.address || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [email, setEmail] = useState(initial?.email || defaultEmail);
  const [brandColor, setBrandColor] = useState(initial?.brandColor || '#064E3B');
  const [receiptPrefix, setReceiptPrefix] = useState(initial?.receiptPrefix || 'RCT-');
  const [currency, setCurrency] = useState<CurrencyCode>(initial?.currency || 'NGN');
  const [vatEnabled, setVatEnabled] = useState(initial?.vatEnabled ?? false);
  const [vatMode, setVatMode] = useState<VatMode>(initial?.vatMode || 'exclusive');
  const [openingCashInput, setOpeningCashInput] = useState(() =>
    initial?.openingCashKobo ? formatKoboPlainInput(initial.openingCashKobo) : ''
  );
  const [defaultTemplate, setDefaultTemplate] = useState<ReceiptTemplate>(
    initial?.defaultTemplate || 'modern'
  );
  const [closeDayReminderTime, setCloseDayReminderTime] = useState(
    initial?.closeDayReminderTime || '19:00'
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setLogoDataUrl(dataUrl);
    } catch (err: any) {
      setError(err?.message || 'Could not process logo image');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Business name is required.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        logoDataUrl,
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        brandColor,
        receiptPrefix: receiptPrefix.trim() || 'RCT-',
        currency,
        vatEnabled,
        vatMode,
        openingCashKobo: parseAmountToKobo(openingCashInput || '0'),
        defaultTemplate,
        closeDayReminderTime: closeDayReminderTime || '19:00',
      });
    } catch (err: any) {
      setError(err?.message || 'Unable to save business details');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label htmlFor="biz-name" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Business Name *
          </label>
          <input
            id="biz-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kemi Textiles & Lace"
            className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Business Logo (optional)
          </label>
          <div className="flex items-center gap-4">
            {logoDataUrl ? (
              <div className="relative">
                <img
                  src={logoDataUrl}
                  alt="Business logo preview"
                  className="w-16 h-16 rounded-xl object-contain border border-[#DED6C2] dark:border-[#2B352F] bg-white p-1"
                />
                <button
                  type="button"
                  onClick={() => setLogoDataUrl(null)}
                  aria-label="Remove logo"
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#121513] text-white flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[#C9B99A] dark:border-[#36423B] bg-[#FAF8F3] dark:bg-[#111714] px-4 py-2.5 text-xs font-medium cursor-pointer hover:bg-[#F3EFE6] dark:hover:bg-[#1B231F] min-h-[44px]">
                <Upload className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
                <span>Upload PNG or JPG</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="biz-address" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Shop / Office Address
          </label>
          <input
            id="biz-address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Suite 12, Balogun Plaza, Lagos Island"
            className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
          />
        </div>

        <div>
          <label htmlFor="biz-phone" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Business Phone
          </label>
          <input
            id="biz-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0803 000 0000"
            className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm font-mono-num min-h-[44px]"
          />
        </div>

        <div>
          <label htmlFor="biz-email" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Business Email
          </label>
          <input
            id="biz-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="sales@yourbusiness.ng"
            className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
          />
        </div>
      </div>

      <div className="pt-4 border-t border-[#ECE6D8] dark:border-[#26302B] grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="biz-prefix" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Receipt Prefix
          </label>
          <input
            id="biz-prefix"
            type="text"
            value={receiptPrefix}
            onChange={(e) => setReceiptPrefix(e.target.value.toUpperCase())}
            placeholder="RCT-"
            maxLength={12}
            className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 font-mono-num text-sm min-h-[44px]"
          />
        </div>

        <div>
          <label htmlFor="biz-currency" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Currency
          </label>
          <select
            id="biz-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
          >
            {Object.values(SUPPORTED_CURRENCIES).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} ({c.symbol})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="biz-opening" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Opening Cash Balance
          </label>
          <input
            id="biz-opening"
            type="text"
            inputMode="decimal"
            value={openingCashInput}
            onChange={(e) => setOpeningCashInput(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 font-mono-num text-sm min-h-[44px]"
          />
        </div>

        <div className="sm:col-span-3">
          <label htmlFor="biz-reminder" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Close-Day Reminder Time (WAT)
          </label>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              id="biz-reminder"
              type="time"
              value={closeDayReminderTime}
              onChange={(e) => setCloseDayReminderTime(e.target.value)}
              className="w-full sm:w-44 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 font-mono-num text-sm min-h-[44px]"
            />
            <span className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
              Used for your daily close-the-day reminder and unclosed previous-day alert.
            </span>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-[#ECE6D8] dark:border-[#26302B] space-y-4">
        <div>
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-2">
            Receipt Brand Color
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            {BRAND_SWATCHES.map((swatch) => (
              <button
                key={swatch.hex}
                type="button"
                onClick={() => setBrandColor(swatch.hex)}
                aria-label={swatch.label}
                className={`h-10 px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-2 ${
                  brandColor.toLowerCase() === swatch.hex.toLowerCase()
                    ? 'border-[#121513] dark:border-white bg-[#F3EFE6] dark:bg-[#1F2923]'
                    : 'border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714]'
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: swatch.hex }} />
                <span>{swatch.label}</span>
              </button>
            ))}
            <input
              type="color"
              aria-label="Custom brand color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="h-10 w-12 rounded-lg border border-[#DED6C2] dark:border-[#2B352F] bg-white p-1 cursor-pointer"
            />
          </div>
        </div>

        <div>
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-2">
            Default Receipt Template
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['modern', 'classic', 'compact'] as ReceiptTemplate[]).map((tpl) => (
              <button
                key={tpl}
                type="button"
                onClick={() => setDefaultTemplate(tpl)}
                className={`min-h-[44px] rounded-xl border px-3 text-xs font-semibold capitalize transition-colors ${
                  defaultTemplate === tpl
                    ? 'border-[#064E3B] bg-[#064E3B] text-white'
                    : 'border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] text-[#121513] dark:text-[#F4F1EA]'
                }`}
              >
                {tpl === 'compact' ? 'Compact 80mm' : tpl}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[#E5DEC9] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#111714] p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Apply Nigerian VAT (7.5%)</p>
              <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                Off by default. Turn on if your business charges 7.5% VAT on receipts.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={vatEnabled}
              onClick={() => setVatEnabled((v) => !v)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                vatEnabled ? 'bg-[#064E3B]' : 'bg-[#D6CFC0] dark:bg-[#2F3B34]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  vatEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {vatEnabled && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E5DEC9] dark:border-[#26302B]">
              {(['exclusive', 'inclusive'] as VatMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setVatMode(m)}
                  className={`min-h-[40px] rounded-lg border text-xs font-medium capitalize ${
                    vatMode === m
                      ? 'border-[#064E3B] bg-[#064E3B] text-white'
                      : 'border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18]'
                  }`}
                >
                  {m === 'exclusive' ? 'Exclusive (+7.5% added)' : 'Inclusive (7.5% inside price)'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-[#B91C1C] dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full sm:w-auto min-h-[48px] rounded-xl bg-[#064E3B] px-6 py-3 text-sm font-semibold text-white hover:bg-[#04392B] transition-colors disabled:opacity-60"
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
