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
export type Entry = typeof BARE | {
    deferred: Deferred;
};
/**
 * A key with no value, or a key with a value that runs on demand.
 * @typedef {typeof BARE | {deferred: Deferred}} Entry
 */
/**
 * An entry with a value.
 * @param {any} payload a payload, or a deferred computation of one
 * @returns {Entry}
 */
export declare function valued(payload: any): Entry;
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
    /**
     * A bag that holds these entries, in key order.
     * @param {Iterable<[string, Entry]>} entries
     */
    static from(entries: Iterable<[string, Entry]>): Bag;
    /**
     * Writes one entry under each key.
     * @param {string[]} keys
     * @param {any} entry BARE, or an entry with a value
     * @param {(() => boolean) | null} guard
     */
    write(keys: string[], entry: any, guard: (() => boolean) | null): void;
    /**
     * Writes the entry that `source` has for `key`, where it has one.
     * @param {string} key
     * @param {() => Bag} source
     * @param {(() => boolean) | null} guard
     */
    copy(key: string, source: () => Bag, guard: (() => boolean) | null): void;
    /**
     * Removes a key.
     * @param {string} key
     * @param {(() => boolean) | null} guard
     */
    delete(key: string, guard: (() => boolean) | null): void;
    /**
     * Writes each entry of a bag as it is.
     * @param {() => Bag} source
     * @param {(() => boolean) | null} guard
     */
    splat(source: () => Bag, guard: (() => boolean) | null): void;
    /**
     * The winning entry for a key, or null where the key is absent.
     * @param {string} key
     */
    entry(key: string): any;
    /**
     * @param {string} key
     * @returns {Entry | null}
     */
    resolve(key: string): Entry | null;
    /** @param {string} key */
    has(key: string): boolean;
    /** @param {string} key */
    hasValue(key: string): boolean;
    /**
     * The payload of a key, or undefined where it has none.
     * @param {string} key
     * @returns {any}
     */
    value(key: string): any;
    /** The present keys, in code point order. */
    keys(): string[];
    get size(): number;
}
/**
 * A bag of bare keys.
 * @param {Iterable<string>} keys
 */
export declare function keySet(keys: Iterable<string>): Bag;
/**
 * Whether every present entry of a bag has no value.
 * @param {Bag} bag
 */
export declare function isKeySet(bag: Bag): boolean;
