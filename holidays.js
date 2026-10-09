// 日本の祝日を法則から計算する（2000〜2099年）。振替休日・国民の休日も含む。
window.JPHolidays = (function () {
  const nthMonday = (y, m, n) => { const first = new Date(y, m - 1, 1).getDay(); const d = 1 + ((8 - first) % 7) + (n - 1) * 7; return d; };
  const equinox = (y, spring) => Math.floor((spring ? 20.8431 : 23.2488) + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  function base(y) {
    const h = {};
    const set = (m, d, name) => { h[`${m}-${d}`] = name; };
    set(1, 1, '元日'); set(1, nthMonday(y, 1, 2), '成人の日'); set(2, 11, '建国記念の日'); set(2, 23, '天皇誕生日');
    set(3, equinox(y, true), '春分の日'); set(4, 29, '昭和の日'); set(5, 3, '憲法記念日'); set(5, 4, 'みどりの日'); set(5, 5, 'こどもの日');
    set(7, nthMonday(y, 7, 3), '海の日'); set(8, 11, '山の日'); set(9, nthMonday(y, 9, 3), '敬老の日'); set(9, equinox(y, false), '秋分の日');
    set(10, nthMonday(y, 10, 2), 'スポーツの日'); set(11, 3, '文化の日'); set(11, 23, '勤労感謝の日');
    return h;
  }
  const cache = {};
  function yearMap(y) {
    if (cache[y]) return cache[y];
    const b = base(y); const out = Object.assign({}, b);
    const key = dt => `${dt.getMonth() + 1}-${dt.getDate()}`;
    // 振替休日: 祝日が日曜なら、その後の最初の「祝日でない日」が休日
    Object.keys(b).forEach(k => {
      const [m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d);
      if (dt.getDay() === 0) { const n = new Date(dt); do { n.setDate(n.getDate() + 1); } while (out[key(n)]); out[key(n)] = '振替休日'; }
    });
    // 国民の休日: 前日と翌日が祝日に挟まれた平日（日曜以外）
    for (let m = 1; m <= 12; m++) {
      const days = new Date(y, m, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const dt = new Date(y, m - 1, d); if (out[key(dt)] || dt.getDay() === 0) continue;
        const p = new Date(dt); p.setDate(d - 1); const n = new Date(dt); n.setDate(d + 1);
        if (b[key(p)] && b[key(n)]) out[key(dt)] = '国民の休日';
      }
    }
    cache[y] = out; return out;
  }
  function name(y, m, d) { return yearMap(y)[`${m}-${d}`] || null; }
  function fromISO(iso) { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); if (!y || !m || !d) return null; return name(y, m, d); }
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  function label(iso) { // "（月・海の日）" のような表示用
    if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); if (isNaN(dt)) return '';
    const hn = name(y, m, d); return `（${WD[dt.getDay()]}${hn ? '・' + hn : ''}）`;
  }
  function kind(iso) { // 'holiday' | 'sun' | 'sat' | ''
    if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d);
    if (name(y, m, d)) return 'holiday'; if (dt.getDay() === 0) return 'sun'; if (dt.getDay() === 6) return 'sat'; return '';
  }
  function monthList(y, m) { const map = yearMap(y); return Object.keys(map).filter(k => Number(k.split('-')[0]) === m).map(k => ({ day: Number(k.split('-')[1]), name: map[k] })).sort((a, b) => a.day - b.day); }
  return { name, fromISO, label, kind, monthList, WD };
})();
