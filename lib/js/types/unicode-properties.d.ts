export type PropertyRange = {
    first: number;
    last: number;
    values: string[];
    line: number;
};
export type PropertyData = {
    kind: string;
    values: Set<string>;
    defaults: string[];
    ranges: PropertyRange[];
    line: number;
};
/**
 * Inspect a complete companion before any notation or cache use (engine §1).
 * @param {string} text
 * @param {{version:string|null,versionCount:number}} core
 * @returns {Map<string,PropertyData>}
 */
export declare function readProperties(text: string, core: {
    version: string | null;
    versionCount: number;
}): Map<string, PropertyData>;
