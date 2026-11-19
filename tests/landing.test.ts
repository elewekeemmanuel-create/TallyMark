import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createApiRouter } from '../src/server/routes.ts';
import { db } from '../src/server/db.ts';
import { ANALYTICS_EVENT_NAMES, AnalyticsEventSchema } from '../src/shared/schemas.ts';
import { SITE_CONFIG } from '../src/shared/siteConfig.ts';

test('AnalyticsEventSchema accepts valid non-PII events and rejects malformed or PII-bearing paths', () => {
  for (const eventName of ANALYTICS_EVENT_NAMES) {
    const parsed = AnalyticsEventSchema.safeParse({
      eventName,
      path: '/',
      timestamp: '2026-11-18T12:00:00.000Z',
    });
    assert.equal(parsed.success, true, `Expected ${eventName} to pass`);
  }

  // Reject unlisted event names
  const badEvent = AnalyticsEventSchema.safeParse({
    eventName: 'arbitrary_custom_event',
    path: '/',
  });
  assert.equal(badEvent.success, false);

  // Reject paths with query strings or emails that could carry PII
  const queryPath = AnalyticsEventSchema.safeParse({
    eventName: 'landing_view',
    path: '/?email=test@example.com',
  });
  assert.equal(queryPath.success, false);

  const nonSlashPath = AnalyticsEventSchema.safeParse({
    eventName: 'landing_view',
    path: 'https://evil.example/',
  });
  assert.equal(nonSlashPath.success, false);
});

test('SITE_CONFIG includes required default early access copy and credit line', () => {
  assert.match(SITE_CONFIG.faqIsItFreeAnswer, /Free during early access/i);
  assert.equal(SITE_CONFIG.earlyAccessTag, 'Early access');
  assert.equal(SITE_CONFIG.trustTag, 'Your data stays yours');
  assert.equal(SITE_CONFIG.creditLine, 'Built by Emmanuel Eleweke | Emmanuel of ZedTech');
  assert.match(SITE_CONFIG.contactEmail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
});

test('POST /api/analytics enforces validation and rate limits without storing PII', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/api/analytics`;
  const testStamp = '2099-01-01T00:00:00.000Z';

  try {
    const invalid = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName: 'unknown_event', path: '/' }),
    });
    assert.equal(invalid.status, 400);

    let hit429 = false;
    for (let i = 0; i < 32; i++) {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName: 'landing_view', path: '/', timestamp: testStamp }),
      });
      if (res.status === 429) {
        hit429 = true;
        break;
      }
      assert.equal(res.status, 202);
    }
    assert.equal(hit429, true, 'Expected rate limiter to return HTTP 429 after 30 requests/min');
  } finally {
    db.prepare('DELETE FROM analytics_events WHERE created_at = ?').run(testStamp);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
