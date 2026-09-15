export const config = {
  runtime: 'edge',
};

const DOKPLOY_BASE = 'http://178.105.184.157:3001';

export default async function handler(req) {
  // 1. Attempt to proxy to Dokploy VPS if accessible
  try {
    const url = new URL(req.url);
    const targetUrl = `${DOKPLOY_BASE}/api/command${url.search}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);

    const forwardHeaders = new Headers();
    const authHeader = req.headers.get('authorization');
    if (authHeader) forwardHeaders.set('authorization', authHeader);
    const contentType = req.headers.get('content-type');
    if (contentType) forwardHeaders.set('content-type', contentType);

    const init = {
      method: req.method,
      headers: forwardHeaders,
      signal: controller.signal,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.text();
    }

    const response = await fetch(targetUrl, init);
    clearTimeout(timeoutId);

    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    // 2. Graceful Edge Fallback when Dokploy VPS is offline or unreachable
    if (req.method === 'POST') {
      return new Response(
        JSON.stringify({
          ok: false,
          offline: true,
          error: 'Dokploy Cloud relay is offline (178.105.184.157:3001). Configure Direct LAN IP in Teleop for instant direct control.',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        offline: true,
        message: 'Dokploy Cloud relay standby; operating in standalone/direct LAN mode',
        roverState: {
          mode: 'AUTO',
          lastSeen: null,
          volt: 12.4,
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
