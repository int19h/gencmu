export type ReferenceSite = {
    document: string;
    at: [number, number];
    rule: string;
    alternative: number;
    path: string;
};
export type LoadWarning = {
    kind: string;
    stage: string;
    rule?: string;
    higher?: string;
    lower?: string;
    container?: string;
    contained?: string;
    references: ReferenceSite[];
    message: string;
};
export type PreferenceDeclaration = {
    higher: string;
    lower: string;
    at: import("./types.js").ErrorLocation;
};
/** @typedef {{document: string, at: [number, number], rule: string, alternative: number, path: string}} ReferenceSite */
/** @typedef {{kind: string, stage: string, rule?: string, higher?: string, lower?: string, container?: string, contained?: string, references: ReferenceSite[], message: string}} LoadWarning */
/** @typedef {{higher: string, lower: string, at: import("./types.js").ErrorLocation}} PreferenceDeclaration */
export declare class Preferences {
    /** @type {Map<string, Map<string, string[]>>} */
    paths: Map<string, Map<string, string[]>>;
    names: Set<string>;
    /** @type {LoadWarning[]} */
    warnings: LoadWarning[];
    /** @param {string} stage @param {Map<string, import("./grammar.js").StitchedRule>} rules @param {PreferenceDeclaration[]} declarations */
    constructor(stage: string, rules: Map<string, import("./grammar.js").StitchedRule>, declarations: PreferenceDeclaration[]);
}
