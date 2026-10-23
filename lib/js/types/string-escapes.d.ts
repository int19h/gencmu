import type { UnicodeTable } from "./unicode.js";
import type { NamesScope } from "./unicode-names.js";
import type { Token } from "./tokens.js";
import type { Position } from "./types.js";
/** @import { UnicodeTable } from "./unicode.js" */
/** @import { NamesScope } from "./unicode-names.js" */
/** @import { Token } from "./tokens.js" */
/** @import { Position } from "./types.js" */
export declare class DocumentStrings {
    path: string;
    unicode: UnicodeTable;
    names: NamesScope;
    position: (offset: number) => Position;
    /**
     * @param {string} path
     * @param {UnicodeTable} unicode
     * @param {NamesScope} names
     * @param {(offset:number)=>Position} position
     */
    constructor(path: string, unicode: UnicodeTable, names: NamesScope, position: (offset: number) => Position);
    /** @param {Token[]} tokens */
    inspect(tokens: Token[]): void;
    /** @param {Token} token @param {boolean} [path] @returns {string} */
    decode(token: Token, path?: boolean): string;
}
