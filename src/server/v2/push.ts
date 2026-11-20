import * as webpushMod from 'web-push';
import { db, logError } from '../db.ts';

const webpush = ((webpushMod as unknown as { default?: typeof webpushMod }).default ??
  webpushMod) as typeof webpushMod;

export interface NonPiiPushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface StoredPushSub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
}

export type PushSenderFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payloadJson: string
) => Promise<void>;

let customPushSender: PushSenderFn | null = null;

/**
 * Allows automated tests to inject a deterministic push transport without network calls.
 */
export function setPushSenderForTests(sender: PushSenderFn | null) {
  customPushSender = sender;
}

export function getVapidConfig(): {
  configured: boolean;
  publicKey: string | null;
  privateKey: string | null;
  subject: string;
} {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim() || null;
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim() || null;
  const subject = (process.env.VAPID_SUBJECT || 'mailto:support@tallymark.app').trim();
  return {
    configured: Boolean(publicKey && privateKey),
    publicKey,
    privateKey,
    subject,
  };
}

/**
 * Validates that a Web Push endpoint is a public HTTPS URL (blocks SSRF against loopback/private nets).
 */
export function isSafePushEndpoint(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds strictly non-PII notification payload for a new payment claim or quote response.
 * Never includes customer names, phone numbers, emails, or amounts.
 */
export function buildNonPiiClaimPushPayload(invoiceNumber: string): NonPiiPushPayload {
  const safeDocNum = (invoiceNumber || 'Invoice').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'Invoice';
  return {
    title: 'Tallymark',
    body: `New payment report on ${safeDocNum}`,
    url: '/app/claims',
    tag: `claim-${safeDocNum}`,
  };
}

export function buildNonPiiQuotePushPayload(quoteNumber: string): NonPiiPushPayload {
  const safeDocNum = (quoteNumber || 'Quote').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'Quote';
  return {
    title: 'Tallymark',
    body: `Quote response on ${safeDocNum}`,
    url: '/app/documents',
    tag: `quote-${safeDocNum}`,
  };
}

/**
 * Dispatches an opt-in Web Push notification to all active subscriptions for a business.
 * Automatically removes dead subscriptions that respond with 404 or 410.
 */
export async function sendBusinessWebPush(
  businessId: string,
  payload: NonPiiPushPayload
): Promise<{ sent: number; removed: number; failed: number }> {
  const vapid = getVapidConfig();
  if (!customPushSender && (!vapid.configured || !vapid.publicKey || !vapid.privateKey)) {
    return { sent: 0, removed: 0, failed: 0 };
  }

  const subs = db
    .prepare('SELECT id, endpoint, p256dh, auth_secret FROM push_subscriptions WHERE business_id = ?')
    .all(businessId) as unknown as StoredPushSub[];

  if (subs.length === 0) {
    return { sent: 0, removed: 0, failed: 0 };
  }

  if (!customPushSender && vapid.publicKey && vapid.privateKey) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  const payloadJson = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const sub of subs) {
    if (!isSafePushEndpoint(sub.endpoint)) {
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      removed += 1;
      continue;
    }

    const pushSub = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth_secret,
      },
    };

    try {
      if (customPushSender) {
        await customPushSender(pushSub, payloadJson);
      } else {
        await webpush.sendNotification(pushSub, payloadJson, { TTL: 86400 });
      }
      db.prepare('UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        sub.id
      );
      sent += 1;
    } catch (err: any) {
      const statusCode = Number(err?.statusCode ?? err?.status ?? 0);
      if (statusCode === 404 || statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        removed += 1;
      } else {
        failed += 1;
        logError('v2_web_push_send', err, { businessId, statusCode });
      }
    }
  }

  return { sent, removed, failed };
}
