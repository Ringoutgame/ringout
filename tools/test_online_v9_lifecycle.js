// V9.4C: die Spielanbindung - dauerhaft, ohne Emulator und ohne Browser.
//
// Geprueft wird der ECHTE Quelltext aus index.html. Die Spielwelt drumherum ist eine
// Attrappe: online, mode, roomCode, gen, turnNo, phase, footballWinner und die
// Sitzauskuenfte lassen sich setzen, damit die beiden Haken ohne Renderschleife und
// ohne Physik ausgeloest werden koennen.
//
// DIE DREI SAETZE, um die es hier geht:
//   1. Die Ruhe haengt NICHT an einem Merker: ein Client betritt nur einen Raum, dessen
//      `v` seiner eigenen ONLINE_PROTOCOL_VERSION entspricht. Solange die 8 ist, ist
//      fbV9LebenAn() ausnahmslos false und jeder Haken faellt wirkungslos durch.
//   2. Die Rundennummer hat weiterhin GENAU EINEN Eigentuemer: onlineArmTurn. Die
//      Anbindung liest sie und erhoeht sie nie.
//   3. Ein Sitz mit e oder gueltigem x wird sofort geschlossen - sonst liefe fuer ihn in
//      jeder kuenftigen Runde die Sechs-Sekunden-Frist ins Leere.
//   node test_online_v9_lifecycle.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 58 - s.length)));

// ── Attrappen ────────────────────────────────────────────────────────────────
const SENTINEL = { '.sv': 'timestamp' };
function uhrwerk(start) {
  let jetzt = start === undefined ? 5000000 : start, id = 1;
  const offen = new Map();
  return { jetzt: () => jetzt, anzahl: () => offen.size, serverNow: () => jetzt,
    setTimeout: (fn, ms) => { const k = id++; offen.set(k, { faellig: jetzt + ms, fn }); return k; },
    clearTimeout: (k) => { offen.delete(k); },
    vor: async (ms) => { jetzt += ms;
      for (let r = 0; r < 40; r++) {
        const f = [...offen.entries()].filter(e => e[1].faellig <= jetzt);
        if (!f.length) break;
        for (const e of f) { offen.delete(e[0]); e[1].fn(); }
        await settle(6);
      }
      await settle(6); } };
}
function attrappe(vorbelegt, uhr) {
  const log = { schreib: [], hoert: [] };
  const stand = Object.assign({}, vorbelegt || {});
  const fehler = {};
  return { log, stand,
    setzeFehler: (p, e) => { fehler[p] = e; },
    loescheFehler: (p) => { delete fehler[p]; },
    zustellen: (p, wert) => { stand[p] = wert;
      for (const h of log.hoert) if (h.pfad === p && h.offen) h.cb({ val: () => wert }); },
    FB: { db: {}, ref: (db, p) => ({ pfad: p }), serverTimestamp: () => SENTINEL,
      runTransaction: async (ref, fn, opts) => {
        const vorher = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        // Auch ein abgewiesener Schreibvorgang hatte eine ABSICHT. Sie wird festgehalten,
        // sonst liessen sich auf demselben Pfad ein remove der Anbindung und ein late der
        // Ablaufsteuerung nicht auseinanderhalten.
        const vorschlag = fn(vorher);
        log.schreib.push({ pfad: ref.pfad, vorschlag });
        if (fehler[ref.pfad]) throw fehler[ref.pfad];
        if (vorschlag === undefined) return { committed: false, snapshot: { val: () => vorher } };
        const jetzt = uhr ? uhr.jetzt() : 1788700000000;
        const g = JSON.parse(JSON.stringify(vorschlag, (k, v) => (v && v['.sv'] === 'timestamp') ? jetzt : v));
        stand[ref.pfad] = g;
        // Firebase reicht einen Blattschreibvorgang an jeden Zuhoerer darueber weiter.
        Promise.resolve().then(() => {
          for (const h of log.hoert) {
            if (!h.offen) continue;
            if (h.pfad === ref.pfad) { h.cb({ val: () => g }); continue; }
            if (ref.pfad.indexOf(h.pfad + '/') !== 0) continue;
            const karte = {}; let leer = true;
            for (const k in stand) {
              if (k.indexOf(h.pfad + '/') !== 0 || stand[k] === null) continue;
              const rest = k.slice(h.pfad.length + 1);
              if (rest.indexOf('/') >= 0) continue;
              karte[rest] = stand[k]; leer = false;
            }
            const da = Object.prototype.hasOwnProperty.call(stand, h.pfad) ? stand[h.pfad] : null;
            if (da && typeof da === 'object')
              for (const k in da) if (!(k in karte)) { karte[k] = da[k]; leer = false; }
            h.cb({ val: () => (leer ? null : karte) });
          }
        });
        return { committed: true, snapshot: { val: () => g } };
      },
      onValue: (ref, cb) => {
        const e = { pfad: ref.pfad, cb, offen: true };
        log.hoert.push(e);
        const v = Object.prototype.hasOwnProperty.call(stand, ref.pfad) ? stand[ref.pfad] : null;
        Promise.resolve().then(() => { if (e.offen) cb({ val: () => v }); });
        return () => { e.offen = false; };
      } } };
}

const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-SPIELANBINDUNG ════');
if (START < 0 || ENDE < 0) { console.log('V9-Bereich nicht gefunden'); process.exit(2); }
const BEREICH = HTML.slice(START, ENDE);
const STILL = uhrwerk(1000);
function speicher() { const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i],
           getItem: (k) => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; }

// Die Spielglobalen, die die Anbindung liest. Sie werden aus `welt` gespiegelt, damit
// ein Test den Zustand zwischen zwei Haken aendern kann.
const GLOBAL = ['online', 'mode', 'roomCode', 'myPlayer', 'gen', 'turnNo', 'phase',
                'footballWinner', 'onlineSessionId', 'ONLINE_PROTOCOL_VERSION',
                // Stufe 2A: die Fassung DES RAUMS - sie entscheidet ueber die Ruhe.
                'roomProto'];
const baue = (a, uhr, welt) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
    'FB_ONLINE_BALL_IDX', 'serverNow', 'setTimeout', 'clearTimeout', 'sessionStorage', 'welt', `
  let ${GLOBAL.join(', ')};
  function sync(){ ${GLOBAL.map(n => n + ' = welt.' + n + ';').join(' ')} }
  sync();
  function fbElim4(){ return welt.elim4; }
  function fbElimPlayers(){ return welt.cap; }
  function fbUid(){ return welt.uid; }
  function fbEvicted(s){ return !!(welt.evicted && welt.evicted[s]); }
  // Der Spielteil als Attrappe: genau die Funktionen, die die Bruecke benutzt. Sie
  // fuehren welt.spur mit, damit die REIHENFOLGE der Wirkungen pruefbar ist.
  let balls = [], commitIdx = [], commitAim = [], commitSpin = [], aimSet = [];
  function np(){ return welt.cap; }
  function resetCommits(){ aimSet=[];commitIdx=[];commitAim=[];commitSpin=[];
    for(let p=0;p<np();p++){aimSet.push(false);commitIdx.push(-1);
                            commitAim.push({dx:0,dy:0});commitSpin.push(0);} }
  function beginReveal(){ welt.spur.push('beginReveal'); phase='reveal'; }
  function applyLaunch(){ welt.spur.push('applyLaunch'); phase='sim';
    welt.starts.push(commitIdx.map((idx,i)=>({seat:i,idx:idx,dx:commitAim[i].dx,
                     dy:commitAim[i].dy,sp:commitSpin[i],an:aimSet[i]}))); }
  // Bildet den ECHTEN footballElimEliminate nach - einschliesslich des additiven
  // Stapelmodus: ist stapel gesetzt, aendert der Aufruf NUR den Zustand und trifft
  // keine Entscheidung. Die Spur haelt jede Entscheidung fest, damit sich zeigen laesst,
  // dass es genau eine gibt.
  let fbElimActive = welt.aktiv;
  function footballElimEliminate(o,stapel){
    if(!fbElimActive[o])return;
    welt.spur.push('raus:'+o); fbElimActive[o]=false;
    for(const b of balls)if(b.owner===o){b.alive=false;b.vx=0;b.vy=0;}
    if(stapel){ welt.spur.push('stapel:'+o); return; }
    const uebrig=[]; for(let i=0;i<welt.cap;i++)if(fbElimActive[i])uebrig.push(i);
    // Wie footballMatchEnd: gameOver spielt SFX.win() - deshalb wird jede Entscheidung
    // festgehalten, auch die siegreiche.
    if(uebrig.length===0){ footballWinner=null; phase='over';
                           welt.spur.push('ohne Sieger'); }
    else if(uebrig.length===1){ footballWinner=uebrig[0]; phase='over';
                                welt.spur.push('SIEGERKLANG'); welt.spur.push('Sieger '+uebrig[0]); } }
  function fbV9WeltAufbauen(){ balls=[];
    for(let i=0;i<welt.cap;i++)balls.push({owner:i,alive:true,vx:0,vy:0,spin:0});
    resetCommits(); }
  fbV9WeltAufbauen();
  ${BEREICH}
  return { sync, fbV9LebenAn, fbV9LebenBereit, fbV9LebenNeueRunde, fbV9LebenHandeln,
           fbV9LebenStop, leben: () => fbV9Leben,
           fbV9ApplyAccepted, fbV9AcceptedOk, fbV9WeltAufbauen,
           sicht: () => ({ commitIdx, commitAim, commitSpin, aimSet, balls, phase }),
           FB_V9_R_COMPLETE, FB_V9_R_BARRIER, FB_V9_COMPLETE, FB_V9_STOPPED };
`)({ FB: a.FB }, globalThis.crypto, 10000, 5, 5,
   (uhr || STILL).serverNow, (uhr || STILL).setTimeout, (uhr || STILL).clearTimeout,
   speicher(), welt);

const UID = 'UID_LIFE_XXXXXXXXXXXXXXXXXX';
const P = (r) => 'rooms/RN2K/g/7/' + r;
const TS = 4000000;
const Q_READY = (n) => ({ k: 'ready', n, ts: TS });
const X_OK = (n) => ({ k: 'ready_timeout', n, ts: TS });
const ruhe = () => new Promise(r => setTimeout(r, 0));
const settle = async (n) => { for (let i = 0; i < (n || 12); i++) await ruhe(); };
const bereitAlle = (n, turn, aus) => { const q = {};
  for (let i = 0; i < n; i++) if (!aus || aus.indexOf(i) < 0) q[i] = Q_READY(turn); return q; };
// Eine v9-Spielwelt. `proto` entscheidet ueber die Ruhe.
const welt9 = (x) => Object.assign({
  online: true, mode: 'football', roomCode: 'RN2K', myPlayer: 1, gen: 7, turnNo: 0,
  phase: 'aim', footballWinner: null, onlineSessionId: 3,
  ONLINE_PROTOCOL_VERSION: 9, roomProto: 9, elim4: true, cap: 3, uid: UID, evicted: {},
  spur: [], starts: [], aktiv: [true, true, true] }, x || {});
const cPfad = (a, turn) => a.log.schreib.filter(w => w.pfad.indexOf(P('c/' + turn + '/')) === 0);

console.log('=== V9.4C: Spielanbindung (ruhend) ===');

(async () => {

// ══ DIE RUHE ═════════════════════════════════════════════════════════════════
abschnitt('Die Ruhe haengt an der Protokollkonstante');
{
  const u = uhrwerk(4000000);
  for (const [name, w] of [
      ['ein v8-Raum', welt9({ roomProto: 8 })],
      ['offline', welt9({ online: false })],
      ['kein Football', welt9({ mode: 'pvp' })],
      ['keine Elimination', welt9({ elim4: false })],
      ['ohne Raumcode', welt9({ roomCode: '' })],
      ['ohne Sitz', welt9({ myPlayer: -1 })]]) {
    const a = attrappe({}, u), M = baue(a, u, w);
    t(name + ': die Anbindung ist aus', M.fbV9LebenAn() === false);
    t(name + ': der Haken faellt wirkungslos durch', M.fbV9LebenNeueRunde() === null);
    t(name + ': und es wird nichts geschrieben', a.log.schreib.length === 0, a.log.schreib.length);
  }
  const a = attrappe({}, u), M = baue(a, u, welt9());
  t('mit Protokoll 9 ist sie an', M.fbV9LebenAn() === true);
  M.fbV9LebenStop();
}

// ══ RUNDE 0 ══════════════════════════════════════════════════════════════════
abschnitt('Runde 0 - Bereitschaft erst nach der Spielbereitschaft');
{
  const u = uhrwerk(4000000);
  const welt = welt9({ turnNo: 0 });
  const a = attrappe({}, u), M = baue(a, u, welt);
  const L = M.fbV9LebenNeueRunde();
  await settle();
  t('ein Lebenslauf entsteht', !!L && M.leben() === L);
  t('er traegt die Runde des Spiels', L.turn === 0, L.turn);
  t('und den Sitz des Spielers', L.ctx.seat === 1 && L.ctx.cap === 3);
  t('die Bereitschaftssteuerung laeuft', !!L.bereit);
  t('der Generationsstart wird versucht', a.log.schreib.some(w => w.pfad === P('s')));
  t('und die eigene Meldung geht hinaus - das Zeichen kam vom Spiel',
    a.log.schreib.some(w => w.pfad === P('q/0/1')), a.log.schreib.map(w => w.pfad).join(','));
  t('aber noch keine Ablaufsteuerung', L.lauf === null);
  t('und keine Runde eroeffnet', !a.log.schreib.some(w => w.pfad.indexOf('/d/') > 0));
  // Der Barriereschluss allein uebergibt noch nicht - dafuer fehlt die Handlung.
  a.zustellen(P('q/0'), bereitAlle(3, 0));
  await settle();
  t('die Barriere schliesst', L.bereit.stufe === M.FB_V9_R_COMPLETE, L.bereit.stufe);
  // DIE ENTSCHEIDENDE EIGENSCHAFT: die Uebergabe wartet NICHT auf eine Handlung.
  t('die Ablaufsteuerung startet sofort - ohne Zug',
    L.uebergeben === true && !!L.lauf, L.uebergeben + '/' + !!L.lauf);
  t('und SIE eroeffnet die Runde', a.log.schreib.some(w => w.pfad === P('d/0')));
  t('genau einmal', a.log.schreib.filter(w => w.pfad === P('d/0')).length === 1);
  t('dabei ist noch kein eigenes Terminal geschrieben',
    !a.log.schreib.some(w => w.pfad === P('c/0/1')));
  t('die Handlung wird nachgereicht und angenommen',
    M.fbV9LebenHandeln({ pass: true }) === true);
  await settle();
  t('erst jetzt geht das eigene Terminal hinaus',
    a.log.schreib.filter(w => w.pfad === P('c/0/1')).length === 1);
  t('eine zweite Handlung wird abgewiesen',
    M.fbV9LebenHandeln({ pass: true }) === false);
  await settle();
  t('und schreibt nichts nach',
    a.log.schreib.filter(w => w.pfad === P('c/0/1')).length === 1);
  M.fbV9LebenStop();
}

// ══ SETTLEMENT ═══════════════════════════════════════════════════════════════
abschnitt('Settlement - die naechste Runde, ohne Zeitgeber');
{
  const u = uhrwerk(4000000);
  const welt = welt9({ turnNo: 0 });
  const a = attrappe({ [P('s')]: { ts: TS } }, u), M = baue(a, u, welt);
  const L0 = M.fbV9LebenNeueRunde();
  await settle();
  t('Runde 0 laeuft', L0.turn === 0);
  // Ein wiederholtes Settlement derselben Runde legt keinen zweiten Lauf an.
  const wieder = M.fbV9LebenNeueRunde();
  await settle();
  t('ein wiederholter Haken derselben Runde ergibt denselben Lauf', wieder === L0);
  t('und keine zweite Meldung',
    a.log.schreib.filter(w => w.pfad === P('q/0/1')).length === 1);
  // Das Spiel hat gerechnet, onlineArmTurn hat turnNo erhoeht - erst DANN der Haken.
  welt.turnNo = 1; M.sync();
  const L1 = M.fbV9LebenNeueRunde();
  await settle();
  t('die naechste Runde ist genau turnNo', L1.turn === 1, L1.turn);
  t('ein NEUER Lauf hat den alten abgeloest', L1 !== L0 && M.leben() === L1);
  t('der alte Lauf ist angehalten', L0.stufe === 'STOPPED');
  t('Runde 1 haengt am Abschluss der Vorrunde, nicht am Generationsstart',
    a.log.hoert.some(h => h.pfad === P('z/0')));
  t('und meldet noch nicht - der Anker fehlt',
    a.log.schreib.filter(w => w.pfad === P('q/1/1')).length === 0);
  a.zustellen(P('z/0'), { ts: TS });
  await settle();
  t('mit dem Anker geht die Meldung hinaus',
    a.log.schreib.filter(w => w.pfad === P('q/1/1')).length === 1);
  t('kein Zeitgeber hat dabei mitgeredet - die Bereitschaft kam aus dem Zustand',
    L1.bereit.bereitLokal === true);
  M.fbV9LebenStop();
}

// ══ MATCHENDE ════════════════════════════════════════════════════════════════
abschnitt('Ein entschiedenes Match bekommt keine naechste Runde');
{
  const u = uhrwerk(4000000);
  for (const [name, w] of [['Phase over', welt9({ phase: 'over', turnNo: 4 })],
                           ['Sieger steht fest', welt9({ footballWinner: 0, turnNo: 4 })]]) {
    const a = attrappe({ [P('s')]: { ts: TS } }, u), M = baue(a, u, w);
    t(name + ': kein Lebenslauf', M.fbV9LebenNeueRunde() === null);
    t(name + ': keine Bereitschaft geschrieben',
      !a.log.schreib.some(x => x.pfad.indexOf('/q/') > 0), a.log.schreib.map(x => x.pfad).join(','));
    t(name + ': und keine Ablaufsteuerung', M.leben() === null);
  }
}

// ══ EIGENER SITZ AUSGETRAGEN ═════════════════════════════════════════════════
abschnitt('Der eigene Sitz ist draussen');
{
  const u = uhrwerk(4000000);
  const welt = welt9({ turnNo: 2, evicted: { 1: true } });
  const a = attrappe({ [P('s')]: { ts: TS } }, u), M = baue(a, u, welt);
  t('kein neuer Lebenslauf', M.fbV9LebenNeueRunde() === null);
  t('nichts geschrieben', a.log.schreib.length === 0, a.log.schreib.length);
  t('und nichts geloescht', a.stand[P('s')] !== null);
  // Auch ein laufender Lauf wird beendet, sobald der eigene Sitz ausgetragen ist.
  const b = attrappe({ [P('s')]: { ts: TS } }, u);
  const w2 = welt9({ turnNo: 0 });
  const M2 = baue(b, u, w2);
  const L = M2.fbV9LebenNeueRunde();
  await settle();
  t('vorher lief einer', !!L);
  w2.evicted = { 1: true }; w2.turnNo = 1; M2.sync();
  t('danach nicht mehr', M2.fbV9LebenNeueRunde() === null);
  t('und er ist angehalten', L.stufe === 'STOPPED' && M2.leben() === null);
}

// ══ e / x -> REMOVE ══════════════════════════════════════════════════════════
abschnitt('Ausgetragene und disqualifizierte Sitze werden sofort geschlossen');
{
  const bauLauf = async (vor, welt) => {
    const u = uhrwerk(4000000);
    const a = attrappe(Object.assign({ [P('s')]: { ts: TS },
                                       [P('q/0')]: bereitAlle(3, 0) }, vor || {}), u);
    const M = baue(a, u, welt || welt9({ turnNo: 0 }));
    const L = M.fbV9LebenNeueRunde();
    await settle();
    M.fbV9LebenHandeln({ pass: true });
    await settle();
    return { u, a, M, L };
  };
  {
    const g = await bauLauf({ [P('e')]: { 2: true } });
    t('die Runde ist eroeffnet', g.a.stand[P('d/0')] !== undefined);
    const rem = cPfad(g.a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'remove');
    t('der ausgetragene Sitz wird sofort geschlossen', rem.length === 1, rem.length);
    t('auf seinem Slot', rem.length === 1 && rem[0].pfad === P('c/0/2'), rem.map(w => w.pfad).join(','));
    t('und ohne sechs Sekunden zu warten', g.u.jetzt() === 4000000);
    // Der eigene Slot wird von der ABLAUFSTEUERUNG beschrieben, nicht von hier - was
    // hier zaehlt, ist, dass kein FREMDER Sitz ein remove bekommt, der es nicht ist.
    t('kein anderer Sitz bekommt ein remove',
      !cPfad(g.a, 0).some(w => w.vorschlag && w.vorschlag.k === 'remove'
                               && w.pfad !== P('c/0/2')));
    g.M.fbV9LebenStop();
  }
  {
    const g = await bauLauf({ [P('x')]: { 2: X_OK(0) } });
    const rem = cPfad(g.a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'remove');
    t('ein disqualifizierter Sitz ebenso', rem.length === 1 && rem[0].pfad === P('c/0/2'));
    g.M.fbV9LebenStop();
  }
  {
    const g = await bauLauf({ [P('e')]: { 0: true }, [P('x')]: { 2: X_OK(0) } });
    const rem = cPfad(g.a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'remove');
    t('beide werden geschlossen - aufsteigend',
      rem.map(w => w.pfad).join('|') === [P('c/0/0'), P('c/0/2')].join('|'),
      rem.map(w => w.pfad).join('|'));
    g.M.fbV9LebenStop();
  }
  {
    const g = await bauLauf({ [P('x')]: { 2: { k: 'ready_timeout' } } });
    t('eine missgebildete Disqualifikation schliesst nichts',
      cPfad(g.a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'remove').length === 0);
    g.M.fbV9LebenStop();
  }
  {
    const g = await bauLauf();
    t('ohne e und ohne x wird nichts geschlossen',
      cPfad(g.a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'remove').length === 0);
    g.M.fbV9LebenStop();
  }
  {
    // Steht das Terminal schon, wird nicht noch einmal geschrieben.
    const g = await bauLauf({ [P('e')]: { 2: true },
                              [P('c/0')]: { 2: { k: 'remove', ts: TS } } });
    t('ein bereits geschlossener Slot wird nicht erneut beschrieben',
      cPfad(g.a, 0).filter(w => w.vorschlag && w.vorschlag.k === 'remove').length === 0);
    g.M.fbV9LebenStop();
  }
  for (const art of ['permission_denied', 'network down']) {
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('s')]: { ts: TS }, [P('q/0')]: bereitAlle(3, 0),
                         [P('e')]: { 2: true } }, u);
    a.setzeFehler(P('c/0/2'), new Error(art));
    const M = baue(a, u, welt9({ turnNo: 0 }));
    M.fbV9LebenNeueRunde();
    await settle();
    M.fbV9LebenHandeln({ pass: true });
    await settle();
    const rem = () => a.log.schreib.filter(w => w.pfad === P('c/0/2')
                                            && w.vorschlag && w.vorschlag.k === 'remove').length;
    t(art + ': ein Versuch faellt', rem() >= 1);
    t(art + ': aber nichts wird erfunden', a.stand[P('c/0/2')] === undefined);
    await u.vor(500); await u.vor(1500); await u.vor(120000);
    // Gezaehlt wird NUR das remove der Anbindung. Auf demselben Slot versucht die
    // Ablaufsteuerung nach ihrer eigenen Frist zusaetzlich ein late - das ist ihr
    // gutes Recht und gehoert nicht in diese Grenze.
    t(art + ': hoechstens drei remove-Versuche', rem() === 3, rem());
    const nachher = rem();
    await u.vor(120000);
    t(art + ': und danach kein vierter', rem() === nachher, rem());
    M.fbV9LebenStop();
  }
  {
    // Gleiche Lage, viele Schnappschuesse: keine Schreibflut.
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('s')]: { ts: TS }, [P('q/0')]: bereitAlle(3, 0),
                         [P('e')]: { 2: true } }, u);
    a.setzeFehler(P('c/0/2'), new Error('permission_denied'));
    const M = baue(a, u, welt9({ turnNo: 0 }));
    M.fbV9LebenNeueRunde();
    await settle();
    M.fbV9LebenHandeln({ pass: true });
    await settle();
    await u.vor(500); await u.vor(1500);
    const rem = () => a.log.schreib.filter(w => w.pfad === P('c/0/2')
                                            && w.vorschlag && w.vorschlag.k === 'remove').length;
    const vorher = rem();
    for (let i = 0; i < 10; i++) { a.zustellen(P('e'), { 2: true }); await settle(4); }
    t('zehn gleiche Schnappschuesse setzen nichts zurueck', rem() === vorher, vorher);
    M.fbV9LebenStop();
  }
}

// ══ AUFRAEUMEN UND VERALTETE RUECKRUFE ═══════════════════════════════════════
abschnitt('Aufraeumen und veraltete Rueckrufe');
{
  const u = uhrwerk(4000000);
  const welt = welt9({ turnNo: 0 });
  const a = attrappe({ [P('s')]: { ts: TS } }, u), M = baue(a, u, welt);
  const L = M.fbV9LebenNeueRunde();
  await settle();
  M.fbV9LebenStop(); M.fbV9LebenStop();
  t('anhalten ist mehrfach gefahrlos', L.stufe === 'STOPPED' && M.leben() === null);
  t('die Zuhoerer sind abgemeldet', a.log.hoert.every(h => !h.offen));
  const vorher = a.log.schreib.length;
  a.zustellen(P('q/0'), bereitAlle(3, 0));
  await settle();
  t('ein spaeter Schnappschuss schreibt nichts mehr', a.log.schreib.length === vorher);
  t('und eine spaete Handlung uebergibt nichts', M.fbV9LebenHandeln({ pass: true }) === false);
  // Generationswechsel entwertet einen alten Lauf.
  const b = attrappe({ [P('s')]: { ts: TS } }, u);
  const w2 = welt9({ turnNo: 0 });
  const M2 = baue(b, u, w2);
  const L2 = M2.fbV9LebenNeueRunde();
  await settle();
  w2.gen = 8; M2.sync();
  const nachher = b.log.schreib.length;
  b.zustellen(P('q/0'), bereitAlle(3, 0));
  await settle();
  t('nach einem Generationswechsel wirkt der alte Lauf nicht mehr',
    b.log.schreib.length === nachher, b.log.schreib.length + '/' + nachher);
  t('und eine Handlung wird nicht mehr angenommen',
    M2.fbV9LebenHandeln({ pass: true }) === false);
  // Sitzungswechsel ebenso.
  w2.gen = 7; w2.onlineSessionId = 99; M2.sync();
  t('ein Sitzungswechsel entwertet ihn genauso',
    M2.fbV9LebenHandeln({ pass: true }) === false);
  t('der alte Lauf hat nie eine Runde eroeffnet',
    !b.log.schreib.some(w => w.pfad.indexOf('/d/') > 0));
  M2.fbV9LebenStop();
  void L2;
}

// ══ DIE GEMEINSAME UHR ════════════════════════════════════
abschnitt('Die Runde oeffnet sich, nicht der erste Zug');
{
  // DER FEHLER, der hier behoben ist: die Uebergabe startete die Ablaufsteuerung erst,
  // wenn der eigene Zug vorlag. Damit haette der erste Spieler bestimmt, wann die
  // gemeinsame Sechs-Sekunden-Frist ueberhaupt beginnt - durch blosses Zoegern
  // beliebig weit hinaus. Die Frist haengt am SERVERzeitstempel von d, und d
  // entsteht jetzt, sobald die Bereitschaftsbarriere geschlossen ist.
  const bauOffen = async (vor, welt) => {
    const u = uhrwerk(4000000);
    const a = attrappe(Object.assign({ [P('s')]: { ts: TS },
                                       [P('q/0')]: bereitAlle(3, 0) }, vor || {}), u);
    const M = baue(a, u, welt || welt9({ turnNo: 0 }));
    const L = M.fbV9LebenNeueRunde();
    await settle();
    return { u, a, M, L };
  };
  {
    const g = await bauOffen();
    t('die Runde ist offen, obwohl niemand hier gezogen hat',
      g.a.stand[P('d/0')] !== undefined && g.a.stand[P('d/0')].n === 0,
      JSON.stringify(g.a.stand[P('d/0')]));
    t('der Rundenbeginn traegt einen SERVERzeitstempel',
      typeof g.a.stand[P('d/0')].o === 'number');
    t('und es steht kein eigenes Terminal im Raum', g.a.stand[P('c/0/1')] === undefined);
    t('auch nach langer Zeit nicht - es wird kein pass untergeschoben',
      true);
    await g.u.vor(5000);
    t('und immer noch keines', g.a.stand[P('c/0/1')] === undefined);
    // Ein Zug NACH der Eroeffnung geht normal hinaus.
    t('ein nachgereichter Zug wird angenommen',
      g.M.fbV9LebenHandeln({ pass: true }) === true);
    await settle();
    t('und steht dann im Raum',
      g.a.stand[P('c/0/1')] && g.a.stand[P('c/0/1')].k === 'pass');
    g.M.fbV9LebenStop();
  }
  {
    // Kein Zug bis zur Frist: es wird NICHTS erfunden. Die bestehende Fristmechanik
    // schliesst den Slot mit late - genau wie bei einem Sitz, der schweigt.
    const g = await bauOffen();
    await g.u.vor(6300);
    const eig = g.a.stand[P('c/0/1')];
    t('ohne Zug wird kein pass erfunden', !eig || eig.k !== 'pass', JSON.stringify(eig));
    t('sondern die Frist schliesst mit late', eig && eig.k === 'late', JSON.stringify(eig));
    g.M.fbV9LebenStop();
  }
  {
    // EIN ZUG VOR DEM AUTORITATIVEN RUNDENBEGINN wird nicht vorzeitig gesendet. Das
    // Tor dafuer ist Schritt (1) der Ablaufsteuerung: ohne autoritatives d geht sie
    // keinen Schritt weiter. Sichtbar wird das an der REIHENFOLGE der Schreibvorgaenge.
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('s')]: { ts: TS }, [P('q/0')]: bereitAlle(3, 0, [2]) }, u);
    const M = baue(a, u, welt9({ turnNo: 0 }));
    const L = M.fbV9LebenNeueRunde();
    await settle();
    t('vor der geschlossenen Barriere laeuft keine Ablaufsteuerung', L.lauf === null);
    t('ein Zug wird schon jetzt angenommen und gemerkt',
      M.fbV9LebenHandeln({ move: { idx: 1, dx: 4, dy: 0, sp: 0 } }) === true);
    await settle();
    t('und dabei nichts geschrieben - die Runde ist nicht einmal offen',
      a.stand[P('c/0/1')] === undefined && a.stand[P('d/0')] === undefined);
    a.zustellen(P('q/0'), bereitAlle(3, 0));
    await settle();
    const folge = a.log.schreib.map(w => w.pfad);
    t('erst jetzt wird die Runde eroeffnet', a.stand[P('d/0')] !== undefined);
    t('und der gemerkte Zug geht hinaus',
      a.stand[P('c/0/1')] && a.stand[P('c/0/1')].k === 'move',
      JSON.stringify(a.stand[P('c/0/1')]));
    t('mit einem echten Hash',
      typeof a.stand[P('c/0/1')].h === 'string' && a.stand[P('c/0/1')].h.length === 64);
    t('und ZUERST die Eroeffnung, dann das Terminal',
      folge.indexOf(P('d/0')) >= 0 && folge.indexOf(P('d/0')) < folge.indexOf(P('c/0/1')),
      folge.join(','));
    M.fbV9LebenStop();
  }
  {
    // Und ohne autoritative Eroeffnung geht ueberhaupt nichts hinaus: kann dieser
    // Client die Runde nicht eroeffnen und sieht auch keine fremde, scheitert er -
    // ohne je ein Terminal zu schreiben.
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('s')]: { ts: TS }, [P('q/0')]: bereitAlle(3, 0) }, u);
    a.setzeFehler(P('d/0'), new Error('permission_denied'));
    const M = baue(a, u, welt9({ turnNo: 0 }));
    const L = M.fbV9LebenNeueRunde();
    await settle();
    M.fbV9LebenHandeln({ pass: true });
    await settle();
    t('ohne autoritativen Rundenbeginn wird kein Terminal geschrieben',
      a.stand[P('c/0/1')] === undefined);
    t('und der Lauf sagt deutlich, woran es lag',
      !!L.lauf && /Rundenbeginn/.test(L.lauf.grund || ''), L.lauf && L.lauf.grund);
    M.fbV9LebenStop();
  }
  {
    // Zwei Clients, dieselbe geschlossene Barriere: write-once entscheidet, und beide
    // rechnen danach mit DEMSELBEN Anker.
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('s')]: { ts: TS }, [P('q/0')]: bereitAlle(3, 0) }, u);
    const MA = baue(a, u, welt9({ turnNo: 0, myPlayer: 0 }));
    const MB = baue(a, u, welt9({ turnNo: 0, myPlayer: 1 }));
    MA.fbV9LebenNeueRunde(); MB.fbV9LebenNeueRunde();
    await settle();
    const auf = a.log.schreib.filter(w => w.pfad === P('d/0'));
    t('beide versuchen zu eroeffnen', auf.length === 2, auf.length);
    t('aber im Raum steht genau ein Anker',
      a.stand[P('d/0')] && typeof a.stand[P('d/0')].o === 'number');
    t('und keiner von beiden hat dafuer einen Zug gebraucht',
      a.stand[P('c/0/0')] === undefined && a.stand[P('c/0/1')] === undefined);
    MA.fbV9LebenStop(); MB.fbV9LebenStop();
  }
  {
    // Ein ausgetragener Sitz wird geschlossen, OHNE dass dieser Client gezogen hat.
    const g = await bauOffen({ [P('e')]: { 2: true } });
    const rem = g.a.log.schreib.filter(w => w.pfad === P('c/0/2')
                                       && w.vorschlag && w.vorschlag.k === 'remove');
    t('remove braucht keinen eigenen Zug', rem.length === 1, rem.length);
    t('und der eigene Slot bleibt leer', g.a.stand[P('c/0/1')] === undefined);
    t('ein aktiver Sitz bleibt unberuehrt', g.a.stand[P('c/0/0')] === undefined);
    g.M.fbV9LebenStop();
  }
  {
    // Ein veralteter Lebenslauf eroeffnet keine neue Runde.
    const u = uhrwerk(4000000);
    const a = attrappe({ [P('s')]: { ts: TS } }, u);
    const welt = welt9({ turnNo: 0 });
    const M = baue(a, u, welt);
    const L = M.fbV9LebenNeueRunde();
    await settle();
    welt.gen = 8; M.sync();
    const vorher = a.log.schreib.length;
    a.zustellen(P('q/0'), bereitAlle(3, 0));
    await settle();
    t('ein veralteter Lebenslauf eroeffnet nichts mehr',
      a.log.schreib.length === vorher, a.log.schreib.length + '/' + vorher);
    t('und uebergibt nicht', L.uebergeben === false);
    M.fbV9LebenStop();
  }
}
// ══ WAECHTER AM QUELLTEXT ════════════════════════════════════════════════════
abschnitt('Waechter');
{
  const roh = HTML.slice(HTML.indexOf('// ════ V9-SPIELANBINDUNG'), ENDE);
  const code = roh.split(/\r?\n/).filter(z => !/^\s*\/\//.test(z)).join('\n');
  t('der ausgelieferte Client steht auf 10',
    /const ONLINE_PROTOCOL_VERSION=10;/.test(HTML));
  t('die Ruhe haengt an der Protokollkonstante',
    /roomProto===9/.test(code));
  // DIE RUNDENNUMMER: gelesen, nie geschrieben.
  t('die Anbindung erhoeht die Rundennummer nicht',
    code.indexOf('turnNo++') < 0 && code.indexOf('turnNo=') < 0 && code.indexOf('turnNo =') < 0);
  t('sie liest sie nur', code.indexOf('turnNo') > 0);
  t('und onlineArmTurn bleibt ihr einziger Eigentuemer',
    (HTML.match(/turnNo\+\+/g) || []).length === 1);
  // KEINE Spielwirkung.
  // Der Teil VOR der Spielbruecke - Bereitschaft, Uebergabe, remove-Schliessung -
  // kennt das Spiel nur soweit, wie er muss: Rundennummer, Phase, Sieger. Die Bruecke
  // dahinter ist ausdruecklich die EINE Stelle, die Zugmenge und Ausscheiden anfasst;
  // sie hat ihre eigenen Waechter in tools/test_online_v9_gameplay_bridge.js.
  const vorBruecke = code.slice(0, code.indexOf('const FB_V9_RAUS='));
  t('die Bereitschaftsschicht wendet keine Zugmenge an',
    vorBruecke.indexOf('applyLaunch') < 0 && vorBruecke.indexOf('beginReveal') < 0 &&
    vorBruecke.indexOf('commitIdx') < 0 && vorBruecke.indexOf('fbV9AcceptedSet') < 0);
  t('und zieht keine Spielfolge aus dem Protokoll',
    vorBruecke.indexOf('footballElimEliminate') < 0 && vorBruecke.indexOf('fbElimLives') < 0 &&
    vorBruecke.indexOf('NO_REVEAL') < 0 && vorBruecke.indexOf('MISMATCH') < 0);
  t('die Bruecke ist die EINE Stelle, die beides tut',
    code.indexOf('const FB_V9_RAUS=') > 0 && code.indexOf('applyLaunch()') > 0 &&
    code.indexOf('footballElimEliminate(i,i!==entscheider)') > 0);
  t('sie eroeffnet keine Runde selbst', code.indexOf('fbV9NetOpenTurn') < 0);
  t('aber sie schliesst dauerhaft abwesende Sitze', code.indexOf('fbV9NetWriteRemove') > 0);
  t('und benutzt dafuer den bestehenden Baustein - keinen zweiten',
    (HTML.match(/function fbV9NetWriteRemove/g) || []).length === 1);
  t('sie benutzt keinen wiederholenden Zeitgeber', code.indexOf('setInterval') < 0);
  t('und keinen dauerhaften Speicher',
    code.indexOf('sessionStorage') < 0 && code.indexOf('localStorage') < 0);
  // fastForwardMatch bleibt der v8-Weg - die v9-Rehydrierung ist V9.4D.
  // fastForwardMatch traegt seit V9.4D2 zwei Eingaenge. Der v8-Zweig ist unveraendert -
  // dieselbe Zughistorie, dieselben Aufrufe -, der v9-Zweig kommt additiv daneben und
  // wird nur mit einer fertigen Zugmengenliste betreten.
  const ff = HTML.match(/function fastForwardMatch\([^)]*\)\{[\s\S]*?\n\}/);
  t('fastForwardMatch liest im v8-Zweig weiterhin die t-Historie',
    ff && ff[0].indexOf('turns[turnNo]') > 0 && ff[0].indexOf('processSlot(s,slots[s])') > 0 &&
    ff[0].indexOf('allAliveCommitted()') > 0);
  t('und der v9-Zweig benutzt AUSSCHLIESSLICH die gemeinsame Wirkung',
    ff && ff[0].indexOf('fbV9Wirken(menge,np())') > 0 &&
    (ff[0].match(/fbV9[A-Za-z]*/g) || []).join(',') === 'fbV9Wirken');
  const al = HTML.match(/function applyLaunch\([^)]*\)\{[\s\S]*?\n\}/);
  t('applyLaunch ist unberuehrt', al && al[0].indexOf('fbV9') < 0);
  const at = HTML.match(/function onlineArmTurn\([^)]*\)\{[\s\S]*?\n\}/);
  t('onlineArmTurn ist unberuehrt', at && at[0].indexOf('fbV9') < 0);
  // Die beiden Haken stehen bei den AUFRUFERN von onlineArmTurn.
  // Vier Treffer: die Definition, die zwei Spielhaken und der Abschluss einer
  // Rehydrierung, die in einer noch nicht eroeffneten Runde landet.
  t('der Haken steht an beiden Rundenanfaengen',
    (HTML.match(/fbV9LebenNeueRunde\(\)/g) || []).length === 4,
    (HTML.match(/fbV9LebenNeueRunde\(\)/g) || []).length);
  t('und beide sind gegen einen fehlenden Block abgesichert',
    (HTML.match(/typeof fbV9LebenNeueRunde==='function'\)fbV9LebenNeueRunde\(\)/g) || []).length === 2);
}

console.log('\nOnline-V9-Spielanbindung: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})().catch(e => { console.log('ABBRUCH: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
