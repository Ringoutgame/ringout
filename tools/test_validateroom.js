// M1-T2 verification: tests the REAL validateRoom extracted from index.html.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const constM = html.match(/const GEN_MAX=[^\n]*/);
const verM = html.match(/const ONLINE_PROTOCOL_VERSION=[^\n]*/);
const fnM = html.match(/function validateRoom\(d\)\{[\s\S]*?\n\}/);
if (!constM || !verM || !fnM) { console.error('FAIL: validateRoom/GEN_MAX/ONLINE_PROTOCOL_VERSION not found'); process.exit(1); }
const validateRoom = new Function(verM[0] + ';' + constM[0] + ';' + fnM[0] + ';return validateRoom;')();
const VER = new Function(verM[0] + ';return ONLINE_PROTOCOL_VERSION;')();   // fixtures follow the real protocol version

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };
const room = (over = {}) => Object.assign(
  { v: VER, config: { winTarget: 3, fmt: 'single' }, gen: 0, p: { 0: true }, created: 1751800000000 }, over);

// ── protocol version (M1-T3) ──
const VMSG = 'Versionen stimmen nicht überein — bitte beide Seite neu laden.';
t('v matching -> ok', validateRoom(room()).ok === true);
t('v missing -> reject with message', validateRoom(room({ v: undefined })).reason === VMSG);
t('v wrong (0) -> reject', validateRoom(room({ v: 0 })).reason === VMSG);
t('v outdated (VER-1) -> reject', validateRoom(room({ v: VER - 1 })).reason === VMSG);
t('v future (VER+1) -> reject', validateRoom(room({ v: VER + 1 })).reason === VMSG);
t('v string -> reject (strict)', validateRoom(room({ v: String(VER) })).reason === VMSG);
t('v null -> reject', validateRoom(room({ v: null })).reason === VMSG);

// ── valid rooms ──
t('valid 3/single', validateRoom(room()).ok === true);
t('valid 5/double', validateRoom(room({ config: { winTarget: 5, fmt: 'double' } })).ok === true);
t('valid gen 7 (rematches)', validateRoom(room({ gen: 7 })).ok === true);
t('valid gen at GEN_MAX', validateRoom(room({ gen: 10000 })).ok === true);
t('valid p as Firebase array [true]', validateRoom(room({ p: [true] })).ok === true);
t('valid: unknown extra fields ignored', validateRoom(room({ zzz: 'junk' })).ok === true);
t('valid: guest slot cleared (p[1] falsy)', validateRoom(room({ p: { 0: true, 1: false } })).ok === true);
{ const v = validateRoom(room({ config: { winTarget: 5, fmt: 'double' }, gen: 3 }));
  t('returns exact validated values', v.winTarget === 5 && v.fmt === 'double' && v.gen === 3); }

// ── invalid: root / config — NO silent defaults ──
t('null room', validateRoom(null).ok === false);
t('string room', validateRoom('x').ok === false);
t('config missing', validateRoom(room({ config: undefined })).ok === false);
t('config wrong type', validateRoom(room({ config: 'single' })).ok === false);
t('winTarget 9999', validateRoom(room({ config: { winTarget: 9999, fmt: 'single' } })).ok === false);
t('winTarget "3" (string)', validateRoom(room({ config: { winTarget: '3', fmt: 'single' } })).ok === false);
t('winTarget 4', validateRoom(room({ config: { winTarget: 4, fmt: 'single' } })).ok === false);
t('winTarget missing', validateRoom(room({ config: { fmt: 'single' } })).ok === false);
t('fmt "triple"', validateRoom(room({ config: { winTarget: 3, fmt: 'triple' } })).ok === false);
t('fmt null', validateRoom(room({ config: { winTarget: 3, fmt: null } })).ok === false);

// ── invalid: gen ──
t('gen -1', validateRoom(room({ gen: -1 })).ok === false);
t('gen 1.5', validateRoom(room({ gen: 1.5 })).ok === false);
t('gen "5" (string)', validateRoom(room({ gen: '5' })).ok === false);
t('gen 2^53 (unsafe)', validateRoom(room({ gen: 2 ** 53 })).ok === false);
t('gen 10001 (> GEN_MAX)', validateRoom(room({ gen: 10001 })).ok === false);
t('gen missing', validateRoom(room({ gen: undefined })).ok === false);
t('gen NaN', validateRoom(room({ gen: NaN })).ok === false);

// ── invalid: p (presence) ──
t('p missing -> verwaist', validateRoom(room({ p: undefined })).reason === 'Raum ist verwaist.');
t('p wrong type', validateRoom(room({ p: 'x' })).ok === false);
t('host missing {1:true} -> verwaist', validateRoom(room({ p: { 1: true } })).reason === 'Raum ist verwaist.');
t('host false -> verwaist', validateRoom(room({ p: { 0: false } })).reason === 'Raum ist verwaist.');
t('host non-bool truthy rejected', validateRoom(room({ p: { 0: 1 } })).ok === false);
t('full room exact message', validateRoom(room({ p: { 0: true, 1: true } })).reason === 'Raum ist schon voll.');
t('full room as array [true,true]', validateRoom(room({ p: [true, true] })).reason === 'Raum ist schon voll.');

// ── purity ──
{ const input = room(); Object.freeze(input); Object.freeze(input.config); Object.freeze(input.p);
  const a = validateRoom(input), b = validateRoom(input);
  t('pure: frozen input, no throw, stable result', JSON.stringify(a) === JSON.stringify(b) && a.ok === true); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
