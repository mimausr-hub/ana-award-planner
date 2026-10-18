const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./helpers.cjs');
const now = Date.parse('2026-10-18T12:00:00Z');
const ago = h => new Date(now - h * 3600000).toISOString();
function observation(source, seats, updated, extra = {}) {
  return { Date: '2026-11-02', Source: source, Route: { OriginAirport: 'NRT', DestinationAirport: 'BKK', Distance: 2900 },
    AvailabilityTrips: [{ Cabin: 'business', Stops: 0, FlightNumbers: 'TG641', DepartsAt: '2026-11-02T09:45:00Z', ArrivesAt: '2026-11-02T15:00:00Z', Aircraft: [], RemainingSeats: seats, UpdatedAt: updated, ...extra }] };
}
function setup(rows, pax=1) { const {ctx}=app('','',now);ctx.testing.state.pax=pax;return {t:ctx.testing,E:ctx.AWARD_EVIDENCE,legs:ctx.AWARD_EVIDENCE.normalize(rows),D:ctx.AWARD_DATA}; }
function rawLeg(o,d,fn='TG1',date='2026-11-02') {
 const r=observation('aeroplan',2,ago(1),{FlightNumbers:fn,DepartsAt:date+'T01:00:00Z',ArrivesAt:date+'T05:00:00Z'});r.Date=date;r.Route.OriginAirport=o;r.Route.DestinationAirport=d;return r;
}
test('seats and freshness stay attached to the same source, including when pax changes',()=>{
 const {E,legs}=setup([observation('aeroplan',9,ago(80)),observation('lifemiles',1,ago(1))]);
 const one=E.select(legs[0],1,false,now),two=E.select(legs[0],2,false,now);
 assert.equal(one.seats,1);assert.equal(one.selectedSource,'lifemiles');assert.equal(one.upd,ago(1));
 assert.equal(two.seats,9);assert.equal(two.upd,ago(80));assert.equal(E.assess(legs[0],2,false,now).level,0);
});
test('own-program seats cannot inflate a partner observation',()=>{
 const {E,legs}=setup([observation('united',9,ago(1),{FlightNumbers:'UA1'}),observation('aeroplan',1,ago(3),{FlightNumbers:'UA1'})]);
 const chosen=E.select(legs[0],2);assert.equal(chosen.seats,1);assert.equal(chosen.selectedSource,'aeroplan');assert.equal(E.assess(legs[0],2).enough,false);
});
test('same-source duplicates retain newest observation and do not count as corroboration',()=>{
 const {E,legs}=setup([observation('aeroplan',9,ago(20)),observation('aeroplan',1,ago(1)),observation('aeroplan',1,ago(1))]);
 assert.equal(legs[0].observations.length,1);assert.equal(E.select(legs[0],2).seats,1);assert.equal(E.assess(legs[0],1).corroborated,false);
});
test('unknown seats, unknown dates and future dates never receive strong evidence',()=>{
 for(const [seats,date] of [[0,ago(1)],[null,ago(1)],[2,''],[2,'invalid'],[2,ago(-2)],[2,'2026-10-18T10:00:00']]){
  const {E,legs,t}=setup([observation('aeroplan',seats,date)]);
  assert.equal(E.assess(legs[0],1).level,0);
  const c=t.confidence({legs},false);assert.equal(c.level,0);
  if(seats===2)assert.match(c.why,/観測時刻不明/);
 }
});
test('multiple recent partner sources improve priority only when both meet the requested pax',()=>{
 const {E,legs}=setup([observation('aeroplan',2,ago(1)),observation('lifemiles',1,ago(2))]);
 assert.equal(E.assess(legs[0],1).level,2);assert.equal(E.assess(legs[0],2).level,0);
});
test('changed schedules and mixed-cabin trips are not silently merged',()=>{
 const {legs}=setup([observation('aeroplan',2,ago(1)),observation('lifemiles',2,ago(1),{DepartsAt:'2026-11-02T10:45:00Z'}),observation('united',2,ago(1),{MixedCabinPct:10})]);
 assert.equal(legs.length,2);
});
test('airport changes are excluded; unknown seats need explicit reference mode and never become 9',()=>{
 const {t}=setup([]);const a={o:'NRT',d:'LHR',arr:'2026-11-02T12:00:00Z',seats:2},b={o:'LGW',d:'FRA',dep:'2026-11-02T13:30:00Z',seats:2};
 assert.equal(t.pairLegs([a],[b],72).length,0);b.o='LHR';assert.equal(t.pairLegs([a],[b],72).length,1);
 a.seats=null;assert.equal(t.pairLegs([a],[b],72).length,0);
 t.state.settings.liveSure=false;t.state.settings.liveUnknown=true;
 assert.equal(t.pairLegs([a],[b],72)[0].seats,null);
});
test('ANA filters exclude prohibited areas, excessive mileage, stopovers and cabins',()=>{
 const {t,E}=setup([]);const combo=(routes)=>({legs:routes.map(([o,d,fn])=>E.normalize([rawLeg(o,d,fn)])[0]),stop:false});
 assert.equal(t.anaRuleFilter([combo([['NRT','YVR','AC1'],['YVR','LHR','AC2']])],'LON',false).length,0);
 assert.equal(t.anaRuleFilter([combo([['NRT','ICN','OZ1'],['ICN','LAX','OZ2']])],'LAX',false).length,0);
 assert.equal(t.anaRuleFilter([combo([['NRT','BKK','TG1'],['BKK','LHR','TG2']])],'LON',false).length,1);
 const stop=combo([['NRT','BKK','TG1'],['BKK','LHR','TG2']]);stop.stop=true;assert.equal(t.anaRuleFilter([stop],'LON',true).length,0);
 assert.equal(t.anaRuleFilter([combo([['NRT','SGN','VN1'],['SGN','LHR','NH2']])],'LON',false).length,0);
 for(const fn of ['LX1','SQ1'])assert.equal(t.anaAllowedLeg({fn,cabin:'F',date:'2026-11-02'}),false);
 assert.equal(t.anaAllowedLeg({fn:'OZ1',cabin:'C',date:'2026-12-17'}),false);
 assert.equal(t.anaAllowedLeg({fn:'BR1',cabin:'PY',date:'2026-11-02'}),false);
});
test('official regional seasons and updated ANA fares replace yearless estimates',()=>{
 const {t}=setup([]);t.state.q.dest='TPE';t.state.dates={'q.dep':'2026-11-02','q.ret':'2026-11-11'};
 assert.equal(t.quickAnalysis().anaMiles,53000);delete t.state.dates['q.ret'];assert.equal(t.quickAnalysis().anaMiles,26500);
 assert.equal(t.seasonOf('2026-12-20','LON'),'H');assert.equal(t.seasonOf('2026-12-20','TPE'),'R');
 assert.equal(t.seasonOf('2027-10-02','TPE'),'H');assert.equal(t.seasonOf('2029-10-02','TPE'),null);
 t.state.dates={'q.dep':'2029-11-02','q.ret':'2029-11-11'};assert.equal(t.quickAnalysis().anaMiles,null);
});
test('partner direct flights are found at the selected origin and quoted using Zone 1-A',()=>{
 const {t,E}=setup([]);t.state.q.dest='BKK';t.state.dates={'q.dep':'2026-11-02'};
 const R={L1:E.normalize([rawLeg('NRT','BKK','TG641'),rawLeg('KIX','BKK','TG623')]),L2:[],L2b:[],L3:[],L3b:[],L4:[],oAps:['HND','NRT'],fAps:['HND','NRT'],dAps:['BKK'],hubsAll:[],regional:[],gateways:[],w:0,dep:'2026-11-02',ret:''};
 const g=t.buildGroup('star','C',['out'],R,()=>{}),tg=g.partners.find(p=>p.cfg.c==='TG');
 assert.equal(tg.outC.length,1);assert.equal(tg.outC[0].legs[0].o,'NRT');assert.equal(t.candidateMiles(tg.outC[0]),30000);
 t.live.results={cabin:'C',groups:[g]};const html=t.renderGroup(g,0);assert.match(html,/ANA公式未確認/);assert.match(html,/30,000/);assert.match(html,/提供元別の根拠/);assert.match(html,/探すコツ/);
 assert.doesNotMatch(html,/取れそう度|ANA可の見込み|全便が提携枠/);
});
test('unknown-time flights are filtered in default mode, including ANA operated flights',()=>{
 const {t,E}=setup([]);t.state.q.dest='BKK';
 const R={L1:E.normalize([rawLeg('NRT','BKK','NH849')]),L2:[],L2b:[],L3:[],L3b:[],L4:[],oAps:['NRT'],fAps:['NRT'],dAps:['BKK'],hubsAll:[],regional:[],w:0,dep:'2026-11-02',ret:''};
 R.L1[0].observations[0].upd='';assert.equal(t.buildGroup('star','C',['out'],R,()=>{}).direct.out.length,0);
});

test('VN observations never become ANA shared evidence, even with an unexpected Star source',()=>{
 const {E,legs}=setup([observation('united',2,ago(1),{FlightNumbers:'VN321'})]);
 assert.equal(E.select(legs[0],1).sharedEvidence,false);assert.equal(E.assess(legs[0],1).level,0);
});
test('published season calendars have exactly one season per covered day',()=>{
 const {t,D}=setup([]);
 for(const [group,dest] of [['asia','TPE'],['west','LON'],['pacific','HNL']]) for(const year of [2026,2027,2028]) {
  const stop=year===2028?'2028-04-01':`${year+1}-01-01`;
  for(let d=`${year}-01-01`;d<stop;d=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
   const matches=Object.values(D.anaSeasons[group][year]).flat().filter(([a,b])=>d>=a&&d<=b);
   assert.equal(matches.length,1,`${group} ${d}`);assert.ok(t.seasonOf(d,dest));
  }
 }
});
