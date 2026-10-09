// seats.aero Partner API への中継（Cloudflare Worker）
//  - API キーを Worker の secret に置き、ブラウザには渡さない
//  - 許可した Origin（自分のサイト）だけに CORS を返す
//  - 合言葉（X-Proxy-Token。カンマ区切りで複数可）が一致した呼び出しだけ管理者のキーで中継する（他人に 1 日 1,000 回の枠を使われないため）
//  - 利用者が自分の seats.aero キー（X-Seats-Key）を送ってきた場合は、そのキーで中継する（利用者自身の契約・枠。合言葉不要）
//  - seats.aero の残回数ヘッダーはそのまま返す
const API = 'https://seats.aero/partnerapi/search';

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = origin && allowed.includes(origin);
  const h = { 'Vary': 'Origin' };
  if (ok) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'X-Proxy-Token, X-Seats-Key, Content-Type';
    h['Access-Control-Expose-Headers'] = 'X-RateLimit-Remaining, X-RateLimit-Limit, RateLimit-Remaining, X-Rate-Limit-Remaining';
    h['Access-Control-Max-Age'] = '86400';
  }
  return { h, ok };
}

const json = (obj, status, extra) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}) });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const { h: cors, ok: originOk } = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    if (origin && !originOk) return json({ error: 'この呼び出し元は許可されていません（ALLOWED_ORIGINS を確認）' }, 403, cors);

    // 使うキーを決める
    //  (1) 利用者が自分の seats.aero キーを送ってきた（X-Seats-Key）→ そのキーで中継。利用者自身の契約・枠で動くので合言葉は不要
    //  (2) 合言葉（X-Proxy-Token）が登録済みのいずれかと一致 → 管理者のキー（secret）で中継
    const ownKey = (request.headers.get('X-Seats-Key') || '').trim();
    const tokens = (env.PROXY_TOKEN || '').split(',').map(s => s.trim()).filter(Boolean);
    const tokenOk = tokens.length && tokens.includes(request.headers.get('X-Proxy-Token') || '');
    const mode = ownKey ? 'own-key' : tokenOk ? 'shared' : null;
    if (!mode) {
      return json({ error: '検索を使うには、設定で「自分の seats.aero API キー」を入れるか、このサイトの管理者から合言葉をもらって入力してください' }, 401, cors);
    }
    const key = ownKey || env.SEATS_AERO_KEY;

    if (url.pathname === '/api/ping') return json({ ok: true, hasKey: !!key, mock: false, proxy: 'cloudflare', mode }, 200, cors);

    if (url.pathname === '/api/search') {
      if (!key) return json({ error: 'SEATS_AERO_KEY が Worker に登録されていません（wrangler secret put SEATS_AERO_KEY）' }, 500, cors);
      const upstream = await fetch(API + url.search, { headers: { 'Partner-Authorization': key, 'Accept': 'application/json', 'User-Agent': 'ana-award-planner/1.0' } });
      const body = await upstream.text();
      const headers = Object.assign({ 'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors);
      for (const [k, v] of upstream.headers) { const lk = k.toLowerCase(); if (lk.includes('ratelimit') || lk.includes('rate-limit')) headers[k] = v; }
      if (!upstream.ok) return json({ error: `seats.aero HTTP ${upstream.status}: ${body.slice(0, 300)}` }, upstream.status, headers);
      return new Response(body, { status: 200, headers });
    }
    return json({ error: 'not found' }, 404, cors);
  }
};
