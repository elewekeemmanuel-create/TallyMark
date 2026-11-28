import React from 'react';
import { Link } from '../lib/router';
import { SITE_CONFIG } from '../shared/siteConfig';
import { TallymarkWordmark } from '../components/TallymarkLogo';

function LegalShell({
  label,
  title,
  children,
  otherLink,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
  otherLink: { to: string; label: string };
}) {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0B0F0E] text-[#111827] dark:text-[#F3F4F6]">
      <header className="border-b border-gray-100 dark:border-[#1F2925] px-4 sm:px-6 h-16 flex items-center justify-between max-w-4xl mx-auto">
        <Link to="/">
          <TallymarkWordmark size="md" />
        </Link>
        <Link
          to="/app"
          className="inline-flex items-center rounded-[10px] bg-[#064E3B] hover:bg-[#04392B] px-4 py-2 text-xs font-semibold text-white transition-colors"
        >
          Open app →
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-8">
        <div className="space-y-2.5">
          <span className="inline-flex items-center rounded-full bg-[#ECFDF5] dark:bg-[#064E3B]/40 px-3 py-1 text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7]">
            {label}
          </span>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.025em]">{title}</h1>
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            Effective during early access · Contact: {SITE_CONFIG.contactEmail}
          </p>
        </div>

        <div className="rounded-[20px] bg-[#F6F7F8] dark:bg-[#131917] p-5 text-sm text-[#4B5563] dark:text-[#D1D5DB] leading-relaxed">
          <strong className="text-[#111827] dark:text-[#F3F4F6]">Legal review notice:</strong>{' '}
          This document is structured around Nigerian small-business record keeping and the Nigeria Data Protection Act (NDPA 2023), and requires formal review by qualified legal counsel before public commercial launch.
        </div>

        <div className="space-y-6">{children}</div>
      </main>

      <footer className="max-w-3xl mx-auto px-4 sm:px-6 py-8 border-t border-gray-100 dark:border-[#1F2925] text-xs text-[#6B7280] dark:text-[#9CA3AF] flex flex-wrap items-center justify-between gap-4">
        <span>{SITE_CONFIG.creditLine}</span>
        <div className="flex items-center gap-4">
          <a href={`mailto:${SITE_CONFIG.contactEmail}`} className="hover:text-[#111827] dark:hover:text-white">
            {SITE_CONFIG.contactEmail}
          </a>
          <Link to={otherLink.to} className="hover:text-[#111827] dark:hover:text-white">
            {otherLink.label}
          </Link>
        </div>
      </footer>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell
      label="Legal · Privacy Policy (NDPA-Aware)"
      title="Privacy Policy"
      otherLink={{ to: '/terms', label: 'Terms of Use' }}
    >
      <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
        Tallymark is built for Nigerian small-business owners. Your business records remain strictly isolated to your owner account under row-level access controls. We process only the information needed to issue your receipts, maintain your cash book, store your private expense proofs, and serve the public verification pages you choose to share.
      </p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">1. Data Controller &amp; Business Records</h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
          For the customer names, phone numbers, sales, debts, and expense proofs you record inside Tallymark, your business acts as the primary data controller under the Nigeria Data Protection Act (NDPA 2023), and Tallymark processes those records strictly on your instruction. You are responsible for ensuring you have a lawful basis when entering a customer’s phone number or name for receipts and debt reminders.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">2. Public Receipt Verification Links</h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
          When you share a receipt link (<span className="font-mono-num">/r/&#123;id&#125;</span>) or QR code, only the details printed on that specific receipt (business header, receipt number, items, totals, payment method, and Valid/Void status) are shown on that page. Your daily cash book, opening balances, expenses, and other customer balances are never exposed.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">3. Voice Dictation &amp; Speak Your Day</h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
          Microphone dictation uses your browser’s built-in Web Speech API only when you actively tap a mic button. When using Speak Your Day, only the text transcript you review is sent to our server-side parser to draft suggested entries — your business ledger history is never sent, and nothing is saved until you review and confirm.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">4. First-Party Privacy-Safe Analytics</h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
          We record minimal, first-party landing page events (such as page views, interactive receipt previews, and button clicks) storing only the event name, route path, and timestamp. We do not use third-party advertising trackers, and we do not store IP addresses, cookies, or personal identifiers in our analytics log.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">5. Your Rights (Access, Portability &amp; Erasure)</h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
          In line with the NDPA 2023, you may access and export your complete JSON business archive or permanently delete your account and associated records directly inside Settings at any time. For privacy questions or assistance, contact{' '}
          <a href={`mailto:${SITE_CONFIG.contactEmail}`} className="text-[#047857] dark:text-[#6EE7B7] underline">
            {SITE_CONFIG.contactEmail}
          </a>
          .
        </p>
      </section>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell
      label="Legal · Terms of Use"
      title="Terms of Use"
      otherLink={{ to: '/privacy', label: 'Privacy Policy' }}
    >
      <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
        Tallymark provides digital receipt issuance, public receipt verification, and daily cash book software for small businesses. By creating an account or using the app, you agree to these terms.
      </p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">1. Immutable Financial Records &amp; Audit Trail</h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
          Once issued, receipts receive a gap-free sequential number and cannot be silently edited or deleted. Mistakes are corrected transparently by voiding a receipt with a documented reason (which updates the public verification badge to VOID) or by posting a visible correction entry on a closed cash book day.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">2. Tax, VAT &amp; Accounting Responsibility</h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
          Tallymark is a record-keeping tool and does not provide tax, legal, or statutory audit advice. You are responsible for configuring your VAT preference (such as 7.5% inclusive or exclusive), verifying entries generated from Speak Your Day drafts, and filing applicable Nigerian taxes accurately.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">3. Early Access &amp; Availability</h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
          {SITE_CONFIG.faqIsItFreeAnswer} Because Tallymark is in early access, features may improve or change over time. We recommend exporting periodic JSON backups from Settings for your permanent archives.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">4. Acceptable Use &amp; Governing Law</h2>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">
          You may not use Tallymark to issue fraudulent receipts or misrepresent transactions. These terms are governed by the laws of the Federal Republic of Nigeria. Questions may be directed to{' '}
          <a href={`mailto:${SITE_CONFIG.contactEmail}`} className="text-[#047857] dark:text-[#6EE7B7] underline">
            {SITE_CONFIG.contactEmail}
          </a>
          .
        </p>
      </section>
    </LegalShell>
  );
}
