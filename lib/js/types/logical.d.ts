import type { GrammarSymbol } from "./types.js";
export type LogicalSymbol = {
    from: number;
    to: number;
    symbol?: GrammarSymbol;
    children?: LogicalSymbol[];
    written?: object;
};
/** @param {{symbol:GrammarSymbol}[]} sequence @returns {LogicalSymbol[]} */
export declare function logicalOf(sequence: {
    symbol: GrammarSymbol;
}[]): LogicalSymbol[];
/** @param {object} sequence @param {LogicalSymbol[]} left @param {LogicalSymbol[]} right @param {number} offset */
export declare function joinedLogical(sequence: object, left: LogicalSymbol[], right: LogicalSymbol[], offset: number): void;
/** @param {{symbol:GrammarSymbol}[]} sequence @param {object} written */
export declare function optionalLogical(sequence: {
    symbol: GrammarSymbol;
}[], written: object): void;
/** @param {LogicalSymbol[]} logical @returns {number|null} */
export declare function inheritedIndex(logical: LogicalSymbol[]): number | null;
