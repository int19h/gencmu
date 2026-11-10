/** @param {any} body @returns {{body:any, mode:string, problem?:string}} */
export declare function queryBody(body: any): {
    body: any;
    mode: string;
    problem?: string;
};
/** @param {any} body @returns {any | null} */
export declare function queryCapture(body: any): any | null;
/** @param {any} body @returns {string} */
export declare function queryIdentity(body: any): string;
/** @param {any} body @returns {string[]} */
export declare function queryReferences(body: any): string[];
/** @param {any} lowered @param {any} body @returns {string} */
export declare function bodyTarget(lowered: any, body: any): string;
/** Remove binders without changing the element that a local query reads.
 * @param {any} value @returns {any} */
export declare function withoutBinders(value: any): any;
