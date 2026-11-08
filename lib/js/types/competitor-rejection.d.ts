export type Item = import('./earley.js').Item;
export type Production = import('./types.js').Production;
export type Advance = {
    next: Item;
    child: Item | null;
};
/** @param {import('./diagnostic-flow.js').DiagnosticFlow} flow @param {import('./earley.js').Chart} chart */
export declare function competitorRejections(flow: import('./diagnostic-flow.js').DiagnosticFlow, chart: import('./earley.js').Chart): void;
/** @param {import('./earley.js').Chart} chart @param {number} start @param {number} cap @param {Production} option
 * @returns {import('./types.js').CompetitorRejection|null} */
export declare function competitorSlice(chart: import('./earley.js').Chart, start: number, cap: number, option: Production): import('./types.js').CompetitorRejection | null;
