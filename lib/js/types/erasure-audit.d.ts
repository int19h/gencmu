/** @param {import('./grammar.js').Grammar} grammar
 * @param {(alternative:import('./grammar.js').StitchedAlternative)=>boolean} emits
 * @returns {{rule:string,document:string,line:number,column:number,alternative:number,kind:'semantic'|'inert',effects:string[]}[]} */
export declare function erasureAudit(grammar: import('./grammar.js').Grammar, emits: (alternative: import('./grammar.js').StitchedAlternative) => boolean): {
    rule: string;
    document: string;
    line: number;
    column: number;
    alternative: number;
    kind: 'semantic' | 'inert';
    effects: string[];
}[];
