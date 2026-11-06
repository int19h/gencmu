export type Derivation = import('./types.js').Derivation;
export type Diagnostic = import('./types.js').ParseWarning;
export type DiagnosticLists = {
    errors: Diagnostic[];
    warnings: Diagnostic[];
};
export type DiagnosticEvent = {
    node: Derivation;
    diagnostic: Diagnostic;
    kind: 'errors' | 'warnings';
    own: boolean;
};
export type NodeInfo = {
    parent: Derivation | null;
    erased: boolean;
    scope: EmissionScope;
};
export type EmissionScope = {
    root: Derivation;
    rows: Carrier[];
    carrier: Carrier | null;
    unowned: DiagnosticLists;
};
export type Carrier = {
    token: import('./tokens.js').AttachedToken;
    span: import('./types.js').Span;
    part: Derivation | null;
    emission: Derivation;
    scope: EmissionScope;
    support: import('./types.js').Span | null;
    own: DiagnosticLists;
    groups: (EmissionScope | import('./tokens.js').AttachedToken)[];
};
/** @typedef {import('./types.js').Derivation} Derivation */
/** @typedef {import('./types.js').ParseWarning} Diagnostic */
/** @typedef {{errors:Diagnostic[],warnings:Diagnostic[]}} DiagnosticLists */
/** @typedef {{node:Derivation,diagnostic:Diagnostic,kind:'errors'|'warnings',own:boolean}} DiagnosticEvent */
/** @typedef {{parent:Derivation|null,erased:boolean,scope:EmissionScope}} NodeInfo */
/** @typedef {{root:Derivation,rows:Carrier[],carrier:Carrier|null,unowned:DiagnosticLists}} EmissionScope */
/** @typedef {{token:import('./tokens.js').AttachedToken,span:import('./types.js').Span,part:Derivation|null,emission:Derivation,scope:EmissionScope,support:import('./types.js').Span|null,own:DiagnosticLists,groups:(EmissionScope|import('./tokens.js').AttachedToken)[]}} Carrier */
/** @returns {DiagnosticLists} */
export declare function emptyDiagnostics(): DiagnosticLists;
/** @param {Diagnostic} diagnostic */
export declare function diagnosticIdentity(diagnostic: Diagnostic): object;
/** @param {DiagnosticLists[]} lists @returns {DiagnosticLists} */
export declare function joinDiagnostics(lists: DiagnosticLists[]): DiagnosticLists;
/** @param {import('./tokens.js').Token[]} tokens @param {number} [end] */
export declare function inputDiagnostics(tokens: import('./tokens.js').Token[], end?: number): DiagnosticLists;
/** @param {DiagnosticEvent[]} first @param {DiagnosticEvent[]} second @returns {DiagnosticLists} */
export declare function tiedDiagnostics(first: DiagnosticEvent[], second: DiagnosticEvent[]): DiagnosticLists;
export declare class DiagnosticFlow {
    root: import("./types.js").Derivation;
    input: import("./tokens.js").Token[];
    /** @type {Map<Derivation,NodeInfo>} */ nodes: Map<Derivation, NodeInfo>;
    /** @type {Derivation[]} */ order: Derivation[];
    /** @type {Map<Derivation,DiagnosticEvent>} */ own: Map<Derivation, DiagnosticEvent>;
    /** @type {DiagnosticEvent[]} */ evaluated: DiagnosticEvent[];
    /** @type {Map<Derivation,EmissionScope>} */ scopeRoots: Map<Derivation, EmissionScope>;
    /** @type {WeakMap<object,Carrier>} */ carriers: WeakMap<object, Carrier>;
    main: EmissionScope;
    scopes: EmissionScope[];
    /** @type {Map<EmissionScope,EmissionScope>} */ reportGroups: Map<EmissionScope, EmissionScope>;
    prefix: number[];
    next: any[];
    previous: number[];
    /** @param {Derivation} root @param {import('./tokens.js').Token[]} input */
    constructor(root: Derivation, input: import('./tokens.js').Token[]);
    /** @param {Derivation} node @returns {NodeInfo} */
    info(node: Derivation): NodeInfo;
    /** @param {Derivation} node @param {Diagnostic} diagnostic @param {'errors'|'warnings'} kind */
    add(node: Derivation, diagnostic: Diagnostic, kind: 'errors' | 'warnings'): void;
    /** @returns {DiagnosticLists} */
    messages(): DiagnosticLists;
    /** Surviving chosen preorder, before output-node omission. @returns {DiagnosticEvent[]} */
    events(): DiagnosticEvent[];
    /** @returns {DiagnosticLists} */
    collected(): DiagnosticLists;
    /** @param {Derivation} root @returns {EmissionScope} */
    attachment(root: Derivation): EmissionScope;
    /** @param {number} start @param {number} end */
    count(start: number, end: number): number;
    /** @param {import('./tokens.js').Token} token @param {Derivation|null} part @param {Derivation} emission @param {EmissionScope} scope */
    emitted(token: import('./tokens.js').Token, part: Derivation | null, emission: Derivation, scope: EmissionScope): {
        token: import("./tokens.js").Token;
        span: import("./types.js").Span;
        part: import("./types.js").Derivation | null;
        emission: import("./types.js").Derivation;
        scope: EmissionScope;
        support: import("./types.js").Span | null;
        own: DiagnosticLists;
        groups: never[];
    };
    /** @param {object} original @param {import('./tokens.js').AttachedToken} copy */
    attached(original: object, copy: import('./tokens.js').AttachedToken): void;
    /** @param {import('./tokens.js').Token} token @param {EmissionScope[]} before @param {EmissionScope[]} after @param {import('./tokens.js').AttachedToken[]} inheritedBefore @param {import('./tokens.js').AttachedToken[]} inheritedAfter */
    attachments(token: import('./tokens.js').Token, before: EmissionScope[], after: EmissionScope[], inheritedBefore: import('./tokens.js').AttachedToken[], inheritedAfter: import('./tokens.js').AttachedToken[]): void;
    /** @param {EmissionScope} scope @returns {DiagnosticLists} */
    all(scope: EmissionScope): DiagnosticLists;
    /** @returns {DiagnosticLists} */
    assign(): DiagnosticLists;
}
/** @type {WeakMap<object,{collected:DiagnosticLists,evaluated:DiagnosticLists}>} */
export declare const stageDiagnostics: WeakMap<object, {
    collected: DiagnosticLists;
    evaluated: DiagnosticLists;
}>;
