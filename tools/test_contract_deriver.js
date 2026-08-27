// ─────────────────────────────────────────────────────────────────────────────
// RingOut — Negativtests der CONTRACT-Ableitung (Online-Protokoll v3.1).
//
//   node tools/test_contract_deriver.js
//
// Die Ableitung ist die einzige Bruecke zwischen dem deploybaren EXPAND-Stand
// und dem Zielstand. Sie MUSS fail-closed sein: eine still halb transformierte
// Rules-Datei waere gefaehrlicher als eine fehlende. Geprueft wird deshalb nicht
// nur der Gutfall, sondern jede Art, wie die Transformation danebengehen kann —
// fehlendes Gate, doppeltes Gate, ein aehnlich aussehender Ausdruck, der NICHT
// getroffen werden darf, und jede Abweichung ausserhalb der bekannten Regeln.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
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

// ── 1) Gutfall ───────────────────────────────────────────────────────────────
{
  const r = D.derive(EXPAND);
  t('Gutfall: Ableitung laeuft durch', !!r && typeof r.text === 'string');
  for (const k of Object.keys(D.EXPECTED_COUNTS)) {
    t('Gutfall: ' + k + ' exakt ' + D.EXPECTED_COUNTS[k] + 'x', r.counts[k] === D.EXPECTED_COUNTS[k],
      'gefunden ' + r.counts[k]);
  }
  t('Gutfall: Ergebnis ist gueltiges JSON', (() => { try { JSON.parse(r.text); return true; } catch (e) { return false; } })());
  t('Gutfall: getrackte Contract-Datei entspricht der Ableitung',
    fs.readFileSync(D.CONTRACT_FILE, 'utf8') === r.text);
  const contract = JSON.parse(r.text);
  t('Gutfall: Contract verlangt auth != null', r.text.split('auth != null').length - 1 === 5);
  t('Gutfall: uid ist Pflichtfeld im Roster',
    contract.rules.rooms.$code.players.$i['.validate'].indexOf("['id','name','tab','uid']") >= 0);
  t('Gutfall: EXPAND selbst verlangt KEIN auth != null', EXPAND.indexOf('auth != null') < 0);
}

// ── 2) Fehlende Gates ────────────────────────────────────────────────────────
{
  // bc-Gate entfernen -> play$seat faellt von 2 auf 1
  const one = EXPAND.replace(D.GATES.play.expand('$seat') + ' && ', '');
  mustThrow('fehlendes play/$seat-Gate bricht ab', one, 'play$seat: erwartet 2, gefunden 1');

  // beide $seat-Gates entfernen
  const none = EXPAND.split(D.GATES.play.expand('$seat') + ' && ').join('');
  mustThrow('beide play/$seat-Gates fehlen', none, 'play$seat: erwartet 2, gefunden 0');

  const noRoster = EXPAND.replace(D.GATES.roster.expand('$i'), 'true');
  mustThrow('fehlendes roster-Gate bricht ab', noRoster, 'roster$i: erwartet 1, gefunden 0');

  const noSeat = EXPAND.replace(D.GATES.seat.expand('$i'), 'true');
  mustThrow('fehlendes seat-Gate bricht ab', noSeat, 'seat$i: erwartet 1, gefunden 0');

  const noPl = EXPAND.replace(D.GATES.play.expand('$pl') + ' && ', '');
  mustThrow('fehlendes play/$pl-Gate bricht ab', noPl, 'play$pl: erwartet 1, gefunden 0');
}

// ── 3) Doppelte Gates ────────────────────────────────────────────────────────
{
  const dup = EXPAND.replace(D.GATES.play.expand('$seat') + ' && ',
    D.GATES.play.expand('$seat') + ' && ' + D.GATES.play.expand('$seat') + ' && ');
  mustThrow('doppeltes play/$seat-Gate bricht ab', dup, 'play$seat: erwartet 2, gefunden 3');

  const dupPl = EXPAND.replace(D.GATES.play.expand('$pl') + ' && ',
    D.GATES.play.expand('$pl') + ' && ' + D.GATES.play.expand('$pl') + ' && ');
  mustThrow('doppeltes play/$pl-Gate bricht ab', dupPl, 'play$pl: erwartet 1, gefunden 2');
}

// ── 4) Aehnlich aussehender Ausdruck darf NICHT stillschweigend mitwandern ───
{
  // Gleiche Form, anderer Platzhalter ($other): kein Gate dieser Ableitung.
  const foreign = "(!root.child('rooms').child($code).child('players').child($other).child('uid').exists()"
    + " || root.child('rooms').child($code).child('players').child($other).child('uid').val() === auth.uid)";
  const withForeign = EXPAND.replace('"seats": {', '"seatsProbe": { ".validate": "' + foreign.replace(/"/g, '\\"') + '" },\n        "seats": {');
  let text = null, threw = null;
  try { text = D.derive(withForeign).text; } catch (e) { threw = (e && e.message) || String(e); }
  // Die Ableitung darf den Fremdausdruck nicht anfassen; sie bricht wegen der
  // zusaetzlichen Regel im Baumvergleich ab — genau das ist fail-closed.
  t('fremder, aehnlicher Ausdruck wird nicht ersetzt',
    threw !== null ? threw.indexOf('unerwartete Abweichung') >= 0
      : text.indexOf(foreign) >= 0,
    threw || 'Fremdausdruck wurde veraendert');
}

// ── 5) Abweichung ausserhalb der erlaubten Regeln ────────────────────────────
{
  const r = D.derive(EXPAND);
  const tampered = r.text.replace('"newData.val() === 0 || newData.val() === 1', '"newData.val() === 0 || newData.val() === 9');
  t('Baumvergleich meldet eine fremde Aenderung',
    D.diffOutsideAllowed(EXPAND, tampered).length > 0);
  t('Baumvergleich meldet den Gutfall NICHT',
    D.diffOutsideAllowed(EXPAND, r.text).length === 0);
  const missingNode = JSON.parse(r.text);
  delete missingNode.rules.rooms.$code.seats;
  t('Baumvergleich meldet einen fehlenden Knoten',
    D.diffOutsideAllowed(EXPAND, JSON.stringify(missingNode)).length > 0);
}

// ── 6) --check meldet jede Abweichung ────────────────────────────────────────
{
  const { spawnSync } = require('child_process');
  const path = require('path');
  const ok = spawnSync(process.execPath, [path.join(__dirname, 'derive_contract_rules.js'), '--check'], { encoding: 'utf8' });
  t('--check ist im Gutfall gruen', ok.status === 0, 'exit ' + ok.status);

  const backup = fs.readFileSync(D.CONTRACT_FILE);
  try {
    fs.writeFileSync(D.CONTRACT_FILE, backup.toString('utf8').replace('auth != null', 'auth  != null'));
    const bad = spawnSync(process.execPath, [path.join(__dirname, 'derive_contract_rules.js'), '--check'], { encoding: 'utf8' });
    t('--check schlaegt bei manipulierter Contract-Datei fehl', bad.status !== 0, 'exit ' + bad.status);
  } finally {
    fs.writeFileSync(D.CONTRACT_FILE, backup);
  }
  const restored = spawnSync(process.execPath, [path.join(__dirname, 'derive_contract_rules.js'), '--check'], { encoding: 'utf8' });
  t('--check nach Wiederherstellung wieder gruen', restored.status === 0, 'exit ' + restored.status);
}

console.log(`\nContract-Deriver: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
