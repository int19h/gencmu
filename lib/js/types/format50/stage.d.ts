import { Token as RecognizerToken } from "../tokens.js";
import { Bag } from "./bag.js";
import { Occurrence } from "./evaluate.js";
/** A token that a stage hands on, or a token of the origin table. */
export declare class Token50 {
    text: string;
    props: Bag;
    span: [number, number];
    source: [number, number];
    node: Occurrence | null;
    insertedBy: string | undefined;
    value: any;
    image: any;
    /**
     * @param {object} fields
     * @param {string} fields.text
     * @param {Bag} fields.props the public bag, with `value` and `image`
     * @param {[number, number]} fields.span
     * @param {[number, number]} fields.source
     * @param {Occurrence | null} [fields.node] the node that the token publishes
     * @param {string} [fields.insertedBy]
     */
    constructor({ text, props, span, source, node, insertedBy }: {
        text: string;
        props: Bag;
        span: [number, number];
        source: [number, number];
        node?: Occurrence | null;
        insertedBy?: string;
    });
    /** The token as the recognizer reads it: its visible keys and its value. */
    recognizerToken(): RecognizerToken;
}
/**
 * The capture slots of an alternative: whether each capture is one node or
 * a list of nodes (engine §3.5).
 * @param {any} body
 * @returns {Map<string, "one" | "list">}
 */
export declare function captureKinds(body: any): Map<string, "one" | "list">;
/** Whether an alternative is one plain symbol (part 1 §5). */
export declare function isPlainSymbol(node: any): any;
export declare class Stage50 {
    name: string;
    runs: any;
    origins: Map<string, any>;
    constants: Map<string, any[]>;
    makeGrammar: any;
    publishes: boolean;
    /** @type {Map<string, any>} the recognizer grammar for each outcome of the closed conditions */
    grammars: Map<string, any>;
    closed: any[];
    /**
     * @param {string} name
     * @param {import("../grammar.js").Grammar} grammar the recognizer's grammar
     * @param {Map<string, any>} origins the format 50 records of each bridged alternative
     * @param {Map<string, any[]>} constants the versions of each constant of the stage
     */
    constructor(name: string, runs: any, origins: Map<string, any>, constants: Map<string, any[]>, makeGrammar: any);
    /** The runs with each closed condition replaced by its truth. */
    folded(truth: any): any;
    /**
     * The stage-local %features declarations, in their order (engine §13).
     * A declaration with conditions turns its features on where every
     * condition holds on the input span. A declaration without conditions
     * turns them on always. Returns a failed report on a conflict with a
     * feature that the caller turns off.
     */
    declareFeatures(tokens: any, sourceText: any, features: any, off: any, inputKeys: any): {
        name: string;
        verdict: null;
        root: null;
        output: null;
        errors: never[];
        warnings: never[];
        input: any;
        error: import("../types.js").ParseError;
    } | {
        name: string;
        verdict: null;
        root: null;
        output: null;
        errors: never[];
        warnings: never[];
        input: any;
        error: {
            kind: string;
            stage: string;
            feature: any;
            message: string;
        };
    } | null;
    /**
     * The recognizer grammar, with each closed condition replaced by its
     * truth for these features and this input interface.
     */
    grammarFor(data: any): any;
    /**
     * Runs the stage over its input tokens.
     * @param {Token50[]} tokens
     * @param {string[]} sourceText
     * @param {any} unicode
     * @param {{features: Set<string>, inputKeys: Set<string>}} options
     */
    run(tokens: Token50[], sourceText: string[], unicode: any, options: {
        features: Set<string>;
        inputKeys: Set<string>;
    }): {
        name: string;
        verdict: null;
        witness: null;
        root: null;
        output: null;
        error: null;
        errors: never[];
        warnings: never[];
    };
    /**
     * The check of elision-only (engine §7), run by the format 49 checker on
     * the chosen derivation. Its readings become occurrence trees.
     */
    elisionOnly(report: any, derivation: any, root: any, context: any, lowered: any, options: any): void;
    /**
     * A query after the choice of a parse: its truth or its keys, by the
     * recognizer's evaluator on the derivation of the occurrence that the
     * query reads. The query's receiver starts at a capture or at `$`.
     */
    lateQuery(data: any, kind: any, node: any, scope: any): boolean | Bag;
    stageData(tokens: any, sourceText: any, options: any): {
        tokens: any;
        sourceText: any;
        features: any;
        constants: Map<string, any[]>;
        inputKeys: any;
        leaf: (token: any, index: any) => any;
    };
    inputKeySet(data: any): Bag;
    /**
     * The occurrence tree of a derivation.
     * @param {any} root
     */
    tree(root: any, data: any, context: any): any;
    /** The records of a written alternative, by its definition and index. */
    writtenOrigin(production: any, source: any, data: any): any;
    /**
     * The records of an alternative of a template instance: the template's
     * records with each parameter replaced by its argument.
     */
    instanceOrigin(production: any, source: any, data: any): any;
    leaf(derivation: any, data: any): Occurrence;
    ruleOccurrence(derivation: any, parts: any, made: any, data: any): Occurrence;
    ruleBag(occurrence: any, data: any): Bag;
    sourceOf(tokens: any, start: any, end: any): any[];
    emptySource(tokens: any, at: any): any;
    /** The tokens that the root hands on (part 1 §10). */
    publish(root: any, data: any): (Token50 & {
        node: any;
    })[];
    outputMask(data: any): Set<string>;
    token(node: any, place: any, data: any, mask: any, insertedBy: any): Token50;
}
