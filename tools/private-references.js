// Whether a file of the repository names a document that the repository
// does not hold. A comment, a test name, a fixture or a catalog says what
// the code does, and it cites a heading of a public manual under docs/. It
// names no erratum, ruling, review or finding of an outside document, and
// no part or section of an outside specification. tools/sync.js --check
// runs this check on every file of the repository (tools/documents.js).
//
// Some words have a public sense too. The CLL errata page is a public
// document, and the corpus and the Unicode data quote real text, so the
// check leaves them out. The words "review" and "finding" are ordinary
// English in prose, so the check reads them only in code and data files.
import fs from "node:fs";
import path from "node:path";
import { repositoryFiles } from "./documents.js";

// This file, which lists the words, and the files that quote outside text:
// the corpus, the Unicode data and the diagrams, whose path data holds such
// letters as M60.
const SKIPPED = /^tools\/private-references\.js$|\.svg$|^tests\/corpus\/|^tests\/core\.txt$|^tests\/quoted-allow\.txt$|^tests\/text-sources\/|(?:^|\/)data\/unicode\//;
// The files whose words "review" and "finding" are code or data.
const CODE = /\.(?:js|mjs|cjs|ts|rs|go|py|json|jsonl|toml|sh)$/;

/** @type {{name: string, pattern: RegExp, code?: boolean}[]} */
const PATTERNS = [
  { name: "an erratum", pattern: /\berratum\b/gi },
  { name: "errata", pattern: /\berrata\b/gi },
  { name: "an erratum by its number", pattern: /\bM-?60\b|\bm60-/gi },
  { name: "a ruling", pattern: /\brulings?\b/gi },
  { name: "a part of a specification", pattern: /\b[Pp]arts? [1-3] §|\bP[1-3] §/g },
  { name: "an answer or a cause", pattern: /\bcause [A-Z] of\b|\banswer \d+\b/g },
  { name: "a review", pattern: /\b(?:the|this|that|each|its|their|earlier|later|first|second|third|fourth|fifth) (?:[A-Z][\w-]* )?reviews?\b/gi, code: true },
  { name: "a finding", pattern: /\b(?:the|this|each|a|its|their) findings?\b|\bfindings? [A-Z]{0,2}\d/gi, code: true },
];

// The public senses: the CLL errata page and the corpus records of its text.
const ALLOWED = [/CLL errata/, /errata page/, /The errata calls/, /adhoc\.syntax\.errata/, /duplicate erratum text/];

/**
 * The places where a file of the repository names an outside document, as
 * "FILE:LINE: ..." (lines counted from 1).
 * @param {string} root
 * @returns {string[]}
 */
export function privateReferenceProblems(root) {
  const problems = [];
  for (const file of repositoryFiles(root)) {
    if (SKIPPED.test(file)) continue;
    const bytes = fs.readFileSync(path.join(root, file));
    if (bytes.subarray(0, 4096).includes(0)) continue;
    const code = CODE.test(file);
    const lines = bytes.toString("utf8").split("\n");
    lines.forEach((line, index) => {
      for (const { name, pattern, code: inCode } of PATTERNS) {
        if (inCode && !code) continue;
        for (const match of line.matchAll(pattern)) {
          const around = line.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30);
          if (ALLOWED.some((allowed) => allowed.test(around))) continue;
          problems.push(`${file}:${index + 1}: "${match[0]}" names ${name} of a document that the repository does not hold. Say what the code does, and cite a heading of a manual under docs/`);
        }
      }
    });
  }
  return problems;
}
