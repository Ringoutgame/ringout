// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Negativtests der CONTRACT-Ableitung (Online-Protokoll v3.1).
//
//   node tools/test_contract_deriver.js
//
// Die Ableitung ist die einzige Bruecke zwischen dem produktiv deployten
// EXPAND-Stand und dem Zielstand. Sie MUSS fail-closed sein: eine still halb
// transformierte Rules-Datei waere gefaehrlicher als eine fehlende.
//
// Geprueft wird deshalb in drei Schichten:
//   1. Strukturvertrag  — der EXPAND-Baum muss EXAKT den erwarteten Regelpfaden
//                         entsprechen. Ein zusaetzlicher oder entfernter Knoten
//                         waere im reinen Vorher/Nachher-Vergleich unsichtbar,
//                         weil er auf beiden Seiten gleich waere.
//   2. Trefferzahlen    — jedes Ownership-Gate exakt so oft wie erwartet.
//   3. Ergebnisvergleich— ausser den sechs bekannten Regeln aendert sich nichts.
//
// Diese Suite ist gegenueber getrackten Dateien READ-ONLY. Faelle, die eine
// abweichende Rules-Datei brauchen, arbeiten auf Kopien in einem Temp-
// Verzeichnis oder rein im Speicher.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const D = require('./derive_contract_rules');

let passed = 0, failed = 0;
const t = (name, ok, detail) => {
  if (ok) { passed++; return; }
  failed++;
  console.log('FAIL: ' + name + (detail ? ' -> ' + detail : ''));
};
// Erwartet einen harten Abbruch — und zwar aus dem RICHTIGEN Grund.
const mustThrow = (name, text, expectPart) => {
  try {
    D.derive(text);
    t(name, false, 'kein Abbruch — die Ableitung haette scheitern muessen');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    t(name, msg.indexOf(expectPart) >= 0, 'falscher Grund: ' + msg.split('\n')[0]);
  }
};

const EXPAND = fs.readFileSync(D.EXPAND_FILE, 'utf8');
const CONTRACT = fs.readFileSync(D.CONTRACT_FILE, 'utf8');
// Baumoperationen fuer die Strukturfaelle — immer ueber eine Kopie.
const tree = () => JSON.parse(EXPAND);
const asText = (o) => JSON.stringify(o, null, 2);

// ── 1) Gutfall ───────────────────────────────────────────────────────────────
{
  const r = D.derive(EXPAND);
  t('Gutfall: Ableitung laeuft durch', !!r && typeof r.text === 'string');
  for (const k of Object.keys(D.EXPECTED_COUNTS)) {
    t('Gutfall: ' + k + ' exakt ' + D.EXPECTED_COUNTS[k] + 'x', r.counts[k] === D.EXPECTED_COUNTS[k],
      'gefunden ' + r.counts[k]);
  }
  t('Gutfall: getrackte Contract-Datei entspricht der Ableitung', CONTRACT === r.text);
  const contract = JSON.parse(r.text);
  t('Gutfall: Contract verlangt auth != null', r.text.split('auth != null').length - 1 === 5);
  t('Gutfall: uid ist Pflichtfeld im Roster',
    contract.rules.rooms.$code.players.$i['.validate'].indexOf("['id','name','tab','uid']") >= 0);
  t('Gutfall: EXPAND selbst verlangt KEIN auth != null', EXPAND.indexOf('auth != null') < 0);
  t('Gutfall: checkText akzeptiert die getrackte Datei', D.checkText(r.text, CONTRACT).ok === true);
}

// ── 2) Strukturvertrag ───────────────────────────────────────────────────────
{
  t('Struktur: das Manifest deckt den echten Baum ab',
    D.rulePaths(tree(), '').length === D.EXPECTED_PATHS.length,
    D.rulePaths(tree(), '').length + ' vs ' + D.EXPECTED_PATHS.length);

  const extra = tree();
  extra.rules.rooms.$code.zzzProbe = { '.validate': 'true' };
  mustThrow('Struktur: zusaetzlicher fremder Regelknoten', asText(extra), 'unerwartete Regelpfade');

  const noState = tree();
  delete noState.rules.rooms.$code.state;
  mustThrow('Struktur: rooms/$code/state fehlt', asText(noState), 'fehlende Regelpfade');

  const noLeaf = tree();
  delete noLeaf.rules.rooms.$code.g.$gen.t.$turn.$pl.ts;
  mustThrow('Struktur: einzelnes erwartetes Leaf fehlt', asText(noLeaf), 'fehlende Regelpfade');

  const noUid = tree();
  delete noUid.rules.rooms.$code.players.$i.uid;
  mustThrow('Struktur: players/$i/uid fehlt', asText(noUid), 'fehlende Regelpfade');

  const noBc = tree();
  delete noBc.rules.rooms.$code.g.$gen.t.$turn.bc;
  mustThrow('Struktur: kompletter bc-Teilbaum fehlt', asText(noBc), 'fehlende Regelpfade');

  mustThrow('Struktur: kaputtes JSON', '{ "rules": ', 'kein gueltiges JSON');
}

// ── 3) Fehlende Gates ────────────────────────────────────────────────────────
{
  const one = EXPAND.replace(D.GATES.play.expand('$seat') + ' && ', '');
  mustThrow('fehlendes play/$seat-Gate bricht ab', one, 'play$seat: erwartet 2, gefunden 1');

  const none = EXPAND.split(D.GATES.play.expand('$seat') + ' && ').join('');
  mustThrow('beide play/$seat-Gates fehlen', none, 'play$seat: erwartet 2, gefunden 0');

  const noRoster = EXPAND.replace(D.GATES.roster.expand('$i'), 'true');
  mustThrow('fehlendes roster-Gate bricht ab', noRoster, 'roster$i: erwartet 1, gefunden 0');

  const noSeat = EXPAND.replace(D.GATES.seat.expand('$i'), 'true');
  mustThrow('fehlendes seat-Gate bricht ab', noSeat, 'seat$i: erwartet 1, gefunden 0');

  const noPl = EXPAND.replace(D.GATES.play.expand('$pl') + ' && ', '');
  mustThrow('fehlendes play/$pl-Gate bricht ab', noPl, 'play$pl: erwartet 1, gefunden 0');
}

// ── 4) Doppelte Gates ────────────────────────────────────────────────────────
{
  const dup = EXPAND.replace(D.GATES.play.expand('$seat') + ' && ',
    D.GATES.play.expand('$seat') + ' && ' + D.GATES.play.expand('$seat') + ' && ');
  mustThrow('doppeltes play/$seat-Gate bricht ab', dup, 'play$seat: erwartet 2, gefunden 3');

  const dupPl = EXPAND.replace(D.GATES.play.expand('$pl') + ' && ',
    D.GATES.play.expand('$pl') + ' && ' + D.GATES.play.expand('$pl') + ' && ');
  mustThrow('doppeltes play/$pl-Gate bricht ab', dupPl, 'play$pl: erwartet 1, gefunden 2');
}

// ── 5) Aehnlich aussehender Ausdruck darf NICHT mitwandern ───────────────────
{
  // Gleiche Form, anderer Platzhalter: kein Gate dieser Ableitung. Er sitzt in
  // einem zusaetzlichen Knoten — der Strukturvertrag faengt das ab, BEVOR
  // irgendetwas ersetzt wird. Genau das ist fail-closed.
  const foreign = "(!root.child('rooms').child($code).child('players').child($other).child('uid').exists()"
    + " || root.child('rooms').child($code).child('players').child($other).child('uid').val() === auth.uid)";
  const probe = tree();
  probe.rules.rooms.$code.seatsProbe = { '.validate': foreign };
  mustThrow('fremder, aehnlicher Ausdruck bricht am Strukturvertrag ab', asText(probe), 'unerwartete Regelpfade');
}

// ── 6) Abweichung ausserhalb der erlaubten Regeln ────────────────────────────
{
  const r = D.derive(EXPAND);
  const tampered = r.text.replace('"newData.val() === 0 || newData.val() === 1', '"newData.val() === 0 || newData.val() === 9');
  t('Baumvergleich meldet eine fremde Aenderung', D.diffOutsideAllowed(EXPAND, tampered).length > 0);
  t('Baumvergleich meldet den Gutfall NICHT', D.diffOutsideAllowed(EXPAND, r.text).length === 0);
}

// ── 7) checkText / --check sind fail-closed ──────────────────────────────────
{
  const r = D.derive(EXPAND);
  t('checkText: fehlende Contract-Datei', D.checkText(r.text, null).ok === false);
  t('checkText: manipulierte Contract-Datei',
    D.checkText(r.text, CONTRACT.replace('auth != null', 'auth  != null')).ok === false);
  t('checkText: leere Contract-Datei', D.checkText(r.text, '').ok === false);

  // CLI-Ebene: der Gutfall gegen die getrackten Dateien (rein lesend) …
  const cli = (env) => spawnSync(process.execPath, [path.join(__dirname, 'derive_contract_rules.js'), '--check'],
    { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
  t('--check ist im Gutfall gruen', cli().status === 0);

  // … und der Fehlerfall ausschliesslich auf KOPIEN in einem Temp-Verzeichnis.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ringout-deriver-'));
  try {
    const exp = path.join(dir, 'expand.json'), con = path.join(dir, 'contract.json');
    fs.writeFileSync(exp, EXPAND);
    fs.writeFileSync(con, CONTRACT.replace('auth != null', 'auth  != null'));
    const bad = cli({ RINGOUT_EXPAND_RULES: exp, RINGOUT_CONTRACT_RULES: con });
    t('--check schlaegt bei manipulierter Contract-Kopie fehl', bad.status !== 0, 'exit ' + bad.status);

    fs.writeFileSync(con, CONTRACT);
    const good = cli({ RINGOUT_EXPAND_RULES: exp, RINGOUT_CONTRACT_RULES: con });
    t('--check ist mit korrekter Kopie gruen', good.status === 0, 'exit ' + good.status);

    fs.unlinkSync(con);
    const gone = cli({ RINGOUT_EXPAND_RULES: exp, RINGOUT_CONTRACT_RULES: con });
    t('--check schlaegt bei fehlender Contract-Datei fehl', gone.status !== 0, 'exit ' + gone.status);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Temp-Rest ist harmlos */ }
  }
}

// ── 8) Die Suite selbst hat nichts angefasst ─────────────────────────────────
{
  t('Suite ist read-only: EXPAND-Datei unveraendert', fs.readFileSync(D.EXPAND_FILE, 'utf8') === EXPAND);
  t('Suite ist read-only: CONTRACT-Datei unveraendert', fs.readFileSync(D.CONTRACT_FILE, 'utf8') === CONTRACT);
}

console.log(`\nContract-Deriver: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
