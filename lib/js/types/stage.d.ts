import { ParseContext } from "./earley.js";
import { Token } from "./tokens.js";
import type { Derivation, ResultNode, Span, StageReport, TagSet } from "./types.js";
import type { Grammar } from "./grammar.js";
import type { UnicodeTable } from "./unicode.js";
export type StageOptions = {
    features: Set<string>;
    elisionOnly: boolean | null | undefined;
    /**
     * whether this is the pipeline's last stage
     */
    last: boolean;
};
/**
 * @import { Action, Derivation, DerivationRule, ElidedNode, EmitItem, ResultNode, Scope, Span, StageReport, TagSet } from "./types.js"
 * @import { Grammar } from "./grammar.js"
 * @import { UnicodeTable } from "./unicode.js"
 */
/**
 * The options of one stage's run.
 * @typedef {object} StageOptions
 * @property {Set<string>} features
 * @property {boolean | null | undefined} elisionOnly
 * @property {boolean} last whether this is the pipeline's last stage
 */
export declare class Stage {
    name: string;
    grammar: Grammar;
    /**
     * @param {string} name
     * @param {Grammar} grammar
     */
    constructor(name: string, grammar: Grammar);
    /**
     * Runs the stage over `tokens`.
     * @param {Token[]} tokens
     * @param {string[]} sourceText the original text as an array of code points
     * @param {UnicodeTable} unicode
     * @param {StageOptions} options
     * @returns {StageReport}
     */
    run(tokens: Token[], sourceText: string[], unicode: UnicodeTable, options: StageOptions): StageReport;
    /**
     * Engine §7: the check of elision-only. It writes the chosen derivation's
     * elided terminators back into the stage's input as synthetic tokens and
     * recognizes that input, R, with the main lowering in the reconstruction
     * mode. Every observation reads the stage's input through the projection
     * π. The check passes where R has one derivation, and gives two readings
     * where it has more. With none, the witness of the chosen derivation is
     * lost.
     * @param {Derivation} chosen D, the chosen derivation
     * @param {ResultNode} tree D's tree
     * @param {ParseContext} main the context of the main parse, whose memo
     *   the check's queries share
     * @param {Set<string>} features
     * @returns {ElisionCheck}
     */
    elisionCheck(chosen: Derivation, tree: ResultNode, main: ParseContext, features: Set<string>): ElisionCheck;
}
export type RestorationRecord = {
    terminal: string;
    at: number;
    source: Span;
    sound?: string;
};
export type ElisionCheck = ({
    kind: "pass";
} | {
    kind: "ambiguous";
    readings: ResultNode[];
    witness: import("./types.js").Witness;
} | {
    kind: "lost";
    completion: RestorationRecord[];
}) & {
    competitorWarnings?: import("./types.js").ParseWarning[];
};
/**
 * The result tree of a derivation (engine §12), as a list: a spliced node
 * yields its children. The walk keeps its own stack, since a right-recursive
 * rule over a long text, such as paragraphs joined by `ni'o`, nests as deep
 * as the text is long.
 * @param {Derivation} root
 * @param {ParseContext} context
 * @returns {ResultNode[]}
 */
export declare function resultTree(root: Derivation, context: ParseContext): ResultNode[];
export type OpaquePart = {
    source: Span;
    text: string;
};
export type Emitter = {
    context: ParseContext;
    /**
     * the derivation's opaque
     * parts
     */
    opaque: Map<Derivation, OpaquePart>;
    /**
     * whether any input token has attachments
     */
    forwards: boolean;
    /**
     * the input
     * tokens whose attachments a token of this emission has inherited
     */
    inherited: Set<import("./tokens.js").AttachedToken>;
};
/**
 * A token's explicit tags with the tags of the stage's implications, added
 * until no tag changes (engine §11). An implication only adds tags, so the
 * closure ends, also over a cycle. A pass over every implication until none
 * adds a tag would settle one link of a chain per pass, so a worklist of the
 * tags added fires each implication at most once.
 * @param {TagSet} tags
 * @param {{if: TagSet, then: TagSet}[]} implications
 * @returns {TagSet}
 */
export declare function implied(tags: TagSet, implications: {
    if: TagSet;
    then: TagSet;
}[]): TagSet;
export type EmitTask = {
    walk: Derivation;
} | {
    run: () => void;
};
/**
 * @typedef {{walk: Derivation} | {run: () => void}} EmitTask
 */
/**
 * @param {Derivation} root
 * @param {ParseContext} context
 * @returns {Token[]}
 */
export declare function emit(root: Derivation, context: ParseContext): Token[];
