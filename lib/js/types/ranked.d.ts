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
};
export type VirtualPath = {
    steps: any[];
    captures: Map<string, {
        node: any;
        at: number;
    }>;
    ends: Map<RankedGroup, {
        at: number;
        option: number;
    }>;
};
/** @typedef {{document?:string, at?:[number,number], rule:string, alternative:number, path:string}} GroupSite */
/** @typedef {{id:number, site:GroupSite, expr:any, source:any, final:boolean, parent:string, helper:string}} RankedGroup */
/** @typedef {{steps:any[], captures:Map<string,{node:any,at:number}>, ends:Map<RankedGroup,{at:number,option:number}>}} VirtualPath */
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
    /** @type {WeakMap<object,RankedGroup>} */
    byExpression: WeakMap<object, RankedGroup>;
    /** @type {WeakMap<object,RankedGroup>} */
    owners: WeakMap<object, RankedGroup>;
    /** @type {WeakMap<object,string>} */
    paths: WeakMap<object, string>;
    sourceSites: WeakMap<object, any>;
    clauseErrors: Map<any, any>;
    /** @param {Map<string,import("./grammar.js").StitchedRule>} rules */
    constructor(rules: Map<string, import("./grammar.js").StitchedRule>);
    /** @param {RankedGroup} group @param {string} code @param {string} message @param {any} [fields] @returns {never} */
    fail(group: RankedGroup, code: string, message: string, fields?: any): never;
    /** @param {RankedGroup} group */
    validateClauses(group: RankedGroup): void;
    /** @param {import("./types.js").Production[]} productions */
    validateTags(productions: import("./types.js").Production[]): void;
}
/** @param {any} value @returns {Set<string>} */
export declare function rankedCaptureReads(value: any): Set<string>;
