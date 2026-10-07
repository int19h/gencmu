import type { Condition, ParseResult, Span, StageReport, Argument, Production } from "./types.js";
import type { Token } from "./tokens.js";
import type { Dialect } from "./dialect.js";
import type { TraceEvent } from "./earley.js";
import type { RuleChange } from "./grammar.js";
export type LineIndex = {
    characters: string[];
    breaks: number[];
};
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
 * Two blocks of text side by side.
 * @param {string} left
 * @param {string} right
 * @param {string} leftTitle
 * @param {string} rightTitle
 * @returns {string}
 */
export declare function sideBySide(left: string, right: string, leftTitle: string, rightTitle: string): string;
/**
 * The tie of a result explained: where its two readings first differ, both
 * readings as brackets, and both trees side by side. A tie ends the run, so
 * at most one stage has one. Empty when no stage ties.
 * @param {{text: string, stages: StageReport[]}} result
 * @returns {string}
 */
export declare function explainTies(result: {
    text: string;
    stages: StageReport[];
}): string;
/**
 * Each warning of a result (engine §12) as the feature it names and an
 * excerpt of the text the warned constituent covers.
 * @param {ParseResult} result
 * @returns {string}
 */
export declare function explainWarnings(result: ParseResult): string;
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
export type Notation = {
    term: Argument;
} | {
    condition: Condition;
};
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
    changes: RuleChange[];
    /**
     * rules that emit `ε` although nothing
     * under them could emit and no token could cover them
     */
    idleErasures: {
        rule: string;
        document: string;
    }[];
    /**
     * every membership of a key in a class
     * that an entry of a classifier adds or removes, in the order of the
     * first entry that touches it
     */
    memberships: Membership[];
};
export type Membership = {
    classifier: string;
    key: string;
    class: string;
    /**
     *   each entry that adds (`∈`) or removes (`∉`) it, in stitching order, with
     *   its gates as written
     */
    changes: {
        op: "∈" | "∉";
        gates: string;
        document: string;
        line: number;
        column: number;
    }[];
};
/**
 * What a grammar author should know about a dialect's grammars: per stage,
 * the rules nothing reaches, every rule a later document replaced or
 * extended, and `%emits ε` that changes nothing.
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
 * @param {{stage: string, position: number, features?: Iterable<string>, withoutFeatures?: Iterable<string>, autoFeatures?: boolean}} options
 * @returns {Trace}
 */
export declare function trace(dialect: Dialect, text: string, options: {
    stage: string;
    position: number;
    features?: Iterable<string>;
    withoutFeatures?: Iterable<string>;
    autoFeatures?: boolean;
}): Trace;
/**
 * A trace as text.
 * @param {Trace} traced
 * @returns {string}
 */
export declare function formatTrace(traced: Trace): string;
