export const config = {
  runtime: 'edge',
};

const DOKPLOY_BASE = 'http://178.105.184.157:3001';

export default async function handler(req) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const forwardHeaders = new Headers();
    const auth = req.headers.get('authorization');
    if (auth) forwardHeaders.set('authorization', auth);
    const ct = req.headers.get('content-type');
    if (ct) forwardHeaders.set('content-type', ct);

    const init = {
      method: req.method,
      headers: forwardHeaders,
      signal: controller.signal,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.text();
    }

    const res = await fetch(`${DOKPLOY_BASE}/api/missions`, init);
    clearTimeout(timeoutId);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {}

  if (req.method === 'POST') {
    return new Response(
      JSON.stringify({
        ok: false,
        offline: true,
        error: 'Dokploy Cloud relay is offline; missions stored locally in IndexedDB.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
