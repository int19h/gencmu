/**
 * @param {any} root
 * @param {{name?:(name:string)=>boolean, terminal?:(name:string)=>boolean, test?:(test:any)=>string|null, depth?:number, deferDepth?:boolean}} [inspect]
 * @returns {string|null}
 */
export declare function layeredPatternProblem(root: any, inspect?: {
    name?: (name: string) => boolean;
    terminal?: (name: string) => boolean;
    test?: (test: any) => string | null;
    depth?: number;
    deferDepth?: boolean;
}): string | null;
/**
 * @param {any} root
 * @param {(term:any)=>string} term
 * @param {boolean} [literal]
 * @returns {string}
 */
export declare function layeredPatternText(root: any, term: (term: any) => string, literal?: boolean): string;
