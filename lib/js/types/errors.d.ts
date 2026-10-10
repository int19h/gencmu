export declare class GencmuError extends Error {
    kind: "grammar" | "usage";
    where: import("./types.js").ErrorLocation;
    code: string | undefined;
    group: import("./ranked.js").GroupSite | undefined;
    option: number | undefined;
    expression: unknown;
    inheritance: import("./ranked.js").GroupSite[] | undefined;
    /**
     * @param {"grammar" | "usage"} kind a grammar that cannot be loaded or
     *   run, or a caller's mistake such as an unknown stage name
     * @param {string} message
     * @param {import("./types.js").ErrorLocation} [where]
     * @param {{cause?: unknown}} [options] the error that caused this one
     */
    constructor(kind: "grammar" | "usage", message: string, where?: import("./types.js").ErrorLocation, options?: {
        cause?: unknown;
    });
    toJSON(): {
        kind: "grammar" | "usage";
        code?: string | undefined;
        message: string;
        group?: import("./ranked.js").GroupSite | undefined;
        option?: number | undefined;
        expression?: {} | null | undefined;
        inheritance?: import("./ranked.js").GroupSite[] | undefined;
    };
}
