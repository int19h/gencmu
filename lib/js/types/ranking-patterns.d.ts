/** @param {any} pattern @returns {boolean} */
export declare function requiresElided(pattern: any): boolean;
/** @param {any} pattern @returns {string|null} */
export declare function rankingPatternProblem(pattern: any): string | null;
/** @param {any} pattern @returns {boolean} */
export declare function readsNodeTags(pattern: any): boolean;
/** @param {any} pattern @param {any} node @returns {boolean|null} */
export declare function possibleNodeMatch(pattern: any, node: any): boolean | null;
/** @param {any} pattern @returns {boolean} */
export declare function hasPatternValue(pattern: any): boolean;
/** @param {any} term @returns {Set<string>|null} */
export declare function knownTags(term: any): Set<string> | null;
/** @param {any} lowered @returns {boolean} */
export declare function canCountProfiles(lowered: any): boolean;
