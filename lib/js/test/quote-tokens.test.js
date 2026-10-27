import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadDialect} from '../src/node.js';

for (const dialect of ['lojban/cll', 'lojban/examples/kihei', 'lojban/bpfk', 'lojban/experimental', 'lojban/zantufa']) {
  test(`${dialect} retains the quote tree after syntax reads its single token`, () => {
    const result = loadDialect(dialect).parse("ba'e zo coi ui cmavo");
    assert.equal(result.ok, true, result.error?.message);
    const words = result.stages.find(stage => stage.name === 'words');
    assert.deepEqual(words.output.map(token => token.image), ["ba'e", 'zo coi', 'ui', 'cmavo']);
    const nodes = [words.tree];
    let quoted;
    while (nodes.length) {
      const node = nodes.pop();
      if (node.rule === 'quoted-word') quoted = node;
      for (const child of node.children || []) nodes.push(child);
    }
    assert.ok(quoted);
    const leaves = [];
    const pending = [quoted];
    while (pending.length) {
      const node = pending.pop();
      if (node.kind === 'token') leaves.push(words.input[node.token].image);
      for (const child of (node.children || []).toReversed()) pending.push(child);
    }
    assert.deepEqual(leaves, ['zo', ' ', 'coi']);
    const syntax = result.stages.find(stage => stage.name === 'syntax');
    const quote = syntax.input.find(token => token.tags.has('ZO'));
    assert.equal(quote.image, 'zo coi');
    assert.equal(quote.before[0].image, "ba'e");
    if (dialect !== 'lojban/zantufa') assert.equal(quote.after[0].image, 'ui');
  });
}
