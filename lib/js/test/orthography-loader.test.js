import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Loader, fnv1a64 } from '../src/pipeline.js';
import { DOM_FORMAT } from '../src/dom.js';
import { stringName } from '../src/tags.js';
import { readGrammarFile } from './shared.js';

const document = source => '```jbogenbau\n' + source + '\n```';
const bundled = readGrammarFile('data/unicode/unicode.txt');
const sparse = bundled.split('\n').filter(line => !line.startsWith('decompose ') && !line.startsWith('combining ')).join('\n');
const loader = (table = bundled, preparsed) => new Loader(path => path === 'data/unicode/unicode.txt' ? table : path === 'data/preparsed/test.json' ? preparsed : path === 'grammars/test/case.md' ? document('%rule r "é"') : readGrammarFile(path));

test('each parse runs stage zero once', () => {
  const custom = loader();
  const pipeline = custom.pipeline('grammars/lojban/experimental/pipeline.md');
  const decompose = custom.unicode.decomposeWithOrigins;
  const texts = [];
  custom.unicode.decomposeWithOrigins = function (text) {
    texts.push(text);
    return decompose.call(this, text);
  };
  try {
    for (const options of [{}, {until: 'words'}]) {
      texts.length = 0;
      const result = pipeline.parse('mi klama', options);
      assert.ok(result.ok);
      assert.deepEqual(texts, ['mi klama']);
      const wordsAt = result.stages.findIndex(stage => stage.name === 'words');
      if (wordsAt + 1 < result.stages.length) {
        assert.equal(result.stages[wordsAt + 1].input, result.stages[wordsAt].output);
      }
    }
  } finally {
    custom.unicode.decomposeWithOrigins = decompose;
  }
});

test('cache identity includes the exact Unicode table text', () => {
  const first = loader();
  const dom = first.documentDom('grammars/test/case.md');
  const preparsed = JSON.stringify({format: DOM_FORMAT, bootstrap: first.bootstrapHash, unicode: first.unicodeHash, properties: first.propertiesHash, documents: {'grammars/test/case.md': {hash: fnv1a64(document('%rule r "é"')), dom}}});
  const cached = loader(bundled, preparsed);
  cached.documentDom('grammars/test/case.md');
  assert.equal(cached.preparsed.size, 1);
  const second = loader(sparse, preparsed);
  assert.equal(dom.rules[0].alternatives[0].expr.literal.string, 'é');
  assert.equal(second.documentDom('grammars/test/case.md').rules[0].alternatives[0].expr.literal.string, 'é');
  assert.equal(second.preparsed.size, 0);
  assert.deepEqual(second.documentDom('grammars/test/case.md'), loader(sparse).documentDom('grammars/test/case.md'));
  assert.equal(loader(sparse, readGrammarFile('data/preparsed/lojban.json')).preparsed.size, 0);
});

test('negated operators require their decomposition records, with or without a cache', () => {
  const source = document('%rule r $a:A %conditions $a.value ≠ "a"');
  const first = loader();
  const dom = first.readDocument(source, 'grammars/test/op.md');
  const cached = JSON.stringify({format: DOM_FORMAT, bootstrap: first.bootstrapHash, unicode: first.unicodeHash, properties: first.propertiesHash, documents: {'grammars/test/op.md': {hash: fnv1a64(source), dom}}});
  for (const preparsed of [undefined, cached]) {
    const custom = new Loader(path => path === 'grammars/test/op.md' ? source : path === 'data/unicode/unicode.txt' ? sparse : path === 'data/preparsed/test.json' ? preparsed : readGrammarFile(path));
    assert.throws(() => custom.documentDom('grammars/test/op.md'), error => error.kind === 'grammar' && error.where.column === 35);
    assert.equal(custom.preparsed.size, 0);
  }
});

test('include paths keep the original filename spelling', () => {
  const custom = new Loader(path => path === 'p.md' ? document('%stage main\n%include "café.md"') : path === 'café.md' ? document('%ambiguity-resolution greedy\n%rule text "a"') : readGrammarFile(path));
  assert.ok(custom.pipeline('p.md').parse('a').ok);
});

test('canonical diagnostic strings read back with exact scalar identity', () => {
  const custom = loader();
  for (const value of ['é', 'à', 'ź', '한', '\u302e\u1b44']) {
    const spelled = stringName(value, custom.unicode);
    const dom = custom.readDocument(document('%ambiguity-resolution greedy\n%const $S ' + spelled + '\n%rule text $S'), 'diagnostic.md');
    // Resolve through the grammar compiler as well as the reader.
    const d = new Loader(path => path === 'p.md' ? document('%stage main\n%include "g.md"') : path === 'g.md' ? document('%ambiguity-resolution greedy\n%const $S ' + spelled + '\n%rule text $S') : readGrammarFile(path)).pipeline('p.md');
    assert.ok(dom.rules.length);
    assert.ok(d.parse('', {tokens: [{tags: new Set(), span:[0,1], source:[0,0], text:'', value, image:value, before:[], after:[]}]}).ok, spelled);
  }
  const ranged = source => new Loader(path => path === 'p.md' ? document('%stage main\n%include "g.md"') : path === 'g.md' ? document('%ambiguity-resolution greedy\n%rule text ' + source) : readGrammarFile(path)).pipeline('p.md');
  const spelling = ranged('"‹U+00E0›".."‹U+017A›"').parse('').error.expected[0].terminal;
  assert.equal(spelling, '"‹U+00E0›".."‹U+017A›"');
  assert.ok(ranged(spelling).parse('', {tokens: [{tags:new Set(),span:[0,1],source:[0,0],text:'',value:'é',image:'é',before:[],after:[]}]}).ok);
});
