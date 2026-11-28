import React from 'react';
import type { ReceiptStatus } from '../shared/schemas';

export function TallymarkEmblem({
  className = 'w-6 h-6',
  strokeColor = '#064E3B',
  slashColor = '#10B981',
}: {
  className?: string;
  strokeColor?: string;
  slashColor?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g stroke={strokeColor} strokeWidth="2.4" strokeLinecap="round">
        <line x1="7" y1="6" x2="7" y2="26" />
        <line x1="13" y1="6" x2="13" y2="26" />
        <line x1="19" y1="6" x2="19" y2="26" />
        <line x1="25" y1="6" x2="25" y2="26" />
        <line x1="4" y1="22.5" x2="28" y2="9.5" stroke={slashColor} strokeWidth="2.5" />
      </g>
    </svg>
  );
}

export function TallymarkWordmark({
  size = 'md',
  inverted = false,
}: {
  size?: 'sm' | 'md' | 'lg';
  inverted?: boolean;
}) {
  const iconCls = size === 'lg' ? 'w-7 h-7' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const textCls =
    size === 'lg'
      ? 'text-[24px] leading-none'
      : size === 'sm'
      ? 'text-[17px] leading-none'
      : 'text-[20px] leading-none';

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 select-none">
      <TallymarkEmblem
        className={iconCls}
        strokeColor={inverted ? '#FFFFFF' : '#064E3B'}
        slashColor={inverted ? '#6EE7B7' : '#059669'}
      />
      <span
        className={`font-semibold tracking-[-0.025em] ${textCls} ${
          inverted ? 'text-white' : 'text-[#111827] dark:text-[#F3F4F6]'
        }`}
      >
        Tallymark
      </span>
    </span>
  );
}

export function RubberStamp({
  status,
  compact = false,
}: {
  status: ReceiptStatus;
  compact?: boolean;
}) {
  const config =
    status === 'VOID'
      ? {
          label: 'VOID',
          colorClass: 'text-[#B91C1C] border-[#B91C1C]/80 bg-[#FEF2F2]/60',
          stroke: '#B91C1C',
        }
      : status === 'PART_PAID'
      ? {
          label: 'PART PAID',
          colorClass: 'text-[#B45309] border-[#B45309]/80 bg-[#FFFBEB]/60',
          stroke: '#B45309',
        }
      : {
          label: 'PAID',
          colorClass: 'text-[#064E3B] border-[#064E3B]/80 bg-[#ECFDF5]/50',
          stroke: '#064E3B',
        };

  return (
    <div
      className={`rubber-stamp inline-flex items-center gap-1.5 rounded-sm font-mono-num font-semibold uppercase select-none ${
        compact ? 'px-2.5 py-0.5 text-[10px]' : 'px-3.5 py-1 text-xs'
      } ${config.colorClass}`}
      aria-label={`Receipt status: ${config.label}`}
    >
      <TallymarkEmblem
        className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}
        strokeColor={config.stroke}
        slashColor={config.stroke}
      />
      <span>{config.label}</span>
    </div>
  );
}
