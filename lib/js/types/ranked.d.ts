export type GroupSite = {
    document?: string;
    at?: [number, number];
    rule: string;
    alternative: number;
    path: string;
};
export type RankedGroup = {
    id: number;
    site: GroupSite;
    expr: any;
    source: any;
    final: boolean;
    parent: string;
    helper: string;
    captures: Set<string>;
};
export type Span = {
    productive: boolean;
    nonempty: boolean;
};
export type ProjectedPath = {
    length: number;
    span: Span;
    captures: Map<string, {
        owner: RankedGroup | null;
        at: number;
    }>;
    ends: Map<RankedGroup, {
        start: Span;
        at: number;
        option: number;
    }>;
    bindings: Map<string, RankedGroup>;
};
/** @typedef {{document?:string, at?:[number,number], rule:string, alternative:number, path:string}} GroupSite */
/** @typedef {{id:number, site:GroupSite, expr:any, source:any, final:boolean, parent:string, helper:string, captures:Set<string>}} RankedGroup */
/** @typedef {{productive:boolean,nonempty:boolean}} Span */
/** @typedef {{length:number,span:Span,captures:Map<string,{owner:RankedGroup|null,at:number}>,ends:Map<RankedGroup,{start:Span,at:number,option:number}>,bindings:Map<string,RankedGroup>}} ProjectedPath */
/** @type {WeakMap<object,[number,number]>} */
export declare const rankedLocations: WeakMap<object, [number, number]>;
/** @param {object} source @param {object} target */
export declare function copyRankedLocation(source: object, target: object): void;
/** @param {import("./types.js").GrammarDom} dom @param {{text:string}[]} tokens @param {(token:any)=>[number,number]} positionOf */
export declare function restoreRankedLocations(dom: import("./types.js").GrammarDom, tokens: {
    text: string;
}[], positionOf: (token: any) => [number, number]): void;
/** @param {{text:string}[]} tokens @param {number} at */
export declare function rankedSyntaxFailure(tokens: {
    text: string;
}[], at: number): boolean;
export declare class RankedGroups {
    /** @type {RankedGroup[]} */
    groups: RankedGroup[];
    rules: Map<string, import("./grammar.js").StitchedRule>;
    /** @type {WeakMap<object,{conditions:Set<string>[],exports:Set<string>,paths:Map<string,ProjectedPath[]>}>} */
    clauseAnalyses: WeakMap<object, {
        conditions: Set<string>[];
        exports: Set<string>;
        paths: Map<string, ProjectedPath[]>;
    }>;
    /** @type {ReturnType<typeof rankedWrittenSpans>|undefined} */
    spans: ReturnType<typeof rankedWrittenSpans> | undefined;
    /** @type {WeakMap<object,RankedGroup>} */
    byExpression: WeakMap<object, RankedGroup>;
    /** @type {WeakMap<object,RankedGroup>} */
    owners: WeakMap<object, RankedGroup>;
    /** @type {WeakMap<object,string>} */
    paths: WeakMap<object, string>;
    sourceSites: WeakMap<object, any>;
    /** @param {Map<string,import("./grammar.js").StitchedRule>} rules */
    constructor(rules: Map<string, import("./grammar.js").StitchedRule>);
    /** @param {RankedGroup} group @param {string} code @param {string} message @param {any} [fields] @returns {never} */
    fail(group: RankedGroup, code: string, message: string, fields?: any): never;
    /** @param {RankedGroup} group */
    validateClauses(group: RankedGroup): void;
    validate(): void;
}
/** @param {any} value @returns {Set<string>} */
export declare function rankedCaptureReads(value: any): Set<string>;
/** The selection binds absent descendants unless an active nested group does.
 * @param {RankedGroup} group @param {Iterable<RankedGroup>} nested */
export declare function rankedBoundCaptures(group: RankedGroup, nested: Iterable<RankedGroup>): Set<string>;
/** Finite structural derivations over a compact graph of written branches.
 * @param {Map<string,import("./grammar.js").StitchedRule>} rules
 */
declare function rankedWrittenSpans(rules: Map<string, import("./grammar.js").StitchedRule>): {
    productive: Set<any>;
    nonempty: Set<any>;
};
export {};
