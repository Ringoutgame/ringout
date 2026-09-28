// Wolkenstufe: prueft den ECHTEN Leistungsregler der Automatik (Block ==WOLKEN-REGLER== aus index.html,
// isoliert ausgefuehrt) gegen realistische Bildzeit-Verlaeufe, dazu die Einbindung (manuelle Wahl hat
// Vorrang, gespeichert, Automatik schaltet nur Hoch -> Sparsam) statisch gegen den Quelltext.
//   node tools/test_wolken_stufe.js
'use strict';
const HTML = require('./extract').loadIndexHtml();
let pass = 0, fail = 0;
const t = (name, cond, info) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''))); };

const a = HTML.indexOf('const WOLKEN_WAHL_KEY=');   // ab den Schluesseln (Speicher-Helfer brauchen sie)
const b = HTML.indexOf('// ==/WOLKEN-REGLER==');
if (a < 0 || b < 0) { console.error('Extraktion des Reglers fehlgeschlagen'); process.exit(1); }
const speicher = {};
const localStorage = { getItem: k => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: k => { delete speicher[k]; } };
const R = new Function('localStorage', HTML.slice(a, b) +
  '\nreturn {WOLKEN_REGLER, wolkenReglerNeu, wolkenReglerSchritt, wolkenAutoGemerkt, wolkenAutoMerken, wolkenAutoLesen, wolkenAutoEntlasten};')(localStorage);
const WOLKEN_AUTO_KEY = 'ringout_wolken_auto_v1';
const DOCUMENT_FREI = true;

// Laesst einen Bildzeit-Verlauf durch den Regler laufen: liefert, nach wie vielen Sekunden er auf Sparsam wechselt (oder null).
function lauf(gen, sekunden) {
  const z = R.wolkenReglerNeu(); let zeit = 0, i = 0;
  while (zeit < sekunden * 1000) { const dt = gen(i++, zeit); zeit += dt; if (R.wolkenReglerSchritt(z, dt)) return { nach: zeit / 1000, z }; }
  return { nach: null, z };
}
let seed = 12345; const zufall = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const um = (ms, streu) => ms + (zufall() - 0.5) * streu;

// ── A) Fluessige Geraete bleiben auf Hoch ──
t('A1 60 Hz fluessig (16,7 ms +-1) bleibt 5 min auf Hoch', lauf(() => um(16.7, 2), 300).nach === null);
t('A2 120 Hz fluessig (8,3 ms) bleibt auf Hoch', lauf(() => um(8.3, 1), 300).nach === null);
t('A3 120 Hz, das oft auf 60 FPS faellt (16,7 ms), bleibt auf Hoch', lauf(i => i % 3 ? 8.3 : 16.7, 300).nach === null);
t('A4 90 Hz mit gelegentlich verpasstem Bild (22 ms) bleibt auf Hoch', lauf(i => i % 10 ? 11.1 : 22.2, 300).nach === null);

// ── B) Einzelne Ausreisser und kurze Haenger schalten NICHT ──
t('B1 alle 2 s ein Ausreisser von 100 ms: kein Wechsel', lauf((i, z) => (i % 120 === 60 ? 100 : 16.7), 300).nach === null);
t('B2 Tab-Wechsel/Ladepausen (> 250 ms) werden ignoriert', lauf(i => (i % 200 === 5 ? 2000 : 16.7), 300).nach === null);
t('B3 Speicherbereinigung: alle 5 s sechs Bilder mit 40 ms: kein Wechsel', lauf(i => (i % 300 < 6 ? 40 : 16.7), 300).nach === null);
for (const start of [600, 630, 660])
  t('B4 ein einzelner Ruckelschub von 3 s (90 Bilder a 33 ms, Beginn ' + start + ') schaltet nicht', lauf(i => (i >= start && i < start + 90 ? 33.3 : 16.7), 300).nach === null);
t('B4b ... auch dann nicht, wenn der 3-s-Schub schwerer ist (jedes Bild 50 ms, 60 Bilder)', lauf(i => (i >= 600 && i < 660 ? 50 : 16.7), 300).nach === null);
t('C0 6 s ununterbrochenes Ruckeln (180 Bilder a 33 ms) schaltet dagegen', lauf(i => (i >= 600 && i < 780 ? 33.3 : 16.7), 300).nach !== null);
t('B5 Ruckelschuebe alle 15 s (je 1,5 s) summieren sich nicht', lauf(i => (i % 900 < 90 && i > 100 ? 33.3 : 16.7), 300).nach === null);
t('B6 Doppelbilder (< 4 ms) zaehlen nicht', lauf(i => (i % 2 ? 1 : 16.7), 300).nach === null);

// ── C) Schwache Geraete wechseln verlaesslich und zuegig ──
const c1 = lauf(i => (i % 4 === 0 ? 33.3 : 16.7), 120);
t('C1 jedes vierte Bild verpasst (25 %): Wechsel', c1.nach !== null, c1.nach);
t('C1 ... innerhalb von 7 s', c1.nach !== null && c1.nach < 7, c1.nach);
const c2 = lauf(() => 33.3, 120);
t('C2 dauerhaft 30 FPS auf 60-Hz-Display: Wechsel nach etwa 9 s', c2.nach !== null && c2.nach < 10, c2.nach);
const c3 = lauf(() => um(45, 20), 120);
t('C3 schwaches Geraet 20-25 FPS: Wechsel', c3.nach !== null && c3.nach < 14, c3.nach);
const c4 = lauf(i => (i % 3 === 0 ? 50 : 16.7), 120);
t('C4 jedes dritte Bild haengt (50 ms): Wechsel', c4.nach !== null && c4.nach < 9, c4.nach);
const c5 = lauf((i, z) => (z < 60000 ? 16.7 : (i % 3 === 0 ? 33.3 : 16.7)), 180);
t('C5 erst fluessig, nach 60 s dauerhaftes Ruckeln (Erwaermung): Wechsel kurz danach', c5.nach !== null && c5.nach > 60 && c5.nach < 68, c5.nach);

// ── G) Extrem langsame Geraete (jedes Bild ueber der Pausengrenze) ──
const g1 = lauf(() => 1100, 300);
t('G1 Software-Grafik mit ~1 FPS: Wechsel (Riesenbilder in Folge zaehlen)', g1.nach !== null, g1.nach);
t('G1 ... innerhalb von 30 s', g1.nach !== null && g1.nach < 30, g1.nach);
const g2 = lauf(() => 300, 300);
t('G2 3 FPS: Wechsel innerhalb von 25 s', g2.nach !== null && g2.nach < 25, g2.nach);
t('G3 zwei Riesenbilder hintereinander (Tab-Rueckkehr) alle 10 s: kein Wechsel', lauf(i => (i % 600 === 5 || i % 600 === 6 ? 900 : 16.7), 300).nach === null);

// ── D) Keine Rueckkehr, kein Hin- und Herschalten ──
{ const z = R.wolkenReglerNeu(); let wechsel = 0;
  for (let i = 0; i < 20000; i++) if (R.wolkenReglerSchritt(z, i % 2 ? 33.3 : 16.7)) wechsel++;
  t('D1 nach der Entscheidung meldet der Regler nie wieder (genau ein Wechsel)', wechsel === 1, wechsel);
  t('D2 der Regler bleibt entschieden, auch bei danach fluessigen Bildern', !R.wolkenReglerSchritt(z, 16.7) && z.entschieden === true); }

// ── E) Gedaechtnis: vorübergehende Probleme legen NICHT fest ──
{ const h = 36e5, tag = 864e5, t0 = 1.8e12; const leeren = () => { delete speicher[WOLKEN_AUTO_KEY]; };
  leeren();
  t('E1 ohne Eintrag: Start auf Hoch', R.wolkenAutoGemerkt(t0) === null);
  R.wolkenAutoMerken(t0);
  t('E2 EIN ruckelnder Abend legt nicht fest: naechster Start auf Hoch', R.wolkenAutoGemerkt(t0 + tag) === null);
  R.wolkenAutoMerken(t0 + 20 * 60e3);
  t('E3 Neuladen im selben Problem (20 min spaeter) zaehlt nicht doppelt', R.wolkenAutoGemerkt(t0 + tag) === null && R.wolkenAutoLesen(t0 + tag).n === 1);
  R.wolkenAutoMerken(t0 + 2 * tag);
  t('E4 zweite Sitzung mit Rucklern an einem anderen Tag: jetzt Start auf Sparsam', R.wolkenAutoGemerkt(t0 + 2 * tag + h) === 'spar');
  t('E5 nach ' + R.WOLKEN_REGLER.merkenTage + ' Tagen ohne neuen Einbruch: wieder Hoch', R.wolkenAutoGemerkt(t0 + 2 * tag + (R.WOLKEN_REGLER.merkenTage + 0.1) * tag) === null);
  R.wolkenAutoEntlasten();
  t('E6 Entlasten loescht das Gedaechtnis', R.wolkenAutoGemerkt(t0 + 2 * tag + h) === null && !(WOLKEN_AUTO_KEY in speicher));
  speicher[WOLKEN_AUTO_KEY] = JSON.stringify({ stufe: 'spar', t: t0 });
  t('E7 alter Eintrag (vor dieser Aenderung) zaehlt nur als eine Sitzung', R.wolkenAutoGemerkt(t0 + h) === null);
  speicher[WOLKEN_AUTO_KEY] = '{kaputt';
  t('E8 beschaedigter Speicher faellt still auf Hoch zurueck', R.wolkenAutoGemerkt(t0) === null);
  leeren(); }

// ── F) Einbindung (statisch) ──
t('F1 Einstellung wird unter ringout_wolken_v1 gespeichert', /localStorage\.setItem\(WOLKEN_WAHL_KEY,w\)/.test(HTML));
t('F2 nur auto|hoch|spar sind gueltig, Standard ist auto', /return v==='hoch'\|\|v==='spar'\?v:'auto'/.test(HTML));
t('F3 manuelle Wahl hat Vorrang vor der gemerkten Automatik', /wolkenWahl==='hoch'\?'voll':wolkenWahl==='spar'\?'spar':\(wolkenAutoGemerkt/.test(HTML));
t('F4 der Regler laeuft nur in der Automatik und nur solange Hoch laeuft', /if\(wolkenWahl!=='auto'\|\|stufe!=='voll'\|\|document\.hidden\)/.test(HTML));
t('F5 der Regler wird je dargestelltem Bild gefuettert', /render\(\)\{sync\(\);if\(wv\)\{wv\.takt\(performance\.now\(\)\);wv\.vorab\(\);\}/.test(HTML));
t('F6 Anlaufphase nach Aufbau und Tab-Rueckkehr wird nicht gewertet', (HTML.match(/ruheBis=performance\.now\(\)\+4000/g) || []).length >= 3);
t('F7 drei Knoepfe Automatisch/Hoch/Sparsam im Settings-Fenster', /id="wolkenAutoBtn"[\s\S]*id="wolkenHochBtn"[\s\S]*id="wolkenSparBtn"/.test(HTML));
t('F8 deutsche Beschriftung Automatisch / Hoch / Sparsam', /wolkenAuto:'Automatisch',wolkenHoch:'Hoch',wolkenSpar:'Sparsam'/.test(HTML));
t('F10 Einbruch in der Sitzung wird gezaehlt (nicht sofort festgelegt)', /stufeSetzen\('spar'\);wolkenAutoMerken\(Date\.now\(\)\)/.test(HTML));
t('F11 fluessiges Spiel auf Hoch entlastet das Gedaechtnis', /\(hochMs\+=dt\)>=WOLKEN_REGLER\.entlastenMs/.test(HTML) && /wolkenAutoEntlasten\(\);r3dDiag\('wolken-entlastet'/.test(HTML));
t('F12 bewusste Wahl "Automatisch" beginnt neu', /if\(w==='auto'\)wolkenAutoEntlasten\(\)/.test(HTML));
t('F9 Stufen unterscheiden sich in Aufloesung und Schritten', /voll:\{aufl:0\.5,schritte:96,/.test(HTML) && /spar:\{aufl:0\.34,schritte:56,/.test(HTML));

console.log('Wolken-Stufe: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
