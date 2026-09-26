/* Clerk Frontend API proxy — Vercel Function.

   Forwards /__clerk/* to the Clerk Frontend API upstream.
   Required Vercel env vars (server-side, NO VITE_ prefix):
     CLERK_FAPI_UPSTREAM   — e.g. https://clerk.your-instance.com
     CLERK_SECRET_KEY      — sk_live_… production secret key

   The upstream host is the Clerk Frontend API origin (no path).
   Clerk Dashboard → your app → API Keys → Frontend API.
*/

const UPSTREAM = process.env.CLERK_FAPI_UPSTREAM;
const SECRET = process.env.CLERK_SECRET_KEY;
const PROXY_BASE = 'https://elysianspirecrm.vercel.app/__clerk';

if (!UPSTREAM) {
  console.error('[clerk-proxy] CLERK_FAPI_UPSTREAM not set');
}
if (!SECRET) {
  console.error('[clerk-proxy] CLERK_SECRET_KEY not set');
}

/**
 * Forward a request to the Clerk Frontend API.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  if (!UPSTREAM || !SECRET) {
    res.status(500).json({ error: 'Clerk proxy not configured' });
    return;
  }

  // Path after /__clerk/
  const path = (req.query.path ?? []).join('/');
  const targetUrl = new URL(`/${path}`, UPSTREAM);
  // Preserve original query string
  targetUrl.search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

  // Build headers to forward
  const forwardHeaders = {};

  // Standard passthrough headers
  const passthrough = [
    'authorization',
    'cookie',
    'content-type',
    'accept',
    'accept-language',
    'user-agent',
    'x-requested-with',
  ];
  for (const h of passthrough) {
    if (req.headers[h]) forwardHeaders[h] = req.headers[h];
  }

  // Clerk-required proxy headers
  forwardHeaders['clerk-proxy-url'] = PROXY_BASE;
  forwardHeaders['clerk-secret-key'] = SECRET;

  // X-Forwarded-For: prefer Vercel's, fall back to socket remote
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  forwardHeaders['x-forwarded-for'] = clientIp;

  // Request init
  const init = {
    method: req.method,
    headers: forwardHeaders,
    // Vercel gives us a readable stream for the body; forward it as-is
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
    // Do not follow redirects — let Clerk's response through verbatim
    redirect: 'manual',
  };

  try {
    const upstreamRes = await fetch(targetUrl.toString(), init);

    // Copy status
    res.status(upstreamRes.status);

    // Copy headers (except ones we must not forward)
    const skipHeaders = new Set([
      'content-encoding',
      'content-length',
      'transfer-encoding',
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'upgrade',
    ]);
    for (const [k, v] of upstreamRes.headers) {
      if (!skipHeaders.has(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    }

    // Stream the body
    if (upstreamRes.body) {
      // Node 18+ fetch returns a Web ReadableStream; pipe to res
      const reader = upstreamRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    console.error('[clerk-proxy] upstream error:', err);
    if (!res.writableEnded) {
      res.status(502).json({ error: 'Bad gateway', message: err.message });
    }
  }
}

// Disable body parsing so we can stream the raw request body
export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};