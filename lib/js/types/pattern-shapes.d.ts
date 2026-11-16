/**
 * @param {any} root
 * @param {{name?:(name:string)=>boolean, terminal?:(name:string)=>boolean, range?:(range:any)=>string|null, test?:(test:any)=>string|null, depth?:number, deferDepth?:boolean}} [inspect]
 * @returns {{problem:string, node:any}|null}
 */
export declare function layeredPatternFault(root: any, inspect?: {
    name?: (name: string) => boolean;
    terminal?: (name: string) => boolean;
    range?: (range: any) => string | null;
    test?: (test: any) => string | null;
    depth?: number;
    deferDepth?: boolean;
}): {
    problem: string;
    node: any;
} | null;
/**
 * @param {any} root
 * @param {{name?:(name:string)=>boolean, terminal?:(name:string)=>boolean, range?:(range:any)=>string|null, test?:(test:any)=>string|null, depth?:number, deferDepth?:boolean}} [inspect]
 * @returns {string|null}
 */
export declare function layeredPatternProblem(root: any, inspect?: {
    name?: (name: string) => boolean;
    terminal?: (name: string) => boolean;
    range?: (range: any) => string | null;
    test?: (test: any) => string | null;
    depth?: number;
    deferDepth?: boolean;
}): string | null;
/**
 * The fault of one pattern node or pattern item, without its children.
 * @param {any} node
 * @param {{name?:(name:string)=>boolean, terminal?:(name:string)=>boolean, range?:(range:any)=>string|null, test?:(test:any)=>string|null, depth?:number, deferDepth?:boolean, repeated?:boolean, inner?:boolean}} [inspect]
 * @param {boolean} [item]
 * @returns {{problem:string, node:any}|null}
 */
export declare function layeredPatternNodeFault(node: any, inspect?: {
    name?: (name: string) => boolean;
    terminal?: (name: string) => boolean;
    range?: (range: any) => string | null;
    test?: (test: any) => string | null;
    depth?: number;
    deferDepth?: boolean;
    repeated?: boolean;
    inner?: boolean;
}, item?: boolean): {
    problem: string;
    node: any;
} | null;
/**
 * The fault of one test operand of a pattern: a requirement entry
 * (`"requirement"`) or the operand of a value test (`"value"`). The
 * tested base is not inspected here.
 * @param {string} kind
 * @param {any} value
 * @param {{name?:(name:string)=>boolean, terminal?:(name:string)=>boolean, range?:(range:any)=>string|null, test?:(test:any)=>string|null, depth?:number, deferDepth?:boolean, repeated?:boolean, inner?:boolean}} [inspect]
 * @returns {{problem:string, node:any}|null}
 */
export declare function layeredPatternOperandFault(kind: string, value: any, inspect?: {
    name?: (name: string) => boolean;
    terminal?: (name: string) => boolean;
    range?: (range: any) => string | null;
    test?: (test: any) => string | null;
    depth?: number;
    deferDepth?: boolean;
    repeated?: boolean;
    inner?: boolean;
}): {
    problem: string;
    node: any;
} | null;
/**
 * @param {any} root
 * @param {(term:any)=>string} term
 * @param {boolean} [literal]
 * @returns {string}
 */
export declare function layeredPatternText(root: any, term: (term: any) => string, literal?: boolean): string;
