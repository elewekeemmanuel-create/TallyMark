import crypto from 'node:crypto';
import { db } from '../db.ts';
import { ANALYTICS_EVENT_NAMES } from '../../shared/schemas.ts';

export type AnonymousEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

const ALLOWED_EVENTS = new Set<string>(ANALYTICS_EVENT_NAMES);
const SAFE_PATH_RE = /^\/[A-Za-z0-9/_-]{0,119}$/;

/**
 * Records a strictly anonymous first-party product event.
 * Never accepts or stores customer names, emails, phones, amounts, document IDs,
 * business IDs, user IDs, or IP addresses.
 */
export function recordAnonymousAnalytics(eventName: AnonymousEventName, routePath: string): void {
  if (!ALLOWED_EVENTS.has(eventName)) return;
  const cleanPath = SAFE_PATH_RE.test(routePath) ? routePath : '/';
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    db.prepare(
      'INSERT INTO analytics_events (id, event_name, path, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, eventName, cleanPath, createdAt);
  } catch {
    // Analytics must never block or fail money/document flows
  }
}
