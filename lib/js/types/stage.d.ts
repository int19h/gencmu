import { DiagnosticFlow } from "./diagnostic-flow.js";
import { ParseContext } from "./earley.js";
import { Token } from "./tokens.js";
import { StringWalk } from "./strings.js";
import type { Derivation, ResultNode, Span, StageReport, TagSet } from "./types.js";
import type { Grammar } from "./grammar.js";
import type { UnicodeTable } from "./unicode.js";
export type StageOptions = {
    features: Set<string>;
    elisionOnly: boolean | null | undefined;
    stageOrder?: number;
    pendingErrors?: boolean;
};
export declare class Stage {
    name: string;
    grammar: Grammar;
    stageChanges: import("./splice.js").StageChange[];
    /**
     * @param {string} name
     * @param {Grammar} grammar
     * @param {import("./splice.js").StageChange[]} [stageChanges]
     */
    constructor(name: string, grammar: Grammar, stageChanges?: import("./splice.js").StageChange[]);
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
     * π. Raw absence of the chosen witness gives witness loss. An admitted
     * witness that is solely best keeps the main result. Any other best
     * competitor gives an elision-only ambiguity.
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
    value?: string;
};
export type ElisionCheck = ({
    kind: "pass";
} | {
    kind: "ambiguous";
    readings: ResultNode[];
    witness?: import("./types.js").Witness;
} | {
    kind: "lost";
    completion: RestorationRecord[];
}) & {
    competitorWarnings?: import("./types.js").ParseWarning[];
};
/**
 * Evaluate own messages before erasure and preserve a prefix on failure (§12.1).
 * @param {DiagnosticFlow} flow @param {ParseContext} context
 * @param {Set<string>} features @param {string} stage @param {number} [stageOrder]
 */
export declare function evaluateDiagnostics(flow: DiagnosticFlow, context: ParseContext, features: Set<string>, stage: string, stageOrder?: number): void;
export type Emitter = {
    context: ParseContext;
    strings: StringWalk;
    forwards: boolean;
    inherited: Set<import("./tokens.js").AttachedToken>;
    trace: DiagnosticFlow;
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
    flow: import("./diagnostic-flow.js").EmissionScope;
} | {
    run: () => void;
};
/**
 * @typedef {{walk: Derivation,flow:import("./diagnostic-flow.js").EmissionScope} | {run: () => void}} EmitTask
 */
/**
 * @param {Derivation} root
 * @param {ParseContext} context
 * @param {DiagnosticFlow} [trace]
 * @returns {Token[]}
 */
export declare function emit(root: Derivation, context: ParseContext, trace?: DiagnosticFlow): Token[];
