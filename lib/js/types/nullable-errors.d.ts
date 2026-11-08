/**
 * The first error alternative that can read no tokens. Gates, conditions,
 * and symbol tests cannot establish a positive width. Each dependency edge
 * participates in the least fixed point once, including recursive calls.
 * @param {Map<string,import('./grammar.js').StitchedRule>} rules
 * @param {{rule:import('./grammar.js').StitchedRule,alternative:import('./grammar.js').StitchedAlternative}[]} errors
 */
export declare function nullableError(rules: Map<string, import('./grammar.js').StitchedRule>, errors: {
    rule: import('./grammar.js').StitchedRule;
    alternative: import('./grammar.js').StitchedAlternative;
}[]): {
    rule: import('./grammar.js').StitchedRule;
    alternative: import('./grammar.js').StitchedAlternative;
} | undefined;
