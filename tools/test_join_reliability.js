#!/usr/bin/env node
// Beitritts-Zuverlaessigkeit: "Joining …" darf nie stehenbleiben, und ein Wiederholen darf
// nie einen zweiten Sitz belegen.
//
// Reproduziert (artifacts/join_reliability/): war die Verbindung im Moment des Tippens weg,
// blieb `get(rooms/<code>)` ueber 45 s offen - der Gast sah dauerhaft 'Joining …', und jeder
// weitere Tap lief in dieselbe Wand. Kein Fernschritt des Beitritts hatte eine Frist.
//
// Geprueft werden die ECHTEN Funktionen aus index.html in einer Sandbox:
//   A  joinFrist: haelt, begrenzt, meldet die Stufe, laesst nichts nachlaufen
//   B  claimSeatSlot: jeder Schreibschritt begrenzt, Ruecknahme begrenzt und best effort
//   C  joinNachFrist: der RAUM entscheidet - eigener Sitz wird uebernommen, sonst sichtbares Ende
//   D  joinRoom: Uebernahme vor jedem neuen Anspruch (Idempotenz), Fristen im Lesepfad
//   E  Quelltextvertrag: kein unbegrenzter Fernaufruf mehr im Beitritt, Spuren im Diagnosepuffer
//
//   node tools/test_join_reliability.js
//   JOIN_TEST_HTML=<andere index.html> node tools/test_join_reliability.js   (Gegenprobe)
'use strict';
const fs = require('fs');
const { loadIndexHtml } = require('./extract');
const html = process.env.JOIN_TEST_HTML
  ? fs.readFileSync(process.env.JOIN_TEST_HTML, 'utf8').replace(/\r\n/g, '\n')
  : loadIndexHtml();

let passed = 0, failed = 0;
function ok(c, name, info) {
  if (c) passed++;
  else { failed++; console.log('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
function block(src, kopf) {   // Funktionsrumpf per Klammerzaehlung
  const a = src.indexOf(kopf); if (a < 0) return '';
  let i = src.indexOf('{', a), t = 0;
  for (; i < src.length; i++) { if (src[i] === '{') t++; else if (src[i] === '}' && --t === 0) break; }
  return src.slice(a, i + 1);
}
const fristen = (html.match(/const JOIN_LESEN_MS=[\s\S]*?function joinDiag\(op,stufe,info\)\{[^\n]*/) || [''])[0];
const claimSrc = block(html, 'async function claimSeatSlot(');
const nachSrc = block(html, 'async function joinNachFrist(');
const joinSrc = block(html, 'function joinRoom(');
const v11Src = block(html, 'async function fbV11Beitritt(');
const claimSeatSrc = block(html, 'async function claimSeat(');

(async () => {
  process.on('unhandledRejection', e => { failed++; console.log('FAIL: unbehandelte Ablehnung ' + (e && e.message)); });

  // ── A: die Frist selbst ────────────────────────────────────────────────────
  let A = { joinFrist: () => Promise.reject(new Error('joinFrist fehlt')), istJoinFrist: () => false, JOIN_LESEN_MS: 0, JOIN_CLAIM_MS: 0, JOIN_ABGLEICH_MS: 0 };
  try { A = new Function(fristen + '\nreturn {joinFrist,istJoinFrist,JOIN_LESEN_MS,JOIN_CLAIM_MS,JOIN_ABGLEICH_MS};')(); } catch (e) {}
  ok(typeof A.joinFrist === 'function' && typeof A.istJoinFrist === 'function', 'A0 joinFrist und istJoinFrist sind im Produkt vorhanden');
  ok([A.JOIN_LESEN_MS, A.JOIN_CLAIM_MS, A.JOIN_ABGLEICH_MS].every(v => v >= 2000 && v <= 20000),
    'A1 die Fristen liegen im sinnvollen Bereich (2-20 s)', [A.JOIN_LESEN_MS, A.JOIN_CLAIM_MS, A.JOIN_ABGLEICH_MS]);
  ok(await A.joinFrist(Promise.resolve('x'), 1000, 's').catch(() => null) === 'x', 'A2 ein schneller Schritt geht unveraendert durch');
  {
    let e = null; const t0 = Date.now();
    try { await A.joinFrist(new Promise(() => {}), 120, 'lesen'); } catch (x) { e = x; }
    ok(!!e && e.joinStufe === 'lesen' && A.istJoinFrist(e), 'A3 ein haengender Schritt endet nach der Frist und nennt die Stufe', e && e.message);
    ok(Date.now() - t0 < 1000, 'A4 … und zwar zur Frist, nicht spaeter', Date.now() - t0);
  }
  {
    let e = null; try { await A.joinFrist(Promise.reject(new Error('permission_denied')), 1000, 's'); } catch (x) { e = x; }
    ok(!!e && !A.istJoinFrist(e), 'A5 ein echter Fehler bleibt ein echter Fehler (keine Frist-Verwechslung)');
  }
  {   // nach einem erfolgreichen Schritt darf keine spaete Ablehnung mehr kommen
    let spaet = null;
    const p = A.joinFrist(Promise.resolve(1), 30, 's'); p.catch(x => { spaet = x; });
    await p; await new Promise(r => setTimeout(r, 80));
    ok(spaet === null, 'A6 nach Erfolg laeuft keine Frist nach');
  }

  // ── B: Sitzanspruch ────────────────────────────────────────────────────────
  const claimWelt = (opt) => {
    const W = { rollback: 0, schritte: [], opt };
    try { W.lauf = new Function('W', `
      ${fristen}
      const onlineTab='TAB';
      function joinOpCurrent(){return W.opt.stale?false:true;}
      const haenger=()=>new Promise(()=>{});
      async function reserveSeat(){W.schritte.push('reserve'); if(W.opt.haengt==='reserve')return haenger(); return {ok:!W.opt.verloren};}
      async function reclaimSeat(){W.schritte.push('reclaim'); if(W.opt.haengt==='reclaim')return haenger(); return {ok:true};}
      async function armPresence(){W.schritte.push('presence'); if(W.opt.haengt==='presence')return haenger(); return {cancel(){}};}
      async function activateSeat(){W.schritte.push('activate'); if(W.opt.haengt==='activate')return haenger(); return true;}
      async function releaseReservation(){W.rollback++; if(W.opt.haengt==='rollback')return haenger(); return true;}
      ${claimSrc}
      return claimSeatSlot;`)(W); } catch (e) { W.lauf = async () => { throw new Error('Sandbox: ' + e.message); }; }
    return W;
  };
  for (const stufe of ['reserve', 'presence', 'activate']) {
    const W = claimWelt({ haengt: stufe });
    let e = null; const t0 = Date.now();
    try { await W.lauf('AAAA', 1, 1, undefined, false, null); } catch (x) { e = x; }
    ok(!!e && e.joinStufe === stufe, 'B ' + stufe + ': haengt der Schritt, endet er mit seiner Frist', e && (e.joinStufe || e.message));
    ok(Date.now() - t0 <= A.JOIN_CLAIM_MS + 2000, 'B ' + stufe + ': … innerhalb der Frist', Date.now() - t0);
    if (stufe !== 'reserve') ok(W.rollback === 1, 'B ' + stufe + ': die Reservierung wird zurueckgenommen', W.rollback);
  }
  {
    const W = claimWelt({ haengt: 'rollback' });
    // Presence haengt NICHT, aber die Ruecknahme: der Auftrag ist veraltet -> Ruecknahme laeuft
    W.opt.stale = true;
    const t0 = Date.now(); const r = await W.lauf('AAAA', 1, 1, undefined, false, null);
    ok(r && r.stale === true, 'B4 ein veralteter Auftrag endet als stale, nicht im Warten', r);
    ok(Date.now() - t0 <= A.JOIN_LESEN_MS + 4000, 'B5 auch eine haengende Ruecknahme wird begrenzt', Date.now() - t0);
  }
  {
    const W = claimWelt({});
    const r = await W.lauf('AAAA', 1, 1, undefined, false, null);
    ok(r && r.ok === true && W.schritte.join(',') === 'reserve,presence,activate', 'B6 der gesunde Anspruch laeuft unveraendert in drei Schritten', W.schritte);
  }
  {
    const W = claimWelt({ verloren: true });
    const r = await W.lauf('AAAA', 1, 1, undefined, false, null);
    ok(r && r.lost === true && W.rollback === 0, 'B7 ein verlorenes Rennen bleibt ein verlorenes Rennen (keine Ruecknahme noetig)', r);
  }

  // ── C: Abgleich nach einer Frist ───────────────────────────────────────────
  const nachWelt = (raum, opt) => {
    const W = { status: [], rejoin: 0, neuversuch: 0, gemerkt: null, diag: [], opt: opt || {} };
    try { W.lauf = new Function('W', `
      ${fristen}
      const onlinePid='PID';
      function fbUid(){return 'UID1';}
      function joinOpCurrent(){return !W.opt.stale;}
      function T(k){return k;}
      function setStatus(t){W.status.push(t);}
      function rememberRoom(c,s){W.gemerkt=[c,s];}
      async function attemptRejoin(c){W.rejoin++;W.status.push('rejoin:'+c);return true;}
      const onlineTab='MEIN-TAB'; let roomProto=0;
      function validateRoom(d){return W.opt.ungueltig?{ok:false,reason:'x'}:{ok:true,game:'ringout',fmt:'ffa',mode:'',cap:5,winTarget:3,gen:0,hostUid:''};}
      async function armPresence(){W.presence=(W.presence||0)+1; if(W.opt.presenceHaengt)return new Promise(()=>{}); return {cancel(){}};}
      async function activateSeat(){W.activate=(W.activate||0)+1; if(W.opt.activateWirft)throw new Error('permission_denied'); return true;}
      function joinFertig(code,seat){W.fertig=[code,seat];}
      function joinRoom(){W.neuversuch=(W.neuversuch||0)+1;W.autoFlag=joinAutoLauf;}
      function findOwnSeat(players,pid,uid){ if(!players)return -1;
        for(const k of Object.keys(players)){ if(players[k]&&players[k].uid===uid)return +k; } return -1; }
      const window={FB:{db:{},ref:()=>({}),get:()=>W.opt.leseHaengt?new Promise(()=>{}):Promise.resolve({exists:()=>!!W.raum,val:()=>W.raum})}};
      ${nachSrc}
      return joinNachFrist;`)(W); } catch (e) { W.lauf = async () => {}; }
    W.raum = raum;
    return W;
  };
  {
    const W = nachWelt({ players: { 2: { uid: 'UID1' } }, p: { 2: { s: 'X', on: false } } });
    await W.lauf('ABCD', 1, 'lesen');
    ok(W.rejoin === 1 && W.gemerkt && W.gemerkt[0] === 'ABCD' && W.gemerkt[1] === 2, 'C1 eigener Sitz mit FREMDEM Token -> Uebernahme ueber den Rueckkehrpfad', { r: W.rejoin, g: W.gemerkt });
    ok(W.status[0] === 'joinStuck', 'C2 der Gast sieht sofort einen wiederholbaren Zustand statt "Joining …"', W.status);
  }
  {   // die eigene, noch nicht aktivierte Reservierung DIESES Tabs: nur die Praesenz fehlt
    const W = nachWelt({ v: 8, players: { 3: { uid: 'UID1' } }, p: { 3: { s: 'MEIN-TAB', on: false } } });
    await W.lauf('ABCD', 1, 'activate');
    ok(W.presence === 1 && W.activate === 1, 'C1b eigene Reservierung wird AKTIVIERT (Praesenz + Aktivierung), nicht uebernommen', { p: W.presence, a: W.activate });
    ok(W.fertig && W.fertig[1] === 3 && W.rejoin === 0, 'C1c … und der Beitritt wird ueber denselben Abschluss fertiggestellt', { f: W.fertig, r: W.rejoin });
  }
  {   // schlaegt die Aktivierung fehl, bleibt der bestehende Weg (Uebernahme)
    const W = nachWelt({ v: 8, players: { 3: { uid: 'UID1' } }, p: { 3: { s: 'MEIN-TAB', on: false } } }, { activateWirft: true });
    await W.lauf('ABCD', 1, 'activate');
    ok(W.rejoin === 1 && !W.fertig, 'C1d scheitert die Aktivierung, bleibt es beim bestehenden Rueckkehrpfad', { r: W.rejoin, f: W.fertig });
  }
  {
    const W = nachWelt({ players: { 0: { uid: 'FREMD' } }, p: { 0: { on: true } } });
    await W.lauf('ABCD', 1, 'presence');
    ok(W.rejoin === 0, 'C3 fremder Sitz wird NIE uebernommen', W.status);
    ok(W.status[W.status.length - 1] === 'joinStuck', 'C4 ohne eigenen Sitz endet der Beitritt sichtbar und wiederholbar', W.status);
  }
  {
    const W = nachWelt(null);
    await W.lauf('ABCD', 1, 'lesen');
    ok(W.status.indexOf('noRoom') >= 0 && W.rejoin === 0, 'C5 ist der Raum weg, sagt es der Status', W.status);
  }
  {
    const W = nachWelt({ players: {} }, { leseHaengt: true });
    const t0 = Date.now(); await W.lauf('ABCD', 1, 'lesen');
    ok(Date.now() - t0 <= A.JOIN_ABGLEICH_MS + 2000, 'C6 auch der Abgleich selbst ist begrenzt', Date.now() - t0);
    ok(W.status[W.status.length - 1] === 'joinStuck', 'C7 … und endet sichtbar, nicht im Warten', W.status);
  }
  {
    const W = nachWelt({ players: {}, state: 'lobby' });
    await W.lauf('ABCD', 1, 'lesen', false);
    ok(W.neuversuch === 1 && W.rejoin === 0, 'C9 antwortet der Raum wieder und nichts ist beansprucht: genau EIN automatischer zweiter Anlauf', { n: W.neuversuch, s: W.status });
    const W2 = nachWelt({ players: {}, state: 'lobby' });
    await W2.lauf('ABCD', 1, 'lesen', true);
    ok(W2.neuversuch === 0 && W2.status[W2.status.length - 1] === 'joinStuck', 'C10 … und der zweite Anlauf startet keinen dritten', { n: W2.neuversuch, s: W2.status });
    const W3 = nachWelt({ players: {}, state: 'playing' });
    await W3.lauf('ABCD', 1, 'lesen', false);
    ok(W3.neuversuch === 0, 'C11 laeuft das Match bereits, wird nichts automatisch wiederholt', W3.status);
  }
  {
    const W = nachWelt({ players: { 2: { uid: 'UID1' } } }, { stale: true });
    await W.lauf('ABCD', 1, 'lesen');
    ok(W.rejoin === 0, 'C8 ein ueberholter Auftrag uebernimmt nichts mehr', W.status);
  }

  // ── C2: ein entwerteter Auftrag endet nicht stumm ─────────────────────────
  {
    const stornoSrc = block(html, 'function joinStorno(');
    const welt = (opt) => { const W = { status: [], diag: [] };
      try { new Function('W', `
        let joinStarts=${opt.starts}, online=${opt.online};
        function joinOpCurrent(op){return ${opt.aktuell};}
        function setStatus(t){W.status.push(t);} function T(k){return k;}
        function joinDiag(op,st,i){W.diag.push(st+':'+i);}
        ${stornoSrc}
        joinStorno(7,${opt.startNr});`)(W); } catch (e) { W.fehler = e.message; }
      return W; };
    const a = welt({ starts: 5, startNr: 5, online: false, aktuell: false });
    ok(a.status[0] === 'joinStuck' && a.diag.some(d => d.startsWith('storno')),
      'C12 ein durch VERLASSEN entwerteter Beitritt endet sichtbar, nicht stumm', { s: a.status, d: a.diag, f: a.fehler });
    const b = welt({ starts: 6, startNr: 5, online: false, aktuell: false });
    ok(b.status.length === 0, 'C13 hat ein NEUERER Beitritt uebernommen, schweigt der alte', b.status);
    const c = welt({ starts: 5, startNr: 5, online: false, aktuell: true });
    ok(c.status.length === 0, 'C14 ein gueltiger Auftrag wird nicht angefasst', c.status);
    const d = welt({ starts: 5, startNr: 5, online: true, aktuell: false });
    ok(d.status.length === 0 && d.diag.some(x => x.indexOf('online') >= 0),
      'C15 wer schon drin ist, bekommt keine Fehlmeldung - die Spur haelt es trotzdem fest', { s: d.status, d: d.diag });
    ok(/const startNr=\+\+joinStarts;/.test(joinSrc) && /\}finally\{ joinStorno\(op,startNr\); \}/.test(joinSrc),
      'C16 jeder Beitrittsversuch zaehlt sich und prueft am Ende, ob er entwertet wurde');
    const rj = block(html, 'async function attemptRejoin(');
    ok(/const op=newJoinOp\(\); const startNr=\+\+joinStarts;/.test(rj) && /\}finally\{ joinStorno\(op,startNr\); \}/.test(rj),
      'C17 dasselbe gilt fuer die Rueckkehr');
  }

  // ── D/E: Verdrahtung im Produkt ────────────────────────────────────────────
  ok(/const s=await joinFrist\(window\.FB\.get\(window\.FB\.ref\(window\.FB\.db,'rooms\/'\+code\)\),JOIN_LESEN_MS,'lesen'\)/.test(joinSrc),
    'D1 der Raum wird mit Frist gelesen');
  const uebernahmeAt = joinSrc.indexOf('const eigener=findOwnSeat(d.players,onlinePid,fbUid());');
  ok(uebernahmeAt > 0 && /if\(eigener>=0&&!\(d\.p&&seatActive\(d\.p,eigener\)\)\)\{[\s\S]*?attemptRejoin\(code\)/.test(joinSrc),
    'D2 ein bereits eigener, nicht aktiver Sitz wird uebernommen statt ein zweiter belegt');
  ok(uebernahmeAt > 0 && uebernahmeAt < joinSrc.indexOf('claimSeat(code,op,cap') && uebernahmeAt < joinSrc.indexOf('claimSeatSlot(code,1,op'),
    'D3 … und zwar VOR jedem Anspruch (Idempotenz)');
  ok(/if\(istJoinFrist\(e\)\)\{ await joinNachFrist\(code,op,e\.joinStufe,!!autoVersuch\); return; \}/.test(joinSrc)
     && /const autoVersuch=joinAutoLauf; joinAutoLauf=false;/.test(joinSrc),
    'D4 eine abgelaufene Frist fuehrt in den Abgleich, nicht in eine Fehlermeldung');
  ok(/joinDiag\(op,'start',code\)/.test(joinSrc) && /joinDiag\(op,'lobby'/.test(joinSrc),
    'D5 Beginn und Erfolg stehen im lokalen Diagnosepuffer (?diag=1)');
  ok(!/await window\.FB\.get\(/.test(joinSrc) && !/await window\.FB\.get\(/.test(claimSeatSrc) && !/await window\.FB\.get\(/.test(v11Src),
    'E1 kein unbegrenztes Lesen mehr im gesamten Beitrittspfad');
  ok(!/await reserveSeat\(|await armPresence\(|await activateSeat\(|await reclaimSeat\(/.test(claimSrc),
    'E2 kein unbegrenztes Schreiben mehr im Sitzanspruch');
  ok(/joinDiag\(op,'frist',stufe\)/.test(nachSrc), 'E3 eine abgelaufene Frist hinterlaesst ihre Stufe im Puffer');
  ok(!/fetch\(|sendBeacon|XMLHttpRequest/.test(fristen + nachSrc), 'E4 die Spuren bleiben lokal - nichts wird gesendet');
  for (const k of ['joinStuck']) ok((html.match(new RegExp('\\n  ' + k + ":'", 'g')) || []).length === 3, 'E5 Text "' + k + '" in allen drei Sprachen');
  // Football: Szene laden und Raummitgliedschaft bleiben getrennte Zustaende
  ok(/if\(joinFb&&!r3dActive\)setStatus\(T\('szeneLaedt'\)\);/.test(joinSrc) && /setStatus\(T\('joining'\)\)/.test(joinSrc),
    'E6 "Arena laedt" und "Beitritt laeuft" bleiben unterscheidbare Zustaende');

  console.log('Join-Reliability: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
