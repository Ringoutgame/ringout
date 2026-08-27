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
//            Client ohne Anmeldung ausgesperrt.
//
// Beide Staende entstehen aus EINER Quelle: der Unterschied ist ausschliesslich
// der Ownership-Ausdruck, den diese Ableitung ersetzt. Damit kann die Contract-
// Fassung nicht von der Expand-Fassung abdriften; tools/test_rules.js prueft im
// --check-Sinn mit, dass die getrackte Datei zur Ableitung passt.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXPAND_FILE = path.join(ROOT, 'firebase.rules.json');
const CONTRACT_FILE = path.join(ROOT, 'firebase.rules.contract.json');

const R = "root.child('rooms').child($code)";
// Jede Gate-Art hat ihre eigenen Platzhalter: 'roster'/'seat' stehen unter
// rooms/$code/{players,p}/$i, 'play' unter dem Move-Slot ($pl) bzw. bc/br ($seat).
const GATE_VARS = { roster: ['$i'], seat: ['$i'], play: ['$pl', '$seat'] };

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

function derive(expandText) {
  let out = expandText;
  const applied = [];
  for (const kind of ['seat', 'roster', 'play']) {
    for (const v of GATE_VARS[kind]) {
      const from = GATES[kind].expand(v), to = GATES[kind].contract(v);
      const n = out.split(from).length - 1;
      if (n === 0) continue;
      out = out.split(from).join(to);
      applied.push(`${kind}${v}: ${n}x`);
    }
  }
  if (applied.length === 0) throw new Error('Kein EXPAND-Ownership-Gate gefunden — Ableitung waere wirkungslos.');

  const rosterHits = out.split(ROSTER_FIELDS_EXPAND).length - 1;
  if (rosterHits !== 1) throw new Error(`Roster-Pflichtfelder erwartet 1x, gefunden ${rosterHits}x.`);
  out = out.replace(ROSTER_FIELDS_EXPAND, ROSTER_FIELDS_CONTRACT);

  JSON.parse(out);   // Ableitung muss gueltiges JSON bleiben
  return { text: out, applied };
}

function main() {
  const check = process.argv.includes('--check');
  const expandText = fs.readFileSync(EXPAND_FILE, 'utf8');
  const { text, applied } = derive(expandText);

  if (check) {
    if (!fs.existsSync(CONTRACT_FILE)) {
      console.error('FEHLGESCHLAGEN: firebase.rules.contract.json fehlt.');
      process.exit(1);
    }
    const current = fs.readFileSync(CONTRACT_FILE, 'utf8');
    if (current !== text) {
      console.error('FEHLGESCHLAGEN: firebase.rules.contract.json ist nicht die Ableitung von firebase.rules.json.');
      console.error('  Beheben mit: node tools/derive_contract_rules.js');
      process.exit(1);
    }
    console.log('Contract-Rules aktuell (Ableitung stimmt) — Gates ersetzt: ' + applied.join(', '));
    return;
  }

  fs.writeFileSync(CONTRACT_FILE, text);
  console.log('firebase.rules.contract.json geschrieben — Gates ersetzt: ' + applied.join(', '));
}

module.exports = { derive, GATES, GATE_VARS, EXPAND_FILE, CONTRACT_FILE };

if (require.main === module) main();
