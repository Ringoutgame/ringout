// Paket A verification: tests the REAL identity helpers extracted from index.html
// (sanitizeName / findOwnSeat / genToken / nameForSeat / playerRecord). These are
// the pure, security-relevant building blocks of the v3 player-identity roster.
//   node test_identity.js
const { loadIndexHtml, grab } = require('./extract');
const html = loadIndexHtml();

const src = [
  grab(html, /const NAME_MAX=[^\n]*/, 'NAME_MAX'),
  grab(html, /const NAME_MAX_UNITS=[^\n]*/, 'NAME_MAX_UNITS'),
  grab(html, /const FFA_MAX_SEATS=[^\n]*/, 'FFA_MAX_SEATS'),
  grab(html, /function genToken\(n\)\{[\s\S]*?\n\}/, 'genToken'),
  grab(html, /function capGraphemes\(s,max\)\{[\s\S]*?\n\}/, 'capGraphemes'),
  grab(html, /function sanitizeName\(raw\)\{[\s\S]*?\n\}/, 'sanitizeName'),
  grab(html, /function findOwnSeat\(players,pid\)\{[\s\S]*?\n\}/, 'findOwnSeat'),
  grab(html, /function nameForSeat\(s\)\{[\s\S]*?\n\}/, 'nameForSeat'),
  grab(html, /function playerRecord\(seat\)\{[^\n]*/, 'playerRecord'),
  // Stubs for the globals the two roster helpers read.
  "const T=k=>k;",
  "let playersRoster={}, onlinePid='PID000001', onlineName='', onlineTab='TAB000001';",
  "return { genToken, sanitizeName, findOwnSeat, nameForSeat, playerRecord,"
    + " setRoster:r=>{playersRoster=r;}, setName:n=>{onlineName=n;} };",
].join('\n');
const env = new Function(src)();

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.error('FAIL: ' + name)); };

// ── sanitizeName: trim, collapse, strip control chars, cap at 16 visible chars ──
t('name kept as-is', env.sanitizeName('Ali') === 'Ali');
t('name trimmed', env.sanitizeName('  Ali  ') === 'Ali');
t('inner whitespace collapsed', env.sanitizeName('a\t  b   c') === 'a b c');
t('control chars become space then collapse', env.sanitizeName('ab') === 'a b');
t('newline/tab treated as whitespace', env.sanitizeName('a\nb') === 'a b');
t('empty -> empty', env.sanitizeName('') === '');
t('whitespace only -> empty', env.sanitizeName('   ') === '');
t('non-string -> empty', env.sanitizeName(42) === '' && env.sanitizeName(null) === '' && env.sanitizeName(undefined) === '');
t('object -> empty', env.sanitizeName({}) === '');
t('capped at 16 code units', env.sanitizeName('x234567890123456789').length === 16);
t('exactly 16 kept', env.sanitizeName('1234567890123456').length === 16);
{ const emoji = '😀'.repeat(20); t('emoji not split (<=16 code points)', [...env.sanitizeName(emoji)].length <= 16); }
{ const a = env.sanitizeName('  Weird\tName  '); t('idempotent', env.sanitizeName(a) === a); }

// ── sanitizeName hardening (Korrekturrunde): C1 controls, bidi controls,
//    invisible format chars, grapheme cap via Intl.Segmenter, unit cap 48 ──
const cc = String.fromCharCode, cp = String.fromCodePoint;
t('C1 control (NEL) stripped', env.sanitizeName('a' + cc(0x85) + 'b') === 'a b');
t('C1 control (0x9f) stripped', env.sanitizeName('a' + cc(0x9f) + 'b') === 'a b');
t('bidi override (RLO) stripped', env.sanitizeName('a' + cc(0x202e) + 'b') === 'a b');
t('bidi isolates (LRI/PDI) stripped', env.sanitizeName(cc(0x2066) + 'abc' + cc(0x2069)) === 'abc');
t('bidi marks (LRM/RLM/ALM) stripped', env.sanitizeName(cc(0x200e) + 'a' + cc(0x200f) + cc(0x61c) + 'b') === 'a b');
t('zero-width space stripped', env.sanitizeName('a' + cc(0x200b) + 'b') === 'a b');
t('zero-width joiner stripped (no invisible smuggling)', env.sanitizeName('a' + cc(0x200d) + 'b') === 'a b');
t('word joiner stripped', env.sanitizeName('a' + cc(0x2060) + 'b') === 'a b');
t('soft hyphen stripped', env.sanitizeName('a' + cc(0xad) + 'b') === 'a b');
t('BOM stripped', env.sanitizeName(cc(0xfeff) + 'Ali') === 'Ali');
t('pure invisible/bidi input -> empty (color fallback upstream)', env.sanitizeName(cc(0x202e) + cc(0x200b) + cc(0x2066) + cc(0xfeff)) === '');
{ const s = cp(0x1F44D, 0x1F3FD).repeat(3) + 'x';   // skin-tone clusters stay intact
  t('grapheme clusters kept intact under the cap', env.sanitizeName(s) === s); }
{ const out = env.sanitizeName(cp(0x1F600).repeat(20));
  t('emoji capped at 16 visible graphemes', [...out].length === 16); }
{ const out = env.sanitizeName(cp(0x1F44D, 0x1F3FD).repeat(20));
  t('unit cap enforced (<=48 UTF-16 units, rules bound)', out.length <= 48 && out.length > 0);
  t('unit-capped result idempotent', env.sanitizeName(out) === out); }

// ── findOwnSeat: lowest seat whose id equals pid; -1 otherwise ──
const P = { 0: { id: 'A' }, 1: { id: 'B' }, 2: { id: 'C' } };
t('finds matching seat', env.findOwnSeat(P, 'B') === 1);
t('no match -> -1', env.findOwnSeat(P, 'Z') === -1);
t('null players -> -1', env.findOwnSeat(null, 'A') === -1);
t('empty pid -> -1', env.findOwnSeat(P, '') === -1);
t('lowest seat wins on duplicate id', env.findOwnSeat({ 0: { id: 'A' }, 1: { id: 'A' } }, 'A') === 0);
t('firebase array form works', env.findOwnSeat([{ id: 'A' }, { id: 'B' }], 'B') === 1);
t('record without id ignored', env.findOwnSeat({ 0: {}, 1: { id: 'B' } }, 'B') === 1);

// ── genToken: url-safe token in the rules charset ──
t('default length 16, valid charset', /^[A-Za-z0-9_-]{16}$/.test(env.genToken()));
t('custom length honored', env.genToken(20).length === 20 && /^[A-Za-z0-9_-]{20}$/.test(env.genToken(20)));
t('two tokens differ', env.genToken(16) !== env.genToken(16));
t('token passes the id rules pattern', /^[A-Za-z0-9_-]{8,24}$/.test(env.genToken(16)));

// ── nameForSeat / playerRecord: roster name, color fallback, always non-empty ──
env.setRoster({ 1: { name: 'Bob' }, 2: { name: '  Weird  ' } });
t('roster name used', env.nameForSeat(1) === 'Bob');
t('roster name sanitized on read', env.nameForSeat(2) === 'Weird');
t('missing record -> color fallback', env.nameForSeat(3) === 'col3');
t('empty roster name -> color fallback', (() => { env.setRoster({ 4: { name: '   ' } }); return env.nameForSeat(4) === 'col4'; })());
{ const r = env.playerRecord(0); t('record has id/name/tab, name non-empty', r.id === 'PID000001' && r.name === 'col0' && r.tab === 'TAB000001'); }
{ env.setName('Zoe'); const r = env.playerRecord(2); t('record uses chosen name when set', r.name === 'Zoe'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
