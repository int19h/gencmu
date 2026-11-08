export type Item = import('./types.js').Item;
export type EdgeGroup = {
    indices: number[];
    erased: boolean;
};
/** @typedef {import('./types.js').Item} Item */
/** @typedef {{indices:number[],erased:boolean}} EdgeGroup */
export declare class ErasedClasses {
    closes: import("./close-observations.js").CloseObservations | null;
    /** @type {WeakMap<object,number>} */ ids: WeakMap<object, number>;
    /** @type {WeakMap<object,string>} */ keys: WeakMap<object, string>;
    next: number;
    /** @param {import("./close-observations.js").CloseObservations|null} [closes] */
    constructor(closes?: import("./close-observations.js").CloseObservations | null);
    /** @param {object} object */
    id(object: object): number;
    /** @param {Item} item */
    key(item: Item): string;
    /** @param {import('./types.js').Edge[]} edges @param {Set<number>|null|undefined} [mask] @param {(item:Item)=>boolean} [eligible] @returns {EdgeGroup[]} */
    groups(edges: import('./types.js').Edge[], mask?: Set<number> | null | undefined, eligible?: (item: Item) => boolean): EdgeGroup[];
    /** @param {Item[]} roots @returns {number[][]} */
    roots(roots: Item[]): number[][];
}
