const ALLOWED_ORIGIN = 'https://pierogas.github.io';

function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  resp.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return resp;
}

function json(data, init) {
  return cors(new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init && init.headers) }
  }));
}

function isAuthorized(request, env) {
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.WORKER_SHARED_SECRET}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const body = await request.json();
      if (!body.deviceId || !body.subscription) {
        return json({ error: 'deviceId e subscription richiesti' }, { status: 400 });
      }
      const existingRaw = await env.PARKED_CARS.get(`sub:${body.deviceId}`);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const record = {
        subscription: body.subscription,
        via: body.via != null ? body.via : existing.via,
        tr: body.tr != null ? body.tr : existing.tr,
        leadHours: body.leadHours != null ? body.leadHours : (existing.leadHours || 24),
        lastNotifiedStart: body.via !== existing.via || body.tr !== existing.tr ? null : (existing.lastNotifiedStart || null),
        updatedAt: Date.now()
      };
      await env.PARKED_CARS.put(`sub:${body.deviceId}`, JSON.stringify(record));
      return json({ ok: true });
    }

    if (url.pathname === '/unsubscribe' && request.method === 'POST') {
      const body = await request.json();
      if (!body.deviceId) return json({ error: 'deviceId richiesto' }, { status: 400 });
      await env.PARKED_CARS.delete(`sub:${body.deviceId}`);
      return json({ ok: true });
    }

    if (url.pathname === '/list' && request.method === 'GET') {
      if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, { status: 401 });
      const list = await env.PARKED_CARS.list({ prefix: 'sub:' });
      const out = [];
      for (const key of list.keys) {
        const raw = await env.PARKED_CARS.get(key.name);
        if (raw) out.push({ deviceId: key.name.slice(4), ...JSON.parse(raw) });
      }
      return json(out);
    }

    if (url.pathname === '/status' && request.method === 'GET') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) return json({ error: 'deviceId richiesto' }, { status: 400 });
      const raw = await env.PARKED_CARS.get(`sub:${deviceId}`);
      if (!raw) return json({ lastNotifiedStart: null });
      const record = JSON.parse(raw);
      return json({ lastNotifiedStart: record.lastNotifiedStart || null });
    }

    if (url.pathname === '/mark-notified' && request.method === 'POST') {
      if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, { status: 401 });
      const body = await request.json();
      const raw = await env.PARKED_CARS.get(`sub:${body.deviceId}`);
      if (!raw) return json({ error: 'not found' }, { status: 404 });
      const record = JSON.parse(raw);
      record.lastNotifiedStart = body.startMs;
      await env.PARKED_CARS.put(`sub:${body.deviceId}`, JSON.stringify(record));
      return json({ ok: true });
    }

    return json({ error: 'not found' }, { status: 404 });
  },

  // Cron Trigger di Cloudflare (affidabile) al posto dello `schedule` di
  // GitHub Actions (sui piani gratuiti viene ritardato anche di ore):
  // fa solo da "sveglia" precisa, l'invio vero resta nello script Node
  // già testato (usa web-push, non compatibile nativamente col runtime Worker).
  async scheduled(event, env, ctx) {
    const res = await fetch(
      'https://api.github.com/repos/pierogas/parcheggio-firenze/actions/workflows/send-reminders.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'parcheggio-firenze-push-worker',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ref: 'main' })
      }
    );
    if (!res.ok) {
      console.log('Errore dispatch workflow:', res.status, await res.text());
    }
  }
};
