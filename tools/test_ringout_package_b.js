#!/usr/bin/env node
// Package B: RingOut FFA, Triple und Team Duel - ein Teilnehmer geht waehrend des Matches.
//
// Frueher fuellte ein Mitspieler den Slot des Abgegangenen mit einem untypisierten Null-Zug;
// seit Fund 2 lehnen die Rules das ab, und der Zug schloss nie. v12 fuehrt stattdessen den
// typisierten Skip {k:'skip'} ein (Rules: tools/test_rules.js, Abschnitt 17). Diese Suite
// fuehrt die ECHTEN Client-Funktionen aus index.html aus:
//   A  Raumfassung: FFA-Familie -> v12, Versus -> v8
//   B  processSlot: ein Skip heisst 'steht still' - kein Ausscheiden, kein Hinausschieben
//   C  applyLaunch: ein uebersprungener Sitz bewegt keine Kugel
//   D  writeRingoutSkip: schreibt nur, was die Rules zulassen, und nur fuer Abwesende
//   E  scheduleRingoutSkip: hoechstens 3 Versuche, Ende bei Rueckkehr/Zugwechsel/Erfolg
//   F  Bestand: v8-Raeume und Football behalten ihr Verhalten
//   G  Determinismus: zwei Clients mit denselben Slots kommen zum selben Zustand
'use strict';
const { loadIndexHtml, grab, grabFunction } = require('./extract');
const html = loadIndexHtml();

let passed = 0, failed = 0;
function ok(c, name, info) {
  if (c) passed++;
  else { failed++; console.log('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}

const Q = {
  roomGame: grab(html, /const ROOM_GAME_RINGOUT=[^\n]*/, 'ROOM_GAME_RINGOUT'),
  versuche: grab(html, /const RINGOUT_SKIP_VERSUCHE=[^\n]*/, 'RINGOUT_SKIP_VERSUCHE'),
  ver: grab(html, /const ONLINE_PROTOCOL_VERSION=[^\n]*/, 'ONLINE_PROTOCOL_VERSION'),
  fassung: grabFunction(html, 'fbRaumFassung'),
  fassungOk: grabFunction(html, 'fbRaumFassungOk'),
  skipRaum: grabFunction(html, 'ringoutSkipRaum'),
  processSlot: grabFunction(html, 'processSlot'),
  applyLaunch: grabFunction(html, 'applyLaunch'),
  writeSkip: grabFunction(html, 'writeRingoutSkip'),
  planSkip: grabFunction(html, 'scheduleRingoutSkip'),
};

// ── A: Raumfassung ────────────────────────────────────────────────────────────
{
  const M = new Function(Q.ver + '\n' + Q.roomGame + '\nconst FB_ONLINE_MODE_LIVES="lives";\n' + Q.fassung + '\n' + Q.fassungOk +
    '\nreturn {fbRaumFassung, fbRaumFassungOk, V: RINGOUT_SKIP_FASSUNG};')();
  ok(M.V === 12, 'A1 die RingOut-FFA-Fassung ist 12', M.V);
  for (const f of ['ffa', 'triple_ffa', 'team_duel'])
    ok(M.fbRaumFassung({ game: 'ringout', fmt: f }) === 12, 'A2 neuer RingOut-Raum ' + f + ' wird v12');
  for (const f of ['single', 'double'])
    ok(M.fbRaumFassung({ game: 'ringout', fmt: f }) === 8, 'A3 Versus ' + f + ' bleibt v8');
  ok(M.fbRaumFassungOk(12) === true && M.fbRaumFassungOk(8) === true, 'A4 der Client bedient v8 und v12');
  ok(M.fbRaumFassungOk(13) === false, 'A5 eine unbekannte Fassung bleibt abgewiesen');
  // Die Paarung beim Beitritt (v12 nur fuer die FFA-Familie) pruefen test_validateroom.js
  // (v12-Versus wird abgewiesen) und test_ffa_flow.js (Gaeste treten einem v12-FFA-Raum
  // ueber den echten joinRoom/validateRoom-Pfad bei) - hier keine zweite Nachbildung.
}

// ── Sandbox fuer den Zugpfad ─────────────────────────────────────────────────
function welt(opt) {
  const W = { schreib: [], timer: [], hud: 0 };
  const src = `
    ${Q.roomGame}
    ${Q.versuche}
    let online=true, roomProto=${opt.proto}, gameStarted=true, phase='aim', myPlayer=${opt.ich || 0};
    let mode='${opt.mode || 'ffa'}', fmt='${opt.fmt || 'ffa'}';
    const N=${opt.n};
    let aimSet=Array(N).fill(false), commitIdx=Array(N).fill(-1), commitAim=Array.from({length:N},()=>({dx:0,dy:0})), commitSpin=Array(N).fill(0);
    let seatGone=[], seatLeft=${JSON.stringify(opt.left || [])}, pendingSlot={}, skipVersuche={}, fbRemovePending=[];
    const TURN_REMOVE='remove', SENTINEL_RETRY_BASE_MS=300, SENTINEL_RETRY_MAX_MS=2000;
    let gen=0, turnNo=0, onlineSessionId=1, roomCode='KX7P', terminated=false;
    const balls=${JSON.stringify(opt.balls || [])};
    function isOnlineTerminated(){return terminated;}
    function clearSentinelRetry(){}
    function updateHud(){W.hud++;} function setPhaseText(){}
    function aliveCount(s){return balls.filter(b=>b.alive&&b.owner===s).length;}
    function sanitizeMove(who,idx,dx,dy,sp){
      const own=Number.isInteger(idx)&&balls[idx]&&balls[idx].owner===who;
      return {idx:own?idx:balls.findIndex(b=>b.alive&&b.owner===who),dx:+dx||0,dy:+dy||0,sp:+sp||0};}
    function writeTurnSlot(s,payload,o){W.schreib.push({s,payload,o});}
    function isCurrentCtx(c){return c.sid===onlineSessionId&&c.room===roomCode&&c.gen===gen&&c.turnNo===turnNo;}
    function setTimeout(f,ms){W.timer.push({f,ms});}
    function devSync(){} function fbSfxLaunch(){} function simTickReset(){} function setPhase(p){phase=p;}
    const SFX={launch(){}}; let r3dActive=false, replaying=false;
    function maxPull(){return 150;} function spawn(){} const PCOLS=[{ui:'#fff'}]; function colorSlot(){return 0;}
    const BR=18, LAUNCH=1;
    ${Q.skipRaum}
    ${Q.processSlot}
    ${Q.applyLaunch}
    ${Q.writeSkip}
    ${Q.planSkip}
    W.S=()=>({aimSet:aimSet.slice(),commitIdx:commitIdx.slice(),seatGone:seatGone.slice(),phase,balls:JSON.parse(JSON.stringify(balls))});
    W.set=(k,v)=>{ if(k==='turnNo')turnNo=v; if(k==='seatLeft')seatLeft=v; if(k==='aimSet')aimSet=v; if(k==='phase')phase=v; if(k==='term')terminated=v; };
    return {processSlot, applyLaunch, writeRingoutSkip, scheduleRingoutSkip};`;
  Object.assign(W, new Function('W', src)(W));
  return W;
}
const kugeln = n => Array.from({ length: n }, (_, i) => ({ owner: i, alive: true, x: 100 * i, y: 50, vx: 0, vy: 0, spin: 0 }));
const SKIP = { k: 'skip', idx: 0, dx: 0, dy: 0, sp: 0 };

// ── B: processSlot ───────────────────────────────────────────────────────────
for (const [fmt, n] of [['ffa', 3], ['ffa', 5], ['triple_ffa', 3], ['team_duel', 4]]) {
  const w = welt({ proto: 12, fmt, n, balls: kugeln(n) });
  w.processSlot(2, SKIP);
  const s = w.S();
  ok(s.aimSet[2] === true, 'B1 ' + fmt + '/' + n + ': Skip schliesst den Slot');
  ok(s.commitIdx[2] === -1, 'B2 ' + fmt + '/' + n + ': ein Skip startet keine Kugel', s.commitIdx);
  ok(!s.seatGone[2], 'B3 ' + fmt + '/' + n + ': ein Skip laesst den Sitz NICHT ausscheiden', s.seatGone);
}
{
  const w = welt({ proto: 12, n: 3, balls: kugeln(3) });
  w.processSlot(1, { idx: 1, dx: 40, dy: -20, sp: 0 });
  ok(w.S().commitIdx[1] === 1 && !w.S().seatGone[1], 'B4 ein normaler Zug in v12 bleibt ein Zug');
  w.processSlot(1, SKIP);
  ok(w.S().commitIdx[1] === 1, 'B5 ein spaeter Skip ueberschreibt einen gueltigen Zug nicht (aimSet schuetzt)');
}

// ── C: applyLaunch ───────────────────────────────────────────────────────────
{
  const w = welt({ proto: 12, n: 3, balls: kugeln(3) });
  w.processSlot(0, { idx: 0, dx: 30, dy: 0, sp: 0 });
  w.processSlot(1, { idx: 1, dx: 0, dy: 25, sp: 0 });
  w.processSlot(2, SKIP);
  w.applyLaunch();
  const b = w.S().balls;
  ok(b[0].vx !== 0 && b[1].vy !== 0, 'C1 die Anwesenden starten ihre Kugeln');
  ok(b[2].vx === 0 && b[2].vy === 0 && b[2].alive === true, 'C2 die Kugel des Abwesenden bleibt ruhig liegen und im Spiel', b[2]);
  ok(w.S().phase === 'sim', 'C3 der Zug laeuft in die Simulation');
}

// ── D: writeRingoutSkip ──────────────────────────────────────────────────────
{
  const w = welt({ proto: 12, n: 3, balls: kugeln(3), left: [false, false, true] });
  w.writeRingoutSkip(2);
  ok(w.schreib.length === 1 && w.schreib[0].s === 2, 'D1 fuer einen abwesenden Sitz wird geschrieben');
  ok(JSON.stringify(w.schreib[0].payload) === JSON.stringify(SKIP), 'D2 exakt die kanonische Skip-Form', w.schreib[0].payload);
  ok(w.schreib[0].o.skip === true && !w.schreib[0].o.sentinel, 'D3 als Skip gekennzeichnet, nicht als alter Sentinel', w.schreib[0].o);
  w.writeRingoutSkip(1);
  ok(w.schreib.length === 1, 'D4 nie fuer einen anwesenden Sitz');
  w.writeRingoutSkip(0);
  ok(w.schreib.length === 1, 'D5 nie fuer den eigenen Sitz');
}
{
  const w = welt({ proto: 8, n: 3, balls: kugeln(3), left: [false, false, true] });
  w.writeRingoutSkip(2);
  ok(w.schreib.length === 0, 'D6 in einem v8-Raum nie (dort gibt es den Skip nicht)');
}
{
  const w = welt({ proto: 12, n: 3, balls: kugeln(3), left: [false, false, true] });
  w.set('aimSet', [false, false, true]); w.writeRingoutSkip(2);
  ok(w.schreib.length === 0, 'D7 nicht, wenn der Slot schon geschlossen ist');
  w.set('aimSet', [false, false, false]); w.set('phase', 'sim'); w.writeRingoutSkip(2);
  ok(w.schreib.length === 0, 'D8 nicht ausserhalb der Planungsphase');
}
{
  const b = kugeln(3); b[2].alive = false;
  const w = welt({ proto: 12, n: 3, balls: b, left: [false, false, true] });
  w.writeRingoutSkip(2);
  ok(w.schreib.length === 0, 'D9 nicht fuer einen Sitz ohne lebende Kugel (er wird ohnehin nicht erwartet)');
}

// ── E: scheduleRingoutSkip ───────────────────────────────────────────────────
{
  const w = welt({ proto: 12, n: 3, balls: kugeln(3), left: [false, false, true] });
  const ctx = { sid: 1, room: 'KX7P', gen: 0, turnNo: 0 };
  let versuche = 0;
  for (let i = 0; i < 10; i++) { const vor = w.timer.length; w.scheduleRingoutSkip(2, ctx); if (w.timer.length > vor) { versuche++; w.timer.pop().f(); } }
  ok(versuche === 2, 'E1 nach der Abweisung hoechstens zwei Wiederholungen (3 Versuche insgesamt)', versuche);
  ok(w.schreib.length === 2, 'E2 jede Wiederholung schreibt genau einmal', w.schreib.length);
}
{
  const w = welt({ proto: 12, n: 3, balls: kugeln(3), left: [false, false, true] });
  const ctx = { sid: 1, room: 'KX7P', gen: 0, turnNo: 0 };
  w.scheduleRingoutSkip(2, ctx); w.set('seatLeft', [false, false, false]); w.timer.pop().f();
  ok(w.schreib.length === 0, 'E3 kehrt der Sitz zurueck, endet die Kette');
  w.set('seatLeft', [false, false, true]); w.scheduleRingoutSkip(2, ctx); w.set('turnNo', 1); w.timer.pop().f();
  ok(w.schreib.length === 0, 'E4 nach einem Zugwechsel endet die Kette');
  w.set('turnNo', 0); w.scheduleRingoutSkip(2, { sid: 1, room: 'KX7P', gen: 0, turnNo: 5 });
  w.set('term', true); const vor = w.timer.length; w.scheduleRingoutSkip(2, ctx);
  ok(w.timer.length === vor, 'E5 nach einem Sitzungsabbruch wird nichts mehr geplant');
}
{
  const w = welt({ proto: 12, n: 3, balls: kugeln(3), left: [false, false, true] });
  const ctx = { sid: 1, room: 'KX7P', gen: 0, turnNo: 0 };
  w.scheduleRingoutSkip(2, ctx);
  ok(w.timer.length === 1 && w.timer[0].ms >= 1000, 'E6 Abstand mindestens 1 s (faengt Uhrfehler an der 30-s-Frist auf)', w.timer[0] && w.timer[0].ms);
}

// ── F: Bestand ───────────────────────────────────────────────────────────────
{
  const w = welt({ proto: 8, n: 3, balls: kugeln(3) });
  w.processSlot(2, { idx: 0, dx: 0, dy: 0, sp: 0 });
  ok(w.S().seatGone[2] === true, 'F1 v8: der alte Sentinel wirkt unveraendert (Bestandsraeume)');
}
{
  const w = welt({ proto: 11, mode: 'football', fmt: 'elimination', n: 3, balls: kugeln(3) });
  w.processSlot(2, { k: 'skip', idx: 2, dx: 0, dy: 0, sp: 0 });
  ok(w.S().commitIdx[2] === 2, 'F2 Football behandelt seinen Skip weiter auf eigenem Weg', w.S().commitIdx);
}

// ── G: Determinismus ─────────────────────────────────────────────────────────
{
  const slots = [{ idx: 0, dx: 12, dy: -30, sp: 0 }, SKIP, { idx: 2, dx: -40, dy: 5, sp: 0.5 }, SKIP];
  const lauf = () => { const w = welt({ proto: 12, n: 4, fmt: 'ffa', balls: kugeln(4) });
    slots.forEach((c, s) => w.processSlot(s, c)); w.applyLaunch(); return JSON.stringify(w.S()); };
  ok(lauf() === lauf(), 'G1 zwei Clients mit denselben Slots erreichen denselben Zustand');
}

console.log('RingOut-Package-B: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
