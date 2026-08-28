// Shared, line-ending-robust extraction helper for the offline test suites.
//
// index.html is stored with LF in the repo but checked out with CRLF on
// Windows working copies (git autocrlf). Some extracted lines end in a `//`
// line comment (e.g. `const GEN_MAX=10000; // ...`). When such a snippet is
// concatenated with following code, only a real line terminator ends that
// comment. On Windows the stray CRLF `\r` happened to do that; on Linux/LF CI
// there is none, so the comment silently swallowed the next statement and the
// suite failed to parse. To make extraction behave identically everywhere:
//   1. loadIndexHtml() normalizes all line endings to `\n`.
//   2. Callers must join extracted snippets with newlines, never `;`.
const fs = require('fs');
const path = require('path');

// Read index.html with line endings normalized to `\n`.
function loadIndexHtml() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  return src.replace(/\r\n?/g, '\n');
}

// Extract the first match of `re` from `src`, or fail the suite if absent.
function grab(src, re, name) {
  const m = src.match(re);
  if (!m) { console.error('FAIL: cannot extract ' + name); process.exit(1); }
  return m[0];
}

// Extract a top-level function declaration by NAME, delimited by its own braces
// instead of by a line pattern.
//
// Line-based regexes (`function f\(\)\{[^\n]*`) silently truncate as soon as a
// function grows past one line, and `[\s\S]*?\n\}` silently over-matches when a
// function ends with `…;}` on its last line instead of a lone `}`. Both failure
// modes produce SYNTACTICALLY BROKEN sandbox source rather than a clear error —
// that is exactly how the online suites went red. Brace counting has neither
// failure mode: it either returns the complete declaration or fails loudly.
//
// String literals, template literals and comments are skipped so that a brace
// inside them never moves the counter. Regex literals are NOT parsed (telling a
// regex from a division needs a full tokenizer); a function whose body contains a
// regex literal with an unbalanced brace must keep using an explicit `grab`.
function grabFunction(src, name) {
  const head = new RegExp('(^|\\n)(async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = src.match(head);
  if (!m) { console.error('FAIL: cannot extract function ' + name); process.exit(1); }
  const start = m.index + (m[1] ? m[1].length : 0);
  const open = src.indexOf('{', m.index + m[0].length);
  if (open < 0) { console.error('FAIL: no body for function ' + name); process.exit(1); }
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === q) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  console.error('FAIL: unbalanced braces in function ' + name);
  process.exit(1);
}

module.exports = { loadIndexHtml, grab, grabFunction };
