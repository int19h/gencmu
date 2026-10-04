import { Sources } from "./tokens.js";
import type { Argument, Condition, Edge, Expectation, LoweredGrammar, Production, Scope, Captured, SpanValue, SymbolTest, TagSet, TermValue } from "./types.js";
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
 * @import { Argument, CharacterClass, Condition, Edge, Expectation, GrammarSymbol, LoweredGrammar, Production, Scope, Captured, SpanValue, SymbolTest, TagSet, Term, TermValue } from "./types.js"
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
    /** @type {Map<string, NonNullable<Captured>>} */
    captured: Map<string, NonNullable<Captured>>;
    /**
     * How the recognizer reads elidable optionals: null as engine §4 says,
     * "reconstruction" in the mode of engine §7.4, or "mandatory", the old
     * contract, where an elidable optional is never empty (a fault).
     * @type {null | "reconstruction" | "mandatory"}
     */
    mode: null | "reconstruction" | "mandatory";
    /**
     * For each token, whether it is a synthetic token of engine §7.2, by
     * its provenance; null where none is.
     * @type {boolean[] | null}
     */
    synthetic: boolean[] | null;
    /**
     * On the context of the reconstructed input of engine §7, how its
     * observations reach the stage's input; null elsewhere.
     * @type {Reconstruction | null}
     */
    recon: Reconstruction | null;
    /** Whether the check of engine §7 is running over this context's input. */
    checking: boolean;
    /**
     * Each token's phonemes in canonical form, for the sound tests of
     * symbols and for phonemes(), computed when one first looks at the
     * token (engine §4, §5).
     * @type {(string | undefined)[]}
     */
    sounds: (string | undefined)[];
    /**
     * For each position, the first token at or after it whose sound is not
     * empty, made on the first sound test. A test then skips a run of
     * silent tokens in one step, rather than walking it each time.
     * @type {Int32Array | null}
     */
    nextSounding: Int32Array | null;
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
     * @param {TagInterner} [interner] the interner of another context whose
     *   tag numbers this one shares, as the check of engine §7 shares the
     *   main parse's
     */
    constructor(lowered: LoweredGrammar, tokens: Token[], sourceText: string[], unicode: UnicodeTable, interner?: TagInterner);
}
export type Reconstruction = {
    /**
     * the context of O, the main parse's,
     * whose memo and active queries the check shares
     */
    observed: ParseContext;
    /**
     * π: for each position of R, the number of
     * original tokens before it
     */
    project: number[];
    /**
     * whether observations read R itself, as the old
     * contract did (a fault)
     */
    raw: boolean;
    /**
     * the contexts of queries
     * that a fault sends elsewhere, by fault
     */
    faulty: Map<string, ParseContext>;
};
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
     * for a drop, the test of the symbol the item
     * would have advanced over, which did not hold
     */
    test?: SymbolTest;
};
/**
 * How the recognition of the reconstructed input R observes the stage's
 * input O (engine §7.3, §7.5).
 * @typedef {object} Reconstruction
 * @property {ParseContext} observed the context of O, the main parse's,
 *   whose memo and active queries the check shares
 * @property {number[]} project π: for each position of R, the number of
 *   original tokens before it
 * @property {boolean} raw whether observations read R itself, as the old
 *   contract did (a fault)
 * @property {Map<string, ParseContext>} faulty the contexts of queries
 *   that a fault sends elsewhere, by fault
 */
/**
 * Something the recognizer did at the traced position: an item predicted,
 * advanced or completed there, or an advance that a condition refused.
 * @typedef {object} TraceEvent
 * @property {"predicted" | "advanced" | "completed" | "dropped"} kind
 * @property {Production} production
 * @property {number} dot the dot of the item made, or of the item refused
 * @property {number} origin
 * @property {Condition} [condition] for a drop, the condition that failed
 * @property {SymbolTest} [test] for a drop, the test of the symbol the item
 *   would have advanced over, which did not hold
 */
export declare class Item {
    production: Production;
    dot: number;
    origin: number;
    slots: Captured;
    tagId: number;
    end: number;
    previous: Item | null;
    child: Item | null;
    /** @type {Edge[] | null} */
    more: Edge[] | null;
    strict: boolean;
    restores: boolean;
    queued: boolean;
    /**
     * @param {Production} production
     * @param {number} dot
     * @param {number} origin
     * @param {Captured} slots
     * @param {Item | null} previous
     * @param {Item | null} child
     */
    constructor(production: Production, dot: number, origin: number, slots: Captured, previous: Item | null, child: Item | null);
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
    /**
     * The rules already predicted here, each with whether that prediction
     * was strict (engine §7.4).
     * @type {Map<string, boolean>}
     */
    predicted: Map<string, boolean>;
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
 * A symbol as the diagnostics write it: its name, followed by its test if
 * it has one, such as LE="la" (docs/output.md).
 * @param {{name: string, test?: SymbolTest | null}} symbol
 * @returns {string}
 */
export declare function writtenSymbol(symbol: {
    name: string;
    test?: SymbolTest | null;
}): string;
export type Reading = {
    last: Map<Production, number>;
};
/**
 * @param {LoweredGrammar} lowered
 * @returns {Reading}
 */
export declare function readingOf(lowered: LoweredGrammar): Reading;
/**
 * Whether a test holds of a symbol's own span, the tokens [from, to), and
 * its own tags (engine §4): a token's for a terminal, the completed item's
 * for a reference. An empty span sounds like the empty string.
 * @param {ParseContext} context
 * @param {SymbolTest} test
 * @param {number} from
 * @param {number} to
 * @param {TagSet} tags
 * @returns {boolean}
 */
export declare function testHolds(context: ParseContext, test: SymbolTest, from: number, to: number, tags: TagSet): boolean;
/**
 * The completed items of `rule` spanning [start, end).
 * @param {Chart} chart
 * @param {string} rule
 * @returns {Item[]}
 */
export declare function rootItems(chart: Chart, rule: string): Item[];
export type StepScope = {
    scope: ChartScope | null;
};
/** @implements {Scope} */
declare class ChartScope implements Scope {
    context: ParseContext;
    production: Production;
    slots: Captured;
    origin: number;
    end: number;
    /** @type {ParseContext | null} */
    reconstructed: ParseContext | null;
    observing: ParseContext;
    /** @type {SpanValue["space"]} */
    space: SpanValue["space"];
    /** @type {TagSet | null} the constituent's tags, once evaluated */
    tagSet: TagSet | null;
    /** @type {NonNullable<Captured>[] | null} every captured part by its index, once many are read */
    parts: NonNullable<Captured>[] | null;
    searched: number;
    /**
     * @param {ParseContext} context
     * @param {Production} production
     * @param {Captured} slots
     * @param {number} origin
     * @param {number} end
     */
    constructor(context: ParseContext, production: Production, slots: Captured, origin: number, end: number);
    /**
     * The constituent's tags, from its production's tag term, evaluated at
     * most once.
     * @returns {TagSet}
     */
    constituent(): TagSet;
    /**
     * @param {string} name
     * @returns {SpanValue}
     */
    capture(name: string): SpanValue;
}
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
export {};
