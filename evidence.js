/* Availability evidence, not an ANA booking confirmation.
 * seats.aero semantics: https://developers.seats.aero/reference/concepts-copy
 * RemainingSeats=0 can mean unknown. Flight times are airport-local, even with Z.
 */
(function () {
  'use strict';
  const STAR = { united: 'UA', aeroplan: 'AC', lifemiles: 'AV' };
  const OW = { american: 'AA', british: 'BA', qantas: 'QF', asiamiles: 'CX', finnair: 'AY', qatar: 'QR' };
  const op = l => (l.fn || '').slice(0, 2);
  const hours = (iso, now = Date.now()) => {
    // Observation time must include a timezone; never interpret missing/future data as fresh.
    if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(iso || '')) return null;
    const t = Date.parse(iso), h = (now - t) / 3600000;
    return Number.isFinite(h) && h >= 0 ? h : null;
  };
  const seatCount = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const shared = (l, source, ow) => ow ? source === 'jal' || !!(OW[source] && OW[source] !== op(l)) : !!((window.AWARD_DATA.starCodes || []).includes(op(l)) && STAR[source] && STAR[source] !== op(l));
  function normalize(data) {
    const seen = new Map(), cabins = { economy: 'Y', premium: 'PY', business: 'C', first: 'F' };
    for (const it of data || []) for (const t of it.AvailabilityTrips || []) {
      const r = it.Route || {}, cabin = cabins[t.Cabin], fn = (t.FlightNumbers || '').replace(/\s/g, '');
      if (Number(t.Stops || 0) !== 0 || !cabin || !/^[A-Z0-9]{2}\d+$/.test(fn) || Number(t.MixedCabinPct || 0) > 0) continue;
      if (!it.Date || !r.OriginAirport || !r.DestinationAirport) continue;
      // Different schedules must not be collapsed into a single synthetic flight.
      const key = [it.Date, r.OriginAirport, r.DestinationAirport, fn, cabin, t.DepartsAt, t.ArrivesAt].join('|');
      let l = seen.get(key);
      if (!l) {
        l = { date: it.Date, o: r.OriginAirport, d: r.DestinationAirport, fn, cabin,
          dep: t.DepartsAt || '', arr: t.ArrivesAt || '', ac: (t.Aircraft || []).join('/'),
          dist: Number(r.Distance || 0), observations: [] };
        seen.set(key, l);
      }
      const observation = { source: t.Source || it.Source || r.Source || '', seats: seatCount(t.RemainingSeats), upd: t.UpdatedAt || it.UpdatedAt || '' };
      const previous = l.observations.find(x => x.source === observation.source);
      if (!previous) l.observations.push(observation);
      else {
        const oldTime = hours(previous.upd), newTime = hours(observation.upd);
        if (newTime !== null && (oldTime === null || newTime < oldTime)) Object.assign(previous, observation);
        else if (observation.upd === previous.upd) previous.seats = previous.seats === null || observation.seats === null ? null : Math.min(previous.seats, observation.seats);
      }
    }
    return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.dep.localeCompare(b.dep));
  }
  function select(l, pax, ow = false, now = Date.now()) {
    const observations = l.observations || [];
    const eligible = observations.filter(x => shared(l, x.source, ow));
    const pool = eligible.length ? eligible : observations;
    const sufficient = pool.filter(x => x.seats !== null && x.seats >= pax);
    const sorted = (sufficient.length ? sufficient : pool).slice().sort((a, b) => (hours(a.upd, now) ?? Infinity) - (hours(b.upd, now) ?? Infinity) || (a.seats ?? 0) - (b.seats ?? 0));
    const chosen = sorted[0] || { seats: null, upd: '', source: '' };
    return { ...l, seats: chosen.seats, upd: chosen.upd, selectedSource: chosen.source,
      srcs: observations.map(x => x.source).filter(Boolean), sharedEvidence: eligible.length > 0 };
  }
  function assess(l, pax, ow = false, now = Date.now()) {
    const selected = select(l, pax, ow, now), h = hours(selected.upd, now);
    const eligible = (l.observations || []).filter(x => shared(l, x.source, ow));
    const recent = eligible.filter(x => hours(x.upd, now) !== null && hours(x.upd, now) <= 24);
    const enough = selected.seats !== null && selected.seats >= pax;
    const corroborated = recent.filter(x => x.seats !== null && x.seats >= pax).length >= 2;
    const conflict = recent.some(x => x.seats !== null && x.seats < pax);
    let level = 0;
    if (eligible.length && enough && h !== null && h <= 24 && !conflict) level = corroborated ? 2 : 1;
    const score = level * 100 + (h === null ? -40 : h <= 2 ? 20 : h <= 12 ? 10 : h <= 24 ? 5 : h <= 72 ? -10 : -30) + (enough ? 0 : -50) - (conflict ? 30 : 0);
    return { selected, h, enough, corroborated, conflict, level, score };
  }
  window.AWARD_EVIDENCE = { normalize, select, assess, hours, shared };
})();
