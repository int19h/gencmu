export type NameRecord = {
    code: number;
    name: string;
    kind: string;
    line: number;
};
export type NameAlgorithm = {
    kind: string;
    first: number;
    last: number;
    prefix: string;
    line: number;
};
import type { UnicodeTable } from "./unicode.js";
import type { GrammarDom } from "./types.js";
/** @typedef {{code:number, name:string, kind:string, line:number}} NameRecord */
/** @typedef {{kind:string, first:number, last:number, prefix:string, line:number}} NameAlgorithm */
/** @import { UnicodeTable } from "./unicode.js" */
/** @import { GrammarDom } from "./types.js" */
/** @param {string} path @param {GrammarDom} dom @param {string[]} [inherited] @returns {string[]} */
export declare function selectedNames(path: string, dom: GrammarDom, inherited?: string[]): string[];
export declare class UnicodeNames {
    path: string;
    /** @type {NameRecord[]} */
    records: NameRecord[];
    /** @type {Map<string, number>} */
    names: Map<string, number>;
    /** @type {Map<number, NameRecord>} */
    formal: Map<number, NameRecord>;
    /** @type {Set<string>} */
    aliases: Set<string>;
    /** @type {Set<number>} */
    scalars: Set<number>;
    /** @type {NameAlgorithm[]} */
    algorithms: NameAlgorithm[];
    /** @param {string} text @param {string} path @param {string} version */
    constructor(text: string, path: string, version: string);
    /** @param {string} name @returns {number | undefined} */
    lookup(name: string): number | undefined;
    /** @param {number} code @returns {boolean} */
    hasScalar(code: number): boolean;
    /** @param {UnicodeNames} pinned @param {Map<string, number>} abbreviations @param {boolean} extra */
    inspect(pinned: UnicodeNames, abbreviations: Map<string, number>, extra: boolean): void;
}
export declare class NamesScope {
    read: (path: string) => string;
    unicode: UnicodeTable;
    fingerprint: (text: string) => string;
    extras: string[];
    /** @type {UnicodeNames[] | null} */
    tables: UnicodeNames[] | null;
    /** @type {Record<string,string> | undefined} */
    dependencies: Record<string, string> | undefined;
    /**
     * @param {(path:string)=>string} read
     * @param {UnicodeTable} unicode
     * @param {(text:string)=>string} fingerprint
     * @param {Iterable<string>} [extras]
     */
    constructor(read: (path: string) => string, unicode: UnicodeTable, fingerprint: (text: string) => string, extras?: Iterable<string>);
    load(): void;
    /** @param {string} name @param {boolean} [coreOnly] @returns {number | undefined} */
    lookup(name: string, coreOnly?: boolean): number | undefined;
}
