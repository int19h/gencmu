export declare class GencmuError extends Error {
    kind: "grammar";
    where: import("./types.js").ErrorLocation;
    /**
     * @param {"grammar"} kind what went wrong; grammar errors are the only kind
     * @param {string} message
     * @param {import("./types.js").ErrorLocation} [where]
     */
    constructor(kind: "grammar", message: string, where?: import("./types.js").ErrorLocation);
}
