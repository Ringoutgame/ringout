#!/usr/bin/env node
// ONLINE COLLAPSE (Fassung 13): der Two-Stage-Collapse im echten Onlinevertrag.
//
// Getestet wird der ECHTE Code aus index.html - der Collapse-Core (==COLLAPSE-CORE==),
// das Onlinemodul (roCol*) und die positionsreine Ring-out-Auswertung - gegen eine
// Datenbank-Attrappe, die sich wie der Zugknoten verhaelt: write-once, und der
// Rueckgabewert ist immer der autoritative Serverwert.
//
//   A  Uhr: verbrauchte PLANUNGSZEIT aus ca/cc, Simulationszeit zaehlt nicht mit
//   B  Stufen: 0 -> 1 -> 2, keine dritte, keine doppelte, keine ausser der Reihe
//   C  Schreibregel: nur aus der eigenen offenen Planungsphase, nur ohne eigene Abgabe
//   D  Halt: solange die eigene Marke unterwegs ist, gibt dieser Sitz nicht ab
//   E  Rueckkehr: dieselbe Stufe und derselbe Radius allein aus der Historie
//   F  Rematch: neue Generation -> Stufe 0, volle Arena, volle Uhr
//   G  Rules: die Marke ist write-once, wertgeprueft und an einen offenen Zug gebunden
'use strict';
const fs = require('fs');
const path = require('path');
const { loadIndexHtml, grab } = require('./extract');
const HTML = loadIndexHtml();
const RULES = JSON.parse(fs.readFileSync(path.join(path.dirname(__dirname), 'firebase.rules.json'), 'utf8'));

let passed = 0, failed = 0;
const t = (name, cond, info) => {
  if (cond) passed++;
  else { failed++; console.log('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
};
const sec = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length)));

const coreM = HTML.match(/==COLLAPSE-CORE-START==([\s\S]*?)==COLLAPSE-CORE-END==/);
if (!coreM) { console.error('FAIL: Collapse-Core nicht gefunden'); process.exit(2); }
const core = coreM[1];
const modul = grab(HTML, /let roColZeit=\{\};[\s\S]*?\nfunction roColZugWechsel\(alt,neu\)\{[\s\S]*?\n\}/, 'roCol-Modul');
const writeOnce = grab(HTML, /function roWriteOnce\(pfad,wert\)\{[\s\S]*?\n\}/, 'roWriteOnce');
const ballsOutsideSrc = grab(HTML, /function ballsOutside\(\)\{[\s\S]*?\n\}/, 'ballsOutside');
const resolveRingOutsSrc = grab(HTML, /function resolveRingOuts\(crossed\)\{[\s\S]*?\n\}/, 'resolveRingOuts');

// Vorbedingungen an den extrahierten Text - lieber laut abbrechen als still falsch messen.
if (!/roColOnline/.test(core)) { console.error('FAIL: der Core kennt den Onlineweg nicht'); process.exit(2); }
if (!/onCollapseExpire\(\)/.test(modul)) { console.error('FAIL: das Modul wendet die Stufe nicht ueber den gemeinsamen Weg an'); process.exit(2); }

// ── Sandbox ──────────────────────────────────────────────────────────────────
// Echt: Collapse-Core, roCol-Modul, roWriteOnce, ballsOutside, resolveRingOuts.
// Gestubbt: DOM, Klang, Partikel und die Firebase-Anbindung.
const prefix = `
  let mode='pvp', online=true, fmt='single', ffaN=2, roomProto=13;
  let R0=1000, BR=32, R=R0, cx=0, cy=0;
  let phase='aim', phaseStart=0, menuVisible=false;
  let aimSet=[false,false], myPlayer=0, turnNo=0, gen=0, roomCode='AB12', onlineSessionId=1;
  let balls=[], outBall=-1, roundWinner=-1, score=[0,0], roundNo=1, winTarget=3;
  let dragging=false, dragShooter=-1;
  let terminated=false, serverClockReady=true, _serverNow=1000000;
  const RINGOUT_PARITY_FASSUNG=13, RINGOUT_SKIP_FASSUNG=12;
  const document={hidden:false,visibilityState:'visible'};
  const diag=[];
  function serverNow(){return _serverNow;}
  function ringoutParitaetsRaum(){return !!online&&roomProto===RINGOUT_PARITY_FASSUNG;}
  function isCurrentCtx(c){return c.sid===onlineSessionId&&c.room===roomCode&&c.gen===gen&&c.turnNo===turnNo;}
  function isOnlineTerminated(){return terminated;}
  function r3dDiag(k,i){diag.push({k,i});}
  function devSync(){}
  function cancelAimDrag(){dragging=false;}
  function aliveCount(o){let n=0;for(const b of balls)if(b.alive&&b.owner===o)n++;return n;}
  function np(){return mode==='ffa'?ffaN:2;}
  function colorSlot(o){return o;}
  function setPhase(p){phase=p;}
  function updateHud(){} function setPhaseText(){} function spawn(){} function popBall(){}
  function winnerRGB(){return '';} function fx3Hit(){} function fx3Dust(){}
  let r3dActive=false, bgPulse=0, bgPulseRGB='', seatGone=[false,false];
  const PCOLS=[{ui:'#4af',rgb:'0,0,0'},{ui:'#f55',rgb:'0,0,0'},{ui:'#5d5',rgb:'0,0,0'},{ui:'#fd5',rgb:'0,0,0'},{ui:'#c7f',rgb:'0,0,0'}];
  const sfx={warn:0,tick:0,collapse:0,ringout:0,drop:0,collapseStop:0};
  const SFX={warn(){sfx.warn++;},tick(){sfx.tick++;},collapse(){sfx.collapse++;},collapseStop(){sfx.collapseStop++;},
             drop(){sfx.drop++;},ringout(){sfx.ringout++;},hit(){},colPreload(){},colvEvent(){}};
  const _els={};
  const $=(id)=>{if(!_els[id])_els[id]={textContent:'',offsetWidth:0,style:{},classList:{add(){},remove(){},toggle(){}}};return _els[id];};
  let _t=0; const performance={now(){return _t;}};
  // Firebase-Attrappe: write-once wie der echte Zugknoten. runTransaction gibt IMMER den
  // autoritativen Wert zurueck - auch wenn der eigene Payload verloren hat.
  const DB={};
  const window={FB:{
    db:{}, ref(_d,p){return {p:p};}, serverTimestamp(){return {__ts:true};},
    runTransaction(ref,fn,opt){
      const cur=(ref.p in DB)?DB[ref.p]:null;
      const neu=fn(cur);
      let wert=cur;
      if(neu!==undefined){ wert=(neu&&neu.__ts)?_serverNow:neu; DB[ref.p]=wert; }
      return Promise.resolve({committed:neu!==undefined,snapshot:{val(){return wert;}}});
    }
  }};
  ${ballsOutsideSrc}
  ${resolveRingOutsSrc}
  ${writeOnce}
  ${core}
  ${modul}
`;
const suffix = `
  ; return {
    roColOnline, roColReset, roColStempel, roColMarkeSchreiben, roColStufeSetzen, roColTurnWert,
    roColZugWechsel, roColRestMs, roColVerbrauchtMs, roColHalt, roColZielMs,
    tickCollapse, resetCollapseTimer, collapseActive, collapseRemainMs, shrinkFloor, onCollapseExpire,
    DB, diag,
    zeit(v){_serverNow=v;}, jetzt(){return _serverNow;},
    setPhase(p){phase=p;}, setTurn(n){turnNo=n;}, setAim(a){aimSet=a;}, setBalls(b){balls=b;},
    setR(v){R=v;}, setGen(g){gen=g;}, setProto(p){roomProto=p;}, setOnline(o){online=o;},
    setMode(m){mode=m;}, setMenu(m){menuVisible=m;}, setSeat(s){myPlayer=s;}, setTerm(v){terminated=v;},
    setClock(v){serverClockReady=v;}, frame(v){_t=v;},
    stufe(){return collapseStage;}, zustand(){return collapseState;}, radius(){return R;}, raus(){return outBall;},
    kugeln(){return balls;}, phase(){return phase;}, sfx, aktiv(){return collapseActive();}
  }`;
const bau = () => new Function(prefix + suffix)();
const tick = () => new Promise(r => setImmediate(r));
const kugel = (owner, x, y) => ({ owner, alive: true, x, y, vx: 0, vy: 0, spin: 0, sx: x, sy: y });

(async () => {
// ══ A. DIE UHR ═══════════════════════════════════════════════════════════════
sec('A. Die Uhr faltet Serverstempel, nicht lokale Frames');
{
  const w = bau();
  w.resetCollapseTimer();
  t('A1 in einem Raum der Fassung 13 ist der Collapse aktiv', w.aktiv() === true);
  t('A2 der erste Zyklus ist 30 s lang', w.roColZielMs() === 30000);
  t('A3 ohne Stempel ist nichts verbraucht', w.roColVerbrauchtMs() === 0 && w.roColRestMs() === 30000);
  // Zug 0 wird geoeffnet: ab jetzt laeuft die Uhr mit der Serverzeit.
  await w.roColStempel(0, 'ca'); await tick();
  w.zeit(w.jetzt() + 5000);
  t('A4 der laufende Zug verbraucht Planungszeit', w.roColVerbrauchtMs() === 5000 && w.roColRestMs() === 25000);
  await w.roColStempel(0, 'cc'); await tick();
  const nachZu = w.roColVerbrauchtMs();
  w.zeit(w.jetzt() + 9000);                       // Reveal + Simulation
  t('A5 ein geschlossener Zug friert seinen Beitrag ein', w.roColVerbrauchtMs() === nachZu, w.roColVerbrauchtMs());
  t('A6 Simulationszeit zaehlt NICHT mit', w.roColVerbrauchtMs() === 5000);
  w.setTurn(1); await w.roColStempel(1, 'ca'); await tick();
  w.zeit(w.jetzt() + 4000);
  t('A7 der naechste Zug zaehlt weiter, nicht von vorn', w.roColVerbrauchtMs() === 9000);
}
{
  const w = bau(); w.resetCollapseTimer();
  // Eine Luecke darf die Uhr nur VERLANGSAMEN - aus ihr kann nie eine zu fruehe Stufe entstehen.
  w.roColTurnWert(0, { cc: 1000500 });            // Schluss ohne Beginn
  t('A8 ein Zug ohne Beginn zaehlt 0', w.roColVerbrauchtMs() === 0);
}
{
  const w = bau(); w.resetCollapseTimer();
  w.setClock(false);
  w.roColTurnWert(0, { ca: 1000000 });
  w.zeit(1020000);
  t('A9 ohne Serveruhr zaehlt der laufende Zug 0', w.roColVerbrauchtMs() === 0);
  w.setClock(true);
  t('A10 mit Serveruhr zaehlt derselbe Zug wieder', w.roColVerbrauchtMs() === 20000);
}

// ══ B. DIE STUFEN ════════════════════════════════════════════════════════════
sec('B. Stufen kommen ausschliesslich aus der Marke');
{
  const w = bau(); w.resetCollapseTimer();
  w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  t('B1 Start: Stufe 0, volle Arena', w.stufe() === 0 && w.radius() === 1000);
  w.zeit(w.jetzt() + 60000);                       // die lokale Uhr ist laengst abgelaufen
  t('B2 eine abgelaufene Uhr allein aendert NICHTS', w.stufe() === 0 && w.radius() === 1000);
  w.roColTurnWert(0, { cs: 1 });
  t('B3 die Marke vollzieht Stufe 1', w.stufe() === 1);
  t('B4 und verkleinert die Arena genau einmal', Math.round(w.radius()) === 820, w.radius());
  w.roColTurnWert(0, { cs: 1 });
  t('B5 dieselbe Marke wirkt kein zweites Mal', w.stufe() === 1 && Math.round(w.radius()) === 820);
  w.setTurn(1);
  w.roColTurnWert(1, { cs: 2 });
  t('B6 die naechste Marke vollzieht Stufe 2', w.stufe() === 2 && Math.round(w.radius()) === 672, w.radius());
  t('B7 Stufe 2 ist terminal', w.zustand() === 'collapsed' && w.roColRestMs() === 0);
  w.setTurn(2);
  w.roColTurnWert(2, { cs: 3 });
  t('B8 es gibt keine dritte Stufe', w.stufe() === 2 && Math.round(w.radius()) === 672);
}
{
  const w = bau(); w.resetCollapseTimer();
  w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  w.roColTurnWert(0, { cs: 2 });
  t('B9 eine Marke ausser der Reihe wird nicht vollzogen', w.stufe() === 0 && w.radius() === 1000);
  w.setTurn(1); w.roColTurnWert(1, { cs: 1 });
  t('B10 die richtige naechste Stufe wirkt weiterhin', w.stufe() === 1);
}
{
  // Die Stufe ist positionsrein: wer beim Collapse ausserhalb liegt, faellt - und zwar
  // ueber denselben Weg wie ein normaler Ring-out.
  const w = bau(); w.resetCollapseTimer();
  w.setBalls([kugel(0, -900, 0), kugel(0, 0, 0), kugel(1, 100, 0)]);
  w.roColTurnWert(0, { cs: 1 });
  const b = w.kugeln();
  t('B11 die Kugel ausserhalb des neuen Radius faellt', b[0].alive === false, b.map(x => x.alive));
  t('B12 die Kugeln innerhalb bleiben', b[1].alive === true && b[2].alive === true);
  t('B13 die Runde laeuft weiter, solange beide noch leben', w.phase() === 'aim');
  t('B14 und es klingt genau ein Drop', w.sfx.drop === 1, w.sfx);
}
{
  // Beendet der Collapse die Runde, laeuft sie ueber denselben Ergebnisweg wie ein
  // normaler Ring-out - kein zweiter Ausgang.
  const w = bau(); w.resetCollapseTimer();
  w.setBalls([kugel(0, -900, 0), kugel(1, 100, 0)]);
  w.roColTurnWert(0, { cs: 1 });
  t('B15 der Rundenausgang laeuft ueber den normalen Weg', w.phase() === 'result');
  t('B16 und benennt dieselbe Kugel', w.raus() === 0, w.raus());
}

// ══ C. DIE SCHREIBREGEL ══════════════════════════════════════════════════════
sec('C. Die Marke schreibt nur ein Sitz, der noch nicht abgegeben hat');
{
  const w = bau(); w.resetCollapseTimer();
  w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  w.setPhase('sim');
  w.roColMarkeSchreiben(); await tick();
  t('C1 ausserhalb der Planungsphase wird nichts geschrieben', Object.keys(w.DB).length === 0, Object.keys(w.DB));
  w.setPhase('aim'); w.setAim([true, false]);
  w.roColMarkeSchreiben(); await tick();
  t('C2 wer bereits abgegeben hat, schreibt nicht', Object.keys(w.DB).length === 0, Object.keys(w.DB));
  w.setAim([false, false]);
  w.roColMarkeSchreiben(); await tick();
  t('C3 ein offener eigener Zug schreibt die Marke', w.DB['rooms/AB12/g/0/t/0/cs'] === 1, Object.keys(w.DB));
  t('C4 und vollzieht sie sofort', w.stufe() === 1);
  w.roColMarkeSchreiben(); await tick();
  t('C5 ein zweiter Anlauf im selben Zug schreibt nichts', Object.keys(w.DB).length === 1);
}
{
  // Der Marker eines ANDEREN Clients gewinnt das Rennen: der eigene Write findet den
  // Slot belegt und uebernimmt den autoritativen Wert - eine Stufe, nicht zwei.
  const w = bau(); w.resetCollapseTimer();
  w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  w.DB['rooms/AB12/g/0/t/0/cs'] = 1;
  w.roColMarkeSchreiben(); await tick();
  t('C6 der fremde Wert gilt', w.DB['rooms/AB12/g/0/t/0/cs'] === 1);
  t('C7 und wird genau einmal vollzogen', w.stufe() === 1 && Math.round(w.radius()) === 820);
}
{
  const w = bau(); w.resetCollapseTimer(); w.setTerm(true);
  w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  w.roColMarkeSchreiben(); await tick();
  t('C8 nach einem terminalen Abbruch wird nichts mehr geschrieben', Object.keys(w.DB).length === 0);
}

// ══ D. DER HALT ══════════════════════════════════════════════════════════════
sec('D. Bis die Marke steht, gibt dieser Sitz nicht ab');
{
  const w = bau(); w.resetCollapseTimer();
  w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  t('D1 ohne laufenden Write keine Sperre', w.roColHalt() === false);
  w.roColMarkeSchreiben();
  t('D2 waehrend der Write laeuft, ist die Abgabe gesperrt', w.roColHalt() === true);
  await tick();
  t('D3 danach faellt die Sperre sofort', w.roColHalt() === false);
  t('D4 canCommitInput fragt genau diese Sperre ab',
    /if\(typeof roColHalt==='function'&&roColHalt\(\)\)return false;\s*\n\s*if\(online\)return true;/.test(HTML));
}

// ══ E. RUECKKEHR ═════════════════════════════════════════════════════════════
sec('E. Die Rueckkehr baut Stufe und Radius aus der Historie');
{
  // Ein Rueckkehrer spielt die Historie Zug fuer Zug nach: dieselben Marken, dieselbe
  // Reihenfolge, dasselbe Ergebnis wie beim Client, der durchgehend dabei war.
  const dabei = bau(), zurueck = bau();
  const historie = { 0: { ca: 1000000, cc: 1010000 }, 1: { ca: 1012000, cc: 1030000, cs: 1 },
                     2: { ca: 1032000, cc: 1050000 }, 3: { ca: 1052000, cs: 2 } };
  for (const w of [dabei, zurueck]) {
    w.resetCollapseTimer();
    w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  }
  for (let n = 0; n <= 3; n++) {
    for (const w of [dabei, zurueck]) { w.setTurn(n); w.roColTurnWert(n, historie[n]); }
  }
  t('E1 der Rueckkehrer steht auf derselben Stufe', zurueck.stufe() === dabei.stufe() && zurueck.stufe() === 2);
  t('E2 und auf demselben spielbaren Radius', zurueck.radius() === dabei.radius(), [zurueck.radius(), dabei.radius()]);
  t('E3 der Zustand ist terminal, nicht wieder Stufe 0', zurueck.zustand() === 'collapsed');
  dabei.zeit(1060000); zurueck.zeit(1060000);
  t('E4 die Uhr des Rueckkehrers kommt aus denselben Stempeln', zurueck.roColVerbrauchtMs() === dabei.roColVerbrauchtMs());
}
{
  // Kein Sprung zurueck auf Stufe 0: eine erneut gelesene Historie wirkt nicht doppelt.
  const w = bau(); w.resetCollapseTimer();
  w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  w.roColTurnWert(0, { cs: 1 });
  const r = w.radius();
  w.roColTurnWert(0, { cs: 1 });
  t('E5 dieselbe Historie zweimal gelesen aendert nichts', w.stufe() === 1 && w.radius() === r);
}

// ══ F. REMATCH ═══════════════════════════════════════════════════════════════
sec('F. Ein Rematch beginnt bei Stufe 0');
{
  const w = bau(); w.resetCollapseTimer();
  w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  w.roColTurnWert(0, { ca: 1000000 });
  w.roColTurnWert(0, { cs: 1 });
  t('F1 Vorbereitung: Stufe 1 steht', w.stufe() === 1);
  w.setGen(1); w.setTurn(0); w.setR(1000);
  w.resetCollapseTimer();                        // neue Generation -> newGame -> resetCollapseTimer
  t('F2 die Stufe faellt auf 0', w.stufe() === 0);
  t('F3 der Zustand laeuft wieder', w.zustand() === 'running');
  t('F4 die Uhr beginnt von vorn', w.roColVerbrauchtMs() === 0 && w.roColRestMs() === 30000);
  w.roColTurnWert(0, { cs: 1 });
  t('F5 und die erste Marke der neuen Generation wirkt wieder', w.stufe() === 1);
}
{
  // In einem Raum ohne Paritaetsfassung bleibt online alles wie bisher: kein Collapse.
  const w = bau(); w.setProto(12); w.resetCollapseTimer();
  t('F6 Fassung 12 hat online keinen Collapse', w.roColOnline() === false && w.aktiv() === false);
  w.setBalls([kugel(0, -200, 0), kugel(1, 200, 0)]);
  w.roColTurnWert(0, { cs: 1 });
  t('F7 und nimmt auch keine Marke an', w.stufe() === 0 && w.radius() === 1000);
}

// ══ G. RULES ═════════════════════════════════════════════════════════════════
sec('G. Die Rules tragen denselben Vertrag');
{
  const slot = RULES.rules.rooms.$code.g.$gen.t.$turn.$pl;
  const W = slot['.write'], V = slot['.validate'];
  t('G1 die Fassung 13 darf den Zugknoten beschreiben',
    /root\.child\('rooms'\)\.child\(\$code\)\.child\('v'\)\.val\(\) === 8 \|\| root\.child\('rooms'\)\.child\(\$code\)\.child\('v'\)\.val\(\) === 12 \|\| root\.child\('rooms'\)\.child\(\$code\)\.child\('v'\)\.val\(\) === 13/.test(W));
  t('G2 ca, cc und cs sind eigene Schluessel des Zugknotens',
    /\$pl === 'ca' \|\| \$pl === 'cc'/.test(W) && /\$pl === 'cs'/.test(W));
  t('G3 sie sind write-once', /\$pl === 'cs'[\s\S]*/.test(W) && /!data\.exists\(\)/.test(W));
  t('G4 die Zeitstempel MUESSEN die Serverzeit sein', /newData\.val\(\) === now/.test(W));
  t('G5 die Stufe ist auf 1..2 begrenzt',
    /newData\.val\(\) >= 1 && newData\.val\(\) <= 2/.test(W));
  t('G6 und ganzzahlig', /newData\.val\(\) === \(newData\.val\(\) - newData\.val\(\) % 1\)/.test(W));
  // Der Kern des Determinismusvertrags: die Marke darf NUR ein Sitz schreiben, der in
  // diesem Zug noch nicht abgegeben hat. Damit kann der Zug nirgends geschlossen sein.
  t('G7 nur ein Sitz OHNE eigene Abgabe darf die Marke schreiben',
    (W.match(/!root\.child\('rooms'\)\.child\(\$code\)\.child\('g'\)\.child\(\$gen\)\.child\('t'\)\.child\(\$turn\)\.child\('[0-4]'\)\.exists\(\)/g) || []).length === 5);
  t('G8 und nur ein verbundener Sitz dieses Raums',
    (W.match(/child\('p'\)\.child\('[0-4]'\)\.child\('on'\)\.val\(\) === true/g) || []).length >= 5);
  // Untere Zeitschranke: verbrauchte Planungszeit kann nie groesser als Echtzeit sein.
  t('G9 eine Stufe kann nicht frueher als ihr Zyklus geschrieben werden',
    /now - root\.child\('rooms'\)\.child\(\$code\)\.child\('g'\)\.child\(\$gen\)\.child\('t'\)\.child\('0'\)\.child\('ca'\)\.val\(\) >= newData\.val\(\) \* 30000/.test(W));
  const zyklus = /const MATCH_COLLAPSE_SECONDS=60, COLLAPSE_STAGE_COUNT=2/.test(HTML);
  t('G10 und diese Schranke ist der Zyklus des Clients (60/2 = 30 s)', zyklus);
  t('G11 die Werte sind Zahlen', /\$pl === 'ca' \|\| \$pl === 'cc' \|\| \$pl === 'cs'/.test(V) && /newData\.isNumber\(\)/.test(V));
  t('G12 Football bleibt von den drei Schluesseln unberuehrt',
    /\$pl === 'ca' \|\| \$pl === 'cc' \|\| \$pl === 'cs'/.test(V) && /config\/game'\)\.val\(\) === 'ringout'/.test(V));
}

console.log('\nOnline-Collapse: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})();
