import { Sources } from './tokens.js';
export type Count = number | bigint;
export type Measure = [Count, Count, Count];
/** @typedef {number|bigint} Count */
/** @typedef {[Count,Count,Count]} Measure */
/** @type {Measure} */
export declare const ZERO_MEASURE: Measure;
/** @param {Count} left @param {Count} right @returns {Count} */
export declare function addCount(left: Count, right: Count): Count;
/** @param {Measure} left @param {Measure} right @returns {Measure} */
export declare function sumMeasure(left: Measure, right: Measure): Measure;
/** Negative means that the left measure wins. @param {ArrayLike<any>} left @param {ArrayLike<any>} right */
export declare function compareMeasure(left: ArrayLike<any>, right: ArrayLike<any>): number;
/** @param {object} diagnostic @param {Measure} measure @param {object} [identity] */
export declare function recordDiagnostic(diagnostic: object, measure: Measure, identity?: object): object;
/** @param {object} diagnostic */
export declare function diagnosticRecord(diagnostic: object): {
    measure: Measure;
    identity: object;
};
/** @param {object} original @param {object} copy */
export declare function copyDiagnosticRecord(original: object, copy: object): object;
export declare class Measures {
    sources: Sources;
    /** @type {{measures:Measures,project:number[]}|null} */ original: {
        measures: Measures;
        project: number[];
    } | null;
    nonempty: number[];
    /** @type {Measure[]} */
    carried: Measure[];
    /** @param {import('./tokens.js').Token[]} tokens @param {Sources} [sources] */
    constructor(tokens: import('./tokens.js').Token[], sources?: Sources);
    /** @param {number} start @param {number} end @returns {Measure} */
    own(start: number, end: number): Measure;
}
