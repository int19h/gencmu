// The shapes of the values the library passes around, as JSDoc type
// definitions. They are checked by TypeScript (see README.md) and
// published as declarations; nothing here runs.

// ---- Tokens and results (docs/output.md) --------------------------------

/**
 * A tag set: each tag with its strength, `true` for strong and `false` for
 * weak.
 * @typedef {Map<string, boolean>} TagSet
 */

/**
 * A half-open range `[start, end)`: of a stage's input tokens, or of the
 * text's code points.
 * @typedef {[number, number]} Span
 */

/**
 * A place in a document, `[line, column]`, both from 1.
 * @typedef {[number, number]} Position
 */

/**
 * Where a grammar error was found, as far as it is known.
 * @typedef {object} ErrorLocation
 * @property {string} [document]
 * @property {number} [line]
 * @property {number} [column]
 * @property {string} [stage]
 * @property {string} [rule]
 */

/**
 * A function from a path relative to the grammars root to that file's text,
 * or `undefined` when there is no such file.
 * @typedef {(path: string) => string | undefined} Resources
 */

/**
 * What a stage concluded about its derivations (engine §6).
 * @typedef {"unique" | "resolved" | "tie"} Verdict
 */

/**
 * A result tree node that reads one token.
 * @typedef {object} TokenNode
 * @property {"token"} kind
 * @property {string} terminal the terminal the token was read as
 * @property {number} token the token's index in the stage's input
 * @property {Span} span
 * @property {Span} source
 */

/**
 * A result tree node for a terminator the text left out.
 * @typedef {object} ElidedNode
 * @property {"elided"} kind
 * @property {string} terminal
 * @property {Span} span
 * @property {Span} source
 */

/**
 * A result tree node for a rule.
 * @typedef {object} RuleNode
 * @property {"rule"} kind
 * @property {string} rule
 * @property {Span} span
 * @property {Span} source
 * @property {TagSet} tags
 * @property {ResultNode[]} children
 */

/** @typedef {TokenNode | ElidedNode | RuleNode} ResultNode */

/**
 * A terminal a rejected stage could have read, and the rules that could
 * have read it.
 * @typedef {object} Expectation
 * @property {string} terminal
 * @property {string[]} rules
 */

/**
 * Why a text did not parse: rejected by a stage, ambiguous under
 * elision-only, or a defect of the grammar found while running it.
 * @typedef {object} ParseError
 * @property {"rejected" | "ambiguous" | "grammar"} kind
 * @property {string} [stage]
 * @property {number} [token]
 * @property {Span} [source]
 * @property {number} [line]
 * @property {number} [column]
 * @property {Expectation[]} [expected]
 * @property {ResultNode[]} [readings]
 * @property {string} [document]
 * @property {string} message
 */

/**
 * One step of a derivation, read bottom-up: a token read, or a production
 * closed.
 * @typedef {ReadAction | CloseAction} Action
 */

/**
 * @typedef {object} ReadAction
 * @property {"read"} kind
 * @property {number} token
 * @property {string} terminal
 * @property {boolean} weak
 */

/**
 * @typedef {object} CloseAction
 * @property {"close"} kind
 * @property {Item} item
 */

/**
 * What one stage did. A stage whose verdict is `tie` has a witness and a
 * tied tree; any other has neither.
 * @typedef {TiedStageReport | SettledStageReport} StageReport
 */

/**
 * @typedef {StageReportBase & {verdict: "tie", witness: Witness, tied: ResultNode}} TiedStageReport
 */

/**
 * @typedef {StageReportBase & {verdict: "unique" | "resolved" | null, witness: null, tied?: undefined}} SettledStageReport
 */

/**
 * Where the chosen and the tied derivation first differ: their actions
 * there, null on the side of one that ended.
 * @typedef {[Action | null, Action | null]} Witness
 */

/**
 * What every stage report has.
 * @typedef {object} StageReportBase
 * @property {string} name
 * @property {Token[] | null} output the tokens handed to the next stage
 * @property {ResultNode | null} tree
 * @property {ParseError | null} error
 * @property {Token[]} [input] the tokens the stage read
 * @property {Derivation} [derivation] the chosen derivation, helpers and all
 * @property {ParseContext} [context]
 */

/**
 * The result of parsing a text.
 * @typedef {object} ParseResult
 * @property {boolean} ok
 * @property {StageReport[]} stages
 * @property {ResultNode | null} tree the last stage's tree
 * @property {ParseError | null} error
 * @property {string} text
 * @property {string[]} features the features the parse ran with, those auto
 *   features added included; not part of the canonical JSON
 */

/**
 * @typedef {object} ParseOptions
 * @property {Iterable<string>} [features] the features to enable, besides
 *   those the dialect's pipeline enables
 * @property {boolean} [autoFeatures] enable `sa-su` only for a text that
 *   needs it; on unless `false`
 * @property {string} [until] the name of the last stage to run
 * @property {boolean | null} [elisionOnly] override the grammar's own
 *   elision-only setting
 * @property {Token[]} [tokens] the first stage's input, in place of the
 *   text's characters
 */

// ---- The grammar DOM (docs/output.md, "The DOM") ------------------------

/**
 * A grammar document as read by the notation.
 * @typedef {object} GrammarDom
 * @property {number} format
 * @property {DomRule[]} rules
 * @property {DomDirective[]} directives
 */

/**
 * @typedef {object} DomDirective
 * @property {string} name
 * @property {string[]} args
 * @property {Position} at
 */

/**
 * @typedef {object} DomRule
 * @property {string} name
 * @property {"define" | "extend"} op
 * @property {Term} [tags]
 * @property {DomAlternative[]} alternatives
 * @property {Emission} [emit]
 * @property {Condition[]} conditions
 * @property {Position} at
 */

/**
 * @typedef {object} DomAlternative
 * @property {Guard[]} guards
 * @property {Expr} expr
 * @property {Term} [tags]
 */

/**
 * @typedef {object} Guard
 * @property {string} feature
 * @property {boolean} negated
 */

/**
 * A rule body expression.
 * @typedef {{choice: Expr[]} | {and: Expr[]} | {seq: Expr[]} | {repeat: Expr, min: number}
 *   | {optional: Expr} | {capture: string, expr: Expr} | {ref: string} | {terminal: string}
 *   | {empty: true}} Expr
 */

/**
 * An emission clause.
 * @typedef {{items: EmitItem[]}} Emission
 */

/**
 * One item of an emission clause: a capture, `""` for `$`, the whole
 * constituent, with the tags to give it or erased; or an inserted token.
 * @typedef {object} EmitItem
 * @property {string} [capture]
 * @property {string} [insert]
 * @property {Term} [tags]
 * @property {true} [erase]
 */

/**
 * @typedef {"=" | "≠" | "∈" | "∉" | "⊆"} Comparator
 */

/**
 * A condition.
 * @typedef {{any: Condition[]} | {all: Condition[]} | {not: Condition} | {matches: Term, rule: string}
 *   | {op: Comparator, left: Term, right: Term}} Condition
 */

/**
 * A term of a condition or a tags clause.
 * @typedef {{literal: string} | {weak: string} | {emptySet: true} | {union: Term[]}
 *   | {intersection: Term[]} | {call: string, args: Argument[]} | {capture: string}} Term
 */

/**
 * A function's argument: a term, or the name of a rule.
 * @typedef {Term | {rule: string}} Argument
 */

// ---- The engine ---------------------------------------------------------

/**
 * @typedef {object} GrammarSymbol
 * @property {string} name
 * @property {boolean} terminal
 */

/**
 * @typedef {object} Capture
 * @property {string} name
 * @property {number} index the position of the captured symbol
 */

/**
 * A condition of a production, with the position after which it can be
 * checked (-1 for before any symbol).
 * @typedef {object} ReadyCondition
 * @property {Condition} condition
 * @property {number} readyAt
 */

/**
 * A production of a lowered grammar (engine §3).
 * @typedef {object} Production
 * @property {number} id
 * @property {string} lhs
 * @property {GrammarSymbol[]} rhs
 * @property {boolean} helper
 * @property {string} owner the rule the production was lowered from
 * @property {string | null} elided the terminator an empty helper stands for
 * @property {Capture[]} captures
 * @property {ReadyCondition[]} conditions
 * @property {Term | null} tags
 * @property {Emission | null} emit
 * @property {boolean} recursivePrefix
 */

/**
 * @typedef {object} Resolution
 * @property {"greedy" | "lazy"} lean
 * @property {boolean} elisionOnly
 */

/**
 * A grammar lowered for one set of features.
 * @typedef {object} LoweredGrammar
 * @property {Production[]} productions
 * @property {Map<string, Production[]>} byLhs
 * @property {Set<string>} elidable
 * @property {Resolution} resolution
 */

/**
 * The lean the ranking uses: the grammar's, or none for elision-only's
 * check.
 * @typedef {"greedy" | "lazy" | "none"} Lean
 */

/**
 * A captured part as a chart item records it: its span and the number of
 * its tag set.
 * @typedef {[number, number, number] | null} Slot
 */

/**
 * How an item was built.
 * @typedef {{kind: "seed"} | {kind: "scan", previous: Item, token: number, terminal: string}
 *   | {kind: "complete", previous: Item, child: Item}} Edge
 */

/**
 * A value a term evaluates to.
 * @typedef {{string: string} | {tags: TagSet} | {list: string[]}} TermValue
 */

/**
 * A span a term denotes, with the tags of the captured part when it is a
 * whole capture.
 * @typedef {object} SpanValue
 * @property {number} start
 * @property {number} end
 * @property {TagSet} [tags]
 */

/**
 * Where a term looks up its captures.
 * @typedef {object} Scope
 * @property {(name: string) => SpanValue} capture
 */

/**
 * A sequence of actions, shared between the sequences built on it.
 * @typedef {{empty: true, size: number} | RopeLeaf | RopeConcat} Rope
 */

/** @typedef {{leaf: Action, size: number}} RopeLeaf */
/** @typedef {{left: Rope, right: Rope, size: number}} RopeConcat */

/**
 * A derivation, every production closed, helpers and all.
 * @typedef {DerivationRead | DerivationRule} Derivation
 */

/**
 * @typedef {object} DerivationRead
 * @property {ReadAction} read
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {object} DerivationRule
 * @property {Item} item
 * @property {Production} production
 * @property {Derivation[]} children
 * @property {number} start
 * @property {number} end
 */

/** @typedef {import("./tokens.js").Token} Token */
/** @typedef {import("./earley.js").Item} Item */
/** @typedef {import("./earley.js").ParseContext} ParseContext */

export {};
