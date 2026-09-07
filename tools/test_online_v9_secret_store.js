// V9.3B2C3B: der Geheimnisspeicher - rein lokal, ohne Browser, ohne Firebase.
//
// Geprueft wird der ECHTE Quelltext aus index.html gegen eine deterministische
// sessionStorage-Attrappe. Kein Emulator, kein Netz, kein Browser.
//
// WAS DIESE SCHICHT LEISTET: sie legt das Geheimnis einer Runde so ab, dass es das
// Neuladen desselben Tabs ueberlebt, und gibt es nur zurueck, wenn der Datensatz IN
// SICH stimmig ist - der Hash wird dabei NEU BERECHNET und verglichen, nie geglaubt.
//
// WAS SIE AUSDRUECKLICH NICHT LEISTET: sie weiss nicht, ob dieses Geheimnis zu dem
// Commit gehoert, der wirklich in Firebase steht. Dieser Abgleich ist die zweite Ebene
// und gehoert zur Steuerung (B2C3C).
//   node test_online_v9_secret_store.js
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, ok, zusatz) => {
  if (ok) { pass++; } else { fail++; console.log('  [FAIL] ' + name + (zusatz !== undefined ? ' -> ' + zusatz : '')); }
};
const abschnitt = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));

// ── Deterministische sessionStorage-Attrappe ─────────────────────────────────
// Sie kann auch WERFEN - genau das muss der Speicher aushalten, ohne das Spiel
// mitzureissen.
function lager(vorbelegt) {
  const m = new Map(Object.entries(vorbelegt || {}));
  const w = { get: false, set: false, del: false, key: false };
  const pruef = (art) => { if (w[art]) throw new Error('Speicher verweigert: ' + art); };
  return {
    inhalt: m, wirf: w,
    get length() { pruef('key'); return m.size; },
    key: (i) => { pruef('key'); return [...m.keys()][i]; },
    getItem: (k) => { pruef('get'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { pruef('set'); m.set(k, String(v)); },
    removeItem: (k) => { pruef('del'); m.delete(k); },
  };
}

// ── Den echten Speicher in eine Sandbox holen ────────────────────────────────
const START = HTML.indexOf('const FB_V9_PREIMAGE_BYTES=60');
const ENDE = HTML.indexOf('// ════ ENDE V9-GEHEIMNISSPEICHER ════');
if (START < 0 || ENDE < START) throw new Error('der v9-Bereich fehlt');
const BEREICH = HTML.slice(START, ENDE);
const baue = (st) => new Function('window', 'crypto', 'GEN_MAX', 'FB_ONLINE_SEATS',
                                  'FB_ONLINE_BALL_IDX', 'sessionStorage', `
  ${BEREICH}
  return { fbV9SecretKey, fbV9SecretSave, fbV9SecretLoad, fbV9SecretDrop,
           fbV9SecretPurge, fbV9Store, fbV9Hash, fbV9Hex, fbV9NewSalt, fbV9CtxOk,
           FB_V9_SAVED, FB_V9_NOT_FOUND, FB_V9_UNAVAILABLE, FB_V9_DROPPED, FB_V9_OK,
           FB_V9_INVALID, FB_V9_ERROR, FB_V9_STORE_V };
`)({ FB: { serverTimestamp: () => 0 } }, globalThis.crypto, 10000, 5, 5, st);

const CTX = { v: 9, code: 'RN2K', gen: 7, turn: 42, seat: 1, cap: 3 };
const mit = (x) => Object.assign({}, CTX, x);
const UID = 'UID_STORE_XXXXXXXXXXXXXXXXXX';
const H32 = '0123456789abcdef'.repeat(2);
const SCHLUESSEL = 'ro9:1:RN2K:7:42:1';

// Einen echten, in sich stimmigen Datensatz bauen - mit dem echten Codec.
async function echterSatz(M, ctx, uid, aenderung) {
  const c = Object.assign({ idx: ctx.seat, dx: 12.5, dy: -8.25, sp: 0.5 }, aenderung || {});
  const salt = M.fbV9NewSalt();
  const h = await M.fbV9Hash({ room: ctx.code, gen: ctx.gen, turn: ctx.turn, seat: ctx.seat,
                               kind: 1, idx: c.idx, dx: c.dx, dy: c.dy, sp: c.sp }, salt);
  return { v: 1, uid: uid, salt: M.fbV9Hex(salt), idx: c.idx, dx: c.dx, dy: c.dy, sp: c.sp, h: h };
}

console.log('=== V9.3B2C3B: der Geheimnisspeicher ===');

(async () => {

// ══ SCHLUESSEL ═══════════════════════════════════════════════════════════════
abschnitt('Der Schluessel');
{
  const M = baue(lager());
  t('genau ro9:<version>:<raum>:<gen>:<turn>:<sitz>',
    M.fbV9SecretKey(CTX) === SCHLUESSEL, M.fbV9SecretKey(CTX));
  t('der Raum steckt darin', M.fbV9SecretKey(CTX).indexOf('RN2K') > 0);
  t('die Generation ebenso', M.fbV9SecretKey(mit({ gen: 9 })).indexOf(':9:') > 0);
  t('die Runde ebenso', M.fbV9SecretKey(mit({ turn: 5 })).endsWith(':5:1'));
  t('und der Sitz', M.fbV9SecretKey(mit({ seat: 2 })).endsWith(':2'));
  t('verschiedene Zusammenhaenge ergeben verschiedene Schluessel',
    new Set([CTX, mit({ gen: 8 }), mit({ turn: 43 }), mit({ seat: 0 }), mit({ code: 'ABCD' })]
      .map(c => M.fbV9SecretKey(c))).size === 5);
  // Weder Konto noch Salz noch Hash gehoeren in den Schluessel.
  t('kein Konto im Schluessel', M.fbV9SecretKey(CTX).indexOf(UID) < 0);
  for (const c of [mit({ v: 8 }), mit({ code: 'rn2k' }), mit({ seat: 3 }), mit({ gen: -1 }),
                   mit({ turn: -1 }), mit({ cap: 6 }), null])
    t('ein ungueltiger Zusammenhang ergibt keinen Schluessel', M.fbV9SecretKey(c) === null);
}

// ══ ABLEGEN ══════════════════════════════════════════════════════════════════
abschnitt('Ablegen - geprueft VOR dem Schreiben');
{
  const st = lager(), M = baue(st);
  const rec = await echterSatz(M, CTX, UID);
  t('ein gueltiger Datensatz wird abgelegt', M.fbV9SecretSave(CTX, UID, rec) === M.FB_V9_SAVED);
  t('unter genau diesem Schluessel', st.inhalt.has(SCHLUESSEL));
  const roh = JSON.parse(st.inhalt.get(SCHLUESSEL));
  t('gespeichert sind genau acht Felder',
    Object.keys(roh).sort().join(',') === 'dx,dy,h,idx,salt,sp,uid,v', Object.keys(roh).join(','));
  // Was NICHT drinsteht, ist so wichtig wie das, was drinsteht.
  for (const f of ['onlineTab', 'onlinePid', 's', 'tab', 'token', 'pw', 'auth'])
    t('kein ' + f + ' im Datensatz', roh[f] === undefined);
  t('der Rohtext nennt kein Praesenztoken',
    st.inhalt.get(SCHLUESSEL).indexOf('onlineTab') < 0
    && st.inhalt.get(SCHLUESSEL).indexOf('onlinePid') < 0);

  const schlecht = [
    ['ohne Konto', { uid: '' }], ['fremdes Konto im Satz', { uid: 'ANDERS' }],
    ['falsche Version', { v: 2 }],
    ['Salz zu kurz', { salt: H32.slice(0, 31) }], ['Salz grossgeschrieben', { salt: H32.toUpperCase() }],
    ['Salz nicht hexadezimal', { salt: 'z'.repeat(32) }],
    ['Hash zu kurz', { h: 'ab'.repeat(31) }], ['Hash grossgeschrieben', { h: 'AB'.repeat(32) }],
    ['fremde Figur', { idx: 2 }], ['gebrochener Index', { idx: 1.5 }],
    ['dx ist NaN', { dx: NaN }], ['dy ist unendlich', { dy: Infinity }],
    ['sp ist NaN', { sp: NaN }],
    ['ein Feld zu viel', { extra: 1 }],
  ];
  for (const p of schlecht) {
    const s2 = lager(), M2 = baue(s2);
    const kaputt = Object.assign({}, rec, p[1]);
    if (p[0] === 'ein Feld zu viel') kaputt.extra = 1;
    t('abgewiesen: ' + p[0], M2.fbV9SecretSave(CTX, UID, kaputt) === M2.FB_V9_INVALID);
    t('  und nichts geschrieben: ' + p[0], s2.inhalt.size === 0, s2.inhalt.size);
  }
  {
    const s3 = lager(), M3 = baue(s3);
    const fehlt = Object.assign({}, rec); delete fehlt.salt;
    t('ein fehlendes Feld wird abgewiesen', M3.fbV9SecretSave(CTX, UID, fehlt) === M3.FB_V9_INVALID);
    t('ein v8-Zusammenhang ebenso',
      M3.fbV9SecretSave(mit({ v: 8 }), UID, rec) === M3.FB_V9_INVALID);
    t('und gar kein Datensatz', M3.fbV9SecretSave(CTX, UID, null) === M3.FB_V9_INVALID);
  }
  {
    // Ein werfender Speicher darf NIE als Erfolg gemeldet werden - genau daran haengt
    // spaeter die Regel, dass ohne gesichertes Geheimnis kein Commit rausgeht.
    const s4 = lager(), M4 = baue(s4);
    s4.wirf.set = true;
    const r = M4.fbV9SecretSave(CTX, UID, rec);
    t('ein werfender Speicher meldet ERROR', r === M4.FB_V9_ERROR, r);
    t('und keinesfalls SAVED', r !== M4.FB_V9_SAVED);
  }
  {
    const M5 = baue(null);
    t('ohne Speicher: UNAVAILABLE', M5.fbV9SecretSave(CTX, UID, rec) === M5.FB_V9_UNAVAILABLE);
    t('und fbV9Store() meldet das ehrlich', M5.fbV9Store() === null);
  }
}

// ══ LESEN ════════════════════════════════════════════════════════════════════
abschnitt('Lesen - der Hash wird NEU BERECHNET, nie geglaubt');
{
  const st = lager(), M = baue(st);
  const rec = await echterSatz(M, CTX, UID);
  M.fbV9SecretSave(CTX, UID, rec);
  const g = await M.fbV9SecretLoad(CTX, UID);
  t('ein gueltiger Datensatz wird gelesen', g.status === M.FB_V9_OK, g.status);
  t('mit dem kanonischen Vektor',
    g.secret.idx === 1 && g.secret.dx === 12.5 && g.secret.dy === -8.25 && g.secret.sp === 0.5);
  t('und dem Salz als 16 rohen Bytes',
    g.secret.salt instanceof Uint8Array && g.secret.salt.length === 16);
  t('sowie dem Hash', g.secret.h === rec.h);
  t('der Zusammenhang kommt mit', g.secret.room === 'RN2K' && g.secret.gen === 7
    && g.secret.turn === 42 && g.secret.seat === 1);

  t('ein fehlender Schluessel ergibt NOT_FOUND',
    (await M.fbV9SecretLoad(mit({ turn: 99 }), UID)).status === M.FB_V9_NOT_FOUND);
  t('ein fremdes Konto ergibt INVALID',
    (await M.fbV9SecretLoad(CTX, 'ANDERES_KONTO_XXXXXXXXX')).status === M.FB_V9_INVALID);

  // DER KERN: jede nachtraegliche Aenderung faellt beim Nachrechnen auf.
  for (const p of [['dx', { dx: 12.6 }], ['dy', { dy: -8.2 }], ['sp', { sp: 0.4 }],
                   ['das Salz', { salt: H32 }], ['den Hash', { h: 'ab'.repeat(32) }]]) {
    const s2 = lager(), M2 = baue(s2);
    s2.inhalt.set(SCHLUESSEL, JSON.stringify(Object.assign({}, rec, p[1])));
    const r = await M2.fbV9SecretLoad(CTX, UID);
    t('ein veraendertes ' + p[0] + ' faellt beim Nachrechnen auf',
      r.status === M2.FB_V9_INVALID, r.status);
    t('  und liefert kein Geheimnis: ' + p[0], r.secret === null);
  }
  for (const p of [['missgebildetes JSON', '{nicht json'], ['leerer Text', ''],
                   ['eine Zahl', '42'], ['null', 'null'], ['ein Feld zu viel',
                    JSON.stringify(Object.assign({}, rec, { extra: 1 }))],
                   ['falsche Version', JSON.stringify(Object.assign({}, rec, { v: 2 }))],
                   ['fremde Figur', JSON.stringify(Object.assign({}, rec, { idx: 2 }))]]) {
    const s3 = lager(), M3 = baue(s3);
    s3.inhalt.set(SCHLUESSEL, p[1]);
    t('abgewiesen beim Lesen: ' + p[0],
      (await M3.fbV9SecretLoad(CTX, UID)).status === M3.FB_V9_INVALID);
  }
  {
    const s4 = lager({ [SCHLUESSEL]: JSON.stringify(rec) }), M4 = baue(s4);
    s4.wirf.get = true;
    const r = await M4.fbV9SecretLoad(CTX, UID);
    t('ein werfender Speicher scheitert sicher', r.status === M4.FB_V9_UNAVAILABLE, r.status);
    t('ohne Ausnahme nach aussen', r.secret === null);
  }
  t('ohne Speicher: UNAVAILABLE',
    (await baue(null).fbV9SecretLoad(CTX, UID)).status === 'UNAVAILABLE');
  // Diese Schicht kennt Firebase nicht.
  const q = HTML.slice(HTML.indexOf('function fbV9SecretKey(ctx)'), ENDE);
  t('der Speicher ruft nirgends Firebase',
    q.indexOf('window.FB') < 0 && q.indexOf('runTransaction') < 0 && q.indexOf('onValue') < 0);
}

// ══ TRENNUNG DER ZUSAMMENHAENGE ══════════════════════════════════════════════
abschnitt('Ein Geheimnis gehoert zu GENAU einem Zusammenhang');
{
  const st = lager(), M = baue(st);
  const rec = await echterSatz(M, CTX, UID);
  M.fbV9SecretSave(CTX, UID, rec);
  for (const p of [['ein anderer Raum', mit({ code: 'ABCD' })],
                   ['eine andere Generation', mit({ gen: 8 })],
                   ['eine andere Runde', mit({ turn: 43 })],
                   ['ein anderer Sitz', mit({ seat: 0 })]]) {
    const r = await M.fbV9SecretLoad(p[1], UID);
    t(p[0] + ' findet es nicht', r.status === M.FB_V9_NOT_FOUND, r.status);
  }
  // Derselbe Raumcode in einer spaeteren Generation ist ein anderer Zusammenhang.
  const spaeter = mit({ gen: 8 });
  const rec2 = await echterSatz(M, spaeter, UID);
  M.fbV9SecretSave(spaeter, UID, rec2);
  t('beide liegen nebeneinander', st.inhalt.size === 2, st.inhalt.size);
  t('und jeder wird einzeln gefunden',
    (await M.fbV9SecretLoad(CTX, UID)).secret.h === rec.h
    && (await M.fbV9SecretLoad(spaeter, UID)).secret.h === rec2.h);
}

// ══ LOESCHEN ═════════════════════════════════════════════════════════════════
abschnitt('Loeschen - genau einer, mehrfach gefahrlos');
{
  const st = lager(), M = baue(st);
  const a = await echterSatz(M, CTX, UID);
  const b = await echterSatz(M, mit({ seat: 0 }), UID, { idx: 0 });
  const c = await echterSatz(M, mit({ turn: 43 }), UID);
  M.fbV9SecretSave(CTX, UID, a);
  M.fbV9SecretSave(mit({ seat: 0 }), UID, b);
  M.fbV9SecretSave(mit({ turn: 43 }), UID, c);
  t('drei Datensaetze liegen bereit', st.inhalt.size === 3, st.inhalt.size);
  t('loeschen meldet Erfolg', M.fbV9SecretDrop(CTX) === M.FB_V9_DROPPED);
  t('und trifft genau einen', st.inhalt.size === 2 && !st.inhalt.has(SCHLUESSEL));
  t('der Nachbarsitz bleibt', st.inhalt.has('ro9:1:RN2K:7:42:0'));
  t('die Nachbarrunde bleibt', st.inhalt.has('ro9:1:RN2K:7:43:1'));
  t('zweimal loeschen ist gefahrlos', M.fbV9SecretDrop(CTX) === M.FB_V9_DROPPED);
  t('und aendert nichts mehr', st.inhalt.size === 2);
  {
    const s2 = lager({ [SCHLUESSEL]: '{}' }), M2 = baue(s2);
    s2.wirf.del = true;
    t('ein werfender Speicher meldet ERROR', M2.fbV9SecretDrop(CTX) === M2.FB_V9_ERROR);
  }
  t('ohne Speicher: UNAVAILABLE', baue(null).fbV9SecretDrop(CTX) === 'UNAVAILABLE');
}

// ══ BEREICHSWEISES AUFRAEUMEN ════════════════════════════════════════════════
abschnitt('Aufraeumen - nur im ausdruecklich genannten Bereich');
{
  const bau = async () => {
    const st = lager({ 'ringout_name': 'Tunay', 'ringout_pid': 'ABC', 'fremd': 'x' });
    const M = baue(st);
    for (const c of [CTX, mit({ turn: 43 }), mit({ gen: 8 }), mit({ code: 'ABCD' })])
      M.fbV9SecretSave(c, UID, await echterSatz(M, c, UID));
    return { st: st, M: M };
  };
  {
    const g = await bau();
    t('vier Geheimnisse und drei fremde Eintraege', g.st.inhalt.size === 7, g.st.inhalt.size);
    g.M.fbV9SecretPurge({ room: 'RN2K' });
    t('ein Raum wird geraeumt', !g.st.inhalt.has(SCHLUESSEL));
    t('der andere Raum bleibt', g.st.inhalt.has('ro9:1:ABCD:7:42:1'));
    // Fremde Schluessel sind tabu.
    t('fremde Eintraege bleiben unberuehrt',
      g.st.inhalt.has('ringout_name') && g.st.inhalt.has('ringout_pid') && g.st.inhalt.has('fremd'));
  }
  {
    const g = await bau();
    g.M.fbV9SecretPurge({ room: 'RN2K', gen: 7 });
    t('nach Generation geraeumt: Generation 7 ist weg', !g.st.inhalt.has(SCHLUESSEL));
    t('Generation 8 bleibt', g.st.inhalt.has('ro9:1:RN2K:8:42:1'));
  }
  {
    const g = await bau();
    g.M.fbV9SecretPurge({ room: 'RN2K', behalte: CTX });
    t('der ausdruecklich geschuetzte Datensatz bleibt', g.st.inhalt.has(SCHLUESSEL));
    t('die uebrigen desselben Raums gehen', !g.st.inhalt.has('ro9:1:RN2K:7:43:1'));
  }
  {
    // Erkennbar unbrauchbare ro9-Schluessel duerfen weg; alles Fremde nie.
    const st = lager({ 'ro9:1:kaputt': 'x', 'ro9:2:RN2K:7:42:1': 'x',
                       'ro9:1:rn2k:7:42:1': 'x', 'ro9x': 'x', 'anderes': 'x' });
    const M = baue(st);
    M.fbV9SecretPurge({});
    t('missgebildete ro9-Schluessel werden entfernt',
      !st.inhalt.has('ro9:1:kaputt') && !st.inhalt.has('ro9:2:RN2K:7:42:1')
      && !st.inhalt.has('ro9:1:rn2k:7:42:1'));
    t('aber nichts ausserhalb des Namensraums',
      st.inhalt.has('anderes'), [...st.inhalt.keys()].join(','));
  }
  {
    const st = lager(), M = baue(st);
    st.wirf.key = true;
    t('ein werfender Speicher meldet ERROR', M.fbV9SecretPurge({}) === M.FB_V9_ERROR);
    t('ohne Speicher: UNAVAILABLE', baue(null).fbV9SecretPurge({}) === 'UNAVAILABLE');
  }
  {
    // Kein Grossreinemachen beim blossen Laden - solange der Raum nicht feststeht,
    // koennte das genau das Geheimnis wegwerfen, das gleich gebraucht wird.
    const st = lager(), M = baue(st);
    M.fbV9SecretSave(CTX, UID, await echterSatz(M, CTX, UID));
    const M2 = baue(st);                       // ein zweiter Bau - wie ein Neuladen
    t('das blosse Laden raeumt nichts', st.inhalt.has(SCHLUESSEL));
    t('und der Datensatz ist danach noch lesbar',
      (await M2.fbV9SecretLoad(CTX, UID)).status === M2.FB_V9_OK);
  }
}

// ══ DER DOPPELTE TAB ═════════════════════════════════════════════════════════
abschnitt('Der doppelte Tab - ausdruecklich hingenommen');
{
  // Ein kopierter sessionStorage laesst sich lokal nicht von einem Neuladen
  // unterscheiden. Das wird hier nicht versucht und schadet auch nicht: der zweite
  // Tab enthuellt denselben richtigen Zug, und write-once laesst nur einen durch.
  const st = lager(), M = baue(st);
  const rec = await echterSatz(M, CTX, UID);
  M.fbV9SecretSave(CTX, UID, rec);
  const kopie = lager(Object.fromEntries(st.inhalt));     // wie ein duplizierter Tab
  const M2 = baue(kopie);
  const g = await M2.fbV9SecretLoad(CTX, UID);
  t('die Kopie laesst sich lesen - so ist es gemeint', g.status === M2.FB_V9_OK, g.status);
  t('und ergibt bitgleich dasselbe Geheimnis', g.secret.h === rec.h);
  // Es gibt hier bewusst KEINE Tab-Pruefung.
  const q = HTML.slice(HTML.indexOf('const FB_V9_STORE_PREFIX'), ENDE);
  for (const w of ['onlineTab', 'onlinePid', "p/'", 'presence'])
    t('der Speicher kennt kein ' + w, q.indexOf(w) < 0);
  t('und behauptet keine Bindung an den echten Commit - das ist B2C3C',
    q.indexOf("c/'") < 0 && q.indexOf('authoritative') < 0);
}

// ══ QUELLTEXT-WAECHTER ═══════════════════════════════════════════════════════
abschnitt('Waechter');
{
  const NL = String.fromCharCode(10);
  const q = HTML.slice(HTML.indexOf('const FB_V9_STORE_PREFIX'), ENDE);
  const code = q.split(NL).map(z => { const k = z.indexOf('//');
    return k >= 0 ? z.slice(0, k) : z; }).join(NL);
  t('der freigegebene Client steht auf Protokoll 8',
    /const ONLINE_PROTOCOL_VERSION=8;/.test(HTML));
  t('der Speicher benutzt sessionStorage', code.indexOf('sessionStorage') > 0);
  t('und ausdruecklich KEIN localStorage', code.indexOf('localStorage') < 0);
  t('und kein IndexedDB', code.indexOf('indexedDB') < 0 && code.indexOf('IDBFactory') < 0);
  t('keine Spielwirkung',
    ['fbElimLives', 'gameOver', 'applyLaunch', 'commitIdx', 'aimSet'].every(w => code.indexOf(w) < 0));
  // Geheimes Material gehoert nicht in die Ausgabe.
  t('nichts wird protokolliert',
    code.indexOf('console.') < 0 && code.indexOf('alert(') < 0);
  t('ausserhalb des ruhenden Bereichs nennt keine Zeile eine v9-Funktion',
    HTML.split(HTML.slice(START, HTML.indexOf('// ════ ENDE V9-BEREITSCHAFTSSTEUERUNG ════')))
      .join('').indexOf('fbV9') < 0);
  // Der v8-Weg benutzt localStorage weiterhin - fuer Name, Kennung, gemerkten Raum.
  // Das ist unberuehrt und soll so bleiben.
  t('der v8-Weg behaelt sein localStorage', HTML.indexOf("localStorage.getItem('ringout_pid')") > 0);
}

console.log('\nOnline-V9-Speicher: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.log('AUSNAHME: ' + (e && e.stack ? e.stack : e)); process.exit(2); });
