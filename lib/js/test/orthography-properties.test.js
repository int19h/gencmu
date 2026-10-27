import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadDialect} from '../src/node.js';
import {UnicodeTable} from '../src/unicode.js';
import {readGrammarFile} from './shared.js';

const unicode = new UnicodeTable(readGrammarFile('data/unicode/unicode.txt'));
function generator(seed = 1) {
  return () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed; };
}
test('the orthography generator retains its low bits', () => {
  const draw = generator();
  assert.deepEqual([draw(), draw()], [1103527590, 377401575]);
});
const random = seed => {
  const draw = generator(seed);
  return array => array[Math.floor(draw() / 0x80000000 * array.length)];
};
const pool = [...'aeiouyAEIOUYbcdfgjklmnprstvxzBKhHqQwW', ...'ɩƖꜷꜶ̨̣́̀̆̈̌̃ा⃝ .,!?’‘~～〜ーｰ·­​٣', "'", '\u0007', ...'023аиуИАбαñ'];
for (const name of ['lojban/bpfk', 'lojban/experimental', 'lojban/zantufa', 'lojban/cll', 'lojban/examples/kihei']) {
  test(`${name}: random texts keep a decided phoneme stage`, t => {
    const dialect = loadDialect(name), pick = random(31), distinct = new Set();
    for (let index = 0; index < 2000; index++) {
      let text = '';
      const length = pick([1,2,3,4,5,6,7]);
      for (let j = 0; j < length; j++) text += pick(pool);
      text = unicode.decompose(text); distinct.add(text);
      const result = dialect.parse(text, {until: name === 'lojban/experimental' ? 'forms' : 'phonemes', });
      assert.ok(result.ok && result.stages.every(stage => ['unique','resolved'].includes(stage.verdict)), JSON.stringify(text));
    }
    t.diagnostic(`${distinct.size} distinct texts from 2000 draws`);
  });
}
const quotes = new Set(["'", '’', '‘']);
const ignored = new Set([...',~～〜ーｰ·­⁠']);
const mark = character => character !== undefined && unicode.category(character.codePointAt(0)).startsWith('M');
const letter = character => character !== undefined && unicode.category(character.codePointAt(0)).startsWith('L') && !ignored.has(character);
function neighbors(chars, index) {
  let left = index - 1, right = index + 1;
  while (ignored.has(chars[left])) left--;
  while (mark(chars[left])) left--;
  while (ignored.has(chars[right])) right++;
  return letter(chars[left]) && letter(chars[right]);
}
for (const features of [[], ['cll-cyrillic']]) {
  test(`experimental expected readings, features ${features.join(',')}`, t => {
    const dialect = loadDialect('lojban/experimental'), pick = random(77), distinct = new Set();
    const letters = features.length ? [...'аеиоуъАЕИУбклмш'] : [...'aeioubcdfklmnprstzAEKL'];
    const chars = [...letters, ..."'’‘~～ー·,­́̈ा!ß2ɩwアи"];
    let kept = 0;
    for (let index = 0; index < 1500; index++) {
      let text = '';
      const length = pick([1,2,3,4,5,6,7,8]);
      for (let j = 0; j < length; j++) text += pick(chars);
      text = unicode.decompose(text); distinct.add(text);
      const cps = [...text];
      const result = dialect.parse(text, {features, until:'phonemes'});
      assert.equal(result.stages[0].verdict, 'unique', text);
      for (const token of result.stages[0].output) {
        const [start,end] = token.source;
        if (token.tags.has('FOREIGN') || (token.value === "'" && !token.tags.has('PAUSE'))) {
          for (let i = start; i < end; i++) if (quotes.has(cps[i])) { assert.ok(neighbors(cps,i), text); kept++; }
        }
        if (token.tags.has('Quote-Material')) {
          assert.ok(token.tags.has('PAUSE') && end > start, text);
          assert.equal(token.value, cps.slice(start,end).join(''), text);
          assert.equal(token.image, cps.slice(start,end).join(''), text);
        } else if (token.tags.has('PAUSE')) {
          assert.ok(!cps.slice(start,end).every(c => ignored.has(c)), text);
        }
      }
      // A quoted body preserves the entire original spelling, even if it contains only ignored characters.
      const chunks = [];
      for (let j = 0, n = pick([1,2,3,4]); j < n; j++) {
        let chunk = '';
        for (let k = 0, m = pick([1,2,3,4]); k < m; k++) chunk += pick([...letters, ...'ßア́~·ー,­!']);
        chunks.push(chunk);
      }
      const body = chunks.join(' ');
      const words = dialect.parse(`zoi gy. ${body} .gy.`, {features, until:'words'});
      assert.ok(words.ok, body);
      const output = words.stages.find(stage => stage.name === 'words').output;
      assert.equal(output.length, 1, body);
      assert.ok(output[0].tags.has('ZOI'), body);
      assert.equal(output[0].image, `zoi gy. ${body} .gy`, body);
    }
    assert.ok(kept > 0);
    t.diagnostic(`${distinct.size} distinct texts, ${kept} internal quotation marks`);
  });
}
for (const name of ['lojban/bpfk','lojban/experimental','lojban/zantufa']) {
  test(`${name}: ignored runs outside quotes preserve word values and stage verdicts`, t => {
    const dialect = loadDialect(name), pick = random(63), distinct = new Set();
    // Quotes take ignored stretches as literal material, so this invariance excludes quote constructors and closers.
    const words = ['mi','do','y','yy','.y.','.yy.','bu','gy','gy.','.gy.','zei','si','sa','su',"fa'o","ie'o",'broda','by','klama'];
    const silents = name === 'lojban/experimental' ? [',',',,','⁠','~','~~','·','­'] : [',',',,','⁠','­'];
    for (let index = 0; index < 2000; index++) {
      let text = pick(words);
      for (let j = 0, n = pick([1,2,3,4,5,6]); j < n; j++) text += ' ' + pick(silents) + ' ' + pick(words);
      distinct.add(text);
      const plain = text.replace(/[,\u2060\u00AD~·]/gu, '');
      const a = dialect.parse(plain), b = dialect.parse(text);
      assert.deepEqual(b.stages.map(s=>s.verdict), a.stages.map(s=>s.verdict), text);
      const output = r => r.stages.find(s=>s.name==='words')?.output;
      assert.deepEqual(output(b)?.map(t=>t.value), output(a)?.map(t=>t.value), text);
      const strip = image => image.replace(/[,\u2060\u00AD~·]/gu,'').replace(/ +/g,' ').trim();
      assert.deepEqual(output(b)?.map(t=>strip(t.image)), output(a)?.map(t=>strip(t.image)), text);
    }
    t.diagnostic(`${distinct.size} distinct texts from 2000 draws`);
  });
}
