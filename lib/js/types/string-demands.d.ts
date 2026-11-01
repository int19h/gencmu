import type { Production } from "./types.js";
/** @param {Production[]} productions @returns {Map<number,Set<string>>} */
export declare function demandedStrings(productions: Production[]): Map<number, Set<string>>;
/** @param {Map<string,any>} rules */
export declare function validateConditionStrings(rules: Map<string, any>): void;
