/** @param {import('./types.js').Derivation} root @param {Set<string>} demanded */
export declare function chosenBoundaries(root: import('./types.js').Derivation, demanded: Set<string>): {
    first: Map<number, Set<string>>;
    last: Map<any, any>;
};
/** @param {ReturnType<typeof chosenBoundaries>} boundaries @param {any} atom
 * @param {{start:number,end:number}} span */
export declare function chosenBoundary(boundaries: ReturnType<typeof chosenBoundaries>, atom: any, span: {
    start: number;
    end: number;
}): any;
