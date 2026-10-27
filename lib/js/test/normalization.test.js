import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { UnicodeTable } from '../src/unicode.js';
import { readGrammarFile } from './shared.js';

// Unicode 15.1 conformance: https://www.unicode.org/Public/15.1.0/ucd/NormalizationTest.txt
// The shared source includes every data line and the Unicode license notice.
test('every Unicode 15.1 normalization case conforms to NFD', () => {
  const unicode = new UnicodeTable(readGrammarFile('data/unicode/unicode.txt'));
  const listed = new Set();
  let part = '', count = 0;
  for (const line of fs.readFileSync(new URL('../../../tests/unicode/NormalizationTest.txt', import.meta.url), 'utf8').split('\n')) {
    const data = line.split('#')[0].trim();
    if (data.startsWith('@')) { part = data.split(' ')[0]; continue; }
    if (!data) continue;
    const columns = data.split(';').slice(0, 5).map(column => column.trim().split(/\s+/).map(hex => String.fromCodePoint(parseInt(hex, 16))).join(''));
    for (let index = 0; index < 5; index++) assert.equal(unicode.decompose(columns[index]), columns[index < 3 ? 2 : 4], `line ${count + 1}, column ${index + 1}`);
    if (part === '@Part1') listed.add(columns[0].codePointAt(0));
    count++;
  }
  assert.equal(count, 19074);
  for (let code = 0; code <= 0x10ffff; code++) {
    if (code >= 0xd800 && code <= 0xdfff || listed.has(code)) continue;
    const scalar = String.fromCodePoint(code);
    assert.equal(unicode.decompose(scalar), scalar, `unlisted U+${code.toString(16)}`);
  }
});
