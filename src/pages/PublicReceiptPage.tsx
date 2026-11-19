import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Printer, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { downloadReceiptPdf } from '../lib/pdf';
import { Link } from '../lib/router';
import type { ReceiptTemplate } from '../shared/schemas';
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
    <div className="min-h-screen bg-[#FAF8F3] text-[#121513] flex flex-col">
      <header className="no-print border-b border-[#E5DEC9] bg-[#FAF8F3]/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <Link to="/" className="shrink-0">
            <TallymarkWordmark size="sm" />
          </Link>

          {receipt && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={pdfBusy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[40px] disabled:opacity-60"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{pdfBusy ? 'PDF…' : 'Download PDF'}</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] bg-white px-3.5 py-2 text-xs font-medium hover:bg-[#F3EFE6] min-h-[40px]"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-5">
        {loading ? (
          <div className="h-96 rounded-2xl bg-[#F3EFE6] animate-pulse" />
        ) : error || !receipt ? (
          <div className="rounded-2xl border border-[#E5DEC9] bg-white p-8 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-[#B91C1C] mx-auto" />
            <h1 className="font-display text-3xl">Receipt unavailable</h1>
            <p className="text-sm text-[#5C635D]">
              This receipt link does not exist or may have been removed.
            </p>
            <Link
              to="/"
              className="inline-block mt-2 text-xs font-semibold text-[#064E3B] hover:underline"
            >
              Visit Tallymark →
            </Link>
          </div>
        ) : (
          <>
            {/* Valid / Void Verification Banner */}
            <div className="no-print rounded-2xl border border-[#E5DEC9] bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {receipt.status === 'VOID' ? (
                  <>
                    <ShieldAlert className="w-5 h-5 text-[#B91C1C] shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-[#B91C1C]">
                        Voided Receipt
                      </p>
                      <p className="text-xs text-[#5C635D]">
                        This receipt was marked VOID by {receipt.businessName}.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-[#064E3B] shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-[#064E3B]">
                        Valid Tallymark Receipt ·{' '}
                        {receipt.status === 'PART_PAID' ? 'Part Paid' : 'Paid in Full'}
                      </p>
                      <p className="text-xs text-[#5C635D]">
                        Issued by {receipt.businessName} · No. {receipt.receiptNumber}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="inline-flex items-center gap-1 rounded-xl bg-[#F3EFE6] p-1 self-start sm:self-auto">
                {(['modern', 'classic', 'compact'] as ReceiptTemplate[]).map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setTemplate(tpl)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize ${
                      template === tpl ? 'bg-white text-[#121513] shadow-xs' : 'text-[#5C635D]'
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

      <footer className="no-print border-t border-[#E5DEC9] py-6 text-center text-xs text-[#5C635D]">
        Built by Emmanuel Eleweke | Emmanuel of ZedTech
      </footer>
    </div>
  );
}
