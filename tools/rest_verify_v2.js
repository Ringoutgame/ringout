// M8-T3b REST verification against the LIVE Realtime Database — run ONLY
// AFTER the v2 rules have been published (supersedes rest_verify.js/M1-T4).
// Covers the full old single/double regression plus the new ffa schema.
// ALLOW = expect HTTP 200. DENY = expect HTTP 401/403 (Permission denied).
// Note: rooms cannot be deleted by clients — test rooms persist until they
// are removed manually in the Firebase console (known TTL backlog item).
//
// SAFETY: this script writes to the LIVE database. It refuses to run unless
// --live is passed explicitly, so it can never fire from an automated runner.
if (!process.argv.includes('--live')) {
  console.error('rest_verify_v2: LIVE-DB-Test — Start nur mit --live erlaubt.');
  console.error('Aufruf: node tools/rest_verify_v2.js --live');
  process.exit(2);
}
const DB = 'https://ringout-87fbb-default-rtdb.europe-west1.firebasedatabase.app';
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';           // == rrand() charset in index.html
const TS = { '.sv': 'timestamp' };
const rc = () => Array.from({length:4},()=>CHARS[Math.floor(Math.random()*CHARS.length)]).join('');
const room = (o={}) => Object.assign({ v:2, config:{winTarget:3,fmt:'single'}, gen:0, p:{0:true}, created:TS }, o);
const ffaRoom = (o={}) => Object.assign({ v:2, config:{winTarget:3,fmt:'ffa'}, gen:0, state:'lobby', p:{0:true}, created:TS }, o);

async function req(method, path, body){
  const r = await fetch(`${DB}/${path}.json`, { method, ...(body!==undefined?{body:JSON.stringify(body)}:{}) });
  let text=''; try{ text=await r.text(); }catch{}
  return { status:r.status, text:text.slice(0,160) };
}
const put = (p,b)=>req('PUT',p,b), del = p=>req('DELETE',p), get = p=>req('GET',p);

let pass=0, fail=0; const fails=[];
async function expect(kind, label, res){
  const ok = kind==='ALLOW' ? res.status===200 : (res.status===401||res.status===403);
  if(ok){ pass++; console.log(`  ok   [${kind}] ${label}  -> ${res.status}`); }
  else{ fail++; fails.push(label); console.log(`  FAIL [${kind}] ${label}  -> ${res.status}  ${res.text}`); }
  return ok;
}
async function freshCode(){ for(let i=0;i<8;i++){ const c=rc(); const g=await get(`rooms/${c}`); if(g.status===200 && g.text==='null') return c; } throw new Error('no free code'); }

(async()=>{
  console.log('=== Root enumeration (must be denied) ===');
  await expect('DENY','GET /rooms (enumeration)', await get('rooms'));

  const RA = await freshCode();
  console.log(`\n=== single/double regression on v2  [room ${RA}] ===`);
  await expect('ALLOW','create single v2',                      await put(`rooms/${RA}`, room()));
  await expect('ALLOW','guest joins p/1=true',                  await put(`rooms/${RA}/p/1`, true));
  await expect('ALLOW','p/1 overwrite (NOT tightened)',         await put(`rooms/${RA}/p/1`, true));
  await expect('DENY','seat 2 claim in single',                 await put(`rooms/${RA}/p/2`, true));
  await expect('DENY','state write on single room',             await put(`rooms/${RA}/state`, 'lobby'));
  await expect('DENY','seats write on single room',             await put(`rooms/${RA}/seats`, 2));
  await expect('ALLOW','move P0 g/0/t/0/0',                     await put(`rooms/${RA}/g/0/t/0/0`, {idx:0,dx:100,dy:-50,sp:0.5}));
  await expect('ALLOW','move P1 g/0/t/0/1 (bounds edge)',       await put(`rooms/${RA}/g/0/t/0/1`, {idx:1,dx:0,dy:194,sp:-1}));
  await expect('DENY','write-once: rewrite g/0/t/0/0',          await put(`rooms/${RA}/g/0/t/0/0`, {idx:2,dx:10,dy:10,sp:0}));
  await expect('DENY','move pl 2 in single',                    await put(`rooms/${RA}/g/0/t/1/2`, {idx:0,dx:10,dy:10,sp:0}));
  await expect('DENY','move idx 4 in single',                   await put(`rooms/${RA}/g/0/t/1/0`, {idx:4,dx:10,dy:10,sp:0}));
  await expect('DENY','move dx=99999 (out of bounds)',          await put(`rooms/${RA}/g/0/t/1/0`, {idx:0,dx:99999,dy:0,sp:0}));
  await expect('DENY','move extra field (hack)',                await put(`rooms/${RA}/g/0/t/1/0`, {idx:0,dx:10,dy:10,sp:0,hack:1}));
  await expect('DENY','move into FUTURE gen g/5 while gen=0',   await put(`rooms/${RA}/g/5/t/0/0`, {idx:0,dx:10,dy:10,sp:0}));
  await expect('ALLOW','rematch gen 0->1 (increment)',          await put(`rooms/${RA}/gen`, 1));
  await expect('DENY','gen jump 1->5',                          await put(`rooms/${RA}/gen`, 5));
  await expect('ALLOW','host leaves: delete p/0',               await del(`rooms/${RA}/p/0`));
  await expect('DENY','re-set p/0=true after host left',        await put(`rooms/${RA}/p/0`, true));
  await expect('ALLOW','guest leaves: delete p/1',              await del(`rooms/${RA}/p/1`));

  const J = await freshCode();
  console.log(`\n=== invalid create rejects (unused code ${J}, none should persist) ===`);
  await expect('DENY','create v1 room (old client)',            await put(`rooms/${J}`, room({v:1})));
  await expect('DENY','fmt=triple',                             await put(`rooms/${J}`, room({config:{winTarget:3,fmt:'triple'}})));
  await expect('DENY','single WITH state at create',            await put(`rooms/${J}`, room({state:'lobby'})));
  await expect('DENY','single WITH seats at create',            await put(`rooms/${J}`, room({seats:2})));
  await expect('DENY','ffa WITHOUT state at create',            await put(`rooms/${J}`, (()=>{const r=ffaRoom();delete r.state;return r;})()));
  await expect('DENY','ffa with state=playing at create',       await put(`rooms/${J}`, ffaRoom({state:'playing'})));
  await expect('DENY','ffa with p/2 prefilled at create',       await put(`rooms/${J}`, ffaRoom({p:{0:true,2:true}})));
  await expect('DENY','ffa with seats prefilled at create',     await put(`rooms/${J}`, ffaRoom({seats:3})));
  await expect('ALLOW','unused code still absent (not persisted)', await get(`rooms/${J}`).then(r=>({status:r.text==='null'?200:500,text:r.text})));

  const RF = await freshCode();
  console.log(`\n=== ffa lifecycle  [room ${RF}] ===`);
  await expect('ALLOW','create ffa room (state lobby)',         await put(`rooms/${RF}`, ffaRoom()));
  await expect('DENY','start with only host (no p/1)',          await put(`rooms/${RF}/state`, 'playing'));
  await expect('ALLOW','claim seat 1',                          await put(`rooms/${RF}/p/1`, true));
  await expect('DENY','re-claim occupied seat 1 (write-once)',  await put(`rooms/${RF}/p/1`, true));
  await expect('ALLOW','claim seat 2',                          await put(`rooms/${RF}/p/2`, true));
  await expect('ALLOW','claim seat 3',                          await put(`rooms/${RF}/p/3`, true));
  await expect('ALLOW','claim seat 4',                          await put(`rooms/${RF}/p/4`, true));
  await expect('DENY','claim seat 5',                           await put(`rooms/${RF}/p/5`, true));
  await expect('ALLOW','lobby leave: delete seat 4',            await del(`rooms/${RF}/p/4`));
  await expect('DENY','seats while still lobby',                await put(`rooms/${RF}/seats`, 4));
  await expect('ALLOW','host start: lobby->playing',            await put(`rooms/${RF}/state`, 'playing'));
  await expect('ALLOW','seats=4 after start',                   await put(`rooms/${RF}/seats`, 4));
  await expect('DENY','seats rewrite (write-once)',             await put(`rooms/${RF}/seats`, 5));
  await expect('DENY','playing->lobby',                         await put(`rooms/${RF}/state`, 'lobby'));
  await expect('DENY','claim seat 4 after start',               await put(`rooms/${RF}/p/4`, true));
  await expect('ALLOW','move pl 3 idx 3',                       await put(`rooms/${RF}/g/0/t/0/3`, {idx:3,dx:10,dy:10,sp:0}));
  await expect('ALLOW','move pl 0 idx 4 (ffa only)',            await put(`rooms/${RF}/g/0/t/0/0`, {idx:4,dx:10,dy:10,sp:0}));
  await expect('DENY','move pl 5',                              await put(`rooms/${RF}/g/0/t/0/5`, {idx:0,dx:10,dy:10,sp:0}));
  await expect('DENY','move idx 5',                             await put(`rooms/${RF}/g/0/t/1/0`, {idx:5,dx:10,dy:10,sp:0}));
  await expect('ALLOW','match presence delete seat 2',          await del(`rooms/${RF}/p/2`));
  await expect('DENY','re-claim seat 2 in match (blocked)',     await put(`rooms/${RF}/p/2`, true));

  const RS = await freshCode();
  console.log(`\n=== ffa seats bounds  [room ${RS}] ===`);
  await expect('ALLOW','create ffa room RS',                    await put(`rooms/${RS}`, ffaRoom()));
  await expect('ALLOW','claim seat 1 (min 2 players)',          await put(`rooms/${RS}/p/1`, true));
  await expect('ALLOW','start RS',                              await put(`rooms/${RS}/state`, 'playing'));
  await expect('DENY','seats=6',                                await put(`rooms/${RS}/seats`, 6));
  await expect('DENY','seats=1',                                await put(`rooms/${RS}/seats`, 1));
  await expect('ALLOW','seats=2',                               await put(`rooms/${RS}/seats`, 2));

  console.log(`\n==================== RESULT: ${pass} passed, ${fail} failed ====================`);
  if(fail) console.log('FAILED:', fails.join(' | '));
  console.log(`Persistent test rooms left in DB (deletes blocked by rules): ${RA}, ${RF}, ${RS}`);
  process.exit(fail?1:0);
})().catch(e=>{ console.error('SUITE ERROR:', e); process.exit(2); });
