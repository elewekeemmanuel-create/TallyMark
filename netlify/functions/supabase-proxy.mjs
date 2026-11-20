function cleanEnv(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/^["']+|["']+$/g, '').trim();
}

function getSupabaseOrigin() {
  const raw = cleanEnv(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
  if (!raw) return '';
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export default async function handler(req) {
  const supaOrigin = getSupabaseOrigin();
  if (!supaOrigin) {
    return new Response(
      JSON.stringify({
        error: 'Supabase is not configured on this server.',
        code: 'SUPABASE_NOT_CONFIGURED',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } }
    );
  }

  const incomingUrl = new URL(req.url);
  const rawPath = incomingUrl.pathname
    .replace(/^\/\.netlify\/functions\/supabase-proxy/, '')
    .replace(/^\/api\/supabase/, '');
  const pathnameOnly = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  const allowedPrefix =
    pathnameOnly.startsWith('/auth/v1/') ||
    pathnameOnly.startsWith('/rest/v1/') ||
    pathnameOnly.startsWith('/storage/v1/');

  if (!allowedPrefix || pathnameOnly.includes('..') || pathnameOnly.includes('\\')) {
    return new Response(JSON.stringify({ error: 'Unsupported Supabase proxy path' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const targetUrl = `${supaOrigin}${pathnameOnly}${incomingUrl.search}`;
  const forwardHeaders = new Headers();
  const allowlistedReqHeaders = [
    'apikey',
    'authorization',
    'content-type',
    'accept',
    'accept-profile',
    'content-profile',
    'prefer',
    'range',
    'x-client-info',
    'x-supabase-api-version',
    'x-upsert',
    'cache-control',
    'if-none-match',
    'if-match',
  ];

  for (const name of allowlistedReqHeaders) {
    const value = req.headers.get(name);
    if (value && value.trim()) {
      forwardHeaders.set(name, value);
    }
  }

  if (!forwardHeaders.has('apikey')) {
    const publicKey = cleanEnv(
      process.env.VITE_SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env.SUPABASE_ANON_KEY
    );
    if (publicKey) {
      forwardHeaders.set('apikey', publicKey);
    }
  }

  const method = req.method.toUpperCase();
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 0) {
      body = buf;
    }
  }

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });

    const responseHeaders = new Headers();
    const allowlistedResHeaders = [
      'content-type',
      'content-range',
      'x-total-count',
      'x-supabase-api-version',
      'x-sb-error-code',
      'cache-control',
      'etag',
      'location',
    ];
    for (const name of allowlistedResHeaders) {
      const value = upstream.headers.get(name);
      if (value) {
        responseHeaders.set(name, value);
      }
    }

    const resBody = await upstream.arrayBuffer();
    return new Response(resBody, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: 'Unable to reach Supabase right now. Please try again in a moment.',
        code: 'SUPABASE_PROXY_UNREACHABLE',
      }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }
}
