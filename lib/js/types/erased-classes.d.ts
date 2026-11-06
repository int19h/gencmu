export type Item = import('./types.js').Item;
export type EdgeGroup = {
    indices: number[];
    erased: boolean;
};
/** @typedef {import('./types.js').Item} Item */
/** @typedef {{indices:number[],erased:boolean}} EdgeGroup */
export declare class ErasedClasses {
    /** @type {WeakMap<object,number>} */ ids: WeakMap<object, number>;
    /** @type {WeakMap<object,string>} */ keys: WeakMap<object, string>;
    next: number;
    constructor();
    /** @param {object} object */
    id(object: object): number;
    /** @param {Item} item */
    key(item: Item): string;
    /** @param {import('./types.js').Edge[]} edges @param {Set<number>|null|undefined} [mask] @returns {EdgeGroup[]} */
    groups(edges: import('./types.js').Edge[], mask?: Set<number> | null | undefined): EdgeGroup[];
    /** @param {Item[]} roots @returns {number[][]} */
    roots(roots: Item[]): number[][];
}
