// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Zugzeit-Anzeige (7 s): Verhalten, Tick-Vertrag und Zeitquelle
//
//   node tools/test_turn_timer.js
//
// Der wichtigste Punkt ist NICHT die Optik, sondern der Vertrag dahinter: die
// Anzeige darf keine eigene Uhr sein. Sie liest online exakt die Deadline, gegen
// die tickOnlineClock() den No-Shot anfordert, und lokal exakt den Wert, den
// turnDeadlinePassed() prueft. Alle Funktionen werden VERBATIM aus index.html
// extrahiert — es wird nichts nachgebaut.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const grab = (re, name) => {
  const m = HTML.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(2); }
  return m[0];
};

const SRC = [
  grab(/const TURN_LIMIT_SECONDS=[^\n]*/, 'TURN_LIMIT_SECONDS'),
  grab(/const COLLAPSE_STAGE_COUNT=[^\n]*/, 'collapse constants'),
  grab(/const GEN_MAX=[^\n]*/, 'GEN_MAX'),
  grab(/const TURN_URGENT_SECONDS=[^\n]*/, 'TURN_URGENT_SECONDS'),
  grab(/let onlineTurnDeadlineAt=null, onlineTurnWindowMs=0;/, 'online turn deadline state'),
  grab(/let turnTickKey='', turnTickSec=-1, turnUpDone=false;/, 'tick latches'),
  grab(/function turnRemainMs\(\)\{[^\n]*/, 'turnRemainMs'),
  grab(/function onlineTurnUsedMs\(sVal,maxTs,capMs\)\{[\s\S]*?\n\}/, 'onlineTurnUsedMs'),
  grab(/function onlineFold\(stamps,tsMap,uptoTurn\)\{[\s\S]*?\n\}/, 'onlineFold'),
  grab(/function onlineClock\(stamps,tsMap,curTurn,nowSrv\)\{[\s\S]*?\n\}/, 'onlineClock'),
  grab(/function turnTimerKey\(\)\{[\s\S]*?\n\}/, 'turnTimerKey'),
  grab(/function turnTimerState\(\)\{[\s\S]*?\n\}/, 'turnTimerState'),
  grab(/function updateTurnTimerHud\(\)\{[\s\S]*?\n\}/, 'updateTurnTimerHud'),
].join('\n');

// Minimale DOM-/SFX-Sandbox. Nur die Symbole, die die extrahierten Funktionen lesen.
function build() {
  const env = `
    const els={};
    function mkEl(){return {style:{display:''},textContent:'',_cls:new Set(),
      classList:{add(c){this._o._cls.add(c);},remove(){for(const c of arguments)this._o._cls.delete(c);},
                 toggle(c,on){if(on)this._o._cls.add(c);else this._o._cls.delete(c);},
                 contains(c){return this._o._cls.has(c);}}};}
    function $(id){ if(!els[id]){const e=mkEl();e.classList._o=e;els[id]=e;} return els[id]; }
    const sfxLog=[];
    const SFX={tick(){sfxLog.push('tick');},turnUp(){sfxLog.push('turnUp');}};
    let soundOn=true;
    let phase='aim', menuVisible=false, coverOpen=false;
    let online=false, gameStarted=false, gen=0, turnNo=0, roundNo=1;
    let collapseEnabled=true, collapseState='running';
    let turnWindowEndEl=null, turnWindowSeat=-1, matchElapsedMs=0;
    let collapseCountVisible=false;
    let srvNow=0;
    function serverNow(){return srvNow;}
    function collapseActive(){return collapseEnabled&&!online;}
    ${SRC}
    return {
      // Zustandssteuerung des Tests (nur Eingaben, nie Ergebnisse)
      set(o){ for(const k in o){ switch(k){
        case 'phase': phase=o[k];break; case 'menuVisible': menuVisible=o[k];break;
        case 'coverOpen': coverOpen=o[k];break; case 'online': online=o[k];break;
        case 'gameStarted': gameStarted=o[k];break; case 'gen': gen=o[k];break;
        case 'turnNo': turnNo=o[k];break; case 'roundNo': roundNo=o[k];break;
        case 'collapseEnabled': collapseEnabled=o[k];break; case 'collapseState': collapseState=o[k];break;
        case 'turnWindowEndEl': turnWindowEndEl=o[k];break; case 'turnWindowSeat': turnWindowSeat=o[k];break;
        case 'matchElapsedMs': matchElapsedMs=o[k];break;
        case 'collapseCountVisible': collapseCountVisible=o[k];break;
        case 'srvNow': srvNow=o[k];break; case 'soundOn': soundOn=o[k];break;
        case 'deadlineAt': onlineTurnDeadlineAt=o[k];break; case 'windowMs': onlineTurnWindowMs=o[k];break;
        default: throw new Error('unbekanntes Feld '+k); } } },
      // Produktionsfunktionen
      tick(){ updateTurnTimerHud(); },
      state(){ return turnTimerState(); },
      key(){ return turnTimerKey(); },
      clock(stamps,ts,curTurn,now){ return onlineClock(stamps,ts,curTurn,now); },
      // Sichtbares Ergebnis
      hud(){ const e=$('turnTimer');
        return { display:e.style.display, urgent:e.classList.contains('urgent'), up:e.classList.contains('up'),
                 num:$('turnTimerNum').textContent, fill:$('turnTimerFill').style.transform }; },
      sfx(){ return sfxLog.slice(); },
      clearSfx(){ sfxLog.length=0; },
      // Mute wird im Produktivcode zentral in SFX.go() geprueft; hier wird derselbe
      // Vertrag nachgebildet, indem der Spy nur bei soundOn protokolliert.
      muteSpy(){ SFX.tick=()=>{ if(soundOn)sfxLog.push('tick'); }; SFX.turnUp=()=>{ if(soundOn)sfxLog.push('turnUp'); }; },
      TURN_LIMIT_SECONDS, TURN_URGENT_SECONDS,
    };
  `;
  return new Function(env)();
}

const G = build();
G.muteSpy();
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; return; } fail++; console.error('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); };

// Lokale Aim-Phase mit frischem Fenster aufsetzen.
function localTurn(elapsed, endEl) {
  G.set({ online: false, gameStarted: false, phase: 'aim', menuVisible: false, coverOpen: false,
          collapseEnabled: true, collapseState: 'running', roundNo: 1, turnWindowSeat: 0,
          matchElapsedMs: elapsed, turnWindowEndEl: endEl, collapseCountVisible: false, soundOn: true });
}
// Online-Aim-Phase: die Anzeige liest die von tickOnlineClock gesetzte Deadline.
function onlineTurn(nowSrv, deadlineAt, windowMs) {
  G.set({ online: true, gameStarted: true, phase: 'aim', menuVisible: false,
          srvNow: nowSrv, deadlineAt: deadlineAt, windowMs: windowMs == null ? 7000 : windowMs,
          collapseCountVisible: false, soundOn: true });
}

// ── 1) Anzeige startet bei 7 Sekunden ───────────────────────────────────────
{
  localTurn(0, 7000); G.clearSfx(); G.tick();
  const h = G.hud();
  t('1.1 lokal: Anzeige sichtbar', h.display === '');
  t('1.2 lokal: startet bei 7', h.num === '7', h.num);
  t('1.3 lokal: Balken voll', h.fill === 'scaleX(1)', h.fill);
  t('1.4 lokal: kein Puls bei 7', h.urgent === false);

  onlineTurn(1000, 8000, 7000); G.clearSfx(); G.tick();
  const o = G.hud();
  t('1.5 online: startet bei 7', o.num === '7', o.num);
  t('1.6 online: Balken voll', o.fill === 'scaleX(1)', o.fill);
  // Restlicher Server-Offset darf nie eine 8 zeigen: die Anzeige ist auf das
  // Fenster geklemmt (die Deadline selbst bleibt unveraendert).
  onlineTurn(600, 8000, 7000); G.tick();
  t('1.7 online: Offset-Rest zeigt trotzdem hoechstens 7', G.hud().num === '7', G.hud().num);
  t('1.8 online: Balken nie ueber voll', G.hud().fill === 'scaleX(1)', G.hud().fill);
  onlineTurn(0, 9500, 7000); G.tick();
  t('1.9 online: grober Vorlauf bleibt auf 7 geklemmt', G.hud().num === '7', G.hud().num);
}

// ── 2) Anzeige nimmt passend zur echten Deadline ab ─────────────────────────
{
  // Lokal: turnRemainMs() = turnWindowEndEl - matchElapsedMs — dieselbe Groesse,
  // die turnDeadlinePassed() prueft.
  for (const [elapsed, expect] of [[0, '7'], [500, '7'], [1000, '6'], [3500, '4'], [6001, '1'], [7000, '0']]) {
    localTurn(elapsed, 7000); G.tick();
    t(`2.1 lokal ${elapsed} ms -> ${expect}`, G.hud().num === expect, G.hud().num);
  }
  // Online: dieselbe Deadline, gegen die der No-Shot angefordert wird.
  for (const [now, expect] of [[1000, '7'], [2000, '6'], [5000, '3'], [7500, '1'], [8000, '0'], [9000, '0']]) {
    onlineTurn(now, 8000, 7000); G.tick();
    t(`2.2 online now=${now} -> ${expect}`, G.hud().num === expect, G.hud().num);
  }
  // Fortschrittsbalken folgt dem Fenster, nicht einer festen 7.
  onlineTurn(1000, 4000, 3000); G.tick();
  t('2.3 verkuerztes Fenster: Balken relativ zum echten Fenster', G.hud().fill === 'scaleX(1)', G.hud().fill);
  onlineTurn(2500, 4000, 3000); G.tick();
  t('2.4 verkuerztes Fenster: halbe Restzeit -> halber Balken', G.hud().fill === 'scaleX(0.5)', G.hud().fill);
}

// ── 3)+4) Tick genau einmal bei 3/2/1, kein Tick bei 7..4 ───────────────────
{
  localTurn(0, 7000); G.tick(); G.clearSfx();
  // 7..4 durchlaufen, mehrere Frames je Sekunde
  for (const ms of [0, 200, 900, 1000, 1500, 2000, 2500, 3000, 3400]) { localTurn(ms, 7000); G.tick(); }
  t('4.1 kein Tick zwischen 7 und 4', G.sfx().length === 0, G.sfx());
  // 3,2,1 — jeweils mehrere Frames pro Sekunde
  for (const ms of [4001, 4300, 4800, 5001, 5400, 5900, 6001, 6300, 6900]) { localTurn(ms, 7000); G.tick(); }
  t('3.1 genau drei Ticks fuer 3/2/1', G.sfx().filter((x) => x === 'tick').length === 3, G.sfx());
  t('3.2 nur Ticks, noch kein Time-up', G.sfx().every((x) => x === 'tick'), G.sfx());
  // 0 -> genau ein Time-up-Impuls, auch ueber mehrere Frames
  for (const ms of [7000, 7100, 7600]) { localTurn(ms, 7000); G.tick(); }
  t('3.3 genau EIN Time-up-Impuls bei 0', G.sfx().filter((x) => x === 'turnUp').length === 1, G.sfx());
  t('3.4 Endzustand markiert (up), kein Dauerpuls', G.hud().up === true && G.hud().urgent === false, G.hud());
}

// ── 5) Mute verhindert die Ticks ────────────────────────────────────────────
{
  localTurn(0, 7000); G.tick(); G.clearSfx();
  G.set({ soundOn: false });
  for (const ms of [4001, 5001, 6001, 7000]) { localTurn(ms, 7000); G.set({ soundOn: false }); G.tick(); }
  t('5.1 stumm: kein Tick, kein Time-up', G.sfx().length === 0, G.sfx());
  // Gegenprobe: mit Ton laeuft derselbe Ablauf hoerbar.
  G.set({ turnWindowEndEl: null }); G.tick();   // Fenster schliessen -> Latches frei
  G.clearSfx();
  for (const ms of [4001, 5001, 6001, 7000]) { localTurn(ms, 7000); G.tick(); }
  t('5.2 mit Ton: 3 Ticks + 1 Time-up', G.sfx().filter((x) => x === 'tick').length === 3 && G.sfx().filter((x) => x === 'turnUp').length === 1, G.sfx());
}

// ── 7) Naechster Turn setzt die Anzeige korrekt zurueck ─────────────────────
{
  // Lokal: neues Fenster (anderer Seat) -> Latches frei, wieder 7, wieder Ticks.
  localTurn(6500, 7000); G.tick(); G.clearSfx();
  G.set({ matchElapsedMs: 7000, turnWindowEndEl: 14000, turnWindowSeat: 1 }); G.tick();
  t('7.1 neuer Turn zeigt wieder 7', G.hud().num === '7', G.hud().num);
  t('7.2 neuer Turn ohne Puls', G.hud().urgent === false);
  for (const ms of [11001, 12001, 13001]) { G.set({ matchElapsedMs: ms }); G.tick(); }
  t('7.3 neuer Turn tickt wieder genau dreimal', G.sfx().filter((x) => x === 'tick').length === 3, G.sfx());
  // Online: neuer turnNo -> neue Identitaet -> Latches frei.
  onlineTurn(7900, 8000, 7000); G.tick();
  const before = G.key();
  G.set({ turnNo: 1, deadlineAt: 16000, srvNow: 9000 }); G.tick();
  t('7.4 online: neuer Turn hat neue Identitaet', G.key() !== before, [before, G.key()]);
  t('7.5 online: neuer Turn zeigt wieder 7', G.hud().num === '7', G.hud().num);
}

// ── 8) Reveal und Game Over blenden aus ─────────────────────────────────────
{
  localTurn(0, 7000); G.tick();
  t('8.0 sichtbar in der Aim-Phase', G.hud().display === '');
  for (const ph of ['reveal', 'sim', 'result', 'over']) {
    localTurn(0, 7000); G.set({ phase: ph }); G.tick();
    t(`8.1 ausgeblendet in Phase '${ph}'`, G.hud().display === 'none', G.hud());
    t(`8.2 Phase '${ph}' meldet inaktiv`, G.state().active === false);
  }
  localTurn(0, 7000); G.set({ menuVisible: true }); G.tick();
  t('8.3 ausgeblendet im Menue', G.hud().display === 'none');
  localTurn(0, 7000); G.set({ coverOpen: true }); G.tick();
  t('8.4 ausgeblendet bei verdeckter Hotseat-Uebergabe', G.hud().display === 'none');
  localTurn(0, 7000); G.set({ collapseState: 'expired' }); G.tick();
  t('8.5 ausgeblendet nach Ablauf der Matchuhr', G.hud().display === 'none');
  // Online ohne Phasenstempel (Reconnect vor dem ersten Stempel): nichts anzeigen
  onlineTurn(1000, null, 7000); G.tick();
  t('8.6 online ohne Deadline: ausgeblendet statt geraten', G.hud().display === 'none');
}

// ── 9) Reconnect mitten in der Aim-Phase zeigt die echte Restzeit ───────────
{
  // Genau die Rechnung aus tickOnlineClock: onlineClock() ueber die GESPEICHERTEN
  // Stempel. Ein frisch verbundener Client kennt nur diese Daten — und muss damit
  // dieselbe Restzeit sehen wie ein durchgehend verbundener.
  const stamps = { 0: 1000, 1: 20000 }, tsMap = { 0: 4000 };
  const nowSrv = 23000;                       // 3 s nach Phasenstart von Turn 1
  const c = G.clock(stamps, tsMap, 1, nowSrv);
  t('9.1 Deadline aus gespeicherten Stempeln', c.deadlineAt === 20000 + c.windowMs, [c.deadlineAt, c.windowMs]);
  onlineTurn(nowSrv, c.deadlineAt, c.windowMs); G.tick();
  t('9.2 Reconnect zeigt die tatsaechliche Restzeit, nicht 7', G.hud().num === '4', G.hud().num);
  t('9.3 kein Sprung auf 7', G.hud().num !== '7');
  // Und der Balken bezieht sich auf das echte Fenster.
  t('9.4 Balken < 1 bei angelaufener Phase', G.hud().fill !== 'scaleX(1)', G.hud().fill);
}

// ── 10)/„eine Uhr": zwei Clients leiten aus denselben Daten dasselbe ab ─────
{
  const stamps = { 0: 5000 }, tsMap = {};
  const a = G.clock(stamps, tsMap, 0, 9000);   // Client A
  const b = G.clock(stamps, tsMap, 0, 9000);   // Client B, identische Eingaben
  t('10.1 gleiche Stempel -> gleiche Deadline', a.deadlineAt === b.deadlineAt, [a.deadlineAt, b.deadlineAt]);
  onlineTurn(9000, a.deadlineAt, a.windowMs); G.tick(); const secA = G.hud().num;
  onlineTurn(9000, b.deadlineAt, b.windowMs); G.tick(); const secB = G.hud().num;
  t('10.2 beide zeigen dieselbe Sekunde', secA === secB, [secA, secB]);
}

// ── 11) Collapse-Timer und Zugtimer bleiben getrennt ────────────────────────
{
  // Waehrend der grosse Collapse-Countdown laeuft, schweigt der Zugtick — die
  // Anzeige selbst laeuft aber unveraendert weiter.
  localTurn(0, 7000); G.tick(); G.clearSfx();
  for (const ms of [4001, 5001, 6001]) { localTurn(ms, 7000); G.set({ collapseCountVisible: true }); G.tick(); }
  t('11.1 kein Zugtick, solange der Collapse-Countdown laeuft', G.sfx().length === 0, G.sfx());
  t('11.2 Anzeige laeuft trotzdem weiter', G.hud().num === '1', G.hud().num);
  t('11.3 Anzeige pulsiert weiterhin', G.hud().urgent === true);
  // Eigene DOM-Knoten, keine Ueberschneidung mit der Matchzeit
  t('11.4 eigenes HUD-Element (turnTimer != collapseTimer)', /id="turnTimer"/.test(HTML) && /id="collapseTimer"/.test(HTML));
  t('11.5 eigene CSS-Klasse (.tturn != .ctimer)', /\.tturn\{/.test(HTML) && /\.ctimer\{/.test(HTML));
  t('11.6 Zugtimer rechts, Matchzeit mittig', /\.tturn\{position:absolute;top:6px;right:6px/.test(HTML) && /\.ctimer\{position:absolute;top:6px;left:50%/.test(HTML));
  // Der Zugtimer haengt im .arena-wrap (beginnt auf jeder Groesse unter der HUD-Zeile)
  // -> keine Kollision mit Menue-/Ton-Button, ohne Media-Query und ohne Pixeloffset.
  t('11.7 Zugtimer liegt im .arena-wrap, nicht in der HUD-Ebene',
    /<div class="arena-wrap">[\s\S]*?id="turnTimer"[\s\S]*?<\/div>\s*<\/div>/.test(HTML));
  t('11.8 .arena-wrap ist positionierender Kontext', /\.arena-wrap\{[^}]*position:relative/.test(HTML));
}

// ── 12) Kein doppelter Tick nach Rematch oder Generationswechsel ────────────
{
  onlineTurn(7900, 8000, 7000); G.tick();       // steht bei 1, Tick fuer 1 ist gefallen
  G.clearSfx();
  G.tick(); G.tick();
  t('12.1 derselbe Zustand tickt nicht erneut', G.sfx().length === 0, G.sfx());
  // Rematch: neue Generation, turnNo zurueck auf 0 -> neue Identitaet
  const keyOld = G.key();
  G.set({ gen: 1, turnNo: 0, deadlineAt: 20000, srvNow: 13000 }); G.tick();
  t('12.2 neue Generation hat neue Identitaet', G.key() !== keyOld, [keyOld, G.key()]);
  t('12.3 nach Rematch wieder 7', G.hud().num === '7', G.hud().num);
  t('12.4 der Wechsel selbst erzeugt keinen Tick', G.sfx().length === 0, G.sfx());
  for (const now of [17001, 18001, 19001]) { G.set({ srvNow: now }); G.tick(); }
  t('12.5 neue Generation tickt genau dreimal', G.sfx().filter((x) => x === 'tick').length === 3, G.sfx());
}

// ── Quellen- und Vertragspruefungen am Quelltext ────────────────────────────
{
  // Genau EIN Aufrufer -> kein Tick kann sich durch mehrere Aufrufstellen verdoppeln.
  const calls = (HTML.match(/updateTurnTimerHud\(\)/g) || []).length;
  t('V1 updateTurnTimerHud hat genau eine Aufrufstelle (+ Definition)', calls === 2, calls);
  t('V2 Aufruf steht in der Hauptschleife nach den Uhren',
    /tickOnlineClock\(\);[^\n]*\n\s*updateTurnTimerHud\(\);/.test(HTML));
  // Keine zweite Uhr: die Anzeige darf weder Date.now noch performance.now lesen.
  const body = grab(/function turnTimerState\(\)\{[\s\S]*?\n\}/, 'turnTimerState')
             + grab(/function updateTurnTimerHud\(\)\{[\s\S]*?\n\}/, 'updateTurnTimerHud');
  t('V3 Anzeige nutzt keine eigene Zeitbasis (kein Date.now/performance.now)',
    !/Date\.now|performance\.now/.test(body));
  t('V4 online liest die von tickOnlineClock gesetzte Deadline', /onlineTurnDeadlineAt/.test(body));
  t('V5 lokal liest sie turnRemainMs() (Quelle von turnDeadlinePassed)', /turnRemainMs\(\)/.test(body));
  t('V6 Anzeige schreibt keinen Spielzustand (kein commit/write/set auf DB)',
    !/commit\(|writeTurnSlot|onlineSendCommit|FB\./.test(body));
  // Timeout-Vertrag unveraendert: der No-Shot nutzt weiterhin die eigene Kugel.
  t('V7 Timeout-No-Shot weiterhin auf der eigenen Standardkugel',
    /function onlineNoShotIdx\(s\)\{return seatDefaultBall\(s\);\}/.test(HTML));
  t('V8 Zugzeit-Konstante unveraendert bei 7 s', /const TURN_LIMIT_SECONDS=7;/.test(HTML));
  // Beschriftungen in allen drei Sprachen
  t('V9 Label DE/EN/TR vorhanden',
    /turnTime:'TURN TIME'/.test(HTML) && /turnTime:'ZUGZEIT'/.test(HTML) && /turnTime:'HAMLE SÜRESİ'/.test(HTML));
  t('V10 Label wird beim Sprachwechsel gesetzt', /turnTimerLbl'\);if\(tl\)tl\.textContent=T\('turnTime'\)/.test(HTML));
}

console.log(`Zugzeit-Anzeige: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
