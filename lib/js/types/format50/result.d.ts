/** The JSON value of a payload or a bag. */
export declare function propsJson(value: any): any;
/**
 * The canonical record of a format 50 result.
 * @param {any} result
 * @param {{stageTrees?: "compact" | "all"}} [options]
 */
export declare function resultRecord(result: any, options?: {
    stageTrees?: "compact" | "all";
}): {
    format: number;
    ok: any;
    input: {
        text: any;
        tokens: any;
    };
    stages: any;
    tree: any[] | null;
    error: {} | null;
};
/** The canonical JSON text of a format 50 result. */
export declare function resultJson50(result: any, options: any): string;
/**
 * Decodes the canonical JSON of a result and checks its references.
 * @param {string} text
 */
export declare function decodeResult50(text: string): any;
