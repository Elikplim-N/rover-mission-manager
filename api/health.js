export const config = {
  runtime: 'edge',
};

const DOKPLOY_BASE = 'http://178.105.184.157:3001';

export default async function handler() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${DOKPLOY_BASE}/api/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
  } catch {}

  return new Response(
    JSON.stringify({
      status: 'standby',
      cloudRelay: 'offline',
      mode: 'edge-fallback',
      version: '1.1.0-edge',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}
