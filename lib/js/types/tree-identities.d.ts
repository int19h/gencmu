/** @param {any} root @returns {any[]} */
export declare function constituentComparisons(root: any): any[];
export type TreeDemand = {
    whole: boolean;
    parts: Set<number>;
    names: Set<string>;
    outer: Set<string>;
    parentPrefix: boolean;
    prefixUntil: number;
};
/** @param {any} production @returns {TreeDemand} */
export declare function localTreeDemand(production: any): TreeDemand;
/** @param {any} lowered @param {any} frames */
export declare function prepareTreeDemands(lowered: any, frames: any): void;
export declare class TreeIdentities {
    /** @type {Map<string,number>} */ ids: Map<string, number>;
    /** @type {{key:any[],empty:boolean}[]} */ nodes: {
        key: any[];
        empty: boolean;
    }[];
    /** @type {Map<number,string>} */ semanticNodes: Map<number, string>;
    /** @type {Map<number,string>} */ semanticSequences: Map<number, string>;
    /** @type {[number,number][]} */ sequences: [number, number][];
    /** @type {Map<string,number>} */ sequenceIds: Map<string, number>;
    /** @type {Map<string,number>} */ concatenations: Map<string, number>;
    emptyProjection: number;
    constructor();
    /** @param {any[]} key @param {boolean} [empty] */
    intern(key: any[], empty?: boolean): number;
    /** @param {number} prefix @param {number} node */
    append(prefix: number, node: number): number;
    /** @param {number} left @param {number} right */
    concat(left: number, right: number): number;
    /** @param {number} sequence @returns {number[]} */
    elements(sequence: number): number[];
    /** @param {number|undefined} identity @returns {string|null} */
    semantic(identity: number | undefined): string | null;
    /** @param {number} sequence @returns {string} */
    sequenceSemantic(sequence: number): string;
    /** @param {string} name @param {number} children */
    rule(name: string, children: number): number;
    /** @param {string} terminal @param {string} value */
    written(terminal: string, value: string): number;
    /** @param {string} terminal */
    omitted(terminal: string): number;
    /** @param {string[]} values */
    seal(values: string[]): number;
}
/** @param {any} context @param {string} terminal @param {number} at */
export declare function terminalIdentity(context: any, terminal: string, at: number): any;
/** @param {any} context @param {number} start @param {number} end */
export declare function sealIdentity(context: any, start: number, end: number): any;
/** @param {any} context @param {any} production @param {number} dot @param {any} previous @param {any} child @param {number} end */
export declare function treeStep(context: any, production: any, dot: number, previous: any, child: any, end: number): {
    treePrefix: any;
    treeIdentity: number;
    treeSequence: any;
} | null;
/** @param {any} lowered @returns {{comparison:any,production:any,cycle:string[]}|null} */
export declare function treeIdentityCycle(lowered: any): {
    comparison: any;
    production: any;
    cycle: string[];
} | null;
/** @param {any} context @param {any} root @returns {number} */
export declare function derivationIdentity(context: any, root: any): number;
