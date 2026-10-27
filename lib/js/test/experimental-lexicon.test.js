// The experimental lexicon follows selected dictionary definitions and explicit policy exceptions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDialect } from "../src/node.js";

const dialect = loadDialect("lojban/experimental");
const lexicon = dialect.stages.find((stage) => stage.name === "forms").grammar.classifiers(new Set()).get("lexicon");

test("experimental classification follows selected English definitions and the maintainer's class corrections", () => {
  for (const [word, name] of [
    ["li'oi", "UI"], ["o'ai", "COI"], ["su'ai", "PA"], ["xe'e", "PA"],
    ["xei'e", "FAhA"], ["xoi", "SEI"], ["xai", "KOhA"], ["xi'o", "KOhA"],
    ["xo'e", "PA"], ["xei", "PA"], ["i'au", "IhAU"], ["zai'e", "BAhE"],
    ["ra'oi", "ZOhOI"], ["ji'ai", "LE"], ["me'ei", "LE"], ["ja'ei", "JAI"],
    ["xa'o", "ZAhO"], ["a'y", "BY"], ["zi'a", "UI"], ["cu'ei", "UI"], ["io'e", "UI"],
    ["ni'au", "COI"],
  ]) assert.deepEqual([...(lexicon.get(word) || [])], [name], word);
});

test("experimental classification retains dictionary classes independently of their constructions", () => {
  for (const [word, name] of [
    ["ba'ei", "BAhEI"], ["bei'e", "BEIhE"], ["ca'ei", "CAhEI"], ["ci'au", "CIhAU"], ["ci'au'u", "CIhAUhU"],
    ["co'ai", "COhAI"], ["co'e'o'e", "COhEhOhE"], ["cu'au", "CUhAU"], ["fa'o'o", "FAhOhO"],
    ["gi'ei", "GIhEI"], ["go'oi", "GOhOI"], ["i'au", "IhAU"], ["jai'a", "JAIhA"],
    ["jai'i", "JAIhI"], ["ji'oi", "JIhOI"], ["kau'u", "KAUhU"], ["ku'ei", "KUhEI"],
    ["la'ei", "LA"], ["li'ei", "LIhEI"], ["mu'oi", "MUhOI"], ["soi'a", "NOIhA"],
    ["se'e'i", "SEhEhI"], ["toi'e", "TOIhE"], ["vu'oi", "VUhOI"], ["xo'i", "XOhI"],
    ["zo'au", "ZOhAU"], ["ze'ei", "SI"], ["la'ai", "LOhU"], ["fu'ei", "FUhE"],
    ["xo'a", "FAhO"], ["jo'au", "COI"], ["xei'u", "DAhO"], ["sai'ei", "MAI"],
    ["pe'ei", "BAhE"], ["xo'ei", "VUhU"],
  ]) assert.deepEqual([...(lexicon.get(word) || [])], [name], word);
});

test("experimental classification preserves baseline words below the dictionary threshold", () => {
  for (const [word, name] of [
    ["ai'i", "UI"], ["cei'a", "MOI"], ["co'au'a", "ZAhO"], ["co'u'a", "ZAhO"],
    ["de'i'a", "BAI"], ["de'i'i", "BAI"], ["de'i'o", "BAI"], ["de'i'u", "BAI"],
    ["fi'oi", "SOI"], ["ku'au", "KUhAU"], ["ku'oi", "KUhOI"], ["sau'a", "ZAhO"],
    ["su'ei", "SE"],
  ]) assert.deepEqual([...(lexicon.get(word) || [])], [name], word);
});

test("ze'ei joins without a warning and rejects a missing right word", () => {
  const text = "lo broda ze'ei gerku cu klama";
  const result = dialect.parse(text);
  assert.equal(result.ok, true, text);
  assert.deepEqual(result.stages.find((stage) => stage.name === "words").output.map((token) => token.image),
    ["lo", "broda ze'ei gerku", "cu", "klama"], text);
  assert.deepEqual(result.warnings, [], text);

  const missing = dialect.parse("mi klama ze'ei");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.kind, "rejected");
  assert.equal(missing.error.stage, "words");
  assert.deepEqual(missing.warnings, []);
});

test("experimental classification admits the 94 dictionary classes supported by corpus evidence", () => {
  for (const [word, name] of [
    ["iau", "IhAU"],
    ["xu'u", "LOhOI"],
    ["ie'o", "Y"],
    ["bi'ai", "CAhA"],
    ["ko'ai", "LOhOI"],
    ["ku'au", "KUhAU"],
    ["xau", "BAI"],
    ["va'ei", "ROI"],
    ["xy'y", "UI"],
    ["bi'au", "UI"],
    ["lu'ei", "LUhEI"],
    ["de'a'ai", "COI"],
    ["bo'a", "KOhA"],
    ["poi'o'a", "NOIhA"],
    ["dau'u", "LE"],
    ["li'au", "LIhAU"],
    ["so'oi", "SOhOI"],
    ["ta'ei", "UI"],
    ["te'oi", "NU"],
    ["jei'u", "UI"],
    ["do'oi", "DOhOI"],
    ["di'a'ai", "COI"],
    ["rei'e", "NAhE"],
    ["ba'oi", "ROI"],
    ["ne'au", "UI"],
    ["mau'u", "UI"],
    ["bo'e", "KOhA"],
    ["kai'i", "LE"],
    ["ti'oi", "LE"],
    ["xe'e'e", "UI"],
    ["sau'ei", "COI"],
    ["sai'e", "NAhE"],
    ["jo'ai", "JAI"],
    ["da'ai", "KOhA"],
    ["kai'e", "UI"],
    ["za'ai", "ZI"],
    ["za'oi", "UI"],
    ["xai'i", "LE"],
    ["ra'ei", "UI"],
    ["ku'ai'i", "GOhA"],
    ["du'ai", "ME"],
    ["da'au", "KOhA"],
    ["ca'au", "KOhA"],
    ["bo'ai", "LI"],
    ["bo'oi", "UI"],
    ["ki'au", "UI"],
    ["au'o", "UI"],
    ["au'y", "BY"],
    ["xa'oi", "UI"],
    ["ue'e", "UI"],
    ["te'i", "BAI"],
    ["si'oi", "SIhOI"],
    ["sei'u", "COI"],
    ["se'o'e", "SE"],
    ["ru'oi", "PA"],
    ["pau'ai", "UI"],
    ["oi'o", "UI"],
    ["ne'e", "CAI"],
    ["loi'e", "LE"],
    ["ku'au'i", "COI"],
    ["gai'o", "GOhA"],
    ["fai'i", "FA"],
    ["do'ei", "KOhA"],
    ["dei'a", "TAhE"],
    ["dei'ei", "KOhA"],
    ["ci'ai", "UI"],
    ["bu'oi", "COI"],
    ["bo'i", "KOhA"],
    ["kai'ei", "NU"],
    ["ta'oi", "TAhOI"],
    ["ze'ai", "TAhE"],
    ["uau'o", "UI"],
    ["va'u'ai", "UI"],
    ["toi'o", "TOIhO"],
    ["toi'u", "UI"],
    ["su'o'o", "PA"],
    ["su'u'u'u'u'u'u'u", "SUhUhUhUhUhUhUhU"],
    ["si'i'ei", "SIhIhEI"],
    ["sei'e", "SEI"],
    ["se'ai", "SE"],
    ["pe'ai", "UI"],
    ["lu'au", "LAhE"],
    ["lo'o'o", "LE"],
    ["lai'u", "LA"],
    ["koi'i", "LOhOI"],
    ["ke'o'a", "COI"],
    ["iy'y", "BY"],
    ["fi'ai", "ZOhU"],
    ["fa'u'u'u'u'u'u'u'u", "FAhO"],
    ["du'au", "LAhE"],
    ["di'ei'o'au", "VUhU"],
    ["cu'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u'u", "UI"],
    ["ca'e'ei", "UI"],
    ["cai'e", "NAhE"],
  ]) assert.deepEqual([...(lexicon.get(word) || [])], [name], word);
});

test("experimental classification excludes inconsistent uses below the score threshold", () => {
  for (const word of [
    "po'au", "zei'a", "zei'i", "le'ei", "tei'u", "pu'ei", "ja'oi",
    "iu'e", "zai'u", "soi'i", "li'ai", "zi'u",
  ]) assert.equal(lexicon.has(word), false, word);
});
