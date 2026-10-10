import { test } from "node:test";
import assert from "node:assert/strict";
import { cllFootnoteProblems, repositoryCllFootnoteProblems } from "../../../tools/cll-footnotes.js";

const base = "https://lojban.org/publications/cll/cll_v1.1_xhtml-section-chunks/";
const footnote = (label, target) => `Text[^source].\n\n[^source]: [${label}](${target}).\n`;

test("every CLL footnote names a page, anchor and number in its pinned edition", () => {
  assert.deepEqual(repositoryCllFootnoteProblems(), []);
});

test("valid chapters, sections and examples match their actual headings", () => {
  for (const [label, target] of [
    ["CLL 1.1, chapter 21", "chapter-grammars.html"],
    ["CLL 1.1, section 21.1", "chapter-grammars.html#section-EBNF"],
    ["CLL 1.1, section 21.1", "chapter-grammars.html#c21s2"],
    ["CLL 1.1, section 21.2", "section-cross-reference.html"],
    ["CLL 1.1, section 14.11, example 14.71", "section-termsets.html#c14e11d1"],
  ]) assert.deepEqual(cllFootnoteProblems(footnote(label, base + target), "a.md"), []);
});

test("missing pages, missing anchors and wrong heading or example numbers fail", () => {
  for (const [label, target, error] of [
    ["CLL 1.1, section 21.1", "missing.html", /page is absent/],
    ["CLL 1.1, section 21.1", "chapter-grammars.html#missing", /anchor has no heading/],
    ["CLL 1.1, section 21.2", "chapter-grammars.html#section-EBNF", /section 21.2 does not match/],
    ["CLL 1.1, section 21.2", "chapter-grammars.html#c21s2", /section 21.2 does not match/],
    ["CLL 1.1, section 14.11, example 14.99", "section-termsets.html#c14e11d1", /example 14.99 does not match/],
    ["CLL 1.1, section 14.10, example 14.71", "section-termsets.html#c14e11d1", /section 14.10 does not match/],
    ["CLL 1.3.4, section 21.1", "chapter-grammars.html#section-EBNF", /edition 1.3.4 differs/],
    ["CLL 1.1", "chapter-grammars.html", /must name/],
    ["CLL 1.1, section 21.1", "chapter-grammars.html#%", /invalid target URL/],
  ]) assert.match(cllFootnoteProblems(footnote(label, base + target), "a.md").join("\n"), error);
});

test("later-edition source line anchors contain the numbered section heading", () => {
  const source = "https://github.com/int19h/cll/blob/v1.3.4/chapters/";
  assert.deepEqual(cllFootnoteProblems(footnote("CLL 1.3.4, section 4.16", source + "04.xml#L6131-L6186"), "a.md"), []);
  assert.deepEqual(cllFootnoteProblems(footnote("CLL 1.3.4, appendix A3.3", source + "a03.xml#L155-L243"), "a.md"), []);
  assert.match(cllFootnoteProblems(footnote("CLL 1.3.4, appendix A3.3", source + "a03.xml"), "a.md").join("\n"), /does not match/);
  assert.match(cllFootnoteProblems(footnote("CLL 1.3.4, appendix A3.3", source + "a03.xml#L99999"), "a.md").join("\n"), /anchor has no heading/);
});

test("only real footnote links are checked", () => {
  const invalid = footnote("CLL 1.1, section 21.2", base + "chapter-grammars.html#section-EBNF");
  assert.deepEqual(cllFootnoteProblems(`\`\`\`markdown\n${invalid}\`\`\`\n`, "a.md"), []);
  assert.deepEqual(cllFootnoteProblems(`[CLL 1.1, section 21.2](${base}chapter-grammars.html#section-EBNF)`, "a.md"), []);
});
