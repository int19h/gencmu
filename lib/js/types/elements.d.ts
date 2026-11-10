import type { GrammarSymbol } from "./types.js";
export type Element = {
    from: number;
    to: number;
    symbol?: GrammarSymbol;
    children?: Element[];
    written?: object;
};
/** @param {{symbol:GrammarSymbol}[]} sequence @returns {Element[]} */
export declare function elementsOf(sequence: {
    symbol: GrammarSymbol;
}[]): Element[];
/** @param {object} sequence @param {Element[]} left @param {Element[]} right @param {number} offset @param {boolean} [owned] */
export declare function joinedElements(sequence: object, left: Element[], right: Element[], offset: number, owned?: boolean): void;
/** @param {{symbol:GrammarSymbol}[]} sequence @param {object} written */
export declare function optionalElement(sequence: {
    symbol: GrammarSymbol;
}[], written: object): void;
/** @param {Element[]} elements @returns {number|null} */
export declare function inheritedIndex(elements: Element[]): number | null;
