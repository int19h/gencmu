import { Sources } from "./tokens.js";
import type { Argument, Condition, Edge, Expectation, LoweredGrammar, Production, Scope, Slot, TagSet, TermValue } from "./types.js";
import type { Token } from "./tokens.js";
import type { UnicodeTable } from "./unicode.js";
export type Chart = {
    sets: ChartSet[];
    start: number;
    end: number;
    /**
     * reads a set without
     * making it: a set the recognizer never reached is empty
     */
    setAt: (position: number) => ChartSet;
    /**
     * the last position whose set holds an item
     */
    furthest: number;
    context: ParseContext;
};
/**
 * @import { Argument, CharacterClass, Condition, Edge, Expectation, GrammarSymbol, LoweredGrammar, Production, Scope, Slot, SpanValue, TagSet, Term, TermValue } from "./types.js"
 * @import { Token } from "./tokens.js"
 * @import { UnicodeTable } from "./unicode.js"
 */
/**
 * A chart: one set per position of the span it was run over.
 * @typedef {object} Chart
 * @property {ChartSet[]} sets
 * @property {number} start
 * @property {number} end
 * @property {(position: number) => ChartSet} setAt reads a set without
 *   making it: a set the recognizer never reached is empty
 * @property {number} furthest the last position whose set holds an item
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
    /** Where each run of the tokens lies in the text (engine §1). */
    sources: Sources;
    sourceText: string[];
    unicode: UnicodeTable;
    interner: TagInterner;
    /**
     * Each token's phonemes lowercased, for the spellings of symbols,
     * computed when a spelling first looks at the token (engine §4).
     * @type {(string | undefined)[]}
     */
    sounds: (string | undefined)[];
    dots: number;
    /** @type {Map<string, boolean | TagSet>} */
    nested: Map<string, boolean | TagSet>;
    /** @type {Set<string>} */
    inProgress: Set<string>;
    /** Where the input of the recognition now running begins. */
    inputStart: number;
    /** Where it ends. */
    inputEnd: number;
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
    /**
     * for a drop, the spelling of the symbol the
     * item would have advanced over, which its span did not match
     */
    spelling?: string;
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
 * @property {string} [spelling] for a drop, the spelling of the symbol the
 *   item would have advanced over, which its span did not match
 */
export declare class Item {
    production: Production;
    dot: number;
    origin: number;
    slots: Slot[];
    tagId: number;
    end: number;
    previous: Item | null;
    child: Item | null;
    /** @type {Edge[] | null} */
    more: Edge[] | null;
    /**
     * @param {Production} production
     * @param {number} dot
     * @param {number} origin
     * @param {Slot[]} slots
     * @param {Item | null} previous
     * @param {Item | null} child
     */
    constructor(production: Production, dot: number, origin: number, slots: Slot[], previous: Item | null, child: Item | null);
    get complete(): boolean;
    /**
     * Every way the item was built, in the order they were found.
     * @returns {Edge[]}
     */
    get edges(): Edge[];
}
export declare class ChartSet {
    position: number;
    /** @type {Item[]} */
    items: Item[];
    /** @type {Map<number | string, Item>} */
    index: Map<number | string, Item>;
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
     * The rules predicted here with productions not made items, since they
     * begin with a terminal the next token does not carry; kept for saying
     * what could have come next (see expectedAt). A rule, not each of its
     * productions: a long text skips millions.
     * @type {string[]}
     */
    skipped: string[];
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
 * A symbol as the diagnostics write it: its name, followed by its spelling
 * in backticks if it has one, such as LE`la` (docs/output.md).
 * @param {{name: string, spelling?: string}} symbol
 * @returns {string}
 */
export declare function writtenSymbol(symbol: {
    name: string;
    spelling?: string;
}): string;
/**
 * Whether the tokens [from, to) sound like a spelling: their phonemes,
 * joined and lowercased, are exactly it (engine §4). A token with no
 * phonemes adds nothing, and a spelling is never empty, so neither such a
 * token alone nor an empty span matches.
 * @param {ParseContext} context
 * @param {string} spelling
 * @param {number} from
 * @param {number} to
 * @returns {boolean}
 */
export declare function spellingMatches(context: ParseContext, spelling: string, from: number, to: number): boolean;
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
 * A term's value (engine §10): a string, or a set, of strings or of tags.
 * The reader has made sure that the types agree, so a set's kind needs no
 * mark here.
 * @param {ParseContext} context
 * @param {Argument} term
 * @param {Scope} scope
 * @returns {TermValue}
 */
export declare function evaluate(context: ParseContext, term: Argument, scope: Scope): TermValue;
/**
 * @param {TermValue} value
 * @returns {Set<string>}
 */
export declare function asSet(value: TermValue): Set<string>;
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
