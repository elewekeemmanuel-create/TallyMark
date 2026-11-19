import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatKobo } from '../../shared/money';
import { usePrefersReducedMotion } from './DesktopPolish';

type PeriodKey = 'today' | 'week' | 'month';

interface ChartBar {
  label: string;
  moneyInKobo: number;
  moneyOutKobo: number;
}

const SAMPLE_PERIODS: Record<
  PeriodKey,
  {
    title: string;
    moneyInKobo: number;
    moneyOutKobo: number;
    cashInHandKobo: number;
    outstandingOwedKobo: number;
    bars: ChartBar[];
  }
> = {
  today: {
    title: 'Today · Sample Counter Day',
    moneyInKobo: 14850000,
    moneyOutKobo: 3200000,
    cashInHandKobo: 5850000,
    outstandingOwedKobo: 2400000,
    bars: [
      { label: '9am', moneyInKobo: 1850000, moneyOutKobo: 400000 },
      { label: '11am', moneyInKobo: 3400000, moneyOutKobo: 1200000 },
      { label: '1pm', moneyInKobo: 2700000, moneyOutKobo: 350000 },
      { label: '3pm', moneyInKobo: 4100000, moneyOutKobo: 800000 },
      { label: '5pm', moneyInKobo: 2800000, moneyOutKobo: 450000 },
    ],
  },
  week: {
    title: 'This Week · Mon – Sat Sample',
    moneyInKobo: 84200000,
    moneyOutKobo: 29400000,
    cashInHandKobo: 14600000,
    outstandingOwedKobo: 6850000,
    bars: [
      { label: 'Mon', moneyInKobo: 11200000, moneyOutKobo: 4200000 },
      { label: 'Tue', moneyInKobo: 14800000, moneyOutKobo: 5100000 },
      { label: 'Wed', moneyInKobo: 9600000, moneyOutKobo: 3800000 },
      { label: 'Thu', moneyInKobo: 15400000, moneyOutKobo: 6200000 },
      { label: 'Fri', moneyInKobo: 18900000, moneyOutKobo: 5400000 },
      { label: 'Sat', moneyInKobo: 14300000, moneyOutKobo: 4700000 },
    ],
  },
  month: {
    title: 'This Month · 4-Week Sample',
    moneyInKobo: 329000000,
    moneyOutKobo: 141500000,
    cashInHandKobo: 28400000,
    outstandingOwedKobo: 11500000,
    bars: [
      { label: 'Wk 1', moneyInKobo: 74000000, moneyOutKobo: 31000000 },
      { label: 'Wk 2', moneyInKobo: 86500000, moneyOutKobo: 38500000 },
      { label: 'Wk 3', moneyInKobo: 79000000, moneyOutKobo: 34000000 },
      { label: 'Wk 4', moneyInKobo: 89500000, moneyOutKobo: 38000000 },
    ],
  },
};

function useCountUpNumber(target: number, reducedMotion: boolean) {
  const [val, setVal] = useState(target);

  useEffect(() => {
    if (reducedMotion) {
      setVal(target);
      return;
    }
    const startVal = val;
    const diff = target - startVal;
    if (diff === 0) return;

    const startTime = performance.now();
    const duration = 360;
    let raf = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(startVal + diff * eased));
      if (progress < 1) {
        raf = window.requestAnimationFrame(step);
      }
    };

    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
    // Intentionally animate from current rendered value toward target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reducedMotion]);

  return val;
}

export function InteractiveSummaryPreview() {
  const reducedMotion = usePrefersReducedMotion();
  const [period, setPeriod] = useState<PeriodKey>('week');
  const [hoveredIdx, setHoveredIdx] = useState<number>(0);

  const data = SAMPLE_PERIODS[period];
  const netKobo = data.moneyInKobo - data.moneyOutKobo;
  const maxBarKobo = Math.max(...data.bars.map((b) => Math.max(b.moneyInKobo, b.moneyOutKobo)), 1);

  const animIn = useCountUpNumber(data.moneyInKobo, reducedMotion);
  const animOut = useCountUpNumber(data.moneyOutKobo, reducedMotion);
  const animNet = useCountUpNumber(netKobo, reducedMotion);
  const animCash = useCountUpNumber(data.cashInHandKobo, reducedMotion);

  const activeBar = data.bars[hoveredIdx] || data.bars[0];

  return (
    <div className="rounded-2xl border border-[#DED6C2] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-5 sm:p-7 space-y-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#ECE6D8] dark:border-[#242D28]">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="label-caps text-[#064E3B] dark:text-[#10B981]">
              Reports &amp; Daily Summary
            </span>
            <span className="border border-[#DED6C2] dark:border-[#2E3832] bg-[#FAF8F3] dark:bg-[#111714] px-2 py-0.5 rounded-sm font-mono-num text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5C635D] dark:text-[#9BA39D]">
              Sample data
            </span>
          </div>
          <h3 className="font-display text-2xl sm:text-3xl text-[#121513] dark:text-[#F4F1EA]">
            Know your day without guessing
          </h3>
        </div>

        <div
          className="inline-flex items-center gap-1 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] p-1 self-start"
          role="group"
          aria-label="Summary time period"
        >
          {(['today', 'week', 'month'] as PeriodKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setPeriod(key);
                setHoveredIdx(0);
                api.trackAnalyticsEvent('summary_period_changed', '/');
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors min-h-[36px] ${
                period === key
                  ? 'bg-[#064E3B] text-white'
                  : 'text-[#5C635D] dark:text-[#9BA39D] hover:text-[#121513] dark:hover:text-[#F4F1EA]'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {/* Count-up KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-3.5">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Money in</p>
          <p className="mt-1.5 font-mono-num text-lg sm:text-xl font-semibold text-[#121513] dark:text-[#F4F1EA]">
            {formatKobo(animIn, 'NGN')}
          </p>
        </div>
        <div className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-3.5">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Money out</p>
          <p className="mt-1.5 font-mono-num text-lg sm:text-xl font-semibold text-[#121513] dark:text-[#F4F1EA]">
            {formatKobo(animOut, 'NGN')}
          </p>
        </div>
        <div className="rounded-xl border border-[#064E3B]/25 dark:border-[#10B981]/30 bg-[#ECFDF5]/60 dark:bg-[#064E3B]/20 p-3.5">
          <p className="label-caps text-[#064E3B] dark:text-[#10B981]">
            Net (money in minus money out)
          </p>
          <p className="mt-1.5 font-mono-num text-lg sm:text-xl font-semibold text-[#064E3B] dark:text-[#10B981]">
            +{formatKobo(animNet, 'NGN')}
          </p>
        </div>
        <div className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-3.5">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Cash in hand</p>
          <p className="mt-1.5 font-mono-num text-lg sm:text-xl font-semibold text-[#121513] dark:text-[#F4F1EA]">
            {formatKobo(animCash, 'NGN')}
          </p>
        </div>
      </div>

      {/* Interactive Bar Chart + Active Tooltip Bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] px-3.5 py-2.5 text-xs">
          <span className="font-semibold text-[#121513] dark:text-[#F4F1EA]">
            {activeBar.label} · {data.title}
          </span>
          <div className="flex flex-wrap items-center gap-4 font-mono-num">
            <span className="text-[#064E3B] dark:text-[#10B981]">
              In: {formatKobo(activeBar.moneyInKobo, 'NGN')}
            </span>
            <span className="text-[#B45309] dark:text-amber-400">
              Out: {formatKobo(activeBar.moneyOutKobo, 'NGN')}
            </span>
            <span className="font-semibold text-[#121513] dark:text-[#F4F1EA]">
              Net: {formatKobo(activeBar.moneyInKobo - activeBar.moneyOutKobo, 'NGN')}
            </span>
          </div>
        </div>

        <div
          className="grid gap-2 sm:gap-3 pt-4 pb-1 px-2 items-end h-48 border-b border-[#DED6C2] dark:border-[#2A352F]"
          style={{ gridTemplateColumns: `repeat(${data.bars.length}, minmax(0, 1fr))` }}
        >
          {data.bars.map((bar, idx) => {
            const inPct = Math.max(10, Math.round((bar.moneyInKobo / maxBarKobo) * 100));
            const outPct = Math.max(6, Math.round((bar.moneyOutKobo / maxBarKobo) * 100));
            const isSelected = hoveredIdx === idx;
            return (
              <button
                key={bar.label}
                type="button"
                onMouseEnter={() => setHoveredIdx(idx)}
                onFocus={() => setHoveredIdx(idx)}
                onClick={() => setHoveredIdx(idx)}
                aria-label={`${bar.label}: Money in ${formatKobo(bar.moneyInKobo, 'NGN')}, Money out ${formatKobo(bar.moneyOutKobo, 'NGN')}`}
                className={`group flex flex-col items-center justify-end h-full rounded-t-lg px-1 pt-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#064E3B] ${
                  isSelected ? 'bg-[#F3EFE6] dark:bg-[#1B241F]' : 'hover:bg-[#F3EFE6]/60 dark:hover:bg-[#1B241F]/50'
                }`}
              >
                <div className="w-full max-w-[44px] flex items-end justify-center gap-1 h-32">
                  <div
                    className={`w-1/2 rounded-t-sm transition-all duration-300 ${
                      isSelected ? 'bg-[#064E3B] dark:bg-[#10B981]' : 'bg-[#064E3B]/75 dark:bg-[#10B981]/70'
                    }`}
                    style={{ height: `${inPct}%` }}
                  />
                  <div
                    className={`w-1/2 rounded-t-sm transition-all duration-300 ${
                      isSelected ? 'bg-[#B89B6A]' : 'bg-[#B89B6A]/65'
                    }`}
                    style={{ height: `${outPct}%` }}
                  />
                </div>
                <span className="mt-2 font-mono-num text-[11px] font-medium text-[#5C635D] dark:text-[#9BA39D]">
                  {bar.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#064E3B] dark:bg-[#10B981]" />
              Money in
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#B89B6A]" />
              Money out
            </span>
          </div>
          <span className="font-mono-num">
            Sample data · Customer debtors shown: {formatKobo(data.outstandingOwedKobo, 'NGN')}
          </span>
        </div>
      </div>
    </div>
  );
}
