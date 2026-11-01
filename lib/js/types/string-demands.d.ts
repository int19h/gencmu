import type { Production } from "./types.js";
/** @param {Production[]} productions @param {any[]} [seeds] @returns {Map<number,Set<string>>} */
export declare function demandedStrings(productions: Production[], seeds?: any[]): Map<number, Set<string>>;
/** @param {Production[]} productions */
export declare function validateConditionStrings(productions: Production[]): void;
