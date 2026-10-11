import { Token } from "./tokens.js";
export type RestorationRecord = {
    terminal: string;
    at: number;
    source: [number, number];
    sound?: string;
};
/** @typedef {{terminal: string, at: number, source: [number, number], sound?: string}} RestorationRecord */
/**
 * @param {import("./tokens.js").Token[]} tokens
 * @param {RestorationRecord[]} records
 * @param {number[]} [order]
 * @param {boolean} [emptySourceIsSynthetic]
 */
export declare function restoreTokens(tokens: import("./tokens.js").Token[], records: RestorationRecord[], order?: number[], emptySourceIsSynthetic?: boolean): {
    restored: Token[];
    synthetic: boolean[];
    originalAt: number[];
    recordAt: number[];
    recordOf: (number | undefined)[];
    project: number[];
};
