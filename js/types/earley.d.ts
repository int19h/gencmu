import type { Argument, Condition, Edge, Expectation, LoweredGrammar, Production, Scope, Slot, TagSet, TermValue } from "./types.js";
import type { Token } from "./tokens.js";
import type { UnicodeTable } from "./unicode.js";
export type Chart = {
    sets: ChartSet[];
    start: number;
    end: number;
    setAt: (position: number) => ChartSet;
    context: ParseContext;
};
/**
 * @import { Argument, Condition, Edge, Expectation, LoweredGrammar, Production, Scope, Slot, SpanValue, TagSet, Term, TermValue } from "./types.js"
 * @import { Token } from "./tokens.js"
 * @import { UnicodeTable } from "./unicode.js"
 */
/**
 * A chart: one set per position of the span it was run over.
 * @typedef {object} Chart
 * @property {ChartSet[]} sets
 * @property {number} start
 * @property {number} end
 * @property {(position: number) => ChartSet} setAt
 * @property {ParseContext} context
 */
export declare class TagInterner {
    /** @type {TagSet[]} */
    sets: TagSet[];
    /** @type {Map<string, number>} */
    ids: Map<string, number>;
    constructor();
    /**
     * @param {TagSet} tags
     * @returns {number}
     */
    intern(tags: TagSet): number;
    /**
     * @param {number} id
     * @returns {TagSet}
     */
    get(id: number): TagSet;
}
export declare class ParseContext {
    lowered: LoweredGrammar;
    tokens: Token[];
    sourceText: string[];
    unicode: UnicodeTable;
    interner: TagInterner;
    /** @type {Map<string, boolean | TagSet>} */
    nested: Map<string, boolean | TagSet>;
    /** @type {Set<string>} */
    inProgress: Set<string>;
    /**
     * When set, the recognizer records what happens at one position of the
     * top-level parse, for diagnostics (see diagnostics.js, trace).
     * @type {{position: number, events: TraceEvent[], depth: number} | null}
     */
    trace: {
        position: number;
        events: TraceEvent[];
        depth: number;
    } | null;
    /**
     * @param {LoweredGrammar} lowered
     * @param {Token[]} tokens
     * @param {string[]} sourceText the text's code points
     * @param {UnicodeTable} unicode
     */
    constructor(lowered: LoweredGrammar, tokens: Token[], sourceText: string[], unicode: UnicodeTable);
}
export type TraceEvent = {
    kind: "predicted" | "advanced" | "completed" | "dropped";
    production: Production;
    /**
     * the dot of the item made, or of the item refused
     */
    dot: number;
    origin: number;
    /**
     * for a drop, the condition that failed
     */
    condition?: Condition;
};
/**
 * Something the recognizer did at the traced position: an item predicted,
 * advanced or completed there, or an advance that a condition refused.
 * @typedef {object} TraceEvent
 * @property {"predicted" | "advanced" | "completed" | "dropped"} kind
 * @property {Production} production
 * @property {number} dot the dot of the item made, or of the item refused
 * @property {number} origin
 * @property {Condition} [condition] for a drop, the condition that failed
 */
export declare class Item {
    production: Production;
    dot: number;
    origin: number;
    slots: Slot[];
    key: string;
    tagId: number;
    /** @type {Edge[]} */
    edges: Edge[];
    end: number;
    /**
     * @param {Production} production
     * @param {number} dot
     * @param {number} origin
     * @param {Slot[]} slots
     * @param {string} key
     */
    constructor(production: Production, dot: number, origin: number, slots: Slot[], key: string);
    get complete(): boolean;
}
export declare class ChartSet {
    position: number;
    /** @type {Item[]} */
    items: Item[];
    /** @type {Map<string, Item>} */
    index: Map<string, Item>;
    /** @type {Item[]} */
    queue: Item[];
    head: number;
    /** @type {Map<string, Item[]>} */
    waiting: Map<string, Item[]>;
    /** @type {Map<string, Item[]>} */
    nullable: Map<string, Item[]>;
    /** @type {Set<string>} the rules already predicted here */
    predicted: Set<string>;
    /**
     * Productions predicted here but not made items, since they begin with
     * a terminal the next token does not carry; kept for saying what could
     * have come next.
     * @type {Production[]}
     */
    skipped: Production[];
    /** @param {number} position */
    constructor(position: number);
}
/**
 * Runs the recognizer over tokens[start, end) with `rule` as the start rule.
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @returns {Chart}
 */
export declare function recognize(context: ParseContext, rule: string, start: number, end: number): Chart;
/**
 * The completed items of `rule` spanning [start, end).
 * @param {Chart} chart
 * @param {string} rule
 * @returns {Item[]}
 */
export declare function rootItems(chart: Chart, rule: string): Item[];
/**
 * @param {Token[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
export declare function phonemesOf(tokens: Token[], start: number, end: number): string;
/**
 * @param {ParseContext} context
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
export declare function textOf(context: ParseContext, start: number, end: number): string;
/**
 * @param {ParseContext} context
 * @param {Argument} term
 * @param {Scope} scope
 * @returns {TermValue}
 */
export declare function evaluate(context: ParseContext, term: Argument, scope: Scope): TermValue;
/**
 * @param {ParseContext} context
 * @param {Condition} condition
 * @param {Scope} scope
 * @returns {boolean}
 */
export declare function holds(context: ParseContext, condition: Condition, scope: Scope): boolean;
/**
 * @param {Chart} chart
 * @returns {{position: number, expected: Expectation[]}}
 */
export declare function rejectionOf(chart: Chart): {
    position: number;
    expected: Expectation[];
};
/**
 * The terminals the parse could have read at a position, each with the
 * rules whose items could have read it: the items there whose next symbol
 * is a terminal, and the predictions the lookahead did not make items of.
 * @param {Chart} chart
 * @param {number} position
 * @returns {Expectation[]}
 */
export declare function expectedAt(chart: Chart, position: number): Expectation[];
