export declare class GencmuError extends Error {
    kind: "grammar" | "usage";
    where: import("./types.js").ErrorLocation;
    /**
     * @param {"grammar" | "usage"} kind a grammar that cannot be loaded or
     *   run, or a caller's mistake such as an unknown stage name
     * @param {string} message
     * @param {import("./types.js").ErrorLocation} [where]
     */
    constructor(kind: "grammar" | "usage", message: string, where?: import("./types.js").ErrorLocation);
}
