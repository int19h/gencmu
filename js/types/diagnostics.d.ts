import type { Condition, ParseResult, Span, Argument, Production } from "./types.js";
import type { Token } from "./tokens.js";
import type { Dialect } from "./dialect.js";
import type { TraceEvent } from "./earley.js";
/**
 * @import { Action, Condition, Expr, ParseResult, ResultNode, Span, StageReport, TagSet, Term, Argument, Production } from "./types.js"
 * @import { Token } from "./tokens.js"
 * @import { Dialect } from "./dialect.js"
 * @import { TraceEvent } from "./earley.js"
 * @import { StitchedAlternative } from "./grammar.js"
 */
/**
 * The line of the text holding a source range, and a caret line under the
 * range: at least one caret, at the end of the line for an empty range.
 * @param {string} text
 * @param {Span} source code point range
 * @returns {{line: number, column: number, excerpt: string}}
 */
export declare function sourceExcerpt(text: string, source: Span): {
    line: number;
    column: number;
    excerpt: string;
};
/**
 * A result's error explained: for a rejection, the stage, the line with a
 * caret under the token the stage could not read, and what could have come
 * there, grouped by the rules that could have read it; for an ambiguous
 * text, its two readings; for a grammar error, where. Empty for a result
 * with no error.
 * @param {ParseResult} result
 * @returns {string}
 */
export declare function explainError(result: ParseResult): string;
/**
 * The ties of a result explained, stage by stage: where the two readings
 * first differ, both readings as brackets, and both trees side by side.
 * Empty when no stage ties.
 * @param {ParseResult} result
 * @returns {string}
 */
export declare function explainTies(result: ParseResult): string;
/**
 * The tokens each stage handed on, or one stage's, as a table.
 * @param {ParseResult} result
 * @param {string} [stageName]
 * @returns {string}
 */
export declare function tokenTable(result: ParseResult, stageName?: string): string;
/**
 * @param {Argument} term
 * @returns {string}
 */
export declare function formatTerm(term: Argument): string;
/**
 * @param {Condition} condition
 * @returns {string}
 */
export declare function formatCondition(condition: Condition): string;
/**
 * A production with a dot, its captures shown, a helper as the rule it
 * belongs to.
 * @param {Production} production
 * @param {number} dot
 * @returns {string}
 */
export declare function formatItem(production: Production, dot: number): string;
export type StageAudit = {
    name: string;
    resolution: string;
    rules: number;
    /**
     * rules no derivation of `text` can reach
     */
    unreachable: string[];
    changes: {
        kind: string;
        rule: string;
        document: string;
        previous: string;
    }[];
    /**
     * conditions no
     * alternative of their definition captures every part of
     */
    idleConditions: {
        rule: string;
        document: string;
        condition: string;
    }[];
    /**
     * erasures, `$ <>` or
     * `$x <>`, of what could never emit anything anyway and never lies inside an emitted token
     */
    idleErasures: {
        rule: string;
        document: string;
        erased: string;
    }[];
};
/**
 * What a grammar author should know about a dialect's grammars: per stage,
 * the rules nothing reaches, every rule a later document replaced or
 * extended, and conditions that never apply.
 * @param {Dialect} dialect
 * @returns {StageAudit[]}
 */
export declare function audit(dialect: Dialect): StageAudit[];
/**
 * An audit as text.
 * @param {StageAudit[]} stages
 * @returns {string}
 */
export declare function formatAudit(stages: StageAudit[]): string;
export type Trace = {
    stage: string;
    /**
     * the position between input tokens traced
     */
    position: number;
    /**
     * the stage's input
     */
    tokens: Token[];
    events: TraceEvent[];
    /**
     * terminals items at the position could read
     */
    expected: {
        terminal: string;
        rules: string[];
    }[];
};
/**
 * @typedef {object} Trace
 * @property {string} stage
 * @property {number} position the position between input tokens traced
 * @property {Token[]} tokens the stage's input
 * @property {TraceEvent[]} events
 * @property {{terminal: string, rules: string[]}[]} expected terminals items at the position could read
 */
/**
 * What one stage's recognizer did at one position of its input: which items
 * it predicted, advanced and completed there, and which advances a
 * condition refused, with the condition. This is the tool for "why does my
 * grammar not accept this text here".
 * @param {Dialect} dialect
 * @param {string} text
 * @param {{stage: string, position: number, features?: Iterable<string>, autoFeatures?: boolean}} options
 * @returns {Trace}
 */
export declare function trace(dialect: Dialect, text: string, options: {
    stage: string;
    position: number;
    features?: Iterable<string>;
    autoFeatures?: boolean;
}): Trace;
/**
 * A trace as text.
 * @param {Trace} traced
 * @returns {string}
 */
export declare function formatTrace(traced: Trace): string;
