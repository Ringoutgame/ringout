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

module.exports = { loadIndexHtml, grab };
