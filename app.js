(function () {
  'use strict';
  const D = window.AWARD_DATA;
  const LS = 'aap.v1';
  const cityMap = {};
  D.cities.forEach(c => { cityMap[c.code] = c; });
  const CABINS = { Y: 'エコノミー', PY: 'プレミアムエコノミー', C: 'ビジネス', F: 'ファースト' };

  // ---------- state ----------
  const defaultState = () => ({
    tab: 'quick', q: { origin: 'TYO', dest: '', final: 'TYO' }, cabin: 'C', pax: 1, dates: {},
    settings: {}, chartOverride: null
  });
  let S = load();
  if (!['quick', 'tips'].includes(S.tab)) S.tab = 'quick'; // 旧版のタブ名が残っていたら戻す
  if (S.settings.authVersion !== 2) { delete S.settings.proxyToken; delete S.settings.seatsKey; S.settings.authVersion = 2; save(); }
  S._cal = null; // カレンダーの開閉状態は再読込で閉じる
  function load() {
    try { const s = JSON.parse(localStorage.getItem(LS)); if (s && typeof s === 'object') { const d = defaultState(); return Object.assign(d, s, { settings: Object.assign(d.settings, s.settings || {}), q: Object.assign(d.q, s.q || {}) }); } } catch (e) { /* ignore */ }
    return defaultState();
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function setPath(k, v) {
    const parts = k.split('.');
    let o = S;
    for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]; if (Array.isArray(o)) o = o[Number(p)]; else { if (o[p] == null) o[p] = {}; o = o[p]; } }
    const last = parts[parts.length - 1];
    if (Array.isArray(o)) o[Number(last)] = v; else o[last] = v;
  }

  // ---------- helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const zone = c => (cityMap[c] ? cityMap[c].zone : null);
  const rankOf = c => { const z = zone(c); return z == null ? -1 : (D.zoneRank[z] || 0); };
  const n = c => (cityMap[c] ? cityMap[c].name : c || '—');
  const fmt = v => (v == null ? '未登録' : Number(v).toLocaleString('ja-JP'));
  const uniq = a => Array.from(new Set(a));
  const charts = () => Object.assign({ partnerChart: D.partnerChart, partnerCityOverride: D.partnerCityOverride, anaChart: D.anaChart, anaSeasons: D.anaSeasons, anaFuel: D.anaFuel, jalChart: D.jalChart }, S.chartOverride || {});
  // ANA 便の燃油（1区間・円）。都市別の例外 → ゾーン別
  const anaFuelPerSector = dest => { const f = charts().anaFuel || D.anaFuel; if (!f || !dest) return null; const v = (f.cityOverride || {})[dest]; if (v != null) return v; const z = zone(dest); return z != null && f.perSector[z] != null ? f.perSector[z] : null; };
  // ---------- season ----------
  const SEASON_NAME = { L: 'ロー', R: 'レギュラー', H: 'ハイ' };
  function seasonOf(iso) {
    if (!iso) return null; const md = iso.slice(5); const ch = charts().anaSeasons || D.anaSeasons;
    const inR = ([a, b]) => (a <= b ? (md >= a && md <= b) : (md >= a || md <= b));
    if ((ch.H || []).some(inR)) return 'H'; if ((ch.L || []).some(inR)) return 'L'; return 'R';
  }
  const seasonTag = iso => { const s = seasonOf(iso); return s ? `<span class="season ${s}">${SEASON_NAME[s]}</span>` : ''; };

  // ---------- UI pieces ----------
  function citySelect(k, value, opts) {
    opts = opts || {};
    let h = `<select data-k="${k}">`;
    if (opts.allowBlank !== false) h += `<option value="">—</option>`;
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(z => {
      if (opts.jpOnly && z !== 1) return;
      if (opts.intlOnly && z === 1) return;
      h += `<optgroup label="${esc(D.zones[z].name)}">`;
      D.cities.filter(c => c.zone === z).forEach(c => { h += `<option value="${c.code}" ${c.code === value ? 'selected' : ''}>${esc(c.name)} (${c.code})</option>`; });
      h += '</optgroup>';
    });
    return h + '</select>';
  }
  function simpleSelect(k, value, map) { return `<select data-k="${k}">` + Object.keys(map).map(v => `<option value="${v}" ${v === String(value) ? 'selected' : ''}>${esc(map[v])}</option>`).join('') + '</select>'; }
  const msg = (cls, t) => `<div class="msg ${cls}">${esc(t)}</div>`;

  const DIRECTS = (() => {
    const m = {}; Object.keys(D.directs).forEach(c => { m[c] = {}; Object.keys(D.directs[c]).forEach(j => { m[c][j] = D.directs[c][j].slice(); }); });
    ['BR', 'SQ', 'VN'].forEach(c => { m[c] = m[c] || {}; D.networks[c].fromJapan.forEach(([a, b]) => { if (!cityMap[b]) return; (m[c][a] = m[c][a] || []); if (!m[c][a].includes(b)) m[c][a].push(b); }); });
    return m;
  })();
  const directCarriers = (from, to) => Object.keys(DIRECTS).filter(c => (DIRECTS[c][from] || []).includes(to));
  const jpWithDirect = (c, to) => Object.keys(DIRECTS[c] || {}).filter(j => DIRECTS[c][j].includes(to));
  const cname = c => (D.carriers[c] ? D.carriers[c].name : ((D.owNames || {})[c] || c));

  function quickAnalysis(cabinOverride) {
    const cabin = cabinOverride || S.cabin;
    const q = S.q; const dep = S.dates['q.dep'] || '', ret = S.dates['q.ret'] || ''; const dz = zone(q.dest); const ch = charts();
    const sDep = seasonOf(dep), sRet = seasonOf(ret); const idx = { L: 0, R: 1, H: 2 };
    const anaArr = ch.anaChart[dz] && ch.anaChart[dz][cabin];
    let anaMiles = null, anaNote = '';
    if (anaArr) {
      if (sDep && sRet) {
        const a = anaArr[idx[sDep]], b = anaArr[idx[sRet]];
        if (a != null && b != null) { anaMiles = (a + b) / 2; if (sDep !== sRet) anaNote = '往路と復路でシーズンが異なるため、それぞれの往復マイルの半分を合算'; }
        else if (a != null) { anaMiles = a; anaNote = `帰国日（${SEASON_NAME[sRet]}）のマイル数が未登録のため往路シーズン基準の概算`; }
        else if (b != null) { anaMiles = b; anaNote = `出発日（${SEASON_NAME[sDep]}）のマイル数が未登録のため帰国シーズン基準の概算`; }
      } else if (sDep) anaMiles = anaArr[idx[sDep]];
    }
    const pz = ch.partnerChart[dz]; let pMiles = pz ? pz[cabin] : null;
    const ov = ch.partnerCityOverride && ch.partnerCityOverride[q.dest]; if (ov && ov[cabin] != null) pMiles = ov[cabin];
    const fromOrigin = directCarriers(q.origin, q.dest);
    const anaJP = jpWithDirect('NH', q.dest);
    const others = Object.keys(DIRECTS).filter(c => c !== 'NH' && jpWithDirect(c, q.dest).length).map(c => ({ c, jps: jpWithDirect(c, q.dest) }));
    const fuelSector = anaFuelPerSector(q.dest); const fuelRT = fuelSector != null ? fuelSector * (ret ? 2 : 1) : null;
    return { q, dep, ret, dz, sDep, sRet, anaMiles, anaNote, pMiles, fuelSector, fuelRT, anaDirectFrom: fromOrigin.includes('NH'), anaJP, othersFrom: fromOrigin.filter(c => c !== 'NH'), others };
  }

  // ---------- live route search (seats.aero 本番・直行→各社ハブ経由。スタアラ＝ANAマイル、参考でワンワールド) ----------
  const LIVE = { status: 'idle', log: [], results: null, calls: 0, msg: '', cache: { out: null, ret: null }, reused: [] };
  const CACHE_MAX_H = 6; // 片側だけ日付を変えて再検索するとき、変わっていない側は前回の取得結果を 6 時間まで使い回す
  const cityOfAp = a => D.hubCity[a] || cityOfAirport(a);
  const tmin = iso => { const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(iso || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null; };
  const paxN = () => Math.max(1, Number(S.pax || 1));
  const enough = l => !l.seats || l.seats >= paxN(); // 残席 0 は「席数不明」なので通す
  const shortLegs = legs => legs.filter(l => l.seats && l.seats < paxN());
  const SIDE_LABEL = { out: '往路', ret: '復路' };
  const CABIN_OF = { economy: 'Y', premium: 'PY', business: 'C', first: 'F' };
  function tripsFrom(data) {
    const out = []; const seen = new Map();
    (data || []).forEach(it => {
      const r = it.Route || {}; const src = it.Source || '';
      (it.AvailabilityTrips || []).forEach(t => {
        if ((t.Stops || 0) !== 0) return; const cabin = CABIN_OF[t.Cabin]; if (!cabin) return;
        const fn = t.FlightNumbers || '';
        const k = `${it.Date}|${r.OriginAirport}|${r.DestinationAirport}|${fn}|${cabin}`;
        const seats = Number(t.RemainingSeats || 0);
        const prev = seen.get(k);
        if (prev) { if (src && !prev.srcs.includes(src)) prev.srcs.push(src); if (seats > prev.seats) prev.seats = seats; const u = t.UpdatedAt || it.UpdatedAt || ''; if (u > (prev.upd || '')) prev.upd = u; return; } // 同じ便が複数プログラムに出ていればまとめる（鮮度は新しい方）
        const leg = { date: it.Date, o: r.OriginAirport, d: r.DestinationAirport, fn, cabin, dep: t.DepartsAt || '', arr: t.ArrivesAt || '', seats, ac: (t.Aircraft || []).join('/'), srcs: src ? [src] : [], dist: Number(r.Distance || 0), upd: t.UpdatedAt || it.UpdatedAt || '' };
        seen.set(k, leg); out.push(leg);
      });
    });
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.dep.localeCompare(b.dep));
  }
  // 本日（UTC 暦日）の API 使用回数をこの端末で数える。seats.aero の上限は 1 日 1,000 回・UTC 0 時（日本時間 朝 9 時）リセット
  const API_LIMIT = 1000;
  const utcDay = () => new Date().toISOString().slice(0, 10);
  function countApiCall() { if (!S.apiUsage || S.apiUsage.day !== utcDay()) S.apiUsage = { day: utcDay(), n: 0 }; S.apiUsage.n++; save(); }
  const apiUsedToday = () => (S.apiUsage && S.apiUsage.day === utcDay() ? S.apiUsage.n : 0);
  const apiRemaining = () => (S.apiRemaining && S.apiRemaining.day === utcDay() ? S.apiRemaining.n : null);
  // 1 回の呼び出しに複数の出発地・到着地・クラス・プログラムをまとめて渡す。1,000 件を超えたら skip でページ送り（cursor は実測で効かない）
  async function legSearch(oAps, dAps, start, end, cabinsParam, sources, onPage) {
    let data = [];
    for (let page = 0; page < 6; page++) {
      LIVE.calls++; countApiCall();
      const params = { origin_airport: oAps.join(','), destination_airport: dAps.join(','), start_date: start, end_date: end, cabins: cabinsParam, sources, take: 1000, include_trips: true };
      if (data.length) params.skip = data.length;
      const j = await apiFetch(params);
      if (!Array.isArray(j.data)) throw new Error('空席データの形式が正しくありません。時間をおいて再試行してください。');
      const rows = j.data; data = data.concat(rows);
      if (onPage) onPage(data.length, LIVE.calls);
      if (!j.hasMore || !rows.length) break;
    }
    return tripsFrom(data);
  }
  // 人数分の席がある便だけで乗継を組む
  function pairLegs(l1, l2, maxH) {
    const out = [];
    l1.filter(enough).forEach(a => l2.filter(enough).forEach(b => {
      if (cityOfAp(a.d) !== cityOfAp(b.o)) return;
      const ta = tmin(a.arr), tb = tmin(b.dep); if (ta == null || tb == null) return;
      const gap = (tb - ta) / 60; if (gap < 1.5 || gap > maxH) return;
      out.push({ legs: [a, b], gapH: gap, stop: gap > 24, seats: Math.min(a.seats || 9, b.seats || 9) });
    }));
    return out;
  }
  // 並び順: 希望の日本側都市（往路=出発地、復路=帰着地）→ 24時間以内の乗継 → 希望日に近い → 席数
  let rankOw = false; // rankCombos 実行中のグループがワンワールドかどうか（取れそう度の判定に使う）
  const rankCombos = (combos, wantDate, prefCity, side) => combos.sort((x, y) => {
    const lastX = x.legs[x.legs.length - 1], lastY = y.legs[y.legs.length - 1];
    const px = (side === 'ret' ? cityOfAp(lastX.d) : cityOfAp(x.legs[0].o)) === prefCity ? 0 : 1;
    const py = (side === 'ret' ? cityOfAp(lastY.d) : cityOfAp(y.legs[0].o)) === prefCity ? 0 : 1;
    const dx = Math.abs(tmin(x.legs[0].date + 'T00:00') - tmin(wantDate + 'T00:00')), dy = Math.abs(tmin(y.legs[0].date + 'T00:00') - tmin(wantDate + 'T00:00'));
    const ax = Math.max(...x.legs.map(l => ageOf(l) || 0)), ay = Math.max(...y.legs.map(l => ageOf(l) || 0));
    const distOf = c => c.legs.reduce((t, l) => t + (l.dist || 0), 0);
    const fz = fuelSaver() ? (fuelOf(x) - fuelOf(y)) : 0; // 燃油節約モード: 燃油の目安が安い順を最優先
    const sz = sureMode() ? (confidence(y, rankOw).score - confidence(x, rankOw).score) : 0; // 取れそう度モード: 点数の高い順
    return fz || sz || (px - py) || (x.stop - y.stop) || (x.legs.length - y.legs.length) || (dx - dy) || (distOf(x) - distOf(y)) || (y.seats - x.seats) || (ax - ay);
  });
  // 探索グループ: スターアライアンス（ANAマイルで予約可）／ワンワールド（参考）
  const LIVE_GROUPS = {
    star: { label: 'スターアライアンス（ANAマイル）', carriers: () => D.liveCarriers, ana: true },
    ow: { label: '参考: ワンワールド', carriers: () => D.liveCarriersOW || [], ana: false }
  };
  // 全区間・全社・全クラスをまとめて取得する。往路 2 区間・復路 2 区間に加え、現地ハブへ乗り継ぐ 3 区間用に「玄関→現地ハブ」を往復 1 回ずつ（最大 6 回＋ページ送り）
  async function fetchLegs(cabins, withOW, log) {
    const q = S.q; const dep = S.dates['q.dep'] || '', ret = S.dates['q.ret'] || '';
    const w = Number(S.settings.window == null ? 6 : S.settings.window); const dz = zone(q.dest);
    const dAps = airportsOf(q.dest), oAps = airportsOf(q.origin), fAps = airportsOf(q.final);
    const cfgs = [...D.liveCarriers, ...(withOW ? (D.liveCarriersOW || []) : [])];
    const jpAll = uniq([...oAps, ...fAps, ...cfgs.flatMap(c => c.jp)]);
    const gateways = (D.gatewaysByZone || {})[dz] || [];
    const regional = uniq(cfgs.filter(c => !c.jp.length && c.zones.includes(dz)).flatMap(c => c.hubs)).filter(h => !dAps.includes(h)); // 日本便の無い現地会社のハブ
    const hubsAll = uniq([...cfgs.flatMap(c => c.hubs), ...gateways]).filter(h => !dAps.includes(h));
    const sources = uniq([D.seatsSources.star, D.seatsSources.vn, withOW ? D.seatsSources.ow : ''].join(',').split(',').filter(Boolean)).join(',');
    const cab = cabins.map(c => CABIN_PARAM[c]).join(',');
    const prog = label => (count, calls) => { LIVE.log[LIVE.log.length - 1] = `${label}: ${count}件取得（API ${calls}回）`; render(); };
    const step = label => { LIVE.log.push(`${label}: 取得中…`); render(); return prog(label); };
    const gw = hubsAll.filter(h => !regional.includes(h));
    // 側ごとのキャッシュ鍵: その側の取得条件がすべて同じなら再利用できる
    const base = JSON.stringify({ w, cab, sources, jpAll, hubsAll, dAps, regional });
    const keyOut = base + '|out|' + dep, keyRet = base + '|ret|' + ret;
    const fresh = c => c && (Date.now() - c.at) < CACHE_MAX_H * 3600000;
    LIVE.reused = [];
    let out = LIVE.cache.out;
    if (fresh(out) && out.key === keyOut) { LIVE.reused.push('out'); log(`往路: 前回（${Math.round((Date.now() - out.at) / 60000)} 分前）の取得結果を再利用（API 0 回）`); }
    else {
      const L1 = await legSearch(jpAll, uniq([...hubsAll, ...dAps]), addDays(dep, -w), addDays(dep, w), cab, sources, step('日本→ハブ・直行'));      // 日本→ハブ ＋ 日本→目的地（直行）
      const L2 = await legSearch(hubsAll, dAps, addDays(dep, -w), addDays(dep, w + 3), cab, sources, step('ハブ→目的地'));                       // ハブ→目的地
      const L2b = regional.length ? await legSearch(gw, regional, addDays(dep, -w), addDays(dep, w + 3), cab, sources, step('玄関ハブ→現地ハブ')) : [];
      out = LIVE.cache.out = { key: keyOut, at: Date.now(), L1, L2, L2b };
    }
    let rt = LIVE.cache.ret;
    if (!ret) rt = { L3: [], L3b: [], L4: [] };
    else if (fresh(rt) && rt.key === keyRet) { LIVE.reused.push('ret'); log(`復路: 前回（${Math.round((Date.now() - rt.at) / 60000)} 分前）の取得結果を再利用（API 0 回）`); }
    else {
      const L3 = await legSearch(dAps, hubsAll, addDays(ret, -w), addDays(ret, w), cab, sources, step('目的地→ハブ'));                               // 目的地→ハブ
      const L3b = regional.length ? await legSearch(regional, gw, addDays(ret, -w), addDays(ret, w + 3), cab, sources, step('現地ハブ→玄関ハブ')) : [];
      const L4 = await legSearch(uniq([...hubsAll, ...dAps]), jpAll, addDays(ret, -w), addDays(ret, w + 3), cab, sources, step('ハブ→日本・直行'));  // ハブ→日本 ＋ 目的地→日本（直行）
      rt = LIVE.cache.ret = { key: keyRet, at: Date.now(), L3, L3b, L4 };
    }
    return { L1: out.L1, L2: out.L2, L2b: out.L2b, L3: rt.L3, L3b: rt.L3b, L4: rt.L4, w, dep, ret, dAps, oAps, fAps, hubsAll, regional, gateways };
  }
  // 燃油サーチャージの目安（1 便・円）。運航会社の燃油設定と区間から見積もる
  //  ・ANA 便、UA の日本発着区間: ANA 公式表（相手側のゾーンの 1 区間額）
  //  ・燃油 0 円の会社（SQ/VN/NZ/AV/ET/CM）: 0
  //  ・その他: 日本発着なら ANA 表 × 会社ごとの係数（LH 系 1.0、TK 0.6 など）、日本に関係ない区間は長距離 25,000・短距離 8,000 × 係数
  const FUEL_FACTOR = { LH: 1.0, LX: 1.0, OS: 1.0, SN: 1.0, AC: 0.9, TG: 0.8, BR: 0.8, CA: 0.8, OZ: 0.8, TP: 0.8, MS: 0.6, TK: 0.6, A3: 0.5, LO: 0.2, BA: 1.0, AY: 0.7, CX: 0.7, IB: 0.8, QF: 0.8, MH: 0.6, JL: 1.0 };
  const FUEL_NONE = new Set(['SQ', 'VN', 'NZ', 'AV', 'ET', 'CM', 'AA', 'QR', 'AS']);
  function fuelEstLeg(l) {
    const op = opOf(l); const zo = zone(cityOfAp(l.o)), zd = zone(cityOfAp(l.d));
    if (zo === 1 && zd === 1) return 0; // 国内線
    const jpLeg = zo === 1 || zd === 1; const far = zo === 1 ? cityOfAp(l.d) : cityOfAp(l.o);
    const anaSector = () => { const v = anaFuelPerSector(far); return v != null ? v : 30000; };
    if (op === 'NH') return jpLeg ? anaSector() : 20000;
    const c = D.carriers[op]; const f = c ? c.fuel : 'yes';
    if (FUEL_NONE.has(op) || f === 'no') return 0;
    if (f === 'jp-only') return jpLeg ? anaSector() : 0;
    const k = FUEL_FACTOR[op] != null ? FUEL_FACTOR[op] : 0.8;
    if (jpLeg) return Math.round(anaSector() * k / 1000) * 1000;
    return Math.round(((l.dist || 0) > 2500 ? 25000 : 8000) * k / 1000) * 1000;
  }
  const fuelOf = c => { if (c._fuel == null) c._fuel = c.legs.reduce((t, l) => t + fuelEstLeg(l), 0); return c._fuel; };
  // 「取れそう度」: 便ごとに ①最終確認の新しさ ②提携枠に出ているか（ANA/JAL 可の見込み） ③残席の余裕 ④複数プログラムに出ているか を点数化し、旅程は最も弱い便で評価
  const sureMode = () => !!S.settings.liveSure;
  function legScore(l, ow) {
    const h = ageOf(l); const fresh = h == null ? 0 : h <= 2 ? 3 : h <= 12 ? 2 : h <= 24 ? 1 : h <= 72 ? 0 : -2;
    const ch = chanceOf(l, ow).k; const chance = ch === 'ok' ? 3 : ch === 'maybe' ? 1 : -3;
    const seats = !l.seats ? 0 : l.seats >= paxN() + 2 ? 1 : 0;
    const progs = (l.srcs || []).length >= 2 ? 1 : 0;
    return fresh + chance + seats + progs;
  }
  function confidence(c, ow) {
    if (c._conf && c._conf.ow === ow) return c._conf;
    const scores = c.legs.map(l => legScore(l, ow)); const min = Math.min(...scores); const sum = scores.reduce((t, v) => t + v, 0);
    const worstAge = Math.max(...c.legs.map(l => ageOf(l) || 0)); const anyNg = c.legs.some(l => chanceOf(l, ow).k === 'ng'); const allOk = c.legs.every(l => chanceOf(l, ow).k === 'ok');
    const grade = anyNg || worstAge > 72 ? '△' : (allOk && worstAge <= 24) ? '◎' : '○';
    const why = [`最終確認 ${worstAge < 1 ? '1時間以内' : worstAge < 24 ? Math.round(worstAge) + '時間前' : Math.round(worstAge / 24) + '日前'}`, anyNg ? '会員枠のみの便あり' : allOk ? '全便が提携枠' : '要確認の便あり'];
    c._conf = { ow, score: min * 10 + sum, grade, why: why.join('・') };
    return c._conf;
  }
  const fuelSaver = () => !!S.settings.liveFuelSaver;
  // 乗継の時間判定（1.5〜maxH 時間、24 時間超はストップオーバー）
  const gapHours = (a, b) => { const ta = tmin(a.arr), tb = tmin(b.dep); if (ta == null || tb == null) return null; const g = (tb - ta) / 60; return (g < 1.5 || g > 72) ? null : g; };
  const sameCity = (a, b) => cityOfAp(a.d) === cityOfAp(b.o);
  const opOf = l => (l.fn || '').slice(0, 2);
  // 3 区間（日本→玄関→現地ハブ→目的地 など）。ストップオーバーは 1 回まで
  function tripleLegs(l1, l2, l3) {
    const out = [];
    l1.filter(enough).forEach(a => l2.filter(enough).forEach(b => {
      if (!sameCity(a, b)) return; const g1 = gapHours(a, b); if (g1 == null) return;
      l3.filter(enough).forEach(c => {
        if (!sameCity(b, c)) return; const g2 = gapHours(b, c); if (g2 == null) return;
        const stops = (g1 > 24) + (g2 > 24); if (stops > 1) return;
        out.push({ legs: [a, b, c], gaps: [g1, g2], gapH: g1 + g2, stop: stops > 0, seats: Math.min(a.seats || 9, b.seats || 9, c.seats || 9) });
      });
    }));
    return out;
  }
  // ANA 提携特典のルール（2025年6月24日以降の発券分）で組合せを絞る
  //  ・乗換地点は、出発地からの必要マイルが目的地より高いゾーンの都市にできない（例: 欧州行きをドーハ経由にはできない）
  //  ・片道旅程では途中降機（24時間超）不可。往復では目的地以外に 1 回まで（往復どちらか）
  //  ・海外乗換は往路・復路各 2 回まで（3 区間までしか作らないので常に範囲内）
  function anaRuleFilter(combos, destCity, oneWay) {
    const destRank = rankOf(destCity);
    return combos.filter(c => {
      if (oneWay && c.stop) return false;
      return c.legs.slice(0, -1).every(l => { const z = zone(cityOfAp(l.d)); return z == null || z === 1 || rankOf(cityOfAp(l.d)) <= destRank; });
    });
  }
  // 取得済みの便を航空会社・ハブごとに振り分けて組合せを作る（API は使わない）
  function buildGroup(alliance, cabin, sides, R, log) {
    const q = S.q; const dz = zone(q.dest); const G = LIVE_GROUPS[alliance];
    const g = { alliance, cabin, sides, direct: null, partners: [] }; rankOw = !G.ana;
    const doOut = sides.includes('out'), doRet = sides.includes('ret') && !!R.ret;
    // 取れそう度モード: 組合せを作る前に、3 日以上前のデータの便と、運航会社の会員枠にしか出ていない便を除く
    const SURE_MAX_H = 72;
    const reliable = l => { if (!sureMode()) return true; const h = ageOf(l); if (h != null && h > SURE_MAX_H) return false; return chanceOf(l, !G.ana).k !== 'ng'; };
    let dropped = 0;
    const byCab = arr => { const c = arr.filter(l => l.cabin === cabin && (!G.ana || !l.fn.startsWith('OZ') || l.date <= '2026-12-16')); const r = c.filter(reliable); dropped += c.length - r.length; return r; };
    const L1 = byCab(R.L1), L2 = byCab(R.L2), L2b = byCab(R.L2b || []), L3 = byCab(R.L3), L3b = byCab(R.L3b || []), L4 = byCab(R.L4);
    if (sureMode()) log(`取れそう度モード: ${SURE_MAX_H / 24} 日以上前のデータの便と会員枠のみの便 ${dropped} 便を除外してから組合せを作ります`);
    const cfgs = G.carriers().filter(cfg => cfg.zones.includes(dz));
    for (const cfg of cfgs) {
      const isC = l => l.fn.startsWith(cfg.c);
      const jpO = uniq([...R.oAps, ...cfg.jp]), jpF = uniq([...R.fAps, ...cfg.jp]);
      if (!cfg.hubs.length) {
        // 直行便（ANA / JAL）
        const out = doOut ? L1.filter(l => isC(l) && jpO.includes(l.o) && R.dAps.includes(l.d)) : [];
        const rt = doRet ? L4.filter(l => isC(l) && R.dAps.includes(l.o) && jpF.includes(l.d) && l.date <= addDays(R.ret, R.w)) : [];
        g.direct = { cfg, out: out.filter(enough), ret: rt.filter(enough), shortOut: shortLegs(out).length, shortRet: shortLegs(rt).length };
        log(`${cname(cfg.c)} 直行: 往路${g.direct.out.length}便 / 復路${g.direct.ret.length}便${g.direct.shortOut + g.direct.shortRet ? `（人数未満 ${g.direct.shortOut + g.direct.shortRet}便）` : ''}`);
        continue;
      }
      if (dz === 5) continue; // ハワイは提携便不可
      if (!cfg.jp.length) continue; // 日本便の無い現地会社は「会社をまたぐ乗継」側で使う
      const l1 = doOut ? L1.filter(l => isC(l) && jpO.includes(l.o) && cfg.hubs.includes(l.d)) : [];
      const l2 = doOut ? L2.filter(l => isC(l) && cfg.hubs.includes(l.o) && R.dAps.includes(l.d)) : [];
      const l3 = doRet ? L3.filter(l => isC(l) && R.dAps.includes(l.o) && cfg.hubs.includes(l.d)) : [];
      const l4 = doRet ? L4.filter(l => isC(l) && cfg.hubs.includes(l.o) && jpF.includes(l.d)) : [];
      const rule = cs => (G.ana ? anaRuleFilter(cs, q.dest, !R.ret) : cs);
      const outC = doOut ? rankCombos(rule(pairLegs(l1, l2, 72)), R.dep, q.origin, 'out') : [];
      const retC = doRet ? rankCombos(rule(pairLegs(l3, l4, 72)), R.ret, q.final, 'ret') : [];
      const p = { cfg, l1: l1.filter(enough), l2: l2.filter(enough), l3: l3.filter(enough), l4: l4.filter(enough), shortOut: shortLegs([...l1, ...l2]).length, shortRet: shortLegs([...l3, ...l4]).length, outC, retC };
      g.partners.push(p);
      log(`${cname(cfg.c)}: 日本→ハブ ${p.l1.length}便 / ハブ→目的地 ${p.l2.length}便 / 目的地→ハブ ${p.l3.length}便 / ハブ→日本 ${p.l4.length}便 → 往路の組合せ ${outC.length}・復路 ${retC.length}${p.shortOut + p.shortRet ? `（人数未満 ${p.shortOut + p.shortRet}便を除外）` : ''}`);
    }
    if (dz === 5) return g;
    // ---- 会社をまたぐ乗継（同じアライアンス内）。日本→玄関ハブ（ANA 直行や提携長距離便）→現地の提携会社で目的地へ。現地ハブを挟む 3 区間も ----
    const codes = new Set(G.ana ? (D.starCodes || []) : (D.owCodes || []));
    const okOp = l => codes.has(opOf(l)) && opOf(l) !== 'VN'; // ベトナム航空は他社と混在不可
    const jpO = uniq([...R.oAps, ...cfgs.flatMap(c => c.jp)]), jpF = uniq([...R.fAps, ...cfgs.flatMap(c => c.jp)]);
    const hubs = R.hubsAll, regional = R.regional;
    const mixedOut = [], mixedRet = [];
    if (doOut) {
      const a1 = L1.filter(l => okOp(l) && jpO.includes(l.o) && hubs.includes(l.d));
      const a2 = L2.filter(l => okOp(l) && hubs.includes(l.o) && R.dAps.includes(l.d));
      pairLegs(a1, a2, 72).forEach(c => { if (opOf(c.legs[0]) !== opOf(c.legs[1])) mixedOut.push(c); });
      if (regional.length) { const ab = L2b.filter(l => okOp(l) && hubs.includes(l.o) && regional.includes(l.d)); const a3 = L2.filter(l => okOp(l) && regional.includes(l.o) && R.dAps.includes(l.d)); mixedOut.push(...tripleLegs(a1.filter(l => !regional.includes(l.d)), ab, a3)); }
    }
    if (doRet) {
      const b1 = L3.filter(l => okOp(l) && R.dAps.includes(l.o) && hubs.includes(l.d));
      const b2 = L4.filter(l => okOp(l) && hubs.includes(l.o) && jpF.includes(l.d));
      pairLegs(b1, b2, 72).forEach(c => { if (opOf(c.legs[0]) !== opOf(c.legs[1])) mixedRet.push(c); });
      if (regional.length) { const bb = L3b.filter(l => okOp(l) && regional.includes(l.o) && hubs.includes(l.d)); const b0 = L3.filter(l => okOp(l) && R.dAps.includes(l.o) && regional.includes(l.d)); mixedRet.push(...tripleLegs(b0, bb, b2.filter(l => !regional.includes(l.o)))); }
    }
    // 会社の組合せ（例: NH→LH、NH→CM→CM）ごとに 1 行にまとめる
    const keyOf = c => c.legs.map(opOf).join('→');
    const groups = {};
    const add = (side, c) => { const k = keyOf(c); groups[k] = groups[k] || { ops: k.split('→'), out: [], ret: [], hubs: new Set() }; groups[k][side].push(c); c.legs.slice(0, -1).forEach(l => groups[k].hubs.add(l.d)); };
    mixedOut.forEach(c => add('out', c)); mixedRet.forEach(c => add('ret', c));
    const ruleM = cs => (G.ana ? anaRuleFilter(cs, q.dest, !R.ret) : cs);
    const mixed = Object.values(groups).map(m => {
      const outC = rankCombos(ruleM(m.out), R.dep, q.origin, 'out'), retC = rankCombos(ruleM(m.ret), R.ret || R.dep, q.final, 'ret');
      return { cfg: { c: m.ops.join('→'), ops: m.ops, hubs: [...m.hubs], mixed: true }, l1: [], l2: [], l3: [], l4: [], shortOut: 0, shortRet: 0, outC, retC };
    });
    const bestDist = p => Math.min(...[...p.outC.slice(0, 1), ...p.retC.slice(0, 1)].map(c => c.legs.reduce((t, l) => t + (l.dist || 0), 0)), Infinity);
    mixed.sort((x, y) => ((y.outC.length > 0) - (x.outC.length > 0)) || ((y.retC.length > 0) - (x.retC.length > 0)) || (bestDist(x) - bestDist(y)));
    mixed.splice(8);
    mixed.forEach(p => g.partners.push(p));
    if (mixed.length) log(`会社をまたぐ乗継: ${mixed.map(p => `${rowName(p.cfg)} 往路${p.outC.length}・復路${p.retC.length}`).join(' / ')}`);
    else log('会社をまたぐ乗継: 組合せなし');
    return g;
  }
  // 行の表示名: 単独会社は会社名、会社をまたぐ場合は「ANA → コパ航空」のように矢印でつなぐ（同じ会社が続けば 1 回）
  const rowName = cfg => (cfg.mixed ? uniq(cfg.ops).map(cname).join(' → ') : cname(cfg.c));
  // ハブ名の表示（4 つ以上は先頭 3 つ＋ほか）
  const hubLabel = (cfg, sep = '／', p) => {
    if (cfg.mixed && p) { // 会社をまたぐ乗継は、最上位候補の経由地を順番どおりに（例: ロサンゼルス → パナマシティ）
      const best = p.outC[0] || p.retC[0]; if (best) { const path = uniq(best.legs.slice(0, -1).map(l => n(cityOfAp(l.d)))); const others = uniq([...p.outC, ...p.retC].map(c => c.legs.slice(0, -1).map(l => cityOfAp(l.d)).join('>'))).length - 1; return `${path.map(esc).join(' → ')}${others > 0 ? ` ほか${others}通り` : ''}`; }
    }
    const names = uniq(cfg.hubs.map(x => n(cityOfAp(x)))); return names.length > 3 ? `${names.slice(0, 3).map(esc).join(sep)} ほか${names.length - 3}` : names.map(esc).join(sep);
  };
  const groupHas = (g, side) => (g.direct && g.direct[side].length > 0) || g.partners.some(p => (side === 'out' ? p.outC : p.retC).length > 0);
  // どこで詰まっているかを 1 行で（ルールのみ）
  function groupSummary(g) {
    const parts = [];
    g.sides.forEach(side => {
      const label = SIDE_LABEL[side];
      const direct = g.direct && g.direct[side].length ? `${cname(g.direct.cfg.c)} 直行` : '';
      const allNg = combos => combos.length && combos.every(c => c.legs.some(l => chanceOf(l, g.alliance === 'ow').k === 'ng'));
      const withC = g.partners.filter(p => (side === 'out' ? p.outC : p.retC).length);
      const okP = withC.filter(p => !p.cfg.mixed).map(p => `${rowName(p.cfg)} ${hubLabel(p.cfg, '/', p)}経由${p.cfg.c === 'VN' ? '（参考）' : allNg(side === 'out' ? p.outC : p.retC) ? '（自社会員枠のみ・要確認）' : ''}`);
      const mixedN = withC.filter(p => p.cfg.mixed).length; if (mixedN) okP.push(`会社をまたぐ乗継 ${mixedN} 通り（表の下の方）`); // 混在は長くなるので件数だけ
      const shortN = (g.direct ? (side === 'out' ? g.direct.shortOut : g.direct.shortRet) : 0) + g.partners.reduce((s, p) => s + (side === 'out' ? p.shortOut : p.shortRet), 0);
      const tail = shortN ? `（${paxN()}人分に満たない便 ${shortN}件は除外）` : '';
      if (direct || okP.length) { parts.push({ ok: true, t: `${label}: ${[direct, ...okP].filter(Boolean).join('・')} で組める${tail}` }); return; }
      // 会社ごとに「どの区間が空か」を見て、理由をまとめる
      const jp = p => (side === 'out' ? p.l1 : p.l4), far = p => (side === 'out' ? p.l2 : p.l3);
      const P = g.partners.filter(p => !p.cfg.mixed); const names = arr => arr.map(p => cname(p.cfg.c)).join('・');
      const A = P.filter(p => !jp(p).length && far(p).length);   // 長距離区間だけ空きなし
      const B = P.filter(p => jp(p).length && !far(p).length);   // ハブ⇄目的地だけ空きなし
      const C = P.filter(p => jp(p).length && far(p).length);    // 両方あるのに乗継がつながらない
      const why = [];
      if (!P.length) why.push(g.direct ? '直行便に空きなし' : '対象の航空会社がありません');
      if (A.length) why.push(`日本⇄ハブの長距離区間に空きなし（${names(A)}はハブ⇄目的地側が空いている）`);
      if (B.length) why.push(`${names(B)}は日本⇄ハブは空いているがハブ⇄目的地に空きなし`);
      if (C.length) why.push(`${names(C)}は便はあるが同じハブで 1.5〜72 時間の乗継がつながらない`);
      if (P.length && !why.length) why.push('全区間で空きなし');
      parts.push({ ok: false, t: `${label}: 組める候補なし。${why.join('。')}${tail}` });
    });
    return parts;
  }
  async function liveSearch() {
    const q = S.q; const dep = S.dates['q.dep'] || '', ret = S.dates['q.ret'] || '';
    if (!q.dest || !dep) { LIVE.status = 'error'; LIVE.msg = '目的地と出発希望日を入れてください（帰国日があれば復路も探します）'; render(); return; }
    if (LIVE.status === 'running') return;
    if (dep < todayISO() || (ret && ret < dep)) { LIVE.status = 'error'; LIVE.msg = '出発日は今日以降、帰国日は出発日以降を選んでください。'; render(); return; }
    LIVE.status = 'running'; LIVE.log = []; LIVE.results = { groups: [], cabin: S.cabin }; LIVE.calls = 0; LIVE.msg = ''; render();
    const log = t => { LIVE.log.push(t); render(); };
    const fallback = S.settings.liveFallbackY !== false && S.cabin !== 'Y';
    const sidesAll = ret ? ['out', 'ret'] : ['out'];
    try {
      const cabins = fallback ? uniq([S.cabin, 'Y']) : [S.cabin];
      log(`seats.aero に問い合わせ（${cabins.map(c => CABINS[c]).join('・')}、全社まとめて ${ret ? 4 : 2} 区間。1,000 件を超える区間はページ送りで数回に分かれます）`);
      const R = await fetchLegs(cabins, !!S.settings.liveOW, log);
      log(`取得完了（API ${LIVE.calls}回）。航空会社ごとに振り分け…`);
      const alliances = ['star']; if (S.settings.liveOW) alliances.push('ow');
      for (const al of alliances) {
        log(`── ${LIVE_GROUPS[al].label}・${CABINS[S.cabin]}`);
        const g = buildGroup(al, S.cabin, sidesAll, R, log); LIVE.results.groups.push(g);
        if (fallback) {
          const lack = sidesAll.filter(sd => !groupHas(g, sd));
          if (lack.length) {
            log(`── ${LIVE_GROUPS[al].label}・エコノミー（${lack.map(sd => SIDE_LABEL[sd]).join('・')}）`);
            const g2 = buildGroup(al, 'Y', lack, R, log); g2.fallback = true; LIVE.results.groups.push(g2);
          }
        }
      }
      LIVE.status = 'done'; log(`完了（API呼び出し ${LIVE.calls}回）`);
    } catch (e) {
      LIVE.status = 'error';
      const m = String(e.message || e);
      if (/429|rate_limit/i.test(m)) { S.apiRemaining = { day: utcDay(), n: 0 }; save(); }
      LIVE.msg = /429|rate_limit/i.test(m) ? 'seats.aero の API 上限（HTTP 429）。1 日 1,000 回の枠を使い切った可能性が高く、UTC 0 時（日本時間 朝 9 時）にリセットされます。この枠は seats.aero に接続した他のアプリ（MCP など）とも共有です。ここまでに取れた結果は下に残しています。' : m;
      render();
    }
  }
  // 便の発着表示: 「東京（羽田 HND）」「ミラノ（マルペンサ MXP）」「フランクフルト（FRA）」
  function apLabel(code) {
    const city = cityOfAp(code); const base = n(city).replace(/（.*?）/g, '').trim();
    const name = (D.airportNames || {})[code];
    const multi = (D.airports[city] || []).length > 1;
    if (name && (multi || name !== base)) return `${base}（${name} ${code}）`;
    return `${base}（${code}）`;
  }
  // 便ごとに seats.aero の該当日・該当区間を開くリンク
  const seatsUrl = (l, cabin) => `https://seats.aero/search?min_seats=${paxN()}&applicable_cabin=${CABIN_PARAM[cabin]}&date=${l.date}&origins=${l.o}&destinations=${l.d}&view=default`;
  // どのマイレージプログラムの在庫か（短縮表記）。JAL マイルで取れるのは jal に出ている便だけ
  const SRC_SHORT = { united: 'UA', aeroplan: 'AC', lifemiles: 'AV', flyingblue: 'AF', delta: 'DL', virginatlantic: 'VS', etihad: 'EY', american: 'AA', alaska: 'AS', qantas: 'QF', british: 'BA', finnair: 'AY', asiamiles: 'CX', jal: 'JAL', qatar: 'QR' };
  // JAL マイルで取れる見込み（ワンワールド表用）
  //  jal 在庫に出ている → 可 / jal が追跡する区間なのに出ていない → なし /
  //  jal が追跡しない区間（提携各社の便はほぼ全部）→ seats.aero に JAL 側データが無いので、他のワンワールド系プログラムの出方から推定:
  //    アラスカ以外のワンワールド系（AA/BA/QF/CX/AY/QR）にも出ていれば共通枠の可能性、アラスカだけなら JAL では出ない可能性が高い
  //  ただし運航会社自身のプログラム（QR 便の Qatar Avios、BA 便の BA など）は会員向け在庫なので提携枠の根拠にしない
  const OW_SHARED = { american: 'AA', british: 'BA', qantas: 'QF', asiamiles: 'CX', finnair: 'AY', qatar: 'QR' };
  function jalChance(l) {
    const srcs = l.srcs || []; const op = (l.fn || '').slice(0, 2);
    if (srcs.includes('jal')) return { k: 'ok', t: 'JAL可（JAL在庫）' };
    // JAL 運航便: seats.aero の JAL 在庫は現状データが空（2026-10 時点で全路線 0 件）なので「なし」とは言えない。
    // 提携プログラムに出ている＝JAL が提携枠を開放している便で、JAL 会員は基本マイルか PLUS（追加マイル）で取れる
    if (op === 'JL') return { k: 'maybe', t: 'JAL便・JALサイトで要確認（PLUS なら取れる見込み）' };
    const shared = srcs.filter(x => OW_SHARED[x] && OW_SHARED[x] !== op).length;
    if (shared >= 2) return { k: 'maybe', t: 'JAL要確認（共通枠の可能性）' };
    if (shared === 1) return { k: 'maybe', t: 'JAL要確認' };
    if (srcs.includes('alaska')) return { k: 'ng', t: 'AS/自社のみ・JAL不可の可能性大' };
    if (srcs.some(x => OW_SHARED[x] === op)) return { k: 'ng', t: '自社会員枠のみ・JAL不可の可能性大' };
    return { k: 'maybe', t: 'JAL要確認' };
  }
  // ANA マイルで取れる見込み（スターアライアンス表用）
  //  スターアライアンスの提携枠は各社共通なので、運航会社「以外」の提携プログラム（UA/AC/AV）に出ていれば ANA も見える。
  //  運航会社自身のプログラムにしか出ていない便（例: エアカナダ便が Aeroplan だけ）は会員向けの変動価格枠で、ANA には開放されていない可能性が高い
  const OWN_STAR = { united: 'UA', aeroplan: 'AC', lifemiles: 'AV' };
  function anaChance(l) {
    const srcs = l.srcs || []; const op = (l.fn || '').slice(0, 2);
    if (op === 'NH') return { k: 'ok', t: 'ANA便（会員枠はさらに広い）' };
    if (op === 'VN') return { k: 'maybe', t: 'ANAの枠とは別・要確認' };
    const shared = srcs.filter(x => OWN_STAR[x] && OWN_STAR[x] !== op).length;
    if (shared >= 1) return { k: 'ok', t: 'ANA可の見込み（提携枠）' };
    if (srcs.some(x => OWN_STAR[x] === op)) return { k: 'ng', t: '自社会員枠のみ・ANA不可の可能性大' };
    return { k: 'maybe', t: 'ANA要確認' };
  }
  const chanceOf = (l, ow) => (ow ? jalChance(l) : anaChance(l));
  const srcBadges = (l, ow) => { const srcs = l.srcs || []; if (!srcs.length) return ''; const jc = chanceOf(l, ow); return `<span class="srcs ${jc.k}" title="在庫が出ているプログラム: ${esc(srcs.join(', '))}">${srcs.map(x => esc(SRC_SHORT[x] || x)).join('/')}・${esc(jc.t)}</span>`; };
  // データの鮮度: seats.aero のキャッシュが最後に更新された時刻からの経過
  const ageOf = l => { const t = Date.parse(l.upd || ''); return isNaN(t) ? null : (Date.now() - t) / 3600000; };
  const ageBadge = l => { const h = ageOf(l); if (h == null) return ''; const txt = h < 1 ? '1時間以内' : h < 24 ? `${Math.round(h)}時間前` : `${Math.round(h / 24)}日前`; const cls = h >= 72 ? 'old' : h >= 24 ? 'mid' : ''; return `<span class="age ${cls}" title="seats.aero がこの空席を最後に確認してからの経過時間">${txt}${h >= 72 ? '・要確認' : ''}</span>`; };
  const isVN = l => /^VN/.test(l.fn);
  // 候補の便を表で出す。1 行＝1 便。乗継候補は 2 行＋乗継時間の行
  const LEG_HEAD = `<thead><tr><th>日付</th><th>便名</th><th>出発</th><th>到着</th><th>残席</th><th>機材</th><th>在庫</th><th>最終確認</th><th></th></tr></thead>`;
  function legRow(l, cabin, ow, cls) {
    const a321 = /321/.test(l.ac) && /^(VN|BR)/.test(l.fn); const k = H.kind(l.date);
    const plus1 = l.arr.slice(0, 10) !== l.date ? '<sup>+1</sup>' : '';
    const vn = '';
    return `<tr class="${cls || ''}"><td class="d ${k}">${l.date.slice(5).replace('-', '/')}${esc(H.label(l.date)).replace('（', '(').replace('）', ')')}</td><td class="fn">${esc(l.fn)}</td><td><span class="t">${l.dep.slice(11, 16)}</span><br><span class="ap">${esc(apLabel(l.o))}</span></td><td><span class="t">${l.arr.slice(11, 16)}${plus1}</span><br><span class="ap">${esc(apLabel(l.d))}</span></td><td class="seat"><span>${l.seats || '?'}席</span></td><td class="ac">${esc((l.ac || '').replace('Airbus ', '').replace('Boeing ', ''))}${a321 ? ' <span class="ac321">⚠A321</span>' : ''}</td><td>${srcBadges(l, ow)}${vn}</td><td>${ageBadge(l)}</td><td><a class="ext" href="${seatsUrl(l, cabin)}" target="_blank" rel="noopener">seats.aero</a></td></tr>`;
  }
  const legTable = (legs, cabin, ow) => `<table class="legs">${LEG_HEAD}<tbody>${legs.map(l => legRow(l, cabin, ow)).join('')}</tbody></table>`;
  function comboTable(combos, cabin, ow) {
    const rows = combos.map(c => {
      let h = '';
      c.legs.forEach((l, i) => {
        h += legRow(l, cabin, ow, i === 0 ? 'combo-start' : '');
        if (i < c.legs.length - 1) {
          const nx = c.legs[i + 1]; const gap = c.gaps ? c.gaps[i] : c.gapH; const hub = apLabel(l.d);
          const move = cityOfAp(l.d) === cityOfAp(nx.o) && l.d !== nx.o ? `（${esc(apLabel(nx.o))} へ空港移動）` : '';
          const chg = opOf(l) !== opOf(nx) ? `・${esc(cname(opOf(nx)))}に乗り換え` : '';
          h += `<tr class="gaprow"><td colspan="9" class="${gap > 24 ? 'stop' : ''}">↳ ${esc(hub)}で乗継 ${gap.toFixed(1)} 時間${gap > 24 ? '　★ストップオーバー（24時間超）' : ''}${chg}${move}</td></tr>`;
        }
      });
      // 予約サイトの「複数都市」画面に入れる区間（各便を 1 区間として順に入力。往復なら復路の便を続けて区間に追加）
      const who = ow ? 'JAL' : 'ANA';
      const segs = c.legs.map((l, i) => `${'①②③④⑤⑥'[i] || (i + 1)} ${esc(n(cityOfAp(l.o)).replace(/（.*?）/g, ''))}(${esc(l.o)}) → ${esc(n(cityOfAp(l.d)).replace(/（.*?）/g, ''))}(${esc(l.d)}) ${l.date.slice(5).replace('-', '/')}`).join('　');
      const cf = confidence(c, ow);
      const sureTxt = `<span class="grade g${cf.grade === '◎' ? 'a' : cf.grade === '○' ? 'b' : 'c'}" title="${esc(cf.why)}">取れそう度 ${cf.grade}</span><span class="muted">（${esc(cf.why)}）</span>　`;
      const fuelTxt = `${sureTxt}<span class="fuelest ${fuelOf(c) === 0 ? 'zero' : ''}">燃油目安 ${fuelOf(c) === 0 ? '0 円' : `約¥${fmt(fuelOf(c))}`}/人（この片道）</span>　`;
      h += `<tr class="gaprow inputrow"><td colspan="9">${fuelTxt}${who} の複数都市画面に入れる区間: ${segs}${c.legs.length > 1 ? `　<span class="muted">（${c.legs.length} 区間とも同じ画面で指定。往復なら復路の便を区間 ${c.legs.length + 1} 以降に続ける）</span>` : ''}</td></tr>`;
      return h;
    }).join('');
    return `<table class="legs">${LEG_HEAD}<tbody>${rows}</tbody></table>`;
  }
  function renderGroup(g, gi) {
    const q = S.q;
    const a = quickAnalysis(g.cabin); const G = LIVE_GROUPS[g.alliance]; const hasOut = g.sides.includes('out'), hasRet = g.sides.includes('ret');
    const ok = () => `<span class="mark ok">○</span>`, ng = `<span class="mark ng">×</span>`, na = `<span class="mark na">—</span>`;
    const days = arr => uniq(arr.map(x => (x.legs ? x.legs[0].date : x.date))).length; // 候補のある出発日の数
    const cell = (has, arr) => (has ? (arr.length ? `${ok()}候補日 ${days(arr)}<span class="muted" style="font-weight:400;font-size:11px">（${arr.length}通り）</span>` : ng) : na);
    const fuelAsOf = (charts().anaFuel || D.anaFuel || {}).asOf || '';
    const fuelCell = c => {
      if (!G.ana) return '—';
      if (c === 'NH') return a.fuelRT != null ? `約¥${fmt(a.fuelRT)}<div class="muted" style="font-size:11px">${esc(fuelAsOf)}</div>` : '—';
      const fx = D.carriers[c] ? D.carriers[c].fuel : 'yes'; const ref = (D.fuelRef || {})[c] || '';
      return `${fx === 'no' ? '0円' : fx === 'jp-only' ? 'あり（日本発着区間）' : 'あり'}<div class="muted" style="font-size:11px">${esc(ref)}</div>`;
    };
    // マイル列: スタアラは ANA チャート、ワンワールドは JAL チャート（JAL 便=路線別基本マイル、提携=総旅程距離制）
    const JKEY = { Y: 'Y', PY: 'PY', C: 'J', F: 'F' }[g.cabin];
    const jalDirectCell = () => {
      const jc = charts().jalChart || D.jalChart; const r = jc && jc.jalRoute[S.q.dest]; if (!r) return '—';
      let v = r[JKEY]; if (Array.isArray(v)) v = v[{ L: 0, R: 1, H: 2 }[a.sDep || 'R']]; if (v == null) return '—';
      return `${fmt(v * (a.ret ? 2 : 1))}<div class="muted" style="font-size:11px">JAL 基本マイル・${a.ret ? '往復' : '片道'}（PLUS だと増える）${r.note ? '・' + esc(r.note) : ''}</div>`;
    };
    const jalPartnerCell = p => {
      const jc = charts().jalChart || D.jalChart; const o = p.outC[0], r = p.retC[0];
      const legs = [...(o ? o.legs : []), ...(r ? r.legs : [])]; const dist = legs.reduce((t, l) => t + (l.dist || 0), 0);
      if (!jc || !dist) return '—';
      const band = arr => arr.find(([max]) => dist <= max); const pb = band(jc.partnerBands), ob = band(jc.oneworldBands);
      const v1 = pb ? pb[1][JKEY] : null, v2 = ob ? ob[1][JKEY] : null;
      return `${v1 != null ? fmt(v1) : '—'}<div class="muted" style="font-size:11px">JMB提携・${o && r ? '往復' : '片道'}・総距離 ${fmt(dist)}mi${v2 != null ? `／2社以上なら ${fmt(v2)}` : ''}</div>`;
    };
    const milesCell = (isDirect, p) => (G.ana ? (isDirect ? (a.anaMiles != null ? fmt(a.anaMiles) : '—') : (a.pMiles != null ? fmt(a.pMiles) : '—')) : (isDirect ? jalDirectCell() : jalPartnerCell(p)));
    // ワンワールド: JAL の在庫（source=jal）に出ている組合せの数。これが 0 なら JAL マイルでは予約できない可能性が高い
    const comboKinds = combos => combos.map(c => { const ks = c.legs.map(l => chanceOf(l, !G.ana).k); return ks.includes('ng') ? 'ng' : ks.every(k => k === 'ok') ? 'ok' : 'maybe'; });
    const jalNote = (combos) => {
      if (!combos.length) return ''; const ks = comboKinds(combos); const ok = ks.filter(k => k === 'ok').length, maybe = ks.filter(k => k === 'maybe').length;
      const who = G.ana ? 'ANA' : 'JAL';
      const t = ok ? `${who}可の見込み ${ok}通り` : maybe ? `${who}要確認 ${maybe}通り` : `${who}不可の可能性大`;
      return `<div class="muted jalnote ${ok ? 'ok' : maybe ? 'maybe' : 'ng'}" style="font-size:11px">${t}</div>`;
    };
    // グループごとに枠で囲み、クラス（ビジネス／エコノミー）とアライアンスを色付きの見出し帯で示す
    const cabCls = { Y: 'cab-y', PY: 'cab-py', C: 'cab-c', F: 'cab-f' }[g.cabin] || 'cab-y';
    let h = `<section class="grp ${cabCls} ${G.ana ? 'al-star' : 'al-ow'}"><div class="grp-head"><span class="cab-badge">${esc(CABINS[g.cabin])}</span><span class="al-badge">${esc(G.label)}</span>${g.fallback ? `<span class="grp-note">${esc(CABINS[LIVE.results.cabin])}が無かったので${g.sides.length < (S.dates['q.ret'] ? 2 : 1) ? `${g.sides.map(s => SIDE_LABEL[s]).join('・')}だけ` : ''}エコノミーで再探索</span>` : ''}</div><div class="grp-body">`;
    groupSummary(g).forEach(s => { h += msg(s.ok ? 'ok' : 'warn', s.t); });
    if (sureMode() && g.partners.some(p => p.outC.length || p.retC.length)) h += `<div class="msg info">取れそう度モード: 3 日以上前のデータの便と、運航会社の会員枠にしか出ていない便を除いてから乗継を組んでいます（要約の「空きなし」もその前提）。残った候補は「最終確認の新しさ」「提携枠に出ているか」「残席の余裕」「複数プログラムに出ているか」を点数化し、いちばん弱い便で評価して高い順に並べています。◎＝全便が提携枠で 24 時間以内に確認、○＝要確認の便あり、△＝会員枠のみの便か 3 日以上前のデータ。${fuelSaver() ? '燃油節約モードも ON のため、燃油が安い順の中で取れそうな順になります。' : ''}</div>`;
    if (fuelSaver() && g.partners.some(p => p.outC.length || p.retC.length)) h += `<div class="msg info">燃油節約モード: 各候補に燃油の目安（運航会社の燃油設定と区間から見積もり。ANA 便と UA の日本発着区間は ANA 公式表、SQ・VN・NZ・コパ・アビアンカ・エチオピアは 0 円、その他は会社ごとの係数）を付け、安い順に並べています。正確な額は ANA サイトの「税金・料金等」で確認してください。</div>`;
    h += `<table class="sum" style="margin-top:6px"><thead><tr><th>航空会社</th><th>往路 <span class="muted" style="font-weight:400">候補日の数（往路ありを先に）</span></th><th>復路 <span class="muted" style="font-weight:400">候補日の数</span></th><th>${G.ana ? 'ANAマイル（往復参考）' : 'JALマイル'}</th><th>燃油</th><th></th></tr></thead><tbody>`;
    if (g.direct) {
      const o = g.direct.out.length, r = g.direct.ret.length;
      h += `<tr class="${(o || r) ? 'full' : ''}"><td><b>${esc(cname(g.direct.cfg.c))} 直行</b></td><td>${cell(hasOut, g.direct.out)}</td><td>${cell(hasRet, g.direct.ret)}</td><td>${milesCell(true)}</td><td>${fuelCell(g.direct.cfg.c)}</td><td>${(o || r) ? `<a href="#live-${gi}-direct" class="muted">詳細</a>` : ''}</td></tr>`;
    }
    const bestFuel = p => { const o = p.outC[0] ? fuelOf(p.outC[0]) : 0, r = p.retC[0] ? fuelOf(p.retC[0]) : 0; return o + r; };
    const bestScore = p => Math.max(...[p.outC[0], p.retC[0]].filter(Boolean).map(c => confidence(c, !G.ana).score), -99);
    // 並び順: 往路に候補がある会社を最優先（予約は往路から取るため）→ 復路もある → 燃油／取れそう度 → 件数
    const parts = g.partners.slice().sort((x, y) => ((y.outC.length > 0) - (x.outC.length > 0)) || ((y.retC.length > 0) - (x.retC.length > 0)) || (fuelSaver() ? (bestFuel(x) - bestFuel(y)) : 0) || (sureMode() ? (bestScore(y) - bestScore(x)) : 0) || (y.outC.length + y.retC.length) - (x.outC.length + x.retC.length));
    const gradeNote = combos => { if (!sureMode() || !combos.length) return ''; const cf = confidence(combos[0], !G.ana); return `<div class="grade g${cf.grade === '◎' ? 'a' : cf.grade === '○' ? 'b' : 'c'}" style="font-size:11px" title="${esc(cf.why)}">${cf.grade} ${esc(cf.why)}</div>`; };
    const fuelBest = p => { if (!fuelSaver() || !(p.outC.length || p.retC.length)) return ''; const parts2 = []; if (p.outC[0]) parts2.push(`往路 ${fuelOf(p.outC[0]) === 0 ? '0円' : '約¥' + fmt(fuelOf(p.outC[0]))}`); if (p.retC[0]) parts2.push(`復路 ${fuelOf(p.retC[0]) === 0 ? '0円' : '約¥' + fmt(fuelOf(p.retC[0]))}`); return `<div class="fuelest ${bestFuel(p) === 0 ? 'zero' : ''}" style="font-size:12px">最安候補: ${parts2.join('／')}</div>`; };
    parts.forEach(p => {
      const pi = g.partners.indexOf(p); const okOut = p.outC.length > 0, okRet = p.retC.length > 0; const full = (okOut || !hasOut) && (okRet || !hasRet) && (okOut || okRet);
      h += `<tr class="${full ? 'full' : ''}"><td>${esc(rowName(p.cfg))}${p.cfg.c === 'VN' ? ' <span class="muted" style="font-size:11px">参考</span>' : ''}${p.cfg.mixed ? ' <span class="muted" style="font-size:11px">会社をまたぐ乗継</span>' : ''}<div class="muted" style="font-size:11px">${hubLabel(p.cfg, '／', p)}経由${!p.cfg.mixed && D.carriers[p.cfg.c] && D.carriers[p.cfg.c].fuel === 'no' ? '・燃油0' : ''}${p.cfg.c === 'VN' ? '<br>Flying Blue 等の在庫。ANA の枠は別なので ANA サイトで要確認' : ''}</div></td><td>${cell(hasOut, p.outC)}${jalNote(p.outC)}${gradeNote(p.outC)}</td><td>${cell(hasRet, p.retC)}${jalNote(p.retC)}${gradeNote(p.retC)}</td><td>${milesCell(false, p)}</td><td>${fuelBest(p)}${p.cfg.mixed ? uniq(p.cfg.ops).map(c => `<div style="font-size:12px">${esc(cname(c))}: ${fuelCell(c)}</div>`).join('') : fuelCell(p.cfg.c)}</td><td>${(okOut || okRet) ? `<a href="#live-${gi}-${pi}" class="muted">詳細</a>` : ''}</td></tr>`;
    });
    h += `</tbody></table>`;
    if (g.direct && (g.direct.out.length || g.direct.ret.length)) {
      h += `<details id="live-${gi}-direct" style="margin-top:10px" open><summary><b>${esc(cname(g.direct.cfg.c))} 直行</b> の便</summary>${g.direct.out.length ? `<div class="sidebox out"><div class="sidehead">往路 <span>${esc(n(q.origin).replace(/（.*?）/g, ''))} → ${esc(n(q.dest).replace(/（.*?）/g, ''))}</span></div>${legTable(g.direct.out.slice(0, 8), g.cabin, !G.ana)}</div>` : ''}${g.direct.ret.length ? `<div class="sidebox ret"><div class="sidehead">復路 <span>${esc(n(q.dest).replace(/（.*?）/g, ''))} → ${esc(n(q.final).replace(/（.*?）/g, ''))}</span></div>${legTable(g.direct.ret.slice(0, 8), g.cabin, !G.ana)}</div>` : ''}</details>`;
    }
    parts.filter(p => p.outC.length || p.retC.length).forEach((p, idx) => {
      const pi = g.partners.indexOf(p);
      h += `<details id="live-${gi}-${pi}" style="margin-top:8px" ${idx === 0 ? 'open' : ''}><summary><b>${esc(rowName(p.cfg))}</b> の候補${p.cfg.mixed ? ' <span class="muted" style="font-weight:400;font-size:12px">（会社をまたぐ乗継）</span>' : ''}</summary>`;
      if (p.outC.length) h += `<div class="sidebox out"><div class="sidehead">往路 <span>${esc(n(q.origin).replace(/（.*?）/g, ''))} → ${esc(n(q.dest).replace(/（.*?）/g, ''))}・上位 ${Math.min(3, p.outC.length)} 件</span></div>` + comboTable(p.outC.slice(0, 3), g.cabin, !G.ana) + `</div>`;
      if (p.retC.length) h += `<div class="sidebox ret"><div class="sidehead">復路 <span>${esc(n(q.dest).replace(/（.*?）/g, ''))} → ${esc(n(q.final).replace(/（.*?）/g, ''))}・上位 ${Math.min(3, p.retC.length)} 件</span></div>` + comboTable(p.retC.slice(0, 3), g.cabin, !G.ana) + `</div>`;
      h += `</details>`;
    });
    if (G.ana && g.partners.some(p => p.outC.length || p.retC.length)) {
      const bothStop = g.partners.filter(p => p.outC.length && p.retC.length && p.outC.every(c => c.stop) && p.retC.every(c => c.stop)).map(p => rowName(p.cfg));
      h += `<p class="muted" style="margin-top:6px;font-size:12px"><b>ANA 提携特典のルール</b>（2025年6月24日以降の発券分）: スターアライアンス各社と ANA は 1 つの旅程に自由に組み合わせ可。乗換は海外で往路・復路各 2 回、日本国内で各 1 回（国内線は ANA 便のみ）まで。途中降機（24 時間超＝★）は往復で目的地以外に 1 回だけ、片道旅程では不可。乗換地点を目的地より必要マイルの高いゾーンにはできない。クラス混在可（往路・復路それぞれ上位クラスのマイル）。ここに出る候補はこれらで絞ってあります。${bothStop.length ? `<br><b>注意:</b> ${esc(bothStop.join('・'))} は往路・復路とも★になる候補しか無いので、どちらかを 24 時間以内の乗継に変える必要があります。` : ''}</p>`;
      h += `<p class="muted" style="margin-top:6px;font-size:12px"><b>ANA マイルで取れるかの見込み</b>: スターアライアンスの提携枠は各社共通なので、運航会社以外の提携プログラム（UA・AC・AV）にも出ている便は ANA でも見える見込みです。運航会社自身のプログラムにしか出ていない便（例: エアカナダ便が Aeroplan だけ、ユナイテッド便が United だけ）は会員向けの変動価格枠で、ANA のサイトでは出ないことが多いです。最終確認は ANA サイトで。</p>`;
    }
    if (!G.ana && g.partners.some(p => p.outC.length || p.retC.length)) h += `<p class="muted" style="margin-top:6px;font-size:12px"><b>JAL マイルで取れるかの見込み</b>: seats.aero の JAL 在庫は現状ほぼ空（JAL 便は PLUS で常に「空席あり」になるため）なので、他プログラムの出方から推定しています。JAL 運航便は提携各社に出ていれば JAL 会員も基本マイルか PLUS で取れる見込みです。「JAL要確認」は AA・BA・カンタス・キャセイ・フィンエアー・カタール Avios など複数のワンワールド系に出ている共通枠で、JAL でも出る可能性があります。「AS/自社のみ」はアラスカと運航会社自身の会員向けにしか出ていない枠で、JAL では出ない可能性が高いです（カタール航空に多い）。最終確認は JAL サイトで。</p><p class="help muted" style="margin-top:6px">ワンワールド各社は ANA マイルでは予約できません。マイル列は JAL マイルの目安です（JAL 便は路線別の基本マイル、提携各社は総旅程距離制。1 社だけなら JMB 提携航空会社特典、JAL 国内線など 2 社以上を組み合わせるとワンワールド特典のチャート）。BA Avios・カタール Avios・アラスカなど他のワンワールド系マイルでも予約できます。</p>`;
    return h + `</div></section>`;
  }
  // 本日の API 使用状況（この端末の回数。seats.aero が残回数を返せばそれを表示）
  function usageHtml() {
    const used = apiUsedToday(), rem = apiRemaining();
    const warn = rem != null ? rem < 100 : used > API_LIMIT * 0.8;
    const text = rem != null ? (rem === 0 ? '本日の上限（1,000 回）に到達。日本時間 朝 9 時にリセット' : `本日の残り 約${rem.toLocaleString('ja-JP')} 回（この端末の使用 ${used} 回）`) : `本日この端末から ${used} 回 / ${API_LIMIT.toLocaleString('ja-JP')} 回（他アプリの分は含まず。日本時間 朝 9 時リセット）`;
    return `<span class="usage ${warn ? 'warn' : ''}">${esc(text)}</span>`;
  }
  function renderLive() {
    const R = LIVE.results;
    const w = S.settings.window == null ? 6 : S.settings.window;
    let h = `${proxyInfo && proxyInfo.mock ? msg('warn', '動作確認用のサンプルデータです。実際の空席ではありません。') : ''}<div class="card"><h2>空席を探す <span class="muted" style="font-weight:400;font-size:12px">seats.aero のデータ・便名/時刻/残席つき</span></h2>
      <p class="help muted">ANA 直行便を先に調べ、次にスターアライアンス各社とベトナム航空のハブ経由を組みます。さらに「日本→地域の玄関ハブ（ANA 直行や提携長距離便）→現地の提携会社で目的地へ」という会社をまたぐ乗継（現地ハブを挟む 3 区間を含む。海外乗継 2 回まで）も組みます。希望日の前後${esc(String(w))}日、同じハブで 1.5〜72 時間（24 時間超は★）でつながり、<b>${esc(String(paxN()))}人分の席がある</b>組合せだけを出します。往路・復路の「○ 3日」は候補のある出発日の数、「燃油」は ANA 便は公式表（1区間×往復）、他社便は有無と実例ベースの目安です。各便の「seats.aero」リンクでその日・その区間を seats.aero 上で開けます。全社・全クラスをまとめて問い合わせるので、1 回の探索で使う API は往復 4〜6 回（片道 2〜3 回。件数が多いとページ送りで増える）です。上限は 1 日 1,000 回（UTC 0 時＝日本時間 朝 9 時リセット）です。往路か復路の日付だけ変えて再検索すると、変えていない側は前回の取得結果（6 時間以内）を再利用するので API はその側の分だけで済みます。</p>
      <div class="row chks">
        ${S.cabin === 'Y' ? `<span class="muted" style="font-size:12px">エコノミーで探します（上位クラスの再探索はありません）</span>` : `<label><input type="checkbox" data-k="settings.liveFallbackY" ${S.settings.liveFallbackY !== false ? 'checked' : ''}> ${esc(CABINS[S.cabin])}が無ければエコノミーも探す</label>`}
        <label><input type="checkbox" data-k="settings.liveOW" ${S.settings.liveOW ? 'checked' : ''}> 参考: ワンワールド系も見る</label>
        <label><input type="checkbox" data-k="settings.liveFuelSaver" ${S.settings.liveFuelSaver ? 'checked' : ''}> 燃油サーチャージを減らす</label>
        <label><input type="checkbox" data-k="settings.liveSure" ${S.settings.liveSure ? 'checked' : ''}> 取れそうな便だけで組む</label>
        <label>希望日の前後 <input type="number" min="0" max="14" data-k="settings.window" value="${esc(String(w))}" style="width:56px"> 日</label>
      </div>
      <div class="help option-help">
        <h3>検索オプションの使い方</h3>
        <dl>
          ${S.cabin !== 'Y' ? `<dt>${esc(CABINS[S.cabin])}が無ければエコノミーも探す</dt><dd>希望クラスの候補が見つからない場合、候補のない往路・復路だけエコノミーでも探します。片方に希望クラスの空席があれば、その候補は残します。日程を優先したいときに便利です。</dd>` : ''}
          <dt>参考: ワンワールド系も見る</dt><dd>JAL直行便や、カタール航空・フィンエアー・キャセイパシフィックなどの乗り継ぎ候補も別枠で表示します。他のマイレージも使える場合に、行き方や空席を比較できます。</dd>
          <dt>燃油サーチャージを減らす</dt><dd>便ごとの燃油サーチャージを見積もり、目安が安い候補を優先して並べます。乗り継ぎ回数や希望日への近さよりも燃油の安さを優先します。税金・空港使用料を含む総額ではないため、支払額は予約画面で確認してください。</dd>
          <dt>取れそうな便だけで組む</dt><dd>最終確認から72時間を超えた便と、運航会社の会員向けの枠しか確認できない便を除外します。そのうえで、データの新しさ・提携枠の有無・残席の余裕・複数プログラムへの掲載状況から候補を並べます。予約の成功を保証するものではなく、候補が少なければオフにして探し直せます。</dd>
        </dl>
        <p class="muted">「燃油サーチャージを減らす」と「取れそうな便だけで組む」を両方オンにすると、候補を絞ったうえで燃油の安さを優先し、同程度なら取れそうな順に表示します。</p>
      </div>
      <div class="row"><button class="btn primary" data-act="livesearch" ${apiStatus().ok && LIVE.status !== 'running' ? '' : 'disabled'}>${LIVE.status === 'running' ? `探索中… ${LIVE.calls}回` : '空席を探す'}</button>${LIVE.status === 'done' ? `<span class="muted">完了・API ${LIVE.calls}回${LIVE.reused.length ? `（${LIVE.reused.map(s => SIDE_LABEL[s]).join('・')}は前回の結果を再利用）` : ''}</span>${LIVE.reused.length ? `<button class="btn small" data-act="liverefresh">全部取り直す</button>` : ''}` : ''}${!apiStatus().ok ? `<span class="muted">${esc(apiStatus().label)}</span>` : ''}${apiStatus().ok ? usageHtml() : ''}</div>`;
    if (LIVE.status === 'error') h += msg('err', LIVE.msg);
    if (LIVE.log.length) h += `<details style="margin-top:6px"><summary class="muted" style="cursor:pointer;font-size:12px">探索ログ</summary><div class="progress">${LIVE.log.map(esc).join('\n')}</div></details>`;
    if (R && R.groups.length) {
      R.groups.forEach((g, gi) => { h += renderGroup(g, gi); });
      if (LIVE.status === 'done' && !R.groups.some(g => g.alliance === 'star' && groupHas(g, 'out'))) h += msg('info', 'ANA マイルで組める往路なし。前後の日数を広げる／日付を動かす／出発地を東京にする、で再探索。');
      h += `<p class="help muted" style="margin-top:8px">往路と復路で別の航空会社を組み合わせても可（ベトナム航空を含む旅程は全便ベトナム航空）。欧州内短距離のビジネスは各社とも通常座席。空席は seats.aero のキャッシュで、各便の「最終確認」は seats.aero がその空席を最後に確認した時刻からの経過です（3 日以上前は要確認）。ANA 会員だけに開放される ANA 便の枠は含まれません。ベトナム航空はスターアライアンス外で、ここに出るのは Flying Blue／デルタ等に開放された枠なので、ANA で取れるかは ANA サイトで確認してください。予約は ANA 公式サイトで。</p>`;
    }
    return h + `</div>`;
  }

  // ---------- tab: quick ----------
  function renderQuick() {
    const q = S.q; const a = quickAnalysis();
    let h = flashMsg ? msg('ok', flashMsg) : '';
    h += `<section class="intro"><span class="eyebrow">AWARD FLIGHT PLANNER</span><h2>マイルで、次の旅へ。</h2><p>行きたい場所と日程から、直行便も乗り継ぎも探せます。</p><div class="steps"><span>1. 行き先と日程を選ぶ</span><span>2. 空席の候補を探す</span><span>3. ANA公式で確認・予約</span></div></section>`;
    if (!apiStatus().ok) h += `<div class="card welcome"><div><h2>初めての方へ</h2><p class="muted">空席検索には合言葉、またはご自身の seats.aero APIキーが必要です。設定画面から入力してください。</p></div><button class="btn primary" data-act="openSettings">接続を設定する</button></div>`;
    h += `<div class="card"><h2>どこへ、いつ</h2>
      <p class="help muted">出発地・目的地・帰着地・クラス・人数と日程を入れて「空席を探す」を押すと、seats.aero のデータから ANA マイルで取れる便を組んで出します。</p>
      <div class="grid">
        <label class="f">出発地${citySelect('q.origin', q.origin, { jpOnly: true, allowBlank: false })}</label>
        <label class="f"><b>目的地</b>${citySelect('q.dest', q.dest, { intlOnly: true })}</label>
        <label class="f">帰着地${citySelect('q.final', q.final, { jpOnly: true, allowBlank: false })}</label>
        <label class="f">クラス${simpleSelect('cabin', S.cabin, CABINS)}</label>
        <label class="f">人数<input type="number" min="1" max="9" data-k="pax" value="${esc(S.pax)}"></label>
      </div>
      <div class="grid" style="margin-top:10px">
        <div><div class="muted" style="font-size:12px">出発日</div>${dateButton('q.dep', a.dep)}</div>
        <div><div class="muted" style="font-size:12px">帰国日（片道なら未選択）</div>${dateButton('q.ret', a.ret)}</div>
      </div></div>`;
    if (!q.dest) return h + `<div class="card">${msg('info', '目的地を選んでください。')}</div>`;

    h += msg('info', 'マイル数は1人分の往復参考値です（片道検索でも往復の値を表示）。シーズン・燃油を含め未検証の推定値があるため、予約時はANA公式で確認してください。');
    // 時期・必要マイル・直行便の有無
    h += `<div class="card"><div class="status-grid">`;
    h += `<div class="box"><div class="l">時期</div><div>${a.dep ? seasonTag(a.dep) : '<span class="muted">出発日を入れる</span>'}${a.ret && a.sRet !== a.sDep ? ` → ${seasonTag(a.ret)}` : ''}</div>${a.sDep === 'H' ? `<div class="muted" style="font-size:12px">ANA便は最も高い時期。他社便を1便入れると固定マイル</div>` : ''}</div>`;
    const fuelAsOf = (charts().anaFuel || D.anaFuel || {}).asOf || '';
    h += `<div class="box"><div class="l">ANA便のみ（往復参考）</div><div class="big">${fmt(a.anaMiles)}</div><div class="muted" style="font-size:12px">${esc(a.anaNote || (a.dep ? 'シーズン制' : ''))}</div>${a.fuelRT != null && charts().anaChart[a.dz] ? `<div class="muted" style="font-size:12px">燃油 約¥${fmt(a.fuelRT)}/人（${a.ret ? '往復' : '片道'}・${esc(fuelAsOf)}）</div>` : (charts().anaChart[a.dz] ? '' : '<div class="muted" style="font-size:12px">ANA 便の路線なし</div>')}</div>`;
    h += `<div class="box"><div class="l">他社便を含む（往復参考）</div><div class="big">${a.dz === 5 ? '不可' : fmt(a.pMiles)}</div><div class="muted" style="font-size:12px">${a.anaMiles != null && a.pMiles != null && a.anaMiles > a.pMiles ? `▲${fmt(a.anaMiles - a.pMiles)}` : '通年固定'}</div><div class="muted" style="font-size:12px">燃油は運航会社次第（SQ・VN は 0 円）</div></div>`;
    const direct = a.anaDirectFrom ? `<span class="mark ok">○</span> ${esc(n(q.origin))}発あり` : a.anaJP.length ? `<span class="mark na">△</span> ${a.anaJP.map(n).join('・')}発のみ（国内線を足せば同マイル）` : `<span class="mark ng">×</span> なし`;
    const others = a.othersFrom.length ? a.othersFrom.map(cname).join('・') : (a.others.length ? `他都市発: ${a.others.map(o => cname(o.c)).join('・')}` : 'なし');
    h += `<div class="box"><div class="l">ANA直行便</div><div>${direct}</div><div class="muted" style="font-size:12px">他社直行: ${esc(others)}</div></div>`;
    h += `</div></div>`;
    h += renderLive();
    return h;
  }

  const H = window.JPHolidays;
  const pad2 = x => String(x).padStart(2, '0');
  const todayISO = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
  function dateButton(key, iso) {
    const kind = iso ? H.kind(iso) : '';
    const text = iso ? `${iso} <span class="wd ${kind}">${esc(H.label(iso))}</span>${seasonTag(iso)}` : '<span class="wd">日付を選ぶ…</span>';
    return `<div class="row"><button class="datebtn" data-act="cal:${key}">${text}</button>${iso ? `<button class="btn small" data-act="calclear:${key}">×</button>` : ''}</div>` +
      (S._cal === key ? calendarHtml(key, iso) : '');
  }
  function calendarHtml(key, selected) {
    const ym = S._calMonth || (selected ? selected.slice(0, 7) : todayISO().slice(0, 7));
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1).getDay(); const days = new Date(y, m, 0).getDate(); const today = todayISO();
    let h = `<div class="cal"><div class="head"><button class="btn small" data-act="calnav:-1">‹</button><span>${y}年${m}月</span><button class="btn small" data-act="calnav:1">›</button></div><div class="grid7">`;
    H.WD.forEach((w, i) => { h += `<div class="wdh ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`; });
    for (let i = 0; i < first; i++) h += `<button class="day pad" tabindex="-1"></button>`;
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${pad2(m)}-${pad2(d)}`; const kind = H.kind(iso); const hn = H.name(y, m, d);
      const cls = ['day', kind, iso === selected ? 'sel' : '', iso === today ? 'today' : ''].filter(Boolean).join(' ');
      h += `<button class="${cls}" data-act="calpick:${key}:${iso}" title="${esc(hn || '')}">${d}</button>`;
    }
    h += `</div>`;
    const hol = H.monthList(y, m);
    if (hol.length) h += `<div class="hol">祝日: ${hol.map(x => `${m}/${x.day} ${esc(x.name)}`).join('　')}</div>`;
    // ANAシーズン区分（連続する同一シーズンをまとめて表示）
    const runs = []; for (let d = 1; d <= days; d++) { const s = seasonOf(`${y}-${pad2(m)}-${pad2(d)}`); const last = runs[runs.length - 1]; if (last && last.s === s) last.to = d; else runs.push({ s, from: d, to: d }); }
    h += `<div class="seasonline">ANAシーズン: ${runs.map(r => `${r.from === 1 && r.to === days ? '全日' : r.from === r.to ? `${r.from}日` : `${r.from}〜${r.to}日`}<span class="season ${r.s}">${SEASON_NAME[r.s]}</span>`).join('　')}</div>`;
    h += `<div class="legend">赤＝日曜・祝日　青＝土曜　●＝今日　シーズンはANA便のみに影響（提携便は通年固定）</div></div>`;
    return h;
  }

  // ---------- auto availability search (seats.aero Partner API) ----------
  const airportsOf = c => (D.airports[c] || [c]);
  const cityOfAirport = (() => { const m = {}; Object.keys(D.airports).forEach(c => D.airports[c].forEach(a => { m[a] = c; })); return a => m[a] || a; })();
  const CABIN_PARAM = { Y: 'economy', PY: 'premium', C: 'business', F: 'first' };
  let proxyInfo = null; // {ok, hasKey, mock}
  // 中継サーバー: 設定の「中継 URL」（Cloudflare Worker）があればそこへ、無ければ同じ場所の serve.py（./api）へ
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const proxyBase = () => isLocalHost ? '' : String(D.defaultProxyUrl || '').replace(/\/+$/, '');
  const proxyHeaders = () => S.settings.proxyToken ? { 'X-Proxy-Token': S.settings.proxyToken } : {};
  function probeProxy() {
    const base = proxyBase();
    const url = base ? base + '/api/ping' : './api/ping';
    return fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000), headers: base ? proxyHeaders() : {} }).then(async r => { const j = r.ok ? await r.json() : null; if (!r.ok && base) { const e = await r.json().catch(() => ({})); return { ok: false, status: r.status, error: e.error || ('HTTP ' + r.status), remote: true }; } return j; }).then(j => { proxyInfo = j; if (j && base) j.remote = true; }).catch(() => { proxyInfo = null; });
  }
  function apiStatus() {
    if (proxyBase()) {
      if (proxyInfo && proxyInfo.ok && proxyInfo.remote && proxyInfo.hasKey) return { ok: true, label: proxyInfo.mode === 'own-key' ? '中継サーバー経由・自分の seats.aero キー（自分の枠で検索）' : '中継サーバー経由・管理者のキー（合言葉）' };
      if (proxyInfo && proxyInfo.remote && proxyInfo.error) return { ok: false, label: `中継サーバーに接続できません: ${proxyInfo.error}` };
      if (proxyInfo && proxyInfo.remote) return { ok: false, label: '中継サーバーに API キーが登録されていません（wrangler secret put SEATS_AERO_KEY）' };
      return { ok: false, label: '検索を使うには、画面上の「設定」で自分の seats.aero API キーか、管理者からもらった合言葉を入れてください' };
    }
    if (proxyInfo && proxyInfo.mock) return { ok: true, label: 'ローカルサーバー（ダミー応答モード）' };
    if (proxyInfo && proxyInfo.hasKey) return { ok: true, label: 'ローカルサーバー経由（APIキー設定済）' };
    return { ok: false, label: proxyInfo ? 'APIキー未設定（serve.py に SEATS_AERO_KEY を渡すか、設定タブにキーを入力）' : 'seats.aero APIキー未設定（設定タブで入力、または serve.py で起動）' };
  }
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
  // seats.aero が残回数ヘッダーを返す場合はそれを優先して表示する（返さない場合はこの端末の回数のみ）
  function noteRemaining(headers) {
    const v = headers && (headers.get('x-ratelimit-remaining') || headers.get('ratelimit-remaining') || headers.get('x-rate-limit-remaining'));
    if (v != null && v !== '' && !isNaN(Number(v))) { S.apiRemaining = { day: utcDay(), n: Number(v) }; save(); }
  }
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const RETRY_WAIT = [5000, 15000, 30000]; // HTTP 429（レート制限）のときの待ち時間
  async function apiFetchOnce(qs) {
    if (proxyBase()) {
      const r = await fetch(proxyBase() + '/api/search?' + qs, { cache: 'no-store', signal: AbortSignal.timeout(30000), headers: proxyHeaders() }); const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (r.status === 401 && !isLocalHost) { proxyInfo = null; delete S.settings.proxyToken; save(); loginError = '合言葉が変更されています。新しい合言葉を入力してください。'; } const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
      noteRemaining(r.headers); return j;
    }
    if (proxyInfo && (proxyInfo.hasKey || proxyInfo.mock)) {
      const r = await fetch('./api/search?' + qs, { cache: 'no-store' }); const j = await r.json();
      if (!r.ok) { if (r.status === 401 && !isLocalHost) { proxyInfo = null; delete S.settings.proxyToken; save(); loginError = '合言葉が変更されています。新しい合言葉を入力してください。'; } const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
      noteRemaining(r.headers); return j;
    }
    throw new Error('中継サーバーに接続できません');
  }
  async function apiFetch(params) {
    const qs = new URLSearchParams(params).toString();
    for (let i = 0; ; i++) {
      try { return await apiFetchOnce(qs); }
      catch (e) {
        const limited = e.status === 429 || /429|rate_limit/i.test(String(e.message));
        if (!limited || i >= RETRY_WAIT.length) throw e;
        if (LIVE.status === 'running') { LIVE.log.push(`seats.aero のレート制限（429）。${RETRY_WAIT[i] / 1000} 秒待って再試行…`); render(); }
        await sleep(RETRY_WAIT[i]);
      }
    }
  }
  // ---------- tab: settings ----------
  function renderSettings() {
    const ch = charts();
    return `${flashMsg ? msg('info', flashMsg) : ''}<div class="card"><h2>設定</h2>
      <p class="muted">現在の接続: <b>${esc(apiStatus().label)}</b></p>
      <p>合言葉でログインしています。別の合言葉に切り替える場合はログアウトしてください。</p>
      <button class="btn" data-act="forgetConnection">ログアウト・保存した合言葉を削除</button>
      <div id="connectionMsg" role="status" aria-live="polite"></div>
      <h3>友人に共有する</h3>
      <p class="muted">サイトのURLをコピーして送れます。合言葉は別途伝えてください。</p>
      <button class="btn" data-act="copyShare">サイトのURLをコピー</button>
      <details style="margin-top:20px"><summary>詳細設定・マイルチャート</summary>
      <label class="f">希望日の前後（日）<input type="number" min="0" max="14" data-k="settings.window" value="${esc(S.settings.window == null ? 6 : S.settings.window)}"></label>
      <h3>マイルチャートの編集（JSON）</h3><p class="muted">partnerChart（提携・通年固定）、anaChart（ANA便・[L,R,H]）、partnerCityOverride（都市別上書き）、anaSeasons（シーズン区分の月日範囲）、anaFuel（ANA 便の燃油・1区間・円。ANA 公式が 2 ヶ月ごとに改定するので asOf と一緒に更新）、jalChart（ワンワールド表用の JAL マイル。JAL 便の路線別基本マイルと距離制チャート）。必要マイルと燃油の表示に使います。保存するとこの端末に記憶されます。</p>
      <textarea id="chartJson">${esc(JSON.stringify({ partnerChart: ch.partnerChart, partnerCityOverride: ch.partnerCityOverride, anaChart: ch.anaChart, anaSeasons: ch.anaSeasons, anaFuel: ch.anaFuel, jalChart: ch.jalChart }, null, 2))}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" data-act="saveChart">チャートを保存</button><button class="btn" data-act="resetChart">既定値に戻す</button><button class="btn" data-act="resetAll">全データを初期化</button></div>
      <div id="chartMsg"></div>
      <p class="muted" style="margin-top:12px">データ版 ${esc(D.version)}。必要マイルは推定値を含みます。予約前にANA公式の必要マイル数・ルールを必ず確認してください。本アプリはANAのサイトに自動アクセスしません。</p></details></div>`;
  }

  let loginBusy = false;
  let loginError = '';
  const needsLogin = () => !isLocalHost && !(proxyInfo && proxyInfo.ok && proxyInfo.hasKey && proxyInfo.mode === 'shared');
  function renderLogin() {
    return `<section class="card login-card"><img class="login-icon" src="icon.svg" alt=""><h2>合言葉を入力してください</h2>
      <p class="muted">ANA特典航空券プランナーへようこそ。<br>管理者から届いた合言葉で、空席検索を始められます。</p>
      <form id="loginForm"><label class="f">合言葉<input id="loginToken" type="password" autocomplete="off" required maxlength="200" placeholder="合言葉" ${loginBusy ? 'disabled' : ''}></label>
      <p class="muted">APIキーではありません。合言葉はURLに含まれません。このブラウザに保存され、次回から自動で確認します。</p>
      <button class="btn primary" type="submit" ${loginBusy ? 'disabled' : ''}>${loginBusy ? '確認中…' : 'はじめる'}</button></form>
      <div role="alert" aria-live="polite">${loginError ? msg('err', loginError) : ''}${flashMsg ? msg('info', flashMsg) : ''}</div></section>`;
  }
  // ---------- render ----------
  const TABS = [['quick', '探す'], ['tips', '設定']];
  function render() {
    const tabs = needsLogin() ? [] : TABS;
    document.getElementById('tabs').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'active' : ''}">${l}</button>`).join('');
    const app = document.getElementById('app');
    app.innerHTML = needsLogin() ? renderLogin() : ({ quick: renderQuick, tips: renderSettings }[S.tab] || renderQuick)();
    if (LIVE.status === 'running') app.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
  }

  const helpBtn = document.getElementById('helpToggle');
  function applyHelp() { document.body.classList.toggle('showhelp', !!S.settings.showHelp); if (helpBtn) { helpBtn.textContent = S.settings.showHelp ? '説明を隠す' : '説明を表示'; helpBtn.classList.toggle('on', !!S.settings.showHelp); } }
  if (helpBtn) helpBtn.addEventListener('click', () => { S.settings.showHelp = !S.settings.showHelp; save(); applyHelp(); });
  applyHelp();
  document.getElementById('tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (!b) return; S.tab = b.dataset.tab; save(); history.replaceState(null, '', location.pathname + (S.tab === 'tips' ? '#settings' : '')); render(); });
  const app = document.getElementById('app');
  app.addEventListener('change', e => {
    flashMsg = null;
    const k = e.target.dataset.k; if (!k) return;
    let val = e.target.value;
    if (e.target.type === 'number') val = Math.max(Number(e.target.min), Math.min(Number(e.target.max), Math.round(Number(val) || Number(e.target.min))));
    if (e.target.type === 'checkbox') val = e.target.checked;
    setPath(k, val); LIVE.results = null; LIVE.status = 'idle'; LIVE.log = []; save(); render();
    if (k === 'settings.proxyUrl' || k === 'settings.proxyToken' || k === 'settings.seatsKey') probeProxy().then(() => render());
  });
  app.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    flashMsg = null;
    const act = b.dataset.act;
    if (act === 'livesearch') { liveSearch(); return; }
    if (act === 'liverefresh') { LIVE.cache = { out: null, ret: null }; liveSearch(); return; }
    if (act.startsWith('cal:')) { const key = act.slice(4); if (S._cal === key) { S._cal = null; } else { S._cal = key; S._calMonth = (S.dates[key] || todayISO()).slice(0, 7); } save(); render(); return; }
    if (act.startsWith('calnav:')) { const [y, m] = (S._calMonth || todayISO().slice(0, 7)).split('-').map(Number); const d = new Date(y, m - 1 + Number(act.slice(7)), 1); S._calMonth = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; save(); render(); return; }
    if (act.startsWith('calpick:')) { const [, key, iso] = act.split(':'); S.dates[key] = iso; LIVE.results = null; LIVE.status = 'idle'; LIVE.log = []; S._cal = null; save(); render(); return; }
    if (act.startsWith('calclear:')) { const key = act.slice(9); delete S.dates[key]; LIVE.results = null; LIVE.status = 'idle'; LIVE.log = []; S._cal = null; save(); render(); return; }
    if (act === 'saveChart') { const m = document.getElementById('chartMsg'); try { const o = JSON.parse(document.getElementById('chartJson').value); if (!o.partnerChart || !o.anaChart) throw new Error('partnerChart と anaChart が必要です'); o.partnerCityOverride = o.partnerCityOverride || {}; o.anaSeasons = o.anaSeasons || D.anaSeasons; o.anaFuel = o.anaFuel || D.anaFuel; o.jalChart = o.jalChart || D.jalChart; S.chartOverride = o; save(); m.innerHTML = msg('ok', '保存しました。'); } catch (err) { m.innerHTML = msg('err', 'JSONエラー: ' + err.message); } }
    if (act === 'openSettings') { S.tab = 'tips'; history.replaceState(null, '', location.pathname + '#settings'); save(); render(); return; }
    if (act === 'forgetConnection') { loginError = ''; loginBusy = false; delete S.settings.proxyToken; delete S.settings.seatsKey; proxyInfo = null; LIVE.cache = { out: null, ret: null }; save(); render(); return; }
    if (act === 'copyShare') { const url = location.origin + location.pathname; (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { b.textContent = 'コピーしました'; }).catch(() => { window.prompt('このURLをコピーしてください', url); }); return; }
    if (act === 'resetChart') { S.chartOverride = null; save(); render(); }
    if (act === 'resetAll') { if (window.confirm('入力・設定をすべて初期化します。よろしいですか？')) { S = defaultState(); proxyInfo = null; LIVE.cache = { out: null, ret: null }; LIVE.results = null; LIVE.status = 'idle'; save(); render(); } }
  });

  // Legacy credential links are discarded, never imported or generated.
  let flashMsg = null;
  function applyHash() {
    const h = location.hash.slice(1);
    if (/[?&](?:key|token|api_key)=/i.test(location.search) || /(?:^|&)(?:key|token|api_key)=/i.test(h)) {
      history.replaceState(null, '', location.pathname);
      S.tab = 'tips';
      flashMsg = 'URLに含まれる接続情報は取り込みません。設定画面から入力してください。';
    } else if (h === 'settings') { S.tab = 'tips'; save(); }
  }
  app.addEventListener('submit', async e => {
    if (e.target.id !== 'loginForm') return;
    e.preventDefault();
    if (loginBusy) return;
    const token = document.getElementById('loginToken').value.trim();
    if (!token) { loginError = '合言葉を入力してください。'; render(); return; }
    S.settings.proxyToken = token;
    delete S.settings.seatsKey;
    loginBusy = true; loginError = ''; proxyInfo = null; render();
    await probeProxy();
    loginBusy = false;
    if (!needsLogin()) {
      S.tab = 'quick'; save(); history.replaceState(null, '', location.pathname); flashMsg = null;
    } else {
      delete S.settings.proxyToken; save();
      loginError = proxyInfo && proxyInfo.status === 401 ? '合言葉が違うか、変更されています。新しい合言葉を入力してください。' : '接続を確認できませんでした。通信環境を確認して、もう一度お試しください。';
    }
    render();
  });
  applyHash();
  window.addEventListener('hashchange', () => { if (location.hash === '#settings' || /(?:key|token|api_key)=/i.test(location.hash)) { applyHash(); render(); } });
  loginBusy = !isLocalHost && !!S.settings.proxyToken;
  render();
  if (isLocalHost || S.settings.proxyToken) probeProxy().then(() => { loginBusy = false; if (!isLocalHost && needsLogin()) { loginError = proxyInfo && proxyInfo.status === 401 ? '合言葉が変更されています。新しい合言葉を入力してください。' : '接続できませんでした。合言葉を入力して再試行してください。'; delete S.settings.proxyToken; save(); } render(); });
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) { navigator.serviceWorker.register('./sw.js').catch(() => {}); }
})();
