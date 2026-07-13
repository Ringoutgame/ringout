// v3 REST verification against the LIVE Realtime Database — run ONLY AFTER the
// v3 rules have been published (supersedes rest_verify_v2.js; the public cutover
// happens after Paket B). Covers the full single/double/ffa regression plus the
// v3 identity roster (players/<seat>), the tightened presence rules and the
// lobby-only host rejoin.
// ALLOW = expect HTTP 200. DENY = expect HTTP 401/403 (Permission denied).
// Room cleanup (v1): a whole room may be deleted ONLY when no seat is present.
//
// SAFETY: this script writes to the LIVE database. It refuses to run unless
// --live is passed explicitly, so it can never fire from an automated runner.
if (!process.argv.includes('--live')) {
  console.error('rest_verify_v3: LIVE-DB-Test — Start nur mit --live erlaubt.');
  console.error('Aufruf: node tools/rest_verify_v3.js --live');
  process.exit(2);
}
const DB = 'https://ringout-87fbb-default-rtdb.europe-west1.firebasedatabase.app';
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';           // == rrand() charset in index.html
const TS = { '.sv': 'timestamp' };
const rc = () => Array.from({length:4},()=>CHARS[Math.floor(Math.random()*CHARS.length)]).join('');
// v3: rooms carry the players/<seat>={id,name,tab} identity roster and a unified
// room-state (ALL modes are created with state:'lobby').
const HOST = { id:'HOST0000', name:'Host', tab:'HOSTTAB0' };
const REC = (id) => ({ id:id||'GUEST001', name:'G', tab:'GTAB0001' });
const room = (o={}) => Object.assign({ v:3, config:{winTarget:3,fmt:'single'}, gen:0, state:'lobby', p:{0:true}, players:{0:HOST}, created:TS }, o);
const ffaRoom = (o={}) => Object.assign({ v:3, config:{winTarget:3,fmt:'ffa'}, gen:0, state:'lobby', p:{0:true}, players:{0:HOST}, created:TS }, o);

async function req(method, path, body){
  const r = await fetch(`${DB}/${path}.json`, { method, ...(body!==undefined?{body:JSON.stringify(body)}:{}) });
  let text=''; try{ text=await r.text(); }catch{}
  return { status:r.status, text:text.slice(0,160) };
}
const put = (p,b)=>req('PUT',p,b), del = p=>req('DELETE',p), get = p=>req('GET',p);
// PATCH = multi-path update: rules validate the MERGED tree exactly like the SDK
// update() the atomic seat-claim uses. All paths pass together or the whole write
// is rejected (atomic) — the vehicle for the 1v1/2v2 atomic guest claim below.
const patch = (p,b)=>req('PATCH',p,b);

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
  console.log(`\n=== 1v1 atomic match-claim + regression on v3  [room ${RA}] ===`);
  await expect('ALLOW','create single v3 (state lobby)',        await put(`rooms/${RA}`, room()));
  await expect('ALLOW','1v1 guest ATOMIC claim {p/1,players/1,state:playing}', await patch(`rooms/${RA}`, {'p/1':true,'players/1':REC(),'state':'playing'}));
  await expect('ALLOW','room now in playing (state check)',     await get(`rooms/${RA}/state`).then(r=>({status:r.text==='"playing"'?200:500,text:r.text})));
  await expect('DENY','p/1 overwrite (write-once)',             await put(`rooms/${RA}/p/1`, true));
  await expect('DENY','2nd guest claim p/1 while PLAYING',      await put(`rooms/${RA}/p/1`, true));
  await expect('DENY','seat 2 claim in single',                 await put(`rooms/${RA}/p/2`, true));
  await expect('DENY','playing->lobby rollback rejected',       await put(`rooms/${RA}/state`, 'lobby'));
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
  await expect('DENY','players/1 create while playing (id steal)', await put(`rooms/${RA}/players/1`, REC('EVIL0001')));
  await expect('ALLOW','host leaves: delete p/0',               await del(`rooms/${RA}/p/0`));
  await expect('DENY','host p/0 rejoin blocked while PLAYING',  await put(`rooms/${RA}/p/0`, true));
  await expect('ALLOW','guest leaves: delete p/1',              await del(`rooms/${RA}/p/1`));
  await expect('ALLOW','guest record delete after presence gone', await del(`rooms/${RA}/players/1`));

  const RD2 = await freshCode();
  console.log(`\n=== 2v2 atomic match-claim  [room ${RD2}] ===`);
  await expect('ALLOW','create double v3 (state lobby)',        await put(`rooms/${RD2}`, room({config:{winTarget:5,fmt:'double'}})));
  await expect('ALLOW','2v2 guest ATOMIC claim {p/1,players/1,state:playing}', await patch(`rooms/${RD2}`, {'p/1':true,'players/1':REC(),'state':'playing'}));
  await expect('ALLOW','2v2 room now in playing',              await get(`rooms/${RD2}/state`).then(r=>({status:r.text==='"playing"'?200:500,text:r.text})));
  await expect('DENY','2v2 2nd guest claim p/1 while PLAYING',  await put(`rooms/${RD2}/p/1`, true));
  await expect('DENY','2v2 seat 2 claim',                       await put(`rooms/${RD2}/p/2`, true));
  await expect('DENY','2v2 host p/0 rejoin while PLAYING',      await (async()=>{ await del(`rooms/${RD2}/p/0`); return put(`rooms/${RD2}/p/0`, true); })());

  const J = await freshCode();
  console.log(`\n=== invalid create rejects (unused code ${J}, none should persist) ===`);
  await expect('DENY','create v2 room (old client)',            await put(`rooms/${J}`, room({v:2})));
  await expect('DENY','fmt=triple',                             await put(`rooms/${J}`, room({config:{winTarget:3,fmt:'triple'}})));
  await expect('DENY','single WITHOUT state at create',         await put(`rooms/${J}`, (()=>{const r=room();delete r.state;return r;})()));
  await expect('DENY','single state=playing at create',         await put(`rooms/${J}`, room({state:'playing'})));
  await expect('DENY','single WITH seats at create',            await put(`rooms/${J}`, room({seats:2})));
  await expect('DENY','create WITHOUT players/0',               await put(`rooms/${J}`, (()=>{const r=room();delete r.players;return r;})()));
  await expect('DENY','create with players/1 prefilled',        await put(`rooms/${J}`, ffaRoom({players:{0:HOST,1:REC()}})));
  await expect('DENY','ffa WITHOUT state at create',            await put(`rooms/${J}`, (()=>{const r=ffaRoom();delete r.state;return r;})()));
  await expect('DENY','ffa with state=playing at create',       await put(`rooms/${J}`, ffaRoom({state:'playing'})));
  await expect('DENY','ffa with p/2 prefilled at create',       await put(`rooms/${J}`, ffaRoom({p:{0:true,2:true}})));
  await expect('DENY','ffa with seats prefilled at create',     await put(`rooms/${J}`, ffaRoom({seats:3})));
  await expect('ALLOW','unused code still absent (not persisted)', await get(`rooms/${J}`).then(r=>({status:r.text==='null'?200:500,text:r.text})));

  const RF = await freshCode();
  console.log(`\n=== ffa lifecycle + identity roster  [room ${RF}] ===`);
  await expect('ALLOW','create ffa room (state lobby)',         await put(`rooms/${RF}`, ffaRoom()));
  await expect('DENY','start with only host (no p/1)',          await put(`rooms/${RF}/state`, 'playing'));
  await expect('ALLOW','claim seat 1',                          await put(`rooms/${RF}/p/1`, true));
  await expect('DENY','re-claim occupied seat 1 (write-once)',  await put(`rooms/${RF}/p/1`, true));
  await expect('ALLOW','players/1 create after presence win',   await put(`rooms/${RF}/players/1`, REC('GUEST001')));
  await expect('DENY','players/1 id switch (immutable)',        await put(`rooms/${RF}/players/1`, REC('EVIL0001')));
  await expect('ALLOW','players/1 same-id update (name change)',await put(`rooms/${RF}/players/1`, {id:'GUEST001',name:'Neu',tab:'GTAB0001'}));
  await expect('DENY','players/1 delete while presence held',   await del(`rooms/${RF}/players/1`));
  await expect('DENY','players/2 create without presence',      await put(`rooms/${RF}/players/2`, REC('GUEST002')));
  await expect('DENY','players name too long (>48)',            await put(`rooms/${RF}/players/1`, {id:'GUEST001',name:'x'.repeat(49),tab:'GTAB0001'}));
  await expect('DENY','players extra field',                    await put(`rooms/${RF}/players/1`, {id:'GUEST001',name:'g',tab:'GTAB0001',hack:1}));
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
  await expect('DENY','players/4 create while playing',         await put(`rooms/${RF}/players/4`, REC('GUEST004')));
  await expect('ALLOW','move pl 3 idx 3',                       await put(`rooms/${RF}/g/0/t/0/3`, {idx:3,dx:10,dy:10,sp:0}));
  await expect('ALLOW','move pl 0 idx 4 (ffa only)',            await put(`rooms/${RF}/g/0/t/0/0`, {idx:4,dx:10,dy:10,sp:0}));
  await expect('DENY','move pl 5',                              await put(`rooms/${RF}/g/0/t/0/5`, {idx:0,dx:10,dy:10,sp:0}));
  await expect('DENY','move idx 5',                             await put(`rooms/${RF}/g/0/t/1/0`, {idx:5,dx:10,dy:10,sp:0}));
  await expect('ALLOW','match presence delete seat 2',          await del(`rooms/${RF}/p/2`));
  await expect('DENY','re-claim seat 2 in match (blocked)',     await put(`rooms/${RF}/p/2`, true));
  await expect('ALLOW','host reload in match: p/0 auto-clears', await del(`rooms/${RF}/p/0`));
  await expect('DENY','host p/0 restore blocked in match',      await put(`rooms/${RF}/p/0`, true));

  const RL = await freshCode();
  console.log(`\n=== lobby rejoin + seat recycling  [room ${RL}] ===`);
  await expect('ALLOW','create ffa lobby RL',                   await put(`rooms/${RL}`, ffaRoom()));
  await expect('ALLOW','guest claims seat 1',                   await put(`rooms/${RL}/p/1`, true));
  await expect('ALLOW','guest writes players/1',                await put(`rooms/${RL}/players/1`, REC('GUEST001')));
  await expect('ALLOW','guest reload: p/1 auto-clears (delete)', await del(`rooms/${RL}/p/1`));
  await expect('DENY','recycle by id switch (immutable even when free)', await put(`rooms/${RL}/players/1`, REC('NEW00001')));
  await expect('ALLOW','recycle step 1: delete stale record',   await del(`rooms/${RL}/players/1`));
  await expect('ALLOW','recycle step 2: presence win',          await put(`rooms/${RL}/p/1`, true));
  await expect('ALLOW','recycle step 3: create own record',     await put(`rooms/${RL}/players/1`, REC('NEW00001')));
  await expect('ALLOW','host reload: p/0 auto-clears',          await del(`rooms/${RL}/p/0`));
  await expect('ALLOW','host rejoin p/0 in LOBBY (players/0 kept)', await put(`rooms/${RL}/p/0`, true));

  const RS = await freshCode();
  console.log(`\n=== ffa seats bounds  [room ${RS}] ===`);
  await expect('ALLOW','create ffa room RS',                    await put(`rooms/${RS}`, ffaRoom()));
  await expect('ALLOW','claim seat 1 (min 2 players)',          await put(`rooms/${RS}/p/1`, true));
  await expect('ALLOW','start RS',                              await put(`rooms/${RS}/state`, 'playing'));
  await expect('DENY','seats=6',                                await put(`rooms/${RS}/seats`, 6));
  await expect('DENY','seats=1',                                await put(`rooms/${RS}/seats`, 1));
  await expect('ALLOW','seats=2',                               await put(`rooms/${RS}/seats`, 2));
  await expect('ALLOW','RS host reload: p/0 auto-clears',       await del(`rooms/${RS}/p/0`));
  await expect('DENY','host p/0 rejoin blocked in PLAYING',     await put(`rooms/${RS}/p/0`, true));

  // ── room cleanup delete (v1): whole-room delete allowed ONLY when empty ──
  const RC = await freshCode();
  console.log(`\n=== room cleanup delete  [room ${RC}] ===`);
  await expect('ALLOW','create room RC',                        await put(`rooms/${RC}`, room()));
  await expect('ALLOW','guest joins p/1',                       await put(`rooms/${RC}/p/1`, true));
  await expect('DENY','room delete blocked, host+guest present',await del(`rooms/${RC}`));
  await expect('ALLOW','host leaves p/0',                       await del(`rooms/${RC}/p/0`));
  await expect('DENY','room delete blocked, p/1 still present',  await del(`rooms/${RC}`));
  await expect('ALLOW','last guest leaves p/1',                 await del(`rooms/${RC}/p/1`));
  await expect('ALLOW','room delete when empty (cleanup)',      await del(`rooms/${RC}`));
  await expect('ALLOW','room gone after cleanup',               await get(`rooms/${RC}`).then(r=>({status:r.text==='null'?200:500,text:r.text})));

  // ── purge persistent test rooms: drop any presence, then delete the room ──
  console.log('\n=== cleanup: purge test rooms (needs cleanup rule live) ===');
  for(const c of [RA,RD2,RF,RL,RS]){
    for(let s=0;s<5;s++) await del(`rooms/${c}/p/${s}`);
    await expect('ALLOW',`delete test room ${c}`,               await del(`rooms/${c}`));
  }

  console.log(`\n==================== RESULT: ${pass} passed, ${fail} failed ====================`);
  if(fail) console.log('FAILED:', fails.join(' | '));
  console.log('Test rooms purged after run (cleanup rule): none should remain.');
  process.exit(fail?1:0);
})().catch(e=>{ console.error('SUITE ERROR:', e); process.exit(2); });
