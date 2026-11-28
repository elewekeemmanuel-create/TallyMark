import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Printer, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { downloadReceiptPdf } from '../lib/pdf';
import { Link } from '../lib/router';
import { sanitizeRasterImageDataUrl, type ReceiptTemplate } from '../shared/schemas';
import type { PublicReceiptRecord } from '../shared/types';
import { ReceiptTemplateView } from '../components/ReceiptTemplates';
import { TallymarkWordmark } from '../components/TallymarkLogo';

export function PublicReceiptPage({ publicId }: { publicId: string }) {
  const [receipt, setReceipt] = useState<PublicReceiptRecord | null>(null);
  const [template, setTemplate] = useState<ReceiptTemplate>('modern');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getPublicReceipt(publicId)
      .then((res) => {
        setReceipt(res.receipt);
        setTemplate(res.receipt.template || 'modern');
      })
      .catch((err: any) => {
        setError(err?.message || 'Receipt not found');
      })
      .finally(() => setLoading(false));
  }, [publicId]);

  const handleDownloadPdf = async () => {
    if (!receipt) return;
    setPdfBusy(true);
    try {
      await downloadReceiptPdf(receipt, template);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7F8] text-[#111827] flex flex-col">
      <header className="no-print border-b border-gray-200/70 bg-white/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="shrink-0">
            <TallymarkWordmark size="sm" />
          </Link>

          {receipt && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={pdfBusy}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[40px] disabled:opacity-60 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-[#6EE7B7]" />
                <span>{pdfBusy ? 'PDF…' : 'Download PDF'}</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#F4F6F8] hover:bg-gray-200/70 px-4 py-2 text-xs font-semibold text-[#111827] min-h-[40px] transition-colors"
              >
                <Printer className="w-3.5 h-3.5 text-[#4B5563]" />
                <span>Print</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-5">
        {loading ? (
          <div className="h-96 rounded-[24px] bg-white animate-pulse" />
        ) : error || !receipt ? (
          <div className="rounded-[24px] bg-white p-10 text-center space-y-3 shadow-xs">
            <AlertCircle className="w-9 h-9 text-[#B91C1C] mx-auto" />
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Receipt unavailable</h1>
            <p className="text-sm text-[#6B7280]">
              This receipt link does not exist or may have been removed.
            </p>
            <Link
              to="/"
              className="inline-block mt-2 text-sm font-semibold text-[#047857] hover:underline"
            >
              Visit Tallymark →
            </Link>
          </div>
        ) : (
          <>
            {/* Valid / Void Verification Banner */}
            <div
              className={`no-print rounded-[24px] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                receipt.status === 'VOID' ? 'bg-[#FEF2F2]' : 'bg-white'
              }`}
            >
              <div className="flex items-center gap-3">
                {receipt.status === 'VOID' ? (
                  <>
                    <span className="w-10 h-10 rounded-[12px] bg-white text-[#B91C1C] flex items-center justify-center shrink-0">
                      <ShieldAlert className="w-5 h-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#B91C1C]">Voided Receipt</p>
                      <p className="text-xs text-[#6B7280]">
                        This receipt was marked VOID by {receipt.businessName}.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="w-10 h-10 rounded-[12px] bg-[#ECFDF5] text-[#064E3B] flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-5 h-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#064E3B]">
                        Verified Tallymark Receipt ·{' '}
                        {receipt.status === 'PART_PAID' ? 'Part Paid' : 'Paid in Full'}
                      </p>
                      <p className="text-xs text-[#6B7280]">
                        Issued by {receipt.businessName} · No.{' '}
                        <span className="font-mono-num">{receipt.receiptNumber}</span>
                        {sanitizeRasterImageDataUrl(receipt.businessSignatureDataUrl)
                          ? ' · Authorized signature attached'
                          : ''}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F4F6F8] p-1 self-start sm:self-auto">
                {(['modern', 'classic', 'compact'] as ReceiptTemplate[]).map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setTemplate(tpl)}
                    className={`rounded-[8px] px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      template === tpl
                        ? 'bg-[#064E3B] text-white'
                        : 'text-[#4B5563] hover:text-[#111827]'
                    }`}
                  >
                    {tpl === 'compact' ? '80mm' : tpl}
                  </button>
                ))}
              </div>
            </div>

            <ReceiptTemplateView receipt={receipt} templateOverride={template} />
          </>
        )}
      </main>

      <footer className="no-print border-t border-gray-200/60 bg-white py-6 text-center text-xs text-[#6B7280]">
        Built by Emmanuel Eleweke | Emmanuel of ZedTech
      </footer>
    </div>
  );
}
