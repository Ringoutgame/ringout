// ─────────────────────────────────────────────────────────────────────────────
// RingOut — CONTRACT-Rules aus den EXPAND-Rules ableiten.
//
//   node tools/derive_contract_rules.js            schreibt firebase.rules.contract.json
//   node tools/derive_contract_rules.js --check    prueft nur, ob die Datei aktuell ist
//
// Der Rollout von Online-Protokoll v3.1 laeuft in zwei Rules-Stufen:
//
//   EXPAND   (firebase.rules.json — deploybar, abwaertskompatibel)
//            players/<seat>/uid ist ERLAUBT. Traegt ein Seat eine uid, darf nur
//            noch diese uid ihn veraendern. Ein Seat ohne uid verhaelt sich
//            exakt wie unter v3 — bereits ausgelieferte Clients spielen weiter.
//
//   CONTRACT (firebase.rules.contract.json — Zielstand, NICHT deployen)
//            uid ist PFLICHT und auth != null wird verlangt. Ab hier ist ein
//            Client ohne Anmeldung ausgesperrt. Der Cutover braucht vorher eine
//            Migration/Drain bestehender uid-loser Raeume (Block D).
//
// Beide Staende entstehen aus EINER Quelle: der Unterschied ist ausschliesslich
// der Ownership-Ausdruck, den diese Ableitung ersetzt.
//
// FAIL-CLOSED: die Ableitung verlangt EXAKT die erwartete Anzahl Ersetzungen je
// Gate-Art, duldet danach keinen uebrig gebliebenen EXPAND-Ausdruck und beweist,
// dass ausser den bekannten Regeln NICHTS anderes im Baum abweicht. Jede
// Abweichung ist ein harter Fehler — eine stillschweigend halb transformierte
// Rules-Datei waere schlimmer als gar keine.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Die Pfade sind ueberschreibbar, damit Tests gegen Kopien in einem Temp-
// Verzeichnis laufen koennen: die getrackten Rules-Dateien bleiben dabei
// unangetastet — eine Testsuite, die Sicherheitsdateien veraendert, ist selbst
// ein Risiko.
const EXPAND_FILE = process.env.RINGOUT_EXPAND_RULES || path.join(ROOT, 'firebase.rules.json');
const CONTRACT_FILE = process.env.RINGOUT_CONTRACT_RULES || path.join(ROOT, 'firebase.rules.contract.json');

const R = "root.child('rooms').child($code)";
// Jede Gate-Art hat ihre eigenen Platzhalter: 'roster'/'seat' stehen unter
// rooms/$code/{players,p}/$i, 'play' unter dem Move-Slot ($pl) bzw. bc/br ($seat).
const GATE_VARS = { roster: ['$i'], seat: ['$i'], play: ['$pl', '$seat'] };

// Erwartete Ersetzungen — hart, nicht "mindestens". Fehlt eine, ist die
// Ableitung unvollstaendig; kommt eine dazu, wurde etwas Unbeabsichtigtes
// getroffen. Beides bricht ab.
const EXPECTED_COUNTS = { 'seat$i': 1, 'roster$i': 1, 'play$pl': 1, 'play$seat': 2 };

const UID = (v) => R + ".child('players').child(" + v + ").child('uid')";
const POST_UID = (v) => "newData.parent().parent().child('players').child(" + v + ").child('uid').val()";

// Drei Gate-Varianten — je nachdem, wie viel der Schreibpfad ueber das Eigentum
// wissen KANN:
//
//   roster  players/<seat>    hier entsteht das Eigentum. CONTRACT muss den
//                             frischen Claim ausdruecklich zulassen (!data.exists()),
//                             sonst kaeme nie ein Seat zustande.
//   seat    p/<seat>          Presence. Frischer Claim und Lobby-Recycling
//                             schreiben players/<seat> in DERSELBEN atomaren
//                             Operation — deshalb zaehlt auch die Nachher-Sicht.
//                             Ein fremder aktiver Seat ist darueber nicht
//                             erreichbar: der players-Knoten verteidigt sich selbst.
//   play    Move-Slot, bc, br reines Eigentum, kein Entstehungsfall.
const GATES = {
  roster: {
    expand: (v) => "(!" + UID(v) + ".exists() || " + UID(v) + ".val() === auth.uid)",
    contract: (v) => "(auth != null && (" + UID(v) + ".val() === auth.uid"
      + " || (!data.exists() && newData.child('uid').val() === auth.uid)))",
  },
  seat: {
    expand: (v) => "(!" + UID(v) + ".exists() || " + UID(v) + ".val() === auth.uid || " + POST_UID(v) + " === auth.uid)",
    contract: (v) => "(auth != null && (" + UID(v) + ".val() === auth.uid || " + POST_UID(v) + " === auth.uid))",
  },
  play: {
    expand: (v) => "(!" + UID(v) + ".exists() || " + UID(v) + ".val() === auth.uid)",
    contract: (v) => "(auth != null && " + UID(v) + ".val() === auth.uid)",
  },
};

// players/<seat>/uid wird im Contract-Stand zum Pflichtfeld.
const ROSTER_FIELDS_EXPAND = "newData.hasChildren(['id','name','tab'])";
const ROSTER_FIELDS_CONTRACT = "newData.hasChildren(['id','name','tab','uid'])";

// Genau diese Regeln DUERFEN sich zwischen den Staenden unterscheiden. Jede
// weitere Abweichung im Baum ist ein Fehler.
const ALLOWED_DIFFS = [
  "rules.rooms.$code.p.$i..write",
  "rules.rooms.$code.players.$i..write",
  "rules.rooms.$code.players.$i..validate",
  "rules.rooms.$code.g.$gen.t.$turn.$pl..write",
  "rules.rooms.$code.g.$gen.t.$turn.bc.$seat..write",
  "rules.rooms.$code.g.$gen.t.$turn.br.$seat..write",
];

// Kanonisches Struktur-Manifest des ERWARTETEN EXPAND-Baums.
// Der reine Vorher/Nachher-Vergleich reicht nicht: ein zusaetzlicher oder
// entfernter Regelknoten waere auf beiden Seiten gleich und damit unsichtbar.
// Deshalb wird die Eingabe VOR der Transformation gegen diese Liste geprueft —
// jeder fehlende und jeder unerwartete Pfad bricht ab.
const EXPECTED_PATHS = [
  'rules/.read',
  'rules/.write',
  'rules/publicRooms/$code/$other/.validate',
  'rules/publicRooms/$code/.validate',
  'rules/publicRooms/$code/.write',
  'rules/publicRooms/$code/created/.validate',
  'rules/publicRooms/.indexOn',
  'rules/publicRooms/.read',
  'rules/rooms/$code/$other/.validate',
  'rules/rooms/$code/.read',
  'rules/rooms/$code/.validate',
  'rules/rooms/$code/.write',
  'rules/rooms/$code/config/$other/.validate',
  'rules/rooms/$code/config/.validate',
  'rules/rooms/$code/config/fmt/.validate',
  'rules/rooms/$code/config/visibility/.validate',
  'rules/rooms/$code/config/winTarget/.validate',
  'rules/rooms/$code/created/.validate',
  'rules/rooms/$code/g/$gen/e/$seat/.validate',
  'rules/rooms/$code/g/$gen/e/$seat/.write',
  'rules/rooms/$code/g/$gen/t/$turn/$pl/$other/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/$pl/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/$pl/.write',
  'rules/rooms/$code/g/$gen/t/$turn/$pl/dx/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/$pl/dy/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/$pl/idx/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/$pl/sp/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/$pl/ts/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/bc/$seat/$other/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/bc/$seat/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/bc/$seat/.write',
  'rules/rooms/$code/g/$gen/t/$turn/bc/$seat/hash/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/bc/$seat/seat/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/bc/$seat/turn/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/bc/$seat/v/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/br/$seat/$other/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/br/$seat/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/br/$seat/.write',
  'rules/rooms/$code/g/$gen/t/$turn/br/$seat/nonce/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/br/$seat/seat/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/br/$seat/seg/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/br/$seat/turn/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/br/$seat/v/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/s/.validate',
  'rules/rooms/$code/g/$gen/t/$turn/s/.write',
  'rules/rooms/$code/gen/.validate',
  'rules/rooms/$code/gen/.write',
  'rules/rooms/$code/p/$i/$other/.validate',
  'rules/rooms/$code/p/$i/.validate',
  'rules/rooms/$code/p/$i/.write',
  'rules/rooms/$code/p/$i/on/.validate',
  'rules/rooms/$code/p/$i/s/.validate',
  'rules/rooms/$code/p/$i/t/.validate',
  'rules/rooms/$code/players/$i/$other/.validate',
  'rules/rooms/$code/players/$i/.validate',
  'rules/rooms/$code/players/$i/.write',
  'rules/rooms/$code/players/$i/id/.validate',
  'rules/rooms/$code/players/$i/name/.validate',
  'rules/rooms/$code/players/$i/tab/.validate',
  'rules/rooms/$code/players/$i/uid/.validate',
  'rules/rooms/$code/seats/.validate',
  'rules/rooms/$code/seats/.write',
  'rules/rooms/$code/state/.validate',
  'rules/rooms/$code/state/.write',
  'rules/rooms/$code/v/.validate',
];

function rulePaths(node, prefix, out) {
  out = out || [];
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const k of Object.keys(node).sort()) rulePaths(node[k], prefix ? prefix + '/' + k : k, out);
  } else out.push(prefix);
  return out;
}

// Fail-closed: die Struktur muss EXAKT dem Manifest entsprechen, bevor
// ueberhaupt transformiert wird.
function assertStructure(text, label) {
  let tree;
  try { tree = JSON.parse(text); } catch (e) { throw new Error(`${label}: kein gueltiges JSON — ${e.message}`); }
  const have = rulePaths(tree, '');
  const want = new Set(EXPECTED_PATHS), got = new Set(have);
  const missing = EXPECTED_PATHS.filter((p) => !got.has(p));
  const extra = have.filter((p) => !want.has(p));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push('fehlende Regelpfade: ' + missing.join(', '));
    if (extra.length) parts.push('unerwartete Regelpfade: ' + extra.join(', '));
    throw new Error(`${label}: Strukturvertrag verletzt — ` + parts.join(' | '));
  }
  return tree;
}

function flatten(node, prefix, out) {
  out = out || {};
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const k of Object.keys(node)) flatten(node[k], prefix ? prefix + '.' + k : k, out);
  } else {
    // Arrays (z. B. .indexOn) sind Blaetter — als JSON vergleichen, nicht per
    // Referenz, sonst meldet jeder Lauf eine Scheinabweichung.
    out[prefix] = Array.isArray(node) ? JSON.stringify(node) : node;
  }
  return out;
}

// Vergleicht die beiden Regelbaeume und meldet jede Abweichung ausserhalb der
// erlaubten Liste — inklusive hinzugefuegter oder verschwundener Knoten.
function diffOutsideAllowed(expandText, contractText) {
  const a = flatten(JSON.parse(expandText), '');
  const b = flatten(JSON.parse(contractText), '');
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const bad = [];
  for (const k of keys) {
    if (a[k] === b[k]) continue;
    if (ALLOWED_DIFFS.indexOf(k) >= 0) continue;
    bad.push(k);
  }
  return bad;
}

function derive(expandText) {
  // (0) Strukturvertrag der EINGABE — vor jeder Transformation.
  assertStructure(expandText, 'EXPAND');
  let out = expandText;
  const counts = {};

  for (const kind of Object.keys(GATE_VARS)) {
    for (const v of GATE_VARS[kind]) {
      const key = kind + v;
      const from = GATES[kind].expand(v), to = GATES[kind].contract(v);
      const n = out.split(from).length - 1;
      counts[key] = n;
      if (n) out = out.split(from).join(to);
    }
  }

  // (1) exakte Trefferzahlen
  const wrong = Object.keys(EXPECTED_COUNTS)
    .filter((k) => counts[k] !== EXPECTED_COUNTS[k])
    .map((k) => `${k}: erwartet ${EXPECTED_COUNTS[k]}, gefunden ${counts[k]}`);
  const unexpected = Object.keys(counts).filter((k) => !(k in EXPECTED_COUNTS) && counts[k] > 0)
    .map((k) => `${k}: unerwartete Gate-Art mit ${counts[k]} Treffern`);
  if (wrong.length || unexpected.length) {
    throw new Error('Ableitung abgebrochen — Trefferzahlen stimmen nicht:\n  ' + wrong.concat(unexpected).join('\n  '));
  }

  // (2) kein EXPAND-Gate darf uebrig bleiben
  const leftovers = [];
  for (const kind of Object.keys(GATE_VARS)) {
    for (const v of GATE_VARS[kind]) {
      if (out.indexOf(GATES[kind].expand(v)) >= 0) leftovers.push(kind + v);
    }
  }
  if (leftovers.length) throw new Error('Ableitung abgebrochen — EXPAND-Gate blieb stehen: ' + leftovers.join(', '));

  // (3) Roster-Pflichtfelder
  const rosterHits = out.split(ROSTER_FIELDS_EXPAND).length - 1;
  if (rosterHits !== 1) throw new Error(`Ableitung abgebrochen — Roster-Pflichtfelder erwartet 1x, gefunden ${rosterHits}x.`);
  out = out.replace(ROSTER_FIELDS_EXPAND, ROSTER_FIELDS_CONTRACT);

  // (4) Strukturvertrag des ERGEBNISSES und keine Abweichung ausserhalb der
  //     bekannten Regeln. Die Transformation darf keinen Knoten hinzufuegen
  //     oder entfernen — nur die sechs vorgesehenen Regeln aendern.
  assertStructure(out, 'CONTRACT');
  const bad = diffOutsideAllowed(expandText, out);
  if (bad.length) throw new Error('Ableitung abgebrochen — unerwartete Abweichung: ' + bad.join(', '));

  const applied = Object.keys(EXPECTED_COUNTS).map((k) => `${k}: ${counts[k]}x`);
  return { text: out, applied, counts };
}

// Reine Pruefung ohne Dateisystem — so kann die Testsuite jede Abweichung
// belegen, ohne eine getrackte Datei anzufassen.
function checkText(derivedText, contractText) {
  if (contractText == null) return { ok: false, reason: 'Contract-Datei fehlt.' };
  if (contractText !== derivedText) return { ok: false, reason: 'Contract-Rules sind nicht die Ableitung der EXPAND-Rules.' };
  return { ok: true };
}

function main() {
  const check = process.argv.includes('--check');
  const expandText = fs.readFileSync(EXPAND_FILE, 'utf8');
  let result;
  try {
    result = derive(expandText);
  } catch (e) {
    console.error('FEHLGESCHLAGEN: ' + ((e && e.message) || e));
    process.exit(1);
  }

  if (check) {
    const v = checkText(result.text, fs.existsSync(CONTRACT_FILE) ? fs.readFileSync(CONTRACT_FILE, 'utf8') : null);
    if (!v.ok) {
      console.error('FEHLGESCHLAGEN: ' + v.reason);
      console.error('  Beheben mit: node tools/derive_contract_rules.js');
      process.exit(1);
    }
    console.log('Contract-Rules aktuell (Ableitung stimmt) — Gates ersetzt: ' + result.applied.join(', '));
    return;
  }

  fs.writeFileSync(CONTRACT_FILE, result.text);
  console.log('firebase.rules.contract.json geschrieben — Gates ersetzt: ' + result.applied.join(', '));
}

module.exports = { derive, checkText, GATES, GATE_VARS, EXPECTED_COUNTS, EXPECTED_PATHS, ALLOWED_DIFFS,
  assertStructure, rulePaths, diffOutsideAllowed, EXPAND_FILE, CONTRACT_FILE };

if (require.main === module) main();
