/**
 * @template K,V
 * @extends {Map<K,V>}
 */
export declare class Recent<K, V> extends Map<K, V> {
    limit: number;
    maxSize: number;
    /** @type {Map<K,number>} */
    sizes: Map<K, number>;
    totalSize: number;
    /** @param {number} limit @param {number} maxSize */
    constructor(limit: number, maxSize: number);
    /** @override @param {K} key @returns {V | undefined} */
    get(key: K): V | undefined;
    /** @override @param {K} key @param {V} value @param {number} [size] @returns {this} */
    set(key: K, value: V, size?: number): this;
    /** @override @param {K} key @returns {boolean} */
    delete(key: K): boolean;
    /** @override */
    clear(): void;
}
