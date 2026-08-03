// Firebase-Boot-Isolation: der produktive v3-Pfad (RTDB) darf NICHT vom Laden des
// Auth-Moduls abhaengen.
//
// Hintergrund (Review-Befund P2): firebase-auth.js war statisch importiert. Ein
// statischer Import, der nicht laedt (CDN blockiert, Adblocker, Offline-Cache),
// bricht die AUSWERTUNG DES GANZEN MODULS ab — window.FB waere nie gesetzt und
// das bestehende v3-Online-Spiel damit tot, obwohl Auth nur v4 betrifft.
//
// Diese Suite fuehrt den ECHTEN Boot-Block aus index.html aus (statische Imports
// werden durch Stubs ersetzt, der dynamische Auth-Import durch einen
// kontrollierbaren Loader) und prueft das Verhalten in vier Szenarien.
//   node tools/test_auth_boot.js
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(path.dirname(__dirname), 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// ── Boot-Block aus index.html extrahieren ──
const block = SRC.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!block) { console.error('FAIL: <script type="module"> nicht gefunden'); process.exit(2); }
const RAW = block[1];

// Statische Imports einsammeln und durch Stub-Parameter ersetzen.
const STATIC_IMPORT = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*"([^"]+)";?[ \t]*$/gm;
const imported = [], importUrls = [];
const BODY = RAW.replace(STATIC_IMPORT, (all, list, url) => {
  list.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => imported.push(n));
  importUrls.push(url);
  return '/* statischer Import im Test gestubbt */';
}).replace(/\bimport\(/g, '__dynImport(');

// (1) Regressionsschutz: Auth darf NIE wieder statisch importiert werden.
t('kein statischer firebase-auth-Import', importUrls.every((u) => !/firebase-auth/.test(u)));
t('Auth wird dynamisch geladen', /__dynImport\(/.test(BODY) && /firebase-auth\.js/.test(BODY));
t('Datenbank-Modul bleibt statisch importiert', importUrls.some((u) => /firebase-database/.test(u)));

// ── Ausfuehrungsumgebung: minimale Stubs, echter Boot-Code ──
class Ev { constructor(type) { this.type = type; } }
function bootWith(dynImport) {
  const events = [];
  const win = { dispatchEvent: (e) => events.push(e.type) };
  const stubs = {
    initializeApp: (cfg) => ({ __app: true, cfg }),
    getDatabase: () => ({ __db: true }),
  };
  for (const n of imported) if (!(n in stubs)) stubs[n] = function () {};
  const argNames = imported.concat(['window', 'Event', '__dynImport']);
  const argVals = imported.map((n) => stubs[n]).concat([win, Ev, dynImport]);
  new Function(...argNames, BODY)(...argVals);
  return { win, events };
}
const tick = () => new Promise((r) => setImmediate(r));

(async function main() {
  // (2) Auth-Modul nicht ladbar -> v3-Boot laeuft vollstaendig durch.
  {
    const { win, events } = bootWith(() => Promise.reject(new Error('CDN blockiert')));
    await tick(); await tick();
    t('Ausfall: window.FB gesetzt', !!win.FB && !!win.FB.db);
    t('Ausfall: __FB_READY true', win.__FB_READY === true);
    t('Ausfall: kein __FB_ERR', win.__FB_ERR === undefined);
    t('Ausfall: __FB_UID leer (v4 inaktiv, kein Absturz)', win.__FB_UID === '');
    t('Ausfall: fb-ready wurde gefeuert', events.indexOf('fb-ready') >= 0);
    t('Ausfall: kein fb-auth-Event', events.indexOf('fb-auth') < 0);
  }
  // (3) Auth-Modul haengt (nie aufgeloest) -> Boot blockiert nicht.
  {
    const { win, events } = bootWith(() => new Promise(() => {}));
    await tick(); await tick();
    t('Haenger: window.FB sofort verfuegbar', !!win.FB && win.__FB_READY === true);
    t('Haenger: fb-ready trotzdem gefeuert', events.indexOf('fb-ready') >= 0);
  }
  // (4) Auth-Modul laedt, aber der Anonymous-Provider ist deaktiviert.
  {
    const mod = {
      getAuth: () => ({}),
      onAuthStateChanged: (a, cb) => cb(null),
      signInAnonymously: () => Promise.reject(new Error('auth/operation-not-allowed')),
    };
    const { win } = bootWith(() => Promise.resolve(mod));
    await tick(); await tick();
    t('Provider aus: __FB_UID bleibt leer', win.__FB_UID === '');
    t('Provider aus: v3-Boot unveraendert', win.__FB_READY === true && !!win.FB);
  }
  // (5) Auth vorhanden -> uid wird bereitgestellt und signalisiert.
  {
    const mod = {
      getAuth: () => ({}),
      onAuthStateChanged: (a, cb) => cb({ uid: 'uid-anon-0001' }),
      signInAnonymously: () => Promise.resolve({}),
    };
    const { win, events } = bootWith(() => Promise.resolve(mod));
    await tick(); await tick();
    t('Auth aktiv: __FB_UID gesetzt', win.__FB_UID === 'uid-anon-0001');
    t('Auth aktiv: fb-auth-Event gefeuert', events.indexOf('fb-auth') >= 0);
  }

  console.log('\nAuth-Boot-Isolation: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
