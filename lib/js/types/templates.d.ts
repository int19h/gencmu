export { hasUnresolved, argumentOfExpression, normalizeArgument } from "./template-nodes.js";
/** @param {any} n @param {any} unicode @returns {string} */
export declare function canonicalArgument(n: any, unicode: any): string;
/** @param {any[]} documents @param {any} unicode @returns {any} */
export declare function expandTemplates(documents: any[], unicode: any): any;
/** @param {any} grammar @returns {{templates:any[],instances:any[]}} */
export declare function templateAudit(grammar: any): {
    templates: any[];
    instances: any[];
};
