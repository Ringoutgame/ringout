// ARENA FOOTBALL ONLINE — DER V11-LEBENSZYKLUS DES CLIENTS.
//
// v11 dreht eine einzige Sache um, und alles hier prueft die Folgen davon: der RAUM
// bleibt, das MATCH kommt und geht. Was daraus wird, laesst sich in fuenf Zusagen
// fassen - und keine davon darf ein zweites Modell neben einem bestehenden aufmachen:
//
//   1. WER MITSPIELT, steht in der Generation (g/<gen>/pt) und nirgends sonst. Die
//      Liste kann Luecken haben; niemand rueckt nach, niemand wird umnummeriert.
//   2. WER NICHT MITSPIELT, ist im Match genau das, was das Spiel seit der ersten
//      Elimination kennt: ein Sitz ohne Figur. Kein neuer Zweig, nur ein frueherer
//      Eintritt in den alten.
//   3. GESTARTET WIRD VON HAND, VOM WIRT. Kein Beitritt startet etwas, keine volle
//      Besetzung, und keine Bereitschaft - die gibt es nicht. Der Wirt darf ab zwei.
//   4. DEN WIRT MUSS ES IMMER GEBEN. Die Rolle wandert an den niedrigsten verbundenen
//      Sitz, sobald der bisherige Wirt kein verbundenes Mitglied mehr ist - und nur
//      dann. Der Start ist EIN atomarer Vorgang aus gen, state und Teilnehmerliste;
//      wer dabei ist, sind GENAU die in diesem Augenblick Verbundenen.
//   5. AM ENDE faellt der Raum in SEINE Lobby zurueck - nicht ins Menue, nicht in
//      einen neuen Raum. Das Ergebnis bleibt so lange stehen, bis es gelesen ist.
//
// Der Beweis des VERTRAGS selbst - dass der Server genau diese Schreibvorgaenge
// zulaesst und alle anderen abweist - liegt in tools/test_online_v11.js gegen die
// echten Rules. Hier geht es um den Client, der sie benutzt.
//
//   node test_online_v11_client.js
const { loadIndexHtml, grab, grabFunction } = require('./extract');
const HTML = loadIndexHtml();

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) pass++;
  else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length)));

// ══ DER SANDKASTEN ═══════════════════════════════════════════════════════════
// Der echte Quelltext, gegen eine nachgebaute Datenbank und eine nachgebaute
// Oberflaeche. Nichts wird nachgebaut, was im Produkt entschieden wird.
const QUELLE = [
  grab(HTML, /const FB_ONLINE_SEATS=[^\n]*/, 'FB_ONLINE_SEATS'),
  grab(HTML, /const FFA_MAX_SEATS=[^\n]*/, 'FFA_MAX_SEATS'),
  grab(HTML, /const FB_DYN_MIN_START=[^\n]*/, 'FB_DYN_MIN_START'),
  grab(HTML, /const FOOTBALL_ELIM_MAX_PLAYERS=[^\n]*/, 'FOOTBALL_ELIM_MAX_PLAYERS'),
  grab(HTML, /const GEN_MAX=[^\n]*/, 'GEN_MAX'),
  grab(HTML, /const FB_V9_CODE_RE=[^\n]*/, 'FB_V9_CODE_RE'),
  grabFunction(HTML, 'fbV9Sitze'),
  grabFunction(HTML, 'fbV9CtxBesetzung'),
  grabFunction(HTML, 'fbV9CtxOk'),
  grabFunction(HTML, 'seatActive'),
  // ── der Lebenszyklus selbst ──
  grab(HTML, /const FB_V11_ERGEBNIS_MS=[^\n]*/, 'FB_V11_ERGEBNIS_MS'),
  grab(HTML, /const FB_V11_ENDE_MAX_MS=[^\n]*/, 'FB_V11_ENDE_MAX_MS'),
  grab(HTML, /const FB_V11_HOST_FRIST_MS=[^\n]*/, 'FB_V11_HOST_FRIST_MS'),
  grab(HTML, /let fbV11State='';[\s\S]*?\nlet fbV11ErgWeg=false;/, 'v11-Zustand'),
  grabFunction(HTML, 'fbV11Raum'),
  grabFunction(HTML, 'fbV11Anwesend'),
  grabFunction(HTML, 'fbV11HostSitz'),
  grabFunction(HTML, 'fbV11HostGemerkt'),
  grabFunction(HTML, 'fbV11NachfolgeStop'),
  grabFunction(HTML, 'fbV11BinHost'),
  grabFunction(HTML, 'fbV11Nachfolge'),
  grabFunction(HTML, 'fbV11Starten'),
  grabFunction(HTML, 'fbV11PtSitze'),
  grabFunction(HTML, 'fbV11PtWarteAus'),
  grabFunction(HTML, 'fbV11PtWarten'),
  grabFunction(HTML, 'fbV11MatchAufnehmen'),
  grabFunction(HTML, 'fbV11MatchVorbei'),
  grabFunction(HTML, 'fbV11ErgebnisFrist'),
  grabFunction(HTML, 'fbV11ErgebnisVerlassen'),
  grabFunction(HTML, 'fbV11ZurueckInLobby'),
  grabFunction(HTML, 'fbV11ListeWieder'),
  grabFunction(HTML, 'fbV11Schritt'),
  grabFunction(HTML, 'fbV11Aus'),
  grabFunction(HTML, 'fbV11An'),
  // ── die Teilnehmerliste im Spiel ──
  grab(HTML, /const FB_ELIM_LIVES=[^\n]*/, 'FB_ELIM_LIVES'),
  grab(HTML, /const fbElimActive=\[[^\n]*/, 'fbElimActive'),
  grab(HTML, /const fbElimLives=\[[^\n]*/, 'fbElimLives'),
  grab(HTML, /const fbElimSlots=\[[^\n]*/, 'fbElimSlots'),
  'let fbElimStartN=0;',
  'function fbElimPlayers(){ return fbElimStartN>=2?fbElimStartN:5; }',
  grab(HTML, /let fbElimTeil=null;[\s\S]*?\nfunction fbElimReset\(\)\{[\s\S]*?\n\}/, 'Teilnehmerliste + Reset'),
].join('\n');

// Die nachgebaute Umgebung. Sie haelt AUSSCHLIESSLICH das, was der Lebenszyklus von
// aussen braucht - jeder Entschluss liegt im echten Quelltext darueber.
const RAHMEN = `
'use strict';
let online=true, roomProto=11, roomCode='VEFB', myPlayer=0, gen=0, gameStarted=false;
let runningGen=-1, turnNo=-1, onlineSessionId=1, roomP={}, lobbyP={}, playersRoster={};
let roomPublic=false, roomOeffentlich=false, mode='football', fmt='elimination';
let roomHostUid='U0';
const SEAT_STALE_MS=40, LOBBY_HOST_GRACE_MS=80;   // im Pruefstand kurz - der Produktwert wird eigens geprueft
const FB_V11_PT_FRIST_MS=150;                     // dito: gemessen wird DASS gewartet wird
let fbRemovePending=[], fbExitBusy={}, replaying=false, repPlaying=false;
let menuVisible=false, phase='aim', turnUnsub=null, fbElimPhaseN=5;
const PROTOKOLL=[];    // jeder Schreibvorgang, in der Reihenfolge
const DOM={};
function $(id){ if(!DOM[id])DOM[id]={id:id,style:{},textContent:'',disabled:false,classList:{
  _s:{}, add(c){this._s[c]=true;}, remove(c){delete this._s[c];}, contains(c){return !!this._s[c];}}}; return DOM[id]; }
function setStatus(x){ DOM.__status=x; }
function toast(x){ PROTOKOLL.push({op:'toast',text:x}); }
function renderLobby(p){ PROTOKOLL.push({op:'renderLobby'}); lobbyP=p||{}; }
function setOnTitle(){}
function resize(){}
function clearAllMatchGrace(){ PROTOKOLL.push({op:'clearAllMatchGrace'}); }
function clearLeaveState(){ PROTOKOLL.push({op:'clearLeaveState'}); }
function startEvictionWatch(){ PROTOKOLL.push({op:'startEvictionWatch'}); }
function footballResetMatchState(){ PROTOKOLL.push({op:'footballResetMatchState'}); fbElimReset(); }
function applyFootballHud(){}
function setzeVorspiel(m,f){ PROTOKOLL.push({op:'setzeVorspiel',mode:m,fmt:f,gameStarted:gameStarted}); }
function maybeStart(){ PROTOKOLL.push({op:'maybeStart',teil:fbElimTeilnehmer(),startN:fbElimStartN}); gameStarted=true; }
function ffaRoom(){ return true; }
function removePublicListing(c){ PROTOKOLL.push({op:'listeWeg',code:c}); }
function writePublicListing(c){ PROTOKOLL.push({op:'listeHin',code:c}); return Promise.resolve(); }
function fbUid(){ return UID[myPlayer]; }
function rRef(p){ return {pfad:'rooms/'+roomCode+(p?'/'+p:'')}; }
const SFX={ footballGoalStop(){}, fbTransitionStop(){} };
function fbV9LebenStop(){ PROTOKOLL.push({op:'fbV9LebenStop'}); }
const UID=['U0','U1','U2','U3','U4'];
// Die nachgebaute Datenbank: sie speichert, sie entscheidet nichts. Was erlaubt ist,
// beweist der Rules-Pruefstand - hier wird gemessen, WAS der Client schreiben will.
let DB={};
let SCHREIBFEHLER=null;
// Bewusst ein EIGENES window je Sandkasten, kein globalThis.window: ein
// aufgeschobener Vorgang eines frueheren Sandkastens loest window erst beim
// Aufruf auf und schriebe sonst in das Protokoll des NAECHSTEN. Das waere ein
// Befund, den es gar nicht gibt - und er wuerde einen echten verdecken.
const window={FB:{
    db:{},
    ref(_db,pfad){ return {pfad:pfad}; },
    set(ref,wert){
      if(SCHREIBFEHLER)return Promise.reject(new Error(SCHREIBFEHLER));
      PROTOKOLL.push({op:'set',pfad:ref.pfad,wert:wert});
      return Promise.resolve();
    },
    update(ref,upd){
      if(SCHREIBFEHLER)return Promise.reject(new Error(SCHREIBFEHLER));
      PROTOKOLL.push({op:'update',pfad:ref.pfad,upd:JSON.parse(JSON.stringify(upd))});
      return Promise.resolve();
    },
    get(ref){
      PROTOKOLL.push({op:'get',pfad:ref.pfad});
      return Promise.resolve({val(){ return DB[ref.pfad]===undefined?null:DB[ref.pfad]; }});
    },
    onValue(ref,cb){
      const eintrag={pfad:ref.pfad,cb:cb,ab:false};
      WACHEN.push(eintrag);
      return ()=>{ eintrag.ab=true; };
    },
  }};
const WACHEN=[];
function melden(pfad,wert){
  for(const w of WACHEN)if(!w.ab&&w.pfad===pfad)w.cb({val(){ return wert; }});
}
`;

const FUSS = `
return {
  P:PROTOKOLL, DOM:DOM, WACHEN:WACHEN,
  leeren(){ PROTOKOLL.length=0; },
  setz(o){ for(const k in o)eval(k+'=o[k]'); },
  sitz(n){ myPlayer=n; },
  gen(n){ gen=n; },
  stand(v){ fbV11State=v; },
  laeuft(v){ gameStarted=v; },
  phase(v){ phase=v; },
  praesenz(p){ roomP=p; lobbyP=p; },
  roster(r){ playersRoster=r; },
  wirt(u){ roomHostUid=u; },
  db(pfad,wert){ DB[pfad]=wert; },
  fehler(v){ SCHREIBFEHLER=v; },
  oeffentlich(a,b){ roomOeffentlich=a; roomPublic=b; },
  proto(v){ roomProto=v; },
  melden:melden,
  zustand(){ return {state:fbV11State, hostUid:roomHostUid, gestartet:fbV11Gestartet,
                     ergAb:fbV11ErgAb, startBusy:fbV11StartBusy, endeBusy:fbV11EndeBusy,
                     gameStarted:gameStarted, teil:fbElimTeilnehmer(), startN:fbElimStartN,
                     aktiv:fbElimActive.slice(), slots:fbElimSlots.slice(), phaseN:fbElimPhaseN,
                     status:DOM.__status, roomPublic:roomPublic,
                     hostSitz:fbV11HostSitz(), binHost:fbV11BinHost()}; },
  // die echten Funktionen
  ptSitze:(v)=>fbV11PtSitze(v),
  warten:()=>fbV11PtWarten(),
  wartestelle:()=>({ gen:fbV11PtGen, offen:!!fbV11PtUnsub }),
  anwesend:(p)=>fbV11Anwesend(p),
  hostSitz:(p)=>fbV11HostSitz(p),
  binHost:(p)=>fbV11BinHost(p),
  nachfolge:(p)=>fbV11Nachfolge(p),
  starten:()=>fbV11Starten(),
  aufnehmen:()=>fbV11MatchAufnehmen(),
  vorbei:()=>fbV11MatchVorbei(),
  zurueck:()=>fbV11ZurueckInLobby(),
  ergWeg:()=>fbV11ErgebnisVerlassen(),
  schritt:()=>fbV11Schritt(),
  an:()=>fbV11An(),
  aus:()=>fbV11Aus(),
  listeWieder:()=>fbV11ListeWieder(),
  teilSetzen:(l)=>fbElimTeilSetzen(l),
  dabei:(o)=>fbElimDabei(o),
  reset:()=>fbElimReset(),
  ctxOk:(c)=>fbV9CtxOk(c),
};`;

function neu() {
  return new Function(RAHMEN + '\n' + QUELLE + '\n' + FUSS)();
}
const warten = (ms) => new Promise(r => setTimeout(r, ms));
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

const P_AN = (s) => ({ s: 'TAB' + s, on: true, t: 1 });
const P_AUS = (s) => ({ s: 'TAB' + s, on: false, t: 1 });
const ROSTER = (sitze) => { const r = {}; for (const s of sitze) r[s] = { id: 'P' + s, name: 'N' + s, tab: 'TAB' + s, uid: 'U' + s }; return r; };
const PRAESENZ = (sitze) => { const p = {}; for (const s of sitze) p[s] = P_AN(s); return p; };

(async () => {

// ══ 1. DIE TEILNEHMERLISTE EINER GENERATION ══════════════════════════════════
abschnitt('Was eine Teilnehmerliste ist - und was keine');
{
  const M = neu();
  t('zwei dichte Sitze', JSON.stringify(M.ptSitze({ 0: true, 1: true })) === '[0,1]');
  t('RTDB liefert dichte Listen als Array - das ist dieselbe Liste',
    JSON.stringify(M.ptSitze([true, true, true])) === '[0,1,2]');
  t('eine Liste mit Luecken bleibt eine Liste mit Luecken',
    JSON.stringify(M.ptSitze({ 0: true, 2: true, 4: true })) === '[0,2,4]');
  t('und auch als lueckenhaftes Array', JSON.stringify(M.ptSitze([true, null, true])) === '[0,2]');
  t('die Reihenfolge ist immer aufsteigend',
    JSON.stringify(M.ptSitze({ 4: true, 1: true })) === '[1,4]');
  t('alle fuenf', JSON.stringify(M.ptSitze({ 0: true, 1: true, 2: true, 3: true, 4: true })) === '[0,1,2,3,4]');
  t('ein einzelner Sitz ist kein Match', M.ptSitze({ 2: true }) === null);
  t('eine leere Liste auch nicht', M.ptSitze({}) === null);
  t('kein Knoten -> keine Liste', M.ptSitze(null) === null && M.ptSitze(undefined) === null);
  t('ein Sitz ausserhalb des Raums macht die ganze Liste ungueltig',
    M.ptSitze({ 0: true, 5: true }) === null);
  t('ein anderer Wert als true ebenso', M.ptSitze({ 0: true, 1: 1 }) === null);
  t('ein false ebenso', M.ptSitze({ 0: true, 1: true, 2: false }) === null);
  t('ein fremder Schluessel ebenso', M.ptSitze({ 0: true, 1: true, x: true }) === null);
  t('nichts wird geraten: eine Zeichenkette ist keine Liste', M.ptSitze('0,1') === null);
}

// ══ 2. WER IST DER WIRT ══════════════════════════════════════════════════════
abschnitt('Der Wirt ist, wer eingetragen ist - und wirklich hier sitzt');
{
  const M = neu();
  M.roster(ROSTER([0, 1, 2]));
  M.praesenz(PRAESENZ([0, 1, 2]));
  M.wirt('U0');
  t('die Kennung zeigt auf einen Sitz', M.hostSitz() === 0, M.hostSitz());
  M.sitz(0); t('und der darauf sitzt, ist der Wirt', M.binHost() === true);
  M.sitz(1); t('die anderen sind es nicht', M.binHost() === false);
  // Der Wirt ist nicht "Sitz 0", sondern wer eingetragen ist.
  M.wirt('U2');
  t('ein Wirt auf Sitz 2 wird dort gefunden', M.hostSitz() === 2, M.hostSitz());
  M.sitz(2); t('… und ist der Wirt', M.binHost() === true);
  M.sitz(0); t('… waehrend Sitz 0 ein gewoehnliches Mitglied ist', M.binHost() === false);
  // Eine Kennung ohne Sitz ist eine Karteileiche.
  M.wirt('U9');
  t('eine Kennung, die zu keinem Sitz gehoert, ist kein Wirt', M.hostSitz() === -1);
  // Ein nur GETRENNTER Wirt ist ebenfalls keiner - sonst haette ein Absturz den Raum
  // stillgelegt. Dieselbe Bedingung rechnet der Server in der Startregel nach.
  M.wirt('U1');
  M.praesenz({ 0: P_AN(0), 1: P_AUS(1), 2: P_AN(2) });
  t('ein getrennter Wirt ist kein Wirt', M.hostSitz() === -1, M.hostSitz());
  M.sitz(1); t('… und haelt sich auch selbst nicht dafuer', M.binHost() === false);
  // Ohne Eintrag gibt es keinen.
  M.wirt('');
  t('ohne Eintrag gibt es keinen Wirt', M.hostSitz() === -1);
}

// ══ 3. DIE NACHFOLGE ═════════════════════════════════════════════════════════
abschnitt('Die Rolle wandert - nur wenn sie frei ist, und nur an den Niedrigsten');
{
  const M = neu();
  M.roster(ROSTER([0, 1, 2])); M.praesenz(PRAESENZ([0, 1, 2]));
  M.wirt('U0'); M.sitz(1); M.leeren();
  M.nachfolge(); await warten(40); await tick();
  t('solange der Wirt da ist, greift niemand nach der Rolle',
    M.P.filter(x => x.op === 'set').length === 0);
}
{
  // Der Wirt ist GEGANGEN: sein Rostereintrag ist fort, es gibt nichts zu erwarten.
  const M = neu();
  M.roster(ROSTER([1, 2])); M.praesenz(PRAESENZ([1, 2]));
  M.wirt('U0'); M.sitz(2); M.leeren();
  M.nachfolge(); await warten(40); await tick();
  t('ein hoeherer Sitz versucht es gar nicht erst',
    M.P.filter(x => x.op === 'set').length === 0);
  const M2 = neu();
  M2.roster(ROSTER([1, 2])); M2.praesenz(PRAESENZ([1, 2]));
  M2.wirt('U0'); M2.sitz(1); M2.leeren();
  M2.nachfolge(); await warten(40); await tick();
  const w = M2.P.filter(x => x.op === 'set');
  t('der niedrigste verbundene Sitz uebernimmt', w.length === 1, w.length);
  t('… und schreibt die Wirtsmarke des Raums', w[0] && w[0].pfad === 'rooms/VEFB/hostUid');
  t('… mit der eigenen Kennung', w[0] && w[0].wert === 'U1', w[0] && w[0].wert);
}
{
  // Der Wirt ist nur GETRENNT - sein Eintrag steht noch. Er laedt vielleicht nur neu.
  // Dann bekommt er die Frist der Lobby, bevor jemand nachrueckt.
  const M = neu();
  M.roster(ROSTER([0, 1])); M.praesenz({ 0: P_AUS(0), 1: P_AN(1) });
  M.wirt('U0'); M.sitz(1); M.leeren();
  M.nachfolge(); await tick();
  t('ein nur getrennter Wirt wird nicht sofort ersetzt',
    M.P.filter(x => x.op === 'set').length === 0);
  await warten(200); await tick();
  t('… erst nach der Frist rueckt der naechste nach',
    M.P.some(x => x.op === 'set' && x.wert === 'U1'));
}
{
  // Und kommt er innerhalb der Frist zurueck, bleibt er Wirt.
  const M = neu();
  M.roster(ROSTER([0, 1])); M.praesenz({ 0: P_AUS(0), 1: P_AN(1) });
  M.wirt('U0'); M.sitz(1); M.leeren();
  M.nachfolge(); await tick();
  M.praesenz(PRAESENZ([0, 1]));              // er ist wieder da
  M.nachfolge();                             // dieselbe Stelle raeumt die Frist ab
  await warten(200); await tick();
  t('kommt der Wirt rechtzeitig zurueck, behaelt er die Rolle',
    M.P.filter(x => x.op === 'set').length === 0);
}
{
  // Mit Luecken gilt dasselbe: der niedrigste VERBUNDENE, nicht der Sitz 1.
  const M = neu();
  M.roster(ROSTER([2, 4])); M.praesenz(PRAESENZ([2, 4]));
  M.wirt('U0'); M.sitz(2); M.leeren();
  M.nachfolge(); await warten(40); await tick();
  t('bei den Sitzen 2 und 4 uebernimmt Sitz 2',
    M.P.some(x => x.op === 'set' && x.wert === 'U2'));
  const M2 = neu();
  M2.roster(ROSTER([2, 4])); M2.praesenz(PRAESENZ([2, 4]));
  M2.wirt('U0'); M2.sitz(4); M2.leeren();
  M2.nachfolge(); await warten(40); await tick();
  t('… und Sitz 4 haelt still', M2.P.filter(x => x.op === 'set').length === 0);
  // Und die zweite Nachfolge danach: geht auch Sitz 2, bleibt Sitz 4.
  const M3 = neu();
  M3.roster(ROSTER([4])); M3.praesenz(PRAESENZ([4]));
  M3.wirt('U2'); M3.sitz(4); M3.leeren();
  M3.nachfolge(); await warten(40); await tick();
  t('geht auch der Nachfolger, uebernimmt der letzte Verbliebene',
    M3.P.some(x => x.op === 'set' && x.wert === 'U4'));
}
{
  // Zweimal hintereinander greift nicht zweimal.
  const M = neu();
  M.roster(ROSTER([1])); M.praesenz(PRAESENZ([1]));
  M.wirt('U0'); M.sitz(1); M.leeren();
  M.nachfolge(); M.nachfolge(); await warten(40); await tick();
  t('zwei Anlaeufe schreiben trotzdem nur einmal',
    M.P.filter(x => x.op === 'set').length === 1, M.P.filter(x => x.op === 'set').length);
}
{
  // Ohne eingetragenen Wirt uebernimmt ebenfalls der niedrigste Sitz - ein Raum ohne
  // Wirt koennte sonst nie wieder starten.
  const M = neu();
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.wirt(''); M.sitz(0); M.leeren();
  M.nachfolge(); await warten(40); await tick();
  t('ein Raum ohne Wirtsmarke bekommt einen', M.P.some(x => x.op === 'set' && x.wert === 'U0'));
}

// ══ 4. DER WIRT STARTET ══════════════════════════════════════════════════════
abschnitt('Gestartet wird von Hand - und nur vom Wirt');
{
  const M = neu();
  M.roster(ROSTER([0, 1, 2])); M.praesenz(PRAESENZ([0, 1, 2]));
  M.wirt('U0'); M.gen(3); M.stand('lobby');
  M.sitz(1); M.leeren();
  await M.starten();
  t('ein gewoehnliches Mitglied startet nichts', M.P.filter(x => x.op === 'update').length === 0);
  M.sitz(0); M.leeren();
  await M.starten();
  const u = M.P.filter(x => x.op === 'update');
  t('der Wirt startet', u.length === 1, u.length);
  t('… als EIN atomarer Vorgang auf den Raum', u[0] && u[0].pfad === 'rooms/VEFB');
  t('… mit der naechsten Generation', u[0] && u[0].upd.gen === 4);
  t('… dem neuen Zustand', u[0] && u[0].upd.state === 'playing');
  t('… und der Teilnehmerliste unter genau dieser Generation',
    u[0] && JSON.stringify(u[0].upd['g/4/pt']) === '{"0":true,"1":true,"2":true}',
    u[0] && JSON.stringify(u[0].upd['g/4/pt']));
  t('mehr Beine hat der Vorgang nicht', u[0] && Object.keys(u[0].upd).length === 3);
}
{
  // WER dabei ist, entscheidet der Klick nicht aus: es sind alle Verbundenen.
  const M = neu();
  M.roster(ROSTER([0, 1, 2, 3, 4]));
  M.praesenz({ 0: P_AN(0), 1: P_AUS(1), 2: P_AN(2), 3: P_AUS(3), 4: P_AN(4) });
  M.wirt('U0'); M.sitz(0); M.stand('lobby'); M.leeren();
  await M.starten();
  const u = M.P.filter(x => x.op === 'update')[0];
  t('getrennte Sitze zaehlen nicht mit',
    u && JSON.stringify(u.upd['g/1/pt']) === '{"0":true,"2":true,"4":true}',
    u && JSON.stringify(u.upd['g/1/pt']));
}
{
  const M = neu();
  M.roster(ROSTER([3])); M.praesenz(PRAESENZ([3]));
  M.wirt('U3'); M.sitz(3); M.stand('lobby'); M.leeren();
  await M.starten();
  t('mit einem einzigen Spieler startet auch der Wirt nicht',
    M.P.filter(x => x.op === 'update').length === 0);
}
{
  const M = neu();
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.wirt('U0'); M.sitz(0); M.stand('playing'); M.leeren();
  await M.starten();
  t('aus einem laufenden Match heraus startet niemand', M.P.filter(x => x.op === 'update').length === 0);
  M.stand('lobby'); M.laeuft(true); M.leeren();
  await M.starten();
  t('… und waehrend das eigene Match noch steht ebenso wenig',
    M.P.filter(x => x.op === 'update').length === 0);
}
{
  // Eine Abweisung heisst: die Besetzung hat sich im selben Augenblick geaendert.
  // Der Spieler erfaehrt das, statt auf einen Knopf zu starren, der nichts tat.
  const M = neu();
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.wirt('U0'); M.sitz(0); M.stand('lobby');
  M.fehler('PERMISSION_DENIED'); M.leeren();
  await M.starten(); await tick();
  t('eine Abweisung wird gesagt, nicht verschluckt',
    /Besetzung/.test(String(M.zustand().status)), M.zustand().status);
  t('… und der Weg bleibt offen', M.zustand().startBusy === false);
}
{
  // Ein Wirt, der nicht selbst im Raum sitzt, startet nichts - genau wie beim Server.
  const M = neu();
  M.roster(ROSTER([1, 2])); M.praesenz(PRAESENZ([1, 2]));
  M.wirt('U0'); M.sitz(1); M.stand('lobby'); M.leeren();
  await M.starten();
  t('eine Wirtskennung ohne Sitz loest nichts aus', M.P.filter(x => x.op === 'update').length === 0);
}

// ══ 6. DAS MATCH AUFNEHMEN ═══════════════════════════════════════════════════
abschnitt('Der Startbefehl ist state=playing plus die Teilnehmerliste');
{
  const M = neu();
  M.sitz(2); M.gen(5); M.stand('playing');
  M.db('rooms/VEFB/g/5/pt', { 0: true, 2: true, 4: true });
  M.leeren();
  await M.aufnehmen(); await tick();
  const z = M.zustand();
  t('die Liste wird aus GENAU dieser Generation gelesen',
    M.P.some(x => x.op === 'get' && x.pfad === 'rooms/VEFB/g/5/pt'));
  t('sie wird zur Teilnehmerliste des Matches', JSON.stringify(z.teil) === '[0,2,4]');
  t('die Sitzzahl ist der HOECHSTE Teilnehmer plus eins - nicht ihre Anzahl',
    z.startN === 5, z.startN);
  t('und der gewoehnliche Matchstart laeuft an', M.P.some(x => x.op === 'maybeStart'));
  t('die Generation gilt als aufgenommen', z.gestartet === 5);
  M.leeren();
  await M.aufnehmen(); await tick();
  t('ein zweites Mal passiert nichts', M.P.length === 0);
}
{
  const M = neu();
  M.sitz(3); M.gen(2); M.stand('playing');
  M.db('rooms/VEFB/g/2/pt', { 0: true, 1: true });
  M.leeren();
  await M.aufnehmen(); await tick();
  t('wer nicht in der Liste steht, startet kein Match',
    !M.P.some(x => x.op === 'maybeStart'));
  t('… verliert aber weder Raum noch Sitz', M.zustand().gameStarted === false);
  t('… und erfaehrt, woran er ist',
    /ohne dich/.test(String(M.zustand().status)), M.zustand().status);
  t('… und die Generation gilt trotzdem als behandelt', M.zustand().gestartet === 2);
}
{
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('playing'); M.leeren();
  await M.aufnehmen(); await tick();
  t('ohne Teilnehmerliste beginnt gar nichts', !M.P.some(x => x.op === 'maybeStart'));
  t('… und es wird zunaechst gewartet, statt den Raum fuer kaputt zu erklaeren',
    M.wartestelle().offen === true && !/fehlt/.test(String(M.zustand().status)), M.zustand().status);
}
{
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('playing');
  M.db('rooms/VEFB/g/1/pt', { 0: true, 7: true });   // manipuliert
  M.leeren();
  await M.aufnehmen(); await tick();
  t('eine unbrauchbare Teilnehmerliste startet kein Match',
    !M.P.some(x => x.op === 'maybeStart'));
}

// ══ 6b. DIE TEILNEHMERLISTE DARF EINEN AUGENBLICK BRAUCHEN ═══════════════════
abschnitt('Wer selbst startet, liest seinen eigenen Schreibvorgang zu frueh');
{
  // Die Reihenfolge, die gegen das echte Projekt dreimal von drei Malen auftrat: der
  // Raum sagt schon 'playing', die Liste steht aber noch nicht. Frueher war das ein
  // Verderb - jetzt wird gewartet.
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('playing');
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.leeren();
  await M.aufnehmen(); await tick();
  t('der erste Griff geht ins Leere', !M.P.some(x => x.op === 'maybeStart'));
  t('… und das ist noch kein Befund - keine Meldung',
    !/fehlt/.test(String(M.zustand().status)), M.zustand().status);
  const w = M.wartestelle();
  t('… sondern eine Wartestelle auf GENAU diese Generation', w.offen === true && w.gen === 1, w);
  t('… und zwar genau eine', M.WACHEN.filter(x => !x.ab && /\/g\/1\/pt$/.test(x.pfad)).length === 1);
  // Jetzt kommt die Liste an.
  M.db('rooms/VEFB/g/1/pt', { 0: true, 1: true });
  M.melden('rooms/VEFB/g/1/pt', { 0: true, 1: true });
  await tick(); await warten(30); await tick();
  t('sobald sie da ist, beginnt das Match', M.P.some(x => x.op === 'maybeStart'));
  t('… mit der richtigen Teilnehmerliste', JSON.stringify(M.zustand().teil) === '[0,1]', M.zustand().teil);
  t('… und die Wartestelle ist abgeraeumt', M.wartestelle().offen === false);
  t('… ohne Meldung', !/fehlt/.test(String(M.zustand().status)), M.zustand().status);
}
{
  // Und die Gegenprobe: eine Generation, die wirklich keine Liste hat, bleibt kaputt.
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('playing');
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.leeren();
  await M.aufnehmen(); await tick();
  t('auch hier wird zunaechst gewartet', M.wartestelle().offen === true);
  await warten(300); await tick();
  t('nach der Frist ist es ein Befund', /fehlt/.test(String(M.zustand().status)), M.zustand().status);
  t('… die Wartestelle ist fort', M.wartestelle().offen === false);
  t('… und es beginnt kein Match', !M.P.some(x => x.op === 'maybeStart'));
  // Fail closed: auch ein weiterer Anlauf faengt nicht von vorn an.
  M.leeren();
  await M.aufnehmen(); await tick();
  t('und nichts beginnt von vorn', M.wartestelle().offen === false && M.P.length === 0);
}
{
  // Drei Ausloeser zugleich - EIN Match. Der optimistische Raumwechsel, die
  // eintreffende Liste und die Bestaetigung des Servers fallen zusammen.
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('playing');
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.db('rooms/VEFB/g/1/pt', { 0: true, 1: true });
  M.leeren();
  await Promise.all([M.aufnehmen(), M.aufnehmen(), M.aufnehmen()]);
  M.schritt(); M.schritt();
  await tick(); await warten(30); await tick();
  t('das Match wird GENAU EINMAL aufgenommen',
    M.P.filter(x => x.op === 'maybeStart').length === 1,
    M.P.filter(x => x.op === 'maybeStart').length);
  t('… und es steht keine zweite Wartestelle offen',
    M.WACHEN.filter(x => !x.ab && /\/pt$/.test(x.pfad)).length === 0);
}
{
  // Eine Wartestelle auf eine ALTE Generation darf spaeter nichts mehr ausloesen.
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('playing');
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.leeren();
  await M.aufnehmen(); await tick();
  t('die Wartestelle gehoert Generation 1', M.wartestelle().gen === 1);
  M.gen(2);                                  // der Raum ist weitergezogen
  M.melden('rooms/VEFB/g/1/pt', { 0: true, 1: true });
  await tick(); await warten(30); await tick();
  t('eine spaete Liste der alten Generation startet nichts',
    !M.P.some(x => x.op === 'maybeStart'));
  t('… und die alte Wartestelle ist abgeraeumt', M.wartestelle().offen === false);
}
{
  // Sie endet auch, wenn der Raum wieder Lobby ist.
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('playing');
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  await M.aufnehmen(); await tick();
  t('es wird gewartet', M.wartestelle().offen === true);
  M.stand('lobby'); M.schritt(); await tick();
  t('… und mit dem Matchende endet das Warten', M.wartestelle().offen === false);
}
{
  // Und mit dem Verlassen des Raums.
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('playing');
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  await M.aufnehmen(); await tick();
  M.aus();
  t('das Verlassen raeumt die Wartestelle ab', M.wartestelle().offen === false);
  t('… und meldet alles ab', M.WACHEN.every(x => x.ab));
}

// ══ 7. DER NICHTTEILNEHMER IM SPIEL ══════════════════════════════════════════
abschnitt('Wer nicht mitspielt, ist ein Sitz ohne Figur');
{
  const M = neu();
  // Bestand: ohne Liste bleibt alles Zeichen fuer Zeichen wie bisher.
  M.setz({ fbElimStartN: 4 });
  M.teilSetzen(null); M.reset();
  let z = M.zustand();
  t('ohne Teilnehmerliste sind die ersten n Sitze aktiv',
    JSON.stringify(z.aktiv) === '[true,true,true,true,false]', JSON.stringify(z.aktiv));
  t('… die Torslots sind die Sitze', JSON.stringify(z.slots) === '[0,1,2,3,-1]');
  t('… und die Arenaphase ist die Spielerzahl', z.phaseN === 4);
  // v11 mit Luecken: Sitz 1 und 3 spielen nicht mit.
  M.setz({ fbElimStartN: 5 });
  t('die Liste wird durch dieselbe Instanz geprueft wie das Protokoll',
    M.teilSetzen([0, 2, 4]) === true);
  M.reset();
  z = M.zustand();
  t('nur die Teilnehmer sind aktiv',
    JSON.stringify(z.aktiv) === '[true,false,true,false,true]', JSON.stringify(z.aktiv));
  t('die Torslots gehoeren ihnen, aufsteigend',
    JSON.stringify(z.slots) === '[0,2,4,-1,-1]', JSON.stringify(z.slots));
  t('und die Arena ist die ihrer Anzahl', z.phaseN === 3);
  t('die Teilnahmefrage stimmt mit der Liste ueberein',
    M.dabei(0) && !M.dabei(1) && M.dabei(2) && !M.dabei(3) && M.dabei(4));
  t('eine ungueltige Liste wird nicht uebernommen', M.teilSetzen([0]) === false);
  t('… und auch keine mit einem Sitz ausserhalb des Raums', M.teilSetzen([0, 9]) === false);
  t('… und keine absteigende', M.teilSetzen([2, 0]) === false);
  M.teilSetzen(null);
  t('null loescht sie wieder', M.zustand().teil === null);
}

// ══ 8. DER RUNDENKONTEXT ═════════════════════════════════════════════════════
abschnitt('Der Kontext einer Runde traegt die Teilnehmer mit');
{
  const M = neu();
  const basis = { v: 9, code: 'VEFB', cap: 5, gen: 0, turn: 0, seat: 2 };
  t('ohne Liste gilt der Kontext wie bisher', M.ctxOk(basis) === true);
  t('mit gueltiger Liste ebenso',
    M.ctxOk(Object.assign({}, basis, { teil: [0, 2, 4] })) === true);
  t('der eigene Sitz MUSS Teilnehmer sein',
    M.ctxOk(Object.assign({}, basis, { teil: [0, 1, 4] })) === false);
  t('die Liste muss in die Sitzzahl passen',
    M.ctxOk(Object.assign({}, basis, { cap: 3, teil: [0, 2, 4] })) === false);
  t('eine Liste mit einem einzigen Sitz ist keine',
    M.ctxOk(Object.assign({}, basis, { teil: [2] })) === false);
  t('eine absteigende auch nicht',
    M.ctxOk(Object.assign({}, basis, { seat: 0, teil: [4, 0] })) === false);
  t('und eine Nichtliste ebenso wenig',
    M.ctxOk(Object.assign({}, basis, { teil: 3 })) === false);
}

// ══ 9. DAS MATCHENDE ═════════════════════════════════════════════════════════
abschnitt('Wer das Ende sieht, sagt es dem Raum - einmal');
{
  const M = neu();
  M.stand('playing'); M.leeren();
  M.vorbei(); await tick();
  const w = M.P.filter(x => x.op === 'set');
  t('genau ein Schreibvorgang', w.length === 1, w.length);
  t('auf den Raumzustand', w[0] && w[0].pfad === 'rooms/VEFB/state');
  t('und zurueck in die Lobby', w[0] && w[0].wert === 'lobby');
  t('der Zeitpunkt des eigenen Endes ist vermerkt', M.zustand().ergAb > 0);
  M.stand('lobby'); M.leeren();
  M.vorbei(); await tick();
  t('ein zweiter Ruf schreibt nichts mehr', M.P.filter(x => x.op === 'set').length === 0);
}

// ══ 10. ZURUECK IN DIE LOBBY DESSELBEN RAUMS ═════════════════════════════════
abschnitt('Am Ende faellt der Raum in SEINE Lobby zurueck');
{
  const M = neu();
  M.sitz(0); M.gen(4); M.stand('lobby'); M.laeuft(true);
  M.teilSetzen([0, 2]); M.setz({ fbElimStartN: 3, runningGen: 4, turnNo: 9 });
  M.roster(ROSTER([0, 2])); M.praesenz(PRAESENZ([0, 2]));
  M.oeffentlich(true, true);
  M.leeren();
  M.zurueck(); await tick();
  const z = M.zustand();
  t('das Match ist zu Ende', z.gameStarted === false);
  t('der Lebenslauf des Protokolls endet mit ihm', M.P.some(x => x.op === 'fbV9LebenStop'));
  t('die Teilnehmerliste gehoerte diesem Match', z.teil === null && z.startN === 0);
  t('die Austrittsmerkungen sind gegenstandslos', M.P.some(x => x.op === 'clearLeaveState'));
  t('der Beobachter der Marker wird neu aufgesetzt', M.P.some(x => x.op === 'startEvictionWatch'));
  t('der Matchzustand des Spiels ist zurueckgesetzt', M.P.some(x => x.op === 'footballResetMatchState'));
  t('die Kulisse entsteht ueber die eine Tuer - NACH dem Matchende',
    M.P.some(x => x.op === 'setzeVorspiel' && x.gameStarted === false));
  t('das Ergebnisfenster ist zu', M.DOM.ov && M.DOM.ov.classList.contains('show') === false);
  t('die Lobby dieses Raums steht', M.DOM.onLobby.style.display === '');
  t('und sie nennt den Raumcode', M.DOM.onCode.textContent === 'VEFB');
  t('die Beitrittskarten bleiben weg - man ist ja drin',
    M.DOM.onActions.style.display === 'none');
  t('die Lobby wird neu gezeichnet', M.P.some(x => x.op === 'renderLobby'));
  t('der Raum steht wieder in der oeffentlichen Liste',
    M.P.some(x => x.op === 'listeHin' && x.code === 'VEFB'));
  t('und der Raum hat einen Wirt - ohne ihn koennte niemand mehr starten',
    M.zustand().hostSitz >= 0
    || M.P.some(x => x.op === 'set' && x.pfad === 'rooms/VEFB/hostUid'), M.zustand().hostSitz);
}
{
  // Ein privater Raum kommt nicht in die Liste - auch nicht nach dem Match.
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('lobby'); M.laeuft(true);
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.oeffentlich(false, false); M.leeren();
  M.zurueck(); await tick();
  t('ein privater Raum bleibt privat', !M.P.some(x => x.op === 'listeHin'));
}
{
  // Geschrieben wird von EINEM - dem niedrigsten verbundenen Sitz.
  const M = neu();
  M.sitz(2); M.gen(1); M.stand('lobby');
  M.roster(ROSTER([0, 2])); M.praesenz(PRAESENZ([0, 2]));
  M.oeffentlich(true, false); M.leeren();
  M.listeWieder(); await tick();
  t('nicht jeder schreibt den Eintrag - nur der niedrigste Sitz',
    !M.P.some(x => x.op === 'listeHin'));
  M.sitz(0); M.leeren();
  M.listeWieder(); await tick();
  t('und der schreibt ihn', M.P.some(x => x.op === 'listeHin'));
  t('… und merkt sich das', M.zustand().roomPublic === true);
}

// ══ 10b. DER KNOPF WARTET AUF DIE BESTAETIGUNG DES RAUMS ═════════════════════
abschnitt('Der Rueckweg geschieht erst, wenn der Raum in der Lobby ist');
{
  // Das Ergebnisfenster erscheint in dem Augenblick, in dem das Match entschieden
  // ist - die Meldung an den Raum ist da noch unterwegs. Wer sofort drueckt, darf
  // nicht in einen Zustand geraten, in dem der naechste Schritt dieselbe
  // Generation noch einmal aufnimmt.
  const M = neu();
  M.sitz(0); M.gen(3); M.stand('playing'); M.laeuft(true); M.phase('over');
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.db('rooms/VEFB/g/3/pt', { 0: true, 1: true });
  M.leeren();
  M.ergWeg(); await tick();
  t('der Knopf sagt dem Raum das Ende',
    M.P.some(x => x.op === 'set' && x.pfad === 'rooms/VEFB/state' && x.wert === 'lobby'));
  t('… springt aber noch nicht', M.zustand().gameStarted === true);
  t('… und der Raum gilt weiter als aufgenommen - das Match wird NICHT neu gestartet',
    M.zustand().gestartet !== -1 || !M.P.some(x => x.op === 'maybeStart'));
  // Jetzt bestaetigt der Raum.
  M.stand('lobby');
  M.schritt(); await tick();
  t('sobald der Raum es bestaetigt, geht es in die Lobby', M.zustand().gameStarted === false);
  t('… und kein zweites Match wird aufgenommen', !M.P.some(x => x.op === 'maybeStart'));
}
{
  // Und der Rueckweg selbst laesst sich aus einem spielenden Raum gar nicht gehen.
  const M = neu();
  M.sitz(0); M.gen(3); M.stand('playing'); M.laeuft(true);
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1])); M.leeren();
  M.zurueck(); await tick();
  t('aus einem spielenden Raum fuehrt kein Rueckweg in die Lobby',
    M.zustand().gameStarted === true && M.P.length === 0);
}

// ══ 11. DIE FRIST BIS ZUR LOBBY ══════════════════════════════════════════════
abschnitt('Das Ergebnis bleibt stehen, bis es gelesen ist');
{
  const M = neu();
  M.sitz(0); M.gen(1); M.stand('playing'); M.laeuft(true); M.phase('over');
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.vorbei(); await tick();                 // eigenes Ende gesehen
  M.stand('lobby'); M.leeren();
  M.schritt(); await tick();
  t('unmittelbar nach dem Ende steht das Ergebnis noch',
    M.zustand().gameStarted === true);
}
{
  // Ein Client, dessen eigener Ablauf noch nicht am Ende ist, wird NICHT
  // mitten aus dem Match gezogen.
  const M = neu();
  M.sitz(1); M.gen(1); M.stand('lobby'); M.laeuft(true); M.phase('aim');
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1])); M.leeren();
  M.schritt(); await tick();
  t('das laufende Match wird nicht abgebrochen', M.zustand().gameStarted === true);
  t('… und die Lobby draengt sich nicht davor',
    !(M.DOM.onLobby && M.DOM.onLobby.style.display === ''));
  t('… der eigene Abschluss ist noch offen', M.zustand().ergAb === 0);
}

// ══ 12. DER EINE SCHRITT ═════════════════════════════════════════════════════
abschnitt('Raumzustand und Wirtsmarke laufen auf EINE Stelle zu');
{
  const M = neu();
  M.sitz(0); M.gen(2);
  M.roster(ROSTER([0, 1])); M.praesenz(PRAESENZ([0, 1]));
  M.an(); await tick();
  t('der Raumzustand bekommt einen Beobachter',
    M.WACHEN.some(w => !w.ab && w.pfad === 'rooms/VEFB/state'));
  t('und die Wirtsmarke auch - sie wandert ja',
    M.WACHEN.some(w => !w.ab && w.pfad === 'rooms/VEFB/hostUid'));
  // Die Wirtsmarke kommt herein und wird uebernommen.
  M.melden('rooms/VEFB/hostUid', 'U1');
  await tick();
  t('ein Wechsel der Marke kommt im Client an', M.zustand().hostUid === 'U1', M.zustand().hostUid);
  t('… und die Lobby wird daraufhin neu gezeichnet', M.P.some(x => x.op === 'renderLobby'));
  M.aus();
  t('das Verlassen meldet alles ab', M.WACHEN.every(w => w.ab));
  t('und loescht den zuletzt gesehenen Zustand', M.zustand().state === '');
}
{
  // In einem Raum, der nicht v11 ist, entsteht gar nichts.
  const M = neu();
  M.proto(10);
  M.an(); await tick();
  t('ein v10-Raum bekommt keinen v11-Beobachter', M.WACHEN.every(w => w.ab));
}

// ══ 13. DIE VERDRAHTUNG IM PRODUKT ═══════════════════════════════════════════
abschnitt('Die Fassung 11 ist erreichbar - und nur ueber die benannten Wege');
{
  t('der ausgelieferte Client steht auf 11',
    /const ONLINE_PROTOCOL_VERSION=11;/.test(HTML));
  t('ein neuer Fuenf-Sitz-Lives-Raum wird v11',
    /if\(cap===5&&ONLINE_PROTOCOL_VERSION>=11\)return 11;/.test(HTML));
  t('und v10 bleibt als Bestandsvertrag lesbar',
    /function fbRaumFassungOk\(v\)\{ return v===8\|\|\(ONLINE_PROTOCOL_VERSION>=9&&v===9\)\|\|\(ONLINE_PROTOCOL_VERSION>=10&&v===10\)\|\|\(ONLINE_PROTOCOL_VERSION>=11&&v===11\); \}/.test(HTML));
  t('die dynamische Besetzung gilt in v10 UND v11',
    /function fbRaumDynamisch\(\)\{return !!online&&\(roomProto===10\|\|roomProto===11\);\}/.test(HTML));
  t('das Startsignal seats wird in v11 gar nicht mehr beobachtet',
    /if\(ffaRoom\(\)&&roomProto!==11\) seatsUnsub=/.test(HTML));
  t('der Hoststart ist in v11 abgeriegelt',
    /if\(\(typeof fbV11Raum==='function'\)&&fbV11Raum\(\)\)return;\n  const n=seatCount\(lobbyP\);/.test(HTML));
  t('die Lobby eines v11-Raums geht ihren eigenen Weg',
    /if\(fmt===FB_ONLINE_FMT&&\(typeof fbV11Raum==='function'\)&&fbV11Raum\(\)\)\{ fbV11Lobby\(p,n\); return; \}/.test(HTML));
  t('derselbe Knopf startet dort das Match',
    /if\(\(typeof fbV11Raum==='function'\)&&fbV11Raum\(\)\)\{ fbV11Starten\(\); return; \}/.test(HTML));
  // Und im ganzen Produkt gibt es keine zweite Startbefugnis mehr, auch keine
  // unsichtbare: kein Bereitschaftszustand, kein Knoten dafuer, kein Selbststart.
  t('es gibt im Produkt keinerlei Bereitschaft mehr',
    HTML.indexOf('fbV11Ready') < 0 && HTML.indexOf('fbV11Rd') < 0
    && HTML.indexOf('fbV11BereitSitze') < 0 && HTML.indexOf('fbV11StartPruefen') < 0
    && HTML.indexOf('fbV11StartSchreiben') < 0);
  t('die Wartestelle hat eine ausdrueckliche Frist', /const FB_V11_PT_FRIST_MS=15000;/.test(HTML));
  t('der Starter sagt seinem Lebenszyklus Bescheid, sobald der Server bestaetigt hat',
    /if\(ctx\.sid===onlineSessionId&&ctx\.room===roomCode\)fbV11Schritt\(\);/.test(HTML));
  t('eine fehlende Liste fuehrt zuerst in die Wartestelle, nicht in die Meldung',
    /if\(!sitze\)\{ fbV11PtWarten\(\); return; \}/.test(HTML));
  t('die Nachfolge wartet die volle Rueckkehrzeit ab, wenn der Wirt nur getrennt ist',
    /const frist=fbV11HostGemerkt\(\)\?FB_V11_HOST_FRIST_MS:0;/.test(HTML)
    && /const FB_V11_HOST_FRIST_MS=SEAT_STALE_MS\+LOBBY_HOST_GRACE_MS;/.test(HTML));
  t('in v11 schliesst kein Host die Lobby',
    /if\(typeof fbV11Raum==='function'&&fbV11Raum\(\)\)return;/.test(grabFunction(HTML, 'evalLobbyHostPresence')));
  t('ein dauerhafter Austritt beendet in v11 nicht den Raum',
    /&&!v11&&fbPermanentExitHappened\(\);/.test(HTML));
  t('der Generationswechsel allein startet in v11 kein Match',
    /if\(v11\)\{ if\(genChanged\)fbV11Schritt\(\); \}\n    else if\(gameStarted && g!==runningGen\) startOnlineGame\(\);/.test(HTML));
  // Und ein BEITRITT loest erst recht nichts aus: der Praesenzweg kennt nur noch die
  // Nachfolge und die oeffentliche Liste.
  t('ein Beitritt startet kein Match',
    /if\(v11\)\{ roomP=p; fbV11Nachfolge\(p\); fbV11ListeWieder\(\); \}/.test(HTML));
  t('das Matchende meldet sich beim Raum',
    /gameOver\(footballWinner\);\n[\s\S]{0,220}?if\(typeof fbV11MatchVorbei==='function'\)fbV11MatchVorbei\(\);/.test(HTML));
  t('auch das Matchende ohne Sieger',
    /if\(typeof fbV11MatchVorbei==='function'\)fbV11MatchVorbei\(\);\n  updateHud\(\);/.test(HTML));
  t('das Verlassen raeumt den Lebenszyklus ab',
    /if\(typeof fbV11Aus==='function'\)fbV11Aus\(\);/.test(HTML));
  t('… und die Teilnehmerliste dazu',
    /if\(typeof fbElimTeilSetzen==='function'\)fbElimTeilSetzen\(null\);/.test(HTML));
  // Die Rueckkehr in einen laufenden v11-Raum liest die Teilnehmerliste, bevor
  // irgendeine globale Variable steht.
  const rj = grabFunction(HTML, 'attemptRejoin');
  t('die Rueckkehr liest die Teilnehmerliste der Generation',
    /rooms\/'\+code\+'\/g\/'\+v\.gen\+'\/pt'/.test(rj));
  t('… und weist ab, wenn es keine brauchbare gibt',
    /if\(!v11Teil\)\{ setStatus\(T\('rejoinNoLobby'\)\); return false; \}/.test(rj));
  t('… laesst aber einen Nichtteilnehmer in seinem Raum',
    /const v11Zuschauer=!!\(v11Teil&&v11Teil\.indexOf\(seat\)<0\);/.test(rj)
    && /if\(v\.state==='lobby'\|\|v11Zuschauer\)\{/.test(rj));
  t('… und uebernimmt fuer einen Teilnehmer Liste und Sitzzahl',
    /fbElimTeilSetzen\(v11Teil\);\n      fbElimStartN=v11Teil\[v11Teil\.length-1\]\+1;/.test(rj));
  const vr = grabFunction(HTML, 'validateRejoinRoom');
  t('ein laufender v11-Raum braucht kein seats',
    /if\(d\.state==='playing'&&multi&&d\.v!==11\)\{/.test(vr));
}

// ══ 14. WAS ES NICHT GIBT ════════════════════════════════════════════════════
abschnitt('Kein zweiter Weg neben den benannten');
{
  const modul = grab(HTML, /\/\/ ════ PROTOKOLL V11 · DER RAUM UEBERLEBT DAS MATCH[\s\S]*?\nfunction fbV11An\(\)\{[\s\S]*?\n\}/, 'v11-Modul');
  t('der Lebenszyklus fasst keine Kugel an',
    modul.indexOf('balls') < 0 && modul.indexOf('.vx=') < 0 && modul.indexOf('mkBall') < 0);
  t('er rechnet keine Physik und keine Runde',
    modul.indexOf('stepSim') < 0 && modul.indexOf('startRound') < 0 && modul.indexOf('turnNo++') < 0);
  t('er schreibt keinen Zug und keinen Commit',
    modul.indexOf('writeTurnSlot') < 0 && modul.indexOf('/c/') < 0 && modul.indexOf('commit') < 0);
  // Der Lebenszyklus kennt den Wirt jetzt - aber nur als KENNUNG. Die alte Herleitung
  // "Wirt ist, wer auf Sitz 0 sitzt" darf hier nirgends auftauchen, sonst gaebe es
  // zwei Vorstellungen davon, wer starten darf.
  t('er leitet den Wirt aus der Kennung ab, nicht aus einer Sitznummer',
    modul.indexOf('roomHostUid') > 0 && modul.indexOf('isHost(') < 0 && modul.indexOf('hostSeat(') < 0);
  t('und er fasst die Wirtsmarke an genau zwei Stellen an - einmal lesend, einmal schreibend',
    (modul.match(/rRef\('hostUid'\)/g) || []).length === 2);
  t('er schreibt nie an seats', modul.indexOf("'seats'") < 0 && modul.indexOf('seats=') < 0);
  t('er merkt sich nichts im Browser',
    modul.indexOf('localStorage') < 0 && modul.indexOf('sessionStorage') < 0);
  // Jeder aufgeschobene Vorgang faengt Sitzung und Raum ein - und JEDER prueft sie
  // beim Zurueckkommen wieder. Ein eingefangener Zusammenhang ohne Pruefung waere
  // genau die Tuer, durch die ein Rueckruf aus Raum A den Raum B beruehrt.
  const ctxe = (modul.match(/const ctx=\{sid:onlineSessionId/g) || []).length;
  const pruef = (modul.match(/ctx\.sid!==onlineSessionId/g) || []).length
              + (modul.match(/ctx\.sid===onlineSessionId/g) || []).length;
  t('jeder eingefangene Zusammenhang wird beim Zurueckkommen geprueft',
    ctxe >= 6 && pruef >= ctxe, ctxe + '/' + pruef);
  t('der Start schreibt genau einmal - in einem update()',
    (modul.match(/window\.FB\.update\(/g) || []).length === 1);
  t('den Raumzustand fasst der Lebenszyklus an genau zwei Stellen an - einmal lesend, einmal schreibend',
    (modul.match(/rRef\('state'\)/g) || []).length === 2
    && /window\.FB\.set\(rRef\('state'\),'lobby'\)/.test(modul)
    && /window\.FB\.onValue\(rRef\('state'\)/.test(modul));
  // Gelesen wird die Liste an drei Stellen, und jede hat ihren Grund: die Deutung
  // selbst, der einmalige Griff beim Aufnehmen, und die Wartestelle, die erkennt, ob
  // das Eingetroffene schon eine brauchbare Liste ist.
  t('die Teilnehmerliste wird nur ueber DIESE eine Deutung gelesen',
    (modul.match(/fbV11PtSitze\(/g) || []).length === 3
    && (modul.match(/function fbV11PtSitze/g) || []).length === 1);
  t('der Lebenszyklus taktet nicht - er wartet begrenzt',
    modul.indexOf('setInterval') < 0
    && (modul.match(/setTimeout/g) || []).length === 3);
}

console.log('\nOnline-V11-Client: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
