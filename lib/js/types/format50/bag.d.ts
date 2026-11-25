/** The entry of a key with no value. */
export declare const BARE: Readonly<{
    bare: true;
}>;
/**
 * A written value whose expression runs once, and only when a reader needs
 * the payload.
 */
export declare class Deferred {
    compute: () => any;
    done: boolean;
    payload: any;
    /** @param {() => any} compute */
    constructor(compute: () => any);
    force(): any;
}
/** An entry with a value. */
export declare function valued(payload: any): {
    deferred: Deferred;
};
export declare class Bag {
    /** @type {any[]} */
    writes: any[];
    /** @type {Map<string, any>} */
    resolved: Map<string, any>;
    /** @type {string[] | null} */
    keyList: string[] | null;
    /** @type {Set<string>} */
    resolving: Set<string>;
    constructor();
    /** A bag that holds these entries, in key order. */
    static from(entries: any): Bag;
    /**
     * Writes one entry under each key.
     * @param {string[]} keys
     * @param {any} entry BARE, or an entry with a value
     * @param {(() => boolean) | null} guard
     */
    write(keys: string[], entry: any, guard: (() => boolean) | null): void;
    /** Writes the entry that `source` has for `key`, where it has one. */
    copy(key: any, source: any, guard: any): void;
    /** Removes a key. */
    delete(key: any, guard: any): void;
    /**
     * Writes each entry of a bag as it is.
     * @param {() => Bag} source
     */
    splat(source: () => Bag, guard: any): void;
    /**
     * The winning entry for a key, or null where the key is absent.
     * @param {string} key
     */
    entry(key: string): any;
    resolve(key: any): any;
    has(key: any): boolean;
    hasValue(key: any): boolean;
    /** The payload of a key, or undefined where it has none. */
    value(key: any): any;
    /** The present keys, in code point order. */
    keys(): string[];
    get size(): number;
}
/** A bag of bare keys. */
export declare function keySet(keys: any): Bag;
/** Whether every present entry of a bag has no value. */
export declare function isKeySet(bag: any): any;
