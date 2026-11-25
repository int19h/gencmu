import { Token } from "../tokens.js";
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
    recognizerToken(): Token;
}
/**
 * The capture slots of an alternative: whether each capture is one node or
 * a list of nodes (engine §3.5).
 * @param {any} body
 * @returns {Map<string, "one" | "list">}
 */
export declare function captureKinds(body: any): Map<string, "one" | "list">;
/**
 * Whether an alternative is one plain symbol (part 1 §5).
 * @param {any} node
 */
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
    /** @type {any[]} */
    closed: any[];
    /** @type {any[] | undefined} the %features directives, with their documents */
    featureDeclarations: any[] | undefined;
    /** @type {any[] | undefined} the errors of bridging, which a parse reports */
    loweringErrors: any[] | undefined;
    instanceNames: {
        grammar: any;
        names: Map<any, any>;
    } | undefined;
    /**
     * @param {string} name
     * @param {any} runs the bridged runs of the stage
     * @param {Map<string, any>} origins the format 50 records of each bridged alternative
     * @param {Map<string, any[]>} constants the versions of each constant of the stage
     * @param {any} makeGrammar
     */
    constructor(name: string, runs: any, origins: Map<string, any>, constants: Map<string, any[]>, makeGrammar: any);
    /**
     * The runs with each closed condition replaced by its truth.
     * @param {any} truth
     * @returns {any}
     */
    folded(truth: any): any;
    /**
     * The stage-local %features declarations, in their order (engine §13).
     * A declaration with conditions turns its features on where every
     * condition holds on the input span. A declaration without conditions
     * turns them on always. Returns a failed report on a conflict with a
     * feature that the caller turns off.
     * @param {any} tokens
     * @param {any} sourceText
     * @param {any} features
     * @param {any} off
     * @param {any} inputKeys
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
     * @param {any} data
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
    }): any;
    /**
     * The check of elision-only (engine §7), run by the format 49 checker on
     * the chosen derivation. Its readings become occurrence trees.
     * @param {any} report
     * @param {any} derivation
     * @param {any} root
     * @param {any} context
     * @param {any} lowered
     * @param {any} options
     */
    elisionOnly(report: any, derivation: any, root: any, context: any, lowered: any, options: any): void;
    /**
     * A query after the choice of a parse: its truth or its keys, by the
     * recognizer's evaluator on the derivation of the occurrence that the
     * query reads. The query's receiver starts at a capture or at `$`.
     * @param {any} data
     * @param {any} kind
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    lateQuery(data: any, kind: any, node: any, scope: any): any;
    /**
     * The messages of the chosen tree (engine §6): each %error, and each
     * %warning whose code is on and not suppressed, in preorder. Erased
     * subtrees evaluate no message.
     * @param {any} root
     * @param {any} data
     */
    diagnostics(root: any, data: any): {
        kind: string;
        node: any;
        diagnostic: {
            stage: string;
            code: any;
            rule: any;
            span: any[];
            source: any[];
            message: any;
        };
    }[];
    /**
     * Gives each report an owner among the output tokens (engine §6): the
     * first token whose input meets the report's input, else the first token
     * that starts at or after it, else the last token. An input token's
     * carried reports pass to the output token that covers it. A report with
     * no output token stays on the stage.
     * @param {any} report
     * @param {any} root
     * @param {any} data
     */
    assignDiagnostics(report: any, root: any, data: any): void;
    /**
     * @param {any} tokens
     * @param {any} sourceText
     * @param {any} options
     */
    stageData(tokens: any, sourceText: any, options: any): any;
    /** @param {any} data */
    inputKeySet(data: any): any;
    /**
     * The occurrence tree of a derivation.
     * @param {any} root
     * @param {any} data
     * @param {any} context
     */
    tree(root: any, data: any, context: any): any;
    /**
     * The effective name of a rule: an unnamed instance takes the canonical
     * spelling of its format 50 call (engine §2.3). A call whose arguments
     * still hold parameters keeps the recognizer's spelling.
     * @param {any} name
     * @param {any} data
     */
    effectiveName(name: any, data: any): any;
    /**
     * The records of a written alternative, by its definition and index.
     * @param {any} production
     * @param {any} source
     * @param {any} data
     */
    writtenOrigin(production: any, source: any, data: any): any;
    /**
     * The records of an alternative of a template instance: the template's
     * records with each parameter replaced by its argument.
     * @param {any} production
     * @param {any} source
     * @param {any} data
     * @returns {any}
     */
    instanceOrigin(production: any, source: any, data: any): any;
    /**
     * @param {any} derivation
     * @param {any} data
     */
    leaf(derivation: any, data: any): Occurrence;
    /**
     * @param {any} derivation
     * @param {any} parts
     * @param {any} made
     * @param {any} data
     */
    ruleOccurrence(derivation: any, parts: any, made: any, data: any): Occurrence;
    /**
     * @param {any} occurrence
     * @param {any} data
     */
    ruleBag(occurrence: any, data: any): Bag;
    /**
     * @param {any} tokens
     * @param {any} start
     * @param {any} end
     */
    sourceOf(tokens: any, start: any, end: any): any[];
    /**
     * @param {any} tokens
     * @param {any} at
     */
    emptySource(tokens: any, at: any): any;
    /**
     * The tokens that the root hands on (part 1 §10).
     * @param {any} root
     * @param {any} data
     */
    publish(root: any, data: any): (Token50 & {
        node: any;
    })[];
    /** @param {any} data */
    outputMask(data: any): Set<string>;
    /**
     * @param {any} node
     * @param {any} place
     * @param {any} data
     * @param {any} mask
     * @param {any} [insertedBy]
     */
    token(node: any, place: any, data: any, mask: any, insertedBy?: any): Token50;
}
