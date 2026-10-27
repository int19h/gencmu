# Guidance for agents working on gencmu

gencmu is a Lojban parser. Its grammars are literate Markdown documents in the jbogenbau notation, and a generic engine reads them at run time. This file states the rules that every change must follow.

## Layout

- `grammars/` holds the grammars. Each `NAME/pipeline.md` names its stages and grammar documents. Directories group pipelines by language family, and root files belong to the engine.
- `docs/` holds the specification: `notation.md`, `engine.md`, `output.md`, `api.md`, `design.md` and `pipelines.md`. `experimental-cmavo-evidence.md` records the usage evidence for the experimental lexicon.
- `lib/js`, `lib/rust`, `lib/go` and `lib/python` are the four libraries. JavaScript is the reference library. If the libraries disagree, the specification decides.
- `tests/` holds the shared conformance cases and the corpus. `tests/README.md` explains the corpus format.
- Run `npm ci` in `lib/js` to install the development dependencies.
- `tools/sync.js` regenerates every generated file: the compiled grammar cache, the package copies of the grammars, the browser bundle and the diagrams. `node tools/sync.js --check` must pass before a commit.

## How changes are made

- Write the specification first. Change `docs/` before or with the code, and keep the four libraries in step with the shared conformance cases.
- Decide correctness by reasoning about the grammar and the specification. Tests show that something is wrong. They cannot show that it is right.
- Fix the class of a problem, not the reported example. Search for every other instance of the same cause.
- Prefer the clear and consistent design. A large mechanical migration is not a reason to avoid it.
- Remove grammar alternatives that can never match.
- Readability comes first. If the notation forces an awkward grammar form, report it in the review or pull request. Propose a notation change.
- Run the whole corpus once per grammar change in Rust, the fastest library. List every changed outcome with its reason. Continuous integration covers the other libraries.
- Before opening a pull request, run the CI checks. These are `node tools/sync.js --check`, `cargo clippy --all-targets -- -D warnings` in `lib/rust`, `npm test` and `npm run types` in `lib/js` (the declarations must not change), and `node tools/smoke-playground.js --browser chromium`.
- A pull request body closes each issue with its own keyword, as in `Closes #12. Closes #13.`

## Writing rules

Grammar prose and documentation use simple English:

- Descriptive sentences of at most 25 words. Procedural sentences of at most 20 words.
- No semicolons and no em dashes.
- One line per paragraph.
- No history: describe what the grammar does, not how it got there.
- Use pipeline for software objects, names, APIs, CLI commands, messages, logs, diagnostics, test fields, playground controls, and engine specifications. Use dialect only for a variety of a language in family-specific prose. Source quotations keep their words.
- Grammar prose explains what each rule block does and why. Differences from the reference grammars go in the closing section of each document.

## Sources and authority

- The `lojban/cll` pipeline follows the text of *The Complete Lojban Language* (CLL) 1.1. The official LLG parser and the YACC grammar are supporting evidence only.
- Every pipeline follows the left-to-right BPFK Magic Words model. Magic words include `si`, `sa`, `su`, `zo`, `zoi`, `zei` and `bu`. camxes-std is its reference implementation. CLL chapter 19 is not consistent on these words, so it is cited only where it agrees with Magic Words.
- A quote of any kind is one word unit, and indicators and `ba'e` mark it as a whole. DAhO, FUhE and FUhO stand wherever indicators can. FUhE opens a run of indicators.
- The `lojban/experimental` pipeline starts from camxes-exp, but camxes-exp is a baseline, not a ceiling. Do not copy a rejection that exists only because of PEG ordering. List every deliberate departure, with its reason.
- The Lojban corpus is the public repository [jbocirvei](https://github.com/int19h/jbocirvei). It holds CLL, the reference grammars, dictionary exports, wiki pages, mail and chat. Many of its sources are git submodules. It is one source, not the only one. If the corpus lacks something, use the original source.
- The maintainers curate the experimental lexicon by hand from the dictionary. Its closing section states the policy and every exception.
- Do not use Tatoeba sentences as test material. Their Lojban is generally poor.

## Reviews

Every grammar or specification change gets independent reviews before it merges. Several reviewers examine the grammar and prose in turn. A separate review covers the code. Each review reasons rule by rule and ends with a clear verdict. A change merges after its reviews are ready and continuous integration passes.
