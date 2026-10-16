// The dictionary policy of issue #211 changes classes without changing syntax.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDialect } from "../src/node.js";

const dialect = loadDialect("experimental");
const lexicon = dialect.stages.find((stage) => stage.name === "forms").grammar.classifiers(new Set()).get("lexicon");

test("experimental classification uses the highest-voted English definition and its base class", () => {
  for (const [word, name] of [
    ["li'oi", "UI"], ["o'ai", "COI"], ["su'ai", "PA"], ["xe'e", "PA"],
    ["xei'e", "FAhA"], ["xoi", "SEI"], ["xai", "KOhA"], ["xi'o", "KOhA"],
    ["xo'e", "PA"], ["xei", "PA"], ["i'au", "IhAU"], ["zai'e", "BAhE"],
    ["ra'oi", "ZOhOI"], ["ji'ai", "LE"], ["me'ei", "LE"], ["ja'ei", "JAI"],
    ["xa'o", "ZAhO"], ["a'y", "BY"], ["zi'a", "UI"], ["cu'ei", "UI"], ["io'e", "UI"],
  ]) assert.deepEqual([...(lexicon.get(word) || [])], [name], word);
});

test("experimental classification retains the dictionary classes that await issue #212", () => {
  for (const [word, name] of [
    ["ba'ei", "BAhEI"], ["bei'e", "BEIhE"], ["ca'ei", "CAhEI"], ["ci'au", "CIhAU"],
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
  for (const word of ["xu'u", "ie'o", "iau", "bi'ai"]) assert.equal(lexicon.has(word), false, word);
});

test("ze'ei applies SI erasure without a warning while its joining use awaits issue #212", () => {
  for (const [text, images] of [
    ["lo broda ze'ei gerku cu klama", ["lo", "gerku", "cu", "klama"]],
    ["mi klama ze'ei", ["mi"]],
  ]) {
    const result = dialect.parse(text);
    assert.equal(result.ok, true, text);
    assert.deepEqual(result.stages.find((stage) => stage.name === "words").output.map((token) => token.image), images, text);
    assert.deepEqual(result.warnings, [], text);
  }
});
