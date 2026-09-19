// Anmeldung auf langsamem Netz: ein SPAETER Erfolg darf nicht verworfen werden.
// Befund (RC-Gate 01): bei 2,5 s Latenz schlug der Boot-Watchdog nach 10 s an, die
// Anmeldung gelang ~35 s spaeter trotzdem - der Fehler blieb aber stehen, fbReady() blieb
// false, und jeder Online-Einstieg meldete "Anmeldung fehlgeschlagen". Ein Neuladen lief
// auf demselben Netz in dieselbe Grenze.
// Ausgefuehrt werden die ECHTEN Textbloecke aus index.html (Watchdog-Skript, Anmeldeblock
// des Moduls, fbReady) gegen eine gesteuerte Uhr und eine gefaelschte Anmeldung.
const { loadIndexHtml, grab } = require('./extract');
const html = loadIndexHtml();
const watchdog = grab(html, /window\.FB_BOOT_TIMEOUT_MS = 10000;[\s\S]*?\n<\/script>/, 'Watchdog-Skript').replace(/<\/script>$/, '');
const anmeldeBlock = grab(html, /const AUTH_TIMEOUT_MS = [\s\S]*?\}catch\(e\)\{ window\.__FB_ERR = String\(e && e\.message \|\| e\); finish\(\); \}/, 'Anmeldeblock');
const fbReadySrc = grab(html, /function fbReady\(\)\{[^\n]*\}/, 'fbReady');

let pass = 0, fail = 0;
const t = (name, ok, info) => { if (ok) { pass++; console.log('  [OK]   ' + name); } else { fail++; console.log('  [FAIL] ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); } };

// Ein Durchlauf: plan = { anmeldungNach: ms | null (nie), fehler: 'code' | null, modulStartNach: ms }
function lauf(plan) {
  let jetzt = 0; const timer = [];
  const setTimeout = (fn, ms) => { timer.push({ due: jetzt + ms, fn }); };
  const events = [];
  class Event { constructor(type) { this.type = type; } }
  const window = { dispatchEvent(e) { events.push(e.type); } };
  const signInAnonymously = () => new Promise((res, rej) => {
    if (plan.anmeldungNach === null) return;
    setTimeout(() => plan.fehler ? rej(new Error(plan.fehler)) : res({ user: { uid: 'UID-1' } }), plan.anmeldungNach);
  });
  const stub = () => ({});
  const modul = new Function('window', 'Event', 'setTimeout', 'initializeApp', 'getDatabase', 'getAuth', 'signInAnonymously',
    'ref', 'set', 'get', 'update', 'remove', 'onValue', 'onDisconnect', 'serverTimestamp', 'runTransaction', 'query', 'orderByChild', 'limitToLast',
    'const firebaseConfig = {};\n' + anmeldeBlock);
  new Function('window', 'Event', 'setTimeout', watchdog)(window, Event, setTimeout);
  const fbReady = new Function('window', fbReadySrc + '\nreturn fbReady;')(window);
  return {
    window, events, fbReady,
    async bis(ms) {
      const ziel = jetzt + ms;
      for (;;) {
        await new Promise(r => setImmediate(r));
        timer.sort((a, b) => a.due - b.due);
        const n = timer[0];
        if (!n || n.due > ziel) { jetzt = ziel; await new Promise(r => setImmediate(r)); return; }
        timer.shift(); jetzt = n.due; n.fn();
      }
    },
    modulStart() { modul(window, Event, setTimeout, stub, stub, stub, signInAnonymously, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub); }
  };
}

(async () => {
  // A: das Modul startet sofort, die Anmeldung antwortet in 1 s -> alles wie immer.
  { const L = lauf({ anmeldungNach: 1000 }); L.modulStart(); await L.bis(12000);
    t('A rechtzeitige Anmeldung: bereit, uid, kein Fehler', !!L.fbReady() && L.window.__FB_UID === 'UID-1' && !L.window.__FB_AUTH_ERR, L.window);
    t('A kein Nachhol-Ereignis noetig', L.events.filter(e => e === 'fb-auth-late').length === 0, L.events); }

  // B: der Befund - das SDK kommt spaet (Modul startet nach 30 s), die Anmeldung dann rasch.
  //    Der Watchdog hat nach 10 s schon "firebase boot timeout" gesetzt.
  { const L = lauf({ anmeldungNach: 2000 }); await L.bis(30000);
    t('B vor der Anmeldung: Watchdog hat entschieden, noch nicht bereit', L.window.__FB_READY === true && L.window.__FB_AUTH_ERR === 'firebase boot timeout' && !L.fbReady());
    L.modulStart(); await L.bis(5000);
    t('B spaete Anmeldung wird uebernommen: fbReady() wird true', !!L.fbReady(), { err: L.window.__FB_AUTH_ERR, uid: L.window.__FB_UID });
    t('B genau EIN Nachhol-Ereignis fuer OPEN ROOMS', L.events.filter(e => e === 'fb-auth-late').length === 1, L.events); }

  // C: das Modul startet sofort, die Anmeldung braucht aber 25 s - die Anmelde-Zeitgrenze
  //    (10 s ab Modulstart) erklaert sie fuer gescheitert, danach gelingt sie doch.
  { const L = lauf({ anmeldungNach: 25000 }); L.modulStart(); await L.bis(12000);
    t('C nach 12 s: gilt als gescheitert', !L.fbReady() && !!L.window.__FB_AUTH_ERR, L.window.__FB_AUTH_ERR);
    await L.bis(20000);
    t('C nach dem spaeten Erfolg: bereit', !!L.fbReady(), { err: L.window.__FB_AUTH_ERR, uid: L.window.__FB_UID }); }

  // D: ein ECHTER Anmeldefehler bleibt stehen - nichts wird schoengeredet.
  { const L = lauf({ anmeldungNach: 1500, fehler: 'auth/operation-not-allowed' }); L.modulStart(); await L.bis(40000);
    t('D echter Fehler bleibt: nicht bereit, Fehler sichtbar', !L.fbReady() && /operation-not-allowed/.test(String(L.window.__FB_AUTH_ERR)), L.window.__FB_AUTH_ERR);
    t('D kein Nachhol-Ereignis', L.events.filter(e => e === 'fb-auth-late').length === 0); }

  // E: die Anmeldung antwortet nie - es bleibt beim begrenzten Fehlschlag, kein neuer Versuch.
  { let versuche = 0; const L = lauf({ anmeldungNach: null });
    const orig = L.modulStart; L.modulStart = () => { versuche++; orig(); };
    L.modulStart(); await L.bis(120000);
    t('E keine Antwort: begrenzter Fehlschlag, nicht bereit', !L.fbReady() && !!L.window.__FB_AUTH_ERR);
    t('E genau ein Anmeldeversuch, keine Schleife', versuche === 1); }

  // F: Verdrahtung im Produkt - der Anmeldeblock uebergibt den EINEN Versuch an die
  //    Uebernahme, und die OPEN-ROOMS-Vorschau haengt am Nachhol-Ereignis.
  t('F der Anmeldeblock reicht das Ergebnis an __fbAnmeldungDa weiter',
    /const anmeldung = signInAnonymously\(auth\);[\s\S]*anmeldung\.then\(cred => window\.__fbAnmeldungDa\(/.test(anmeldeBlock));
  t('F es gibt genau EINEN signInAnonymously-Aufruf', (anmeldeBlock.match(/signInAnonymously\(/g) || []).length === 1);
  t('F OPEN ROOMS wird nach einer spaeten Anmeldung nachgeholt',
    /window\.addEventListener\('fb-auth-late',\(\)=>\{ if\(fbReady\(\)&&menuVisible\)startPublicListing\(\); \}\);/.test(html));

  console.log(`\nAnmeldung-spaet: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
