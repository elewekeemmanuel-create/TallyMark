import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function AuthProofImage({
  proofUrl,
  alt = 'Expense proof',
  className = 'w-14 h-14 rounded-[10px] object-cover border border-gray-200 dark:border-[#232D29]',
  onClick,
}: {
  proofUrl: string;
  alt?: string;
  className?: string;
  onClick?: (resolvedSrc: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrlToRevoke: string | null = null;
    setFailed(false);

    api
      .fetchAuthenticatedProofBlobUrl(proofUrl)
      .then((resolved) => {
        if (cancelled) {
          if (resolved.startsWith('blob:')) URL.revokeObjectURL(resolved);
          return;
        }
        if (resolved.startsWith('blob:')) {
          objectUrlToRevoke = resolved;
        }
        setSrc(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
    };
  }, [proofUrl]);

  if (failed) {
    return (
      <div className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#232D29] text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
        Proof unavailable
      </div>
    );
  }

  if (!src) {
    return <div className={`${className} animate-pulse bg-[#F4F6F8] dark:bg-[#1A221F]`} />;
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(src)}
      className="focus:outline-none group relative shrink-0"
      title="View proof photo"
    >
      <img src={src} alt={alt} className={className} />
    </button>
  );
}
