import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { db, logError } from './src/server/db.ts';
import { createApiRouter, mapPublicReceiptRow } from './src/server/routes.ts';
import { runProofRetentionJob } from './src/server/v2/retention.ts';
import { formatKobo } from './src/shared/money.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function injectPublicReceiptOgMeta(html: string, publicId: string): string {
  const row = db.prepare('SELECT * FROM public_receipts WHERE public_id = ?').get(publicId);
  if (!row) {
    return html;
  }
  const receipt = mapPublicReceiptRow(row);
  const statusLabel =
    receipt.status === 'VOID' ? 'VOID' : receipt.status === 'PART_PAID' ? 'Part Paid' : 'Paid';
  const amount = formatKobo(receipt.totalKobo, receipt.currency);
  const title = `${receipt.receiptNumber} · ${receipt.businessName} — ${amount} (${statusLabel})`;
  const desc = receipt.customerName
    ? `Official Tallymark receipt for ${receipt.customerName} from ${receipt.businessName}. Total: ${amount}. Status: ${statusLabel}.`
    : `Official Tallymark receipt from ${receipt.businessName}. Total: ${amount}. Status: ${statusLabel}.`;

  return html
    .replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${escapeHtml(desc)}" />`
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:title" content="${escapeHtml(title)}" />`
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:description" content="${escapeHtml(desc)}" />`
    );
}

function injectPublicInvoiceOgMeta(html: string, publicId: string): string {
  const row: any = db
    .prepare(
      `SELECT status, balance_due_kobo, snapshot_json
       FROM invoices
       WHERE public_id = ? AND status != 'DRAFT' AND snapshot_json IS NOT NULL`
    )
    .get(publicId);
  if (!row) {
    return html;
  }
  try {
    const snap = JSON.parse(row.snapshot_json);
    const bizName = String(snap?.business?.name || 'Business');
    const docNum = String(snap?.invoiceNumber || 'Invoice');
    const cur = (snap?.business?.currency || 'NGN') as any;
    const bal = Number(row.balance_due_kobo || 0);
    // Privacy rule: WhatsApp/OG preview shows ONLY business name, document number, and amount due — NEVER customer name
    const amountText =
      row.status === 'PAID'
        ? 'Paid'
        : row.status === 'SETTLED'
        ? 'Settled'
        : row.status === 'VOID'
        ? 'Void'
        : `Amount due: ${formatKobo(bal, cur)}`;
    const title = `${docNum} · ${bizName}`;
    const desc = `${bizName} — ${docNum}. ${amountText}.`;
    return html
      .replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
      .replace(
        /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
        `<meta name="description" content="${escapeHtml(desc)}" />`
      )
      .replace(
        /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:title" content="${escapeHtml(title)}" />`
      )
      .replace(
        /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:description" content="${escapeHtml(desc)}" />`
      );
  } catch {
    return html;
  }
}

function injectPublicQuoteOgMeta(html: string, publicId: string): string {
  const row: any = db
    .prepare(
      `SELECT status, total_kobo, snapshot_json
       FROM quotes
       WHERE public_id = ? AND status != 'DRAFT' AND snapshot_json IS NOT NULL`
    )
    .get(publicId);
  if (!row) {
    return html;
  }
  try {
    const snap = JSON.parse(row.snapshot_json);
    const bizName = String(snap?.business?.name || 'Business');
    const docNum = String(snap?.quoteNumber || 'Quote');
    const cur = (snap?.business?.currency || 'NGN') as any;
    const total = Number(row.total_kobo || 0);
    // Privacy rule: WhatsApp/OG preview shows ONLY business name, quote number, and amount — NEVER customer name
    const statusText =
      row.status === 'ACCEPTED'
        ? 'Accepted'
        : row.status === 'DECLINED'
        ? 'Declined'
        : row.status === 'CONVERTED'
        ? 'Converted to invoice'
        : row.status === 'VOID'
        ? 'Void'
        : `Total: ${formatKobo(total, cur)}`;
    const title = `${docNum} · ${bizName}`;
    const desc = `${bizName} — ${docNum}. ${statusText}.`;
    return html
      .replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
      .replace(
        /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
        `<meta name="description" content="${escapeHtml(desc)}" />`
      )
      .replace(
        /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:title" content="${escapeHtml(title)}" />`
      )
      .replace(
        /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:description" content="${escapeHtml(desc)}" />`
      );
  } catch {
    return html;
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    const scriptSrc = IS_PROD ? "'self'" : "'self' 'unsafe-inline' 'unsafe-eval'";
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https: wss:",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; ')
    );
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.use('/api', createApiRouter());

  app.get('/robots.txt', (req, res) => {
    const origin = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    res
      .type('text/plain')
      .send(
        `User-agent: *\nAllow: /\nAllow: /privacy\nAllow: /terms\nDisallow: /app\nDisallow: /api\nDisallow: /r/\nDisallow: /i/\nDisallow: /q/\n\nSitemap: ${origin}/sitemap.xml\n`
      );
  });

  app.get('/sitemap.xml', (req, res) => {
    const origin = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const routes = [
      { loc: `${origin}/`, changefreq: 'weekly', priority: '1.0' },
      { loc: `${origin}/login`, changefreq: 'monthly', priority: '0.7' },
      { loc: `${origin}/privacy`, changefreq: 'monthly', priority: '0.4' },
      { loc: `${origin}/terms`, changefreq: 'monthly', priority: '0.4' },
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes
      .map(
        (r) =>
          `  <url>\n    <loc>${escapeHtml(r.loc)}</loc>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`
      )
      .join('\n')}\n</urlset>\n`;
    res.type('application/xml').send(xml);
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.get('*', async (req, res) => {
      try {
        const publicInvMatch = /^\/(?:i|q)\/([A-Za-z0-9_-]+)\/?$/.exec(req.path);
        if (publicInvMatch) {
          const docPath = path.resolve(process.cwd(), 'public-doc.html');
          let docHtml = fs.readFileSync(docPath, 'utf-8');
          if (req.path.startsWith('/i/')) {
            docHtml = injectPublicInvoiceOgMeta(docHtml, publicInvMatch[1]);
          } else if (req.path.startsWith('/q/')) {
            docHtml = injectPublicQuoteOgMeta(docHtml, publicInvMatch[1]);
          }
          const transformed = await vite.transformIndexHtml(req.originalUrl, docHtml);
          res
            .status(200)
            .set({
              'Content-Type': 'text/html',
              'X-Robots-Tag': 'noindex, nofollow',
              'Referrer-Policy': 'no-referrer',
              'Cache-Control': 'private, no-store, max-age=0',
            })
            .end(transformed);
          return;
        }
        const templatePath = path.resolve(process.cwd(), 'index.html');
        let html = fs.readFileSync(templatePath, 'utf-8');
        const publicMatch = /^\/r\/([A-Za-z0-9_-]+)$/.exec(req.path);
        if (publicMatch) {
          html = injectPublicReceiptOgMeta(html, publicMatch[1]);
        }
        const transformed = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(transformed);
      } catch (err) {
        logError('vite_ssr_fallback', err, { url: req.originalUrl });
        res.status(500).send('Internal server error');
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { index: false }));

    app.get('*', (req, res) => {
      try {
        const publicInvMatch = /^\/(?:i|q)\/([A-Za-z0-9_-]+)\/?$/.exec(req.path);
        if (publicInvMatch) {
          const docPath = path.join(distDir, 'public-doc.html');
          let docHtml = fs.readFileSync(docPath, 'utf-8');
          if (req.path.startsWith('/i/')) {
            docHtml = injectPublicInvoiceOgMeta(docHtml, publicInvMatch[1]);
          } else if (req.path.startsWith('/q/')) {
            docHtml = injectPublicQuoteOgMeta(docHtml, publicInvMatch[1]);
          }
          res
            .status(200)
            .set({
              'Content-Type': 'text/html',
              'X-Robots-Tag': 'noindex, nofollow',
              'Referrer-Policy': 'no-referrer',
              'Cache-Control': 'private, no-store, max-age=0',
            })
            .end(docHtml);
          return;
        }
        const indexPath = path.join(distDir, 'index.html');
        let html = fs.readFileSync(indexPath, 'utf-8');
        const publicMatch = /^\/r\/([A-Za-z0-9_-]+)$/.exec(req.path);
        if (publicMatch) {
          html = injectPublicReceiptOgMeta(html, publicMatch[1]);
        }
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        logError('prod_html_serve', err, { url: req.originalUrl });
        res.status(500).send('Internal server error');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        level: 'info',
        message: `Tallymark server listening on http://0.0.0.0:${PORT}`,
        mode: IS_PROD ? 'production' : 'development',
      })
    );

    // Schedule 90-day claim proof retention job (keeps claim metadata, deletes proof files)
    const runRetention = () => {
      runProofRetentionJob().catch((err) => logError('scheduled_proof_retention', err));
    };
    setTimeout(runRetention, 30_000).unref();
    setInterval(runRetention, 6 * 60 * 60 * 1000).unref();
  });
}

startServer().catch((err) => {
  logError('server_boot_failure', err);
  process.exit(1);
});
