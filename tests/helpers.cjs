const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function app(hash = '', search = '', nowMs = null) {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, {innerHTML:'', listeners:{}, addEventListener(type,fn){this.listeners[type]=fn}, querySelectorAll(){return []}, classList:{toggle(){}}}); return nodes.get(id); };
  const storage = new Map(); const requests = [];
  const Clock = nowMs == null ? Date : class extends Date { constructor(...a) { super(...(a.length ? a : [nowMs])); } static now() { return nowMs; } };
  const ctx = vm.createContext({ URLSearchParams, AbortSignal, Date: Clock, console, setTimeout,
    document: {getElementById:node, body:node('body')},
    localStorage: {getItem:k=>storage.get(k), setItem:(k,v)=>storage.set(k,v)},
    location: {hash, search, origin:'https://mimausr-hub.github.io', hostname:'mimausr-hub.github.io', pathname:'/ana-award-planner/', protocol:'https:'},
    history: {replaceState(a,b,url){ctx.cleanURL=url;}}, navigator:{},
    fetch: async (url,opts)=> {requests.push({url,opts}); return {ok:true,json:async()=>({ok:false,hasKey:false})};}
  });
  ctx.window = ctx; ctx.addEventListener=()=>{};
  for (const file of ['data.js','holidays.js','evidence.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\}\)\(\);\s*$/, 'window.testing={state:S,live:LIVE,liveSearch,renderSettings,proxyBase,proxyHeaders,buildGroup,tripsFrom,pairLegs,tripleLegs,confidence,anaRuleFilter,anaAllowedLeg,seasonOf,quickAnalysis,candidateMiles,renderQuick,renderGroup};})();');
  vm.runInContext(source,ctx); return {ctx,requests,node};
}

module.exports = { app };
