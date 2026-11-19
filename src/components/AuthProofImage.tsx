import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function AuthProofImage({
  proofUrl,
  alt = 'Expense proof',
  className = 'w-14 h-14 rounded-xl object-cover border border-[#DED6C2] dark:border-[#2B352F]',
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
      <div className="px-2.5 py-1.5 rounded-lg border border-[#DED6C2] dark:border-[#2B352F] text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
        Proof unavailable
      </div>
    );
  }

  if (!src) {
    return <div className={`${className} animate-pulse bg-[#F3EFE6] dark:bg-[#1B231F]`} />;
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
