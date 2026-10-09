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
export type RankedReference = ReferenceSite & {
    expression: any;
    source: import("./grammar.js").StitchedAlternative;
};
export type SlotComponent = {
    id: number;
    names: Set<string>;
    parent: string;
    references: RankedReference[];
};
export type SlotVariant = {
    component: SlotComponent;
    reference: RankedReference;
    roles: Map<string, string>;
    holeNames: Set<string>;
    paths: WeakMap<object, string>;
    body: any;
};
/** @typedef {{document: string, at: [number, number], rule: string, alternative: number, path: string}} ReferenceSite */
/** @typedef {{kind: string, stage: string, rule?: string, higher?: string, lower?: string, container?: string, contained?: string, references: ReferenceSite[], message: string}} LoadWarning */
/** @typedef {{higher: string, lower: string, at: import("./types.js").ErrorLocation}} PreferenceDeclaration */
/** @typedef {ReferenceSite & {expression: any, source: import("./grammar.js").StitchedAlternative}} RankedReference */
/** @typedef {{id: number, names: Set<string>, parent: string, references: RankedReference[]}} SlotComponent */
/** @typedef {{component: SlotComponent, reference: RankedReference, roles: Map<string,string>, holeNames: Set<string>, paths: WeakMap<object,string>, body: any}} SlotVariant */
export declare class Preferences {
    /** @type {Map<string, Map<string, string[]>>} */
    paths: Map<string, Map<string, string[]>>;
    declarations: PreferenceDeclaration[];
    names: Set<string>;
    warnings: any[];
    /** @type {Map<string, SlotComponent>} */
    byName: Map<string, SlotComponent>;
    /** @type {Map<import("./grammar.js").StitchedAlternative, SlotVariant>} */
    variants: Map<import("./grammar.js").StitchedAlternative, SlotVariant>;
    /** @type {SlotComponent[]} */
    components: SlotComponent[];
    /** @type {Map<string,SlotVariant>} */
    ruleVariants: Map<string, SlotVariant>;
    /** @type {Map<import("./grammar.js").StitchedAlternative,Map<number,SlotVariant>>} */
    sourceVariants: Map<import("./grammar.js").StitchedAlternative, Map<number, SlotVariant>>;
    /** @param {string} stage @param {Map<string, import("./grammar.js").StitchedRule>} rules @param {PreferenceDeclaration[]} declarations */
    constructor(stage: string, rules: Map<string, import("./grammar.js").StitchedRule>, declarations: PreferenceDeclaration[]);
    /** @param {string} code @param {string} name @param {any} fields @param {string} message @returns {never} */
    fail(code: string, name: string, fields: any, message: string): never;
    /** @param {RankedReference} reference @param {SlotComponent} component @returns {SlotVariant} */
    template(reference: RankedReference, component: SlotComponent): SlotVariant;
    /** @param {import("./types.js").Production[]} productions */
    validate(productions: import("./types.js").Production[]): void;
    /** @param {import("./types.js").Production} p @param {SlotComponent} component @returns {SlotVariant | undefined} */
    variant(p: import("./types.js").Production, component: SlotComponent): SlotVariant | undefined;
    /** @param {SlotComponent} component @param {Set<string>} unsafe @param {any} expression @param {import("./types.js").Production[]} productions */
    requireEmpty(component: SlotComponent, unsafe: Set<string>, expression: any, productions: import("./types.js").Production[]): void;
}
