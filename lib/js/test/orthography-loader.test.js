import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Loader, fnv1a64 } from '../src/dialect.js';
import { DOM_FORMAT } from '../src/dom.js';
import { stringName } from '../src/tags.js';
import { readGrammarFile } from './shared.js';

const document = source => '```jbogenbau\n' + source + '\n```';
const bundled = readGrammarFile('unicode.txt');
const sparse = bundled.split('\n').filter(line => !line.startsWith('decompose ') && !line.startsWith('combining ')).join('\n');
const loader = (table = bundled, compiled) => new Loader(path => path === 'unicode.txt' ? table : path === 'compiled.json' ? compiled : path === 'case.md' ? document('%rule r "é"') : readGrammarFile(path));

test('cache identity includes the exact Unicode table text', () => {
  const first = loader();
  const dom = first.documentDom('case.md');
  const compiled = JSON.stringify({format: DOM_FORMAT, bootstrap: first.bootstrapHash, unicode: first.unicodeHash, documents: {'case.md': {hash: fnv1a64(document('%rule r "é"')), dom}}});
  assert.equal(loader(bundled, compiled).compiled.size, 1);
  const second = loader(sparse, compiled);
  assert.equal(second.compiled.size, 0);
  assert.equal(dom.rules[0].alternatives[0].expr.literal.string, 'é');
  assert.equal(second.documentDom('case.md').rules[0].alternatives[0].expr.literal.string, 'é');
  assert.deepEqual(second.documentDom('case.md'), loader(sparse).documentDom('case.md'));
  assert.equal(loader(sparse, readGrammarFile('compiled.json')).compiled.size, 0);
});

test('negated operators require their decomposition records, with or without a cache', () => {
  const source = document('%rule r $a:A %conditions $a.value ≠ "a"');
  for (const compiled of [undefined, readGrammarFile('compiled.json')]) {
    const custom = loader(sparse, compiled);
    assert.throws(() => custom.readDocument(source, 'op.md'), error => error.kind === 'grammar' && error.where.column === 35);
  }
});

test('include paths keep the original filename spelling', () => {
  const custom = new Loader(path => path === 'p.md' ? document('%stage main\n%include "café.md"') : path === 'café.md' ? document('%ambiguity-resolution greedy\n%rule text "a"') : readGrammarFile(path));
  assert.ok(custom.dialect('p.md').parse('a').ok);
});

test('canonical diagnostic strings read back with exact scalar identity', () => {
  const custom = loader();
  for (const value of ['é', 'à', 'ź', '한', '\u302e\u1b44']) {
    const spelled = stringName(value, custom.unicode);
    const dom = custom.readDocument(document('%ambiguity-resolution greedy\n%rule text ' + spelled), 'diagnostic.md');
    // Resolve through the grammar compiler as well as the reader.
    const d = new Loader(path => path === 'p.md' ? document('%stage main\n%include "g.md"') : path === 'g.md' ? document('%ambiguity-resolution greedy\n%rule text ' + spelled) : readGrammarFile(path)).dialect('p.md');
    assert.ok(dom.rules.length);
    assert.ok(d.parse('', {tokens: [{tags: new Set(), span:[0,1], source:[0,0], text:'', value, image:value, before:[], after:[]}]}).ok, spelled);
  }
  const range = custom.readDocument(document('%rule r $_00E0..$_017A'), 'range.md');
  assert.ok(range.rules.length);
});
