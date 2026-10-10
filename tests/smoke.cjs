const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function app(hash = '', search = '') {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, {innerHTML:'', listeners:{}, addEventListener(type,fn){this.listeners[type]=fn}, querySelectorAll(){return []}, classList:{toggle(){}}}); return nodes.get(id); };
  const storage = new Map(); const requests = [];
  const ctx = vm.createContext({ URLSearchParams, AbortSignal, Date, console, setTimeout,
    document: {getElementById:node, body:node('body')},
    localStorage: {getItem:k=>storage.get(k), setItem:(k,v)=>storage.set(k,v)},
    location: {hash, search, origin:'https://mimausr-hub.github.io', hostname:'mimausr-hub.github.io', pathname:'/ana-award-planner/', protocol:'https:'},
    history: {replaceState(a,b,url){ctx.cleanURL=url;}}, navigator:{},
    fetch: async (url,opts)=> {requests.push({url,opts}); return {ok:true,json:async()=>({ok:false,hasKey:false})};}
  });
  ctx.window = ctx; ctx.addEventListener=()=>{};
  for (const file of ['data.js','holidays.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\}\)\(\);\s*$/, 'window.testing={state:S,live:LIVE,liveSearch,renderSettings,proxyBase,proxyHeaders,buildGroup};})();');
  vm.runInContext(source,ctx); return {ctx,requests,node};
}
test('credential URLs are discarded without importing secrets',()=>{
  for (const [hash,query] of [['#token=fake-test-token',''],['#key=fake-test-key',''],['#settings','?token=fake-test-token']]) {
    const {ctx}=app(hash,query);
    assert.equal(ctx.cleanURL,'/ana-award-planner/');
    assert.equal(ctx.testing.state.settings.proxyToken,undefined);
    assert.equal(ctx.testing.state.settings.seatsKey,undefined);
  }
});
test('new visitors can find settings and share URLs contain no credentials',()=>{
 const {ctx,node}=app(); assert.equal(node('tabs').innerHTML,''); assert.match(node('app').innerHTML,/合言葉を入力してください/); assert.doesNotMatch(node('app').innerHTML,/どこへ、いつ/);
 const html=ctx.testing.renderSettings(); assert.match(html,/ログアウト/); assert.doesNotMatch(html,/#token=|#key=|inviteLink/);
 ctx.testing.state.settings.proxyUrl='https://untrusted.example'; assert.equal(ctx.testing.proxyBase(),'https://ana-award-proxy.anamile.workers.dev');
});
test('login only saves a verified passphrase and rejects wrong ones', async()=>{
 const {ctx,node}=app();
 const submit=()=>node('app').listeners.submit({target:{id:'loginForm'},preventDefault(){}});
 node('loginToken').value='wrong';
 ctx.fetch=async()=>({ok:false,status:401,json:async()=>({error:'invalid'})});
 await submit(); assert.equal(ctx.testing.state.settings.proxyToken,undefined); assert.match(node('app').innerHTML,/合言葉が違う/);
 node('loginToken').value='test-passphrase';
 ctx.fetch=async()=>({ok:true,json:async()=>({ok:true,hasKey:true,mode:'shared'})});
 await submit(); assert.equal(ctx.testing.state.settings.proxyToken,'test-passphrase'); assert.match(node('app').innerHTML,/どこへ、いつ/); assert.doesNotMatch(node('app').innerHTML,/id="loginForm"/);
});
test('invalid dates stop before any search API call',async()=>{
 const {ctx,requests}=app(); const t=ctx.testing; t.state.q.dest='TPE'; t.state.dates={'q.dep':'2000-01-01'};
 await t.liveSearch(); assert.equal(t.live.status,'error'); assert.match(t.live.msg,/今日以降/); assert.equal(requests.filter(r=>r.url.includes('/search')).length,0);
 t.state.dates={'q.dep':'2090-01-20','q.ret':'2090-01-10'}; await t.liveSearch(); assert.equal(t.live.status,'error');
});
test('Worker denies unauthenticated and disallowed-origin requests',async()=>{
 const src=fs.readFileSync(path.join(root,'worker/index.js'),'utf8'); const worker=(await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'))).default;
 const env={ALLOWED_ORIGINS:'https://mimausr-hub.github.io',PROXY_TOKEN:'test-only',SEATS_AERO_KEY:'test-only-key'};
 const url='https://worker.example/api/ping';
 assert.equal((await worker.fetch(new Request(url),env)).status,401);
 assert.equal((await worker.fetch(new Request(url,{headers:{Origin:'https://untrusted.example','X-Proxy-Token':'test-only'}}),env)).status,403);
 assert.equal((await worker.fetch(new Request(url,{headers:{'X-Seats-Key':'test-only-key'}}),env)).status,401);
 assert.equal((await worker.fetch(new Request(url,{headers:{'X-Proxy-Token':'test-only-key'}}),{...env,PROXY_TOKEN:'test-only-key'})).status,401);
 const ok=await worker.fetch(new Request(url,{headers:{Origin:'https://mimausr-hub.github.io','X-Proxy-Token':'test-only'}}),env);
 assert.equal(ok.status,200); assert.equal((await ok.json()).mode,'shared');
});
