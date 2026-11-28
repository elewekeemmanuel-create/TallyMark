import React, { useEffect, useState } from 'react';
import { Delete, X } from 'lucide-react';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '../shared/money';

interface NumericKeypadProps {
  open: boolean;
  title: string;
  initialValue: string;
  mode: 'currency' | 'quantity';
  currency?: CurrencyCode;
  maxValue?: number;
  onApply: (value: string) => void;
  onClose: () => void;
}

export function NumericKeypad({
  open,
  title,
  initialValue,
  mode,
  currency = 'NGN',
  onApply,
  onClose,
}: NumericKeypadProps) {
  const [raw, setRaw] = useState(initialValue === '0' ? '' : initialValue);

  useEffect(() => {
    if (open) {
      setRaw(initialValue === '0' ? '' : initialValue);
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [open, initialValue, onClose]);

  if (!open) return null;

  const symbol = SUPPORTED_CURRENCIES[currency]?.symbol ?? '₦';

  const append = (token: string) => {
    setRaw((prev) => {
      if (token === '.') {
        if (prev.includes('.')) return prev;
        return prev === '' ? '0.' : `${prev}.`;
      }
      if (token === '00') {
        if (prev === '' || prev === '0') return '0';
        const dotIdx = prev.indexOf('.');
        if (dotIdx !== -1) {
          const decLen = prev.length - dotIdx - 1;
          if (decLen >= 2) return prev;
          if (decLen === 1) return `${prev}0`;
        }
        return `${prev}00`.slice(0, 12);
      }
      if (prev === '0') return token;
      const dotIdx = prev.indexOf('.');
      if (dotIdx !== -1) {
        const maxDec = mode === 'currency' ? 2 : 3;
        if (prev.length - dotIdx - 1 >= maxDec) return prev;
      }
      return `${prev}${token}`.slice(0, 12);
    });
  };

  const addQuick = (delta: number) => {
    const current = Number.parseFloat(raw || '0') || 0;
    const next = current + delta;
    setRaw(Number.isInteger(next) ? String(next) : next.toFixed(2));
  };

  const backspace = () => {
    setRaw((prev) => prev.slice(0, -1));
  };

  const formattedPreview = (() => {
    if (!raw) return mode === 'currency' ? `${symbol}0` : '0';
    if (mode === 'quantity') return raw;
    const [whole, frac] = raw.split('.');
    const formattedWhole = Number(whole || '0').toLocaleString('en-NG');
    return frac !== undefined ? `${symbol}${formattedWhole}.${frac}` : `${symbol}${formattedWhole}`;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-t-[28px] md:rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 pb-safe shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 dark:bg-[#232D29] md:hidden" />
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-gray-100 dark:border-[#1F2925]">
          <div>
            <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">{title}</p>
            <p className="mt-1 font-mono-num text-3xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
              {formattedPreview}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keypad"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29] text-[#6B7280] dark:text-[#9CA3AF] hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {mode === 'currency' && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[500, 1000, 5000].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => addQuick(amt)}
                className="min-h-[40px] rounded-[10px] border border-emerald-200/70 dark:border-[#1F2925] bg-[#ECFDF5] dark:bg-[#064E3B]/30 font-mono-num text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] hover:bg-[#D1FAE5] dark:hover:bg-[#064E3B]/50 transition-colors"
              >
                +{symbol}
                {amt.toLocaleString('en-NG')}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', mode === 'currency' ? '00' : '←'].map(
            (key) => {
              if (key === '←') {
                return (
                  <button
                    key="bs-alt"
                    type="button"
                    onClick={backspace}
                    aria-label="Backspace"
                    className="min-h-[54px] rounded-[12px] border border-gray-200/80 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#1A221F] inline-flex items-center justify-center text-[#111827] dark:text-[#F3F4F6] active:scale-[0.98]"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                );
              }
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => append(key)}
                  className="min-h-[54px] rounded-[12px] border border-gray-200/80 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#0B0F0E] font-mono-num text-xl font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-gray-100 dark:hover:bg-[#1A221F] active:scale-[0.98] transition-colors"
                >
                  {key}
                </button>
              );
            }
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={() => setRaw('')}
            className="min-h-[48px] rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#0B0F0E] text-sm font-medium text-[#6B7280] dark:text-[#9CA3AF] hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={backspace}
            aria-label="Backspace"
            className="min-h-[48px] rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#1A221F] inline-flex items-center justify-center text-[#111827] dark:text-[#F3F4F6] hover:bg-gray-200/70 dark:hover:bg-[#232D29] transition-colors"
          >
            <Delete className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(raw || '0');
              onClose();
            }}
            className="min-h-[48px] rounded-[10px] bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#04392B] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
