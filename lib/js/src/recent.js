// A bounded map, from least to most recently used.
/**
 * @template K,V
 * @extends {Map<K,V>}
 */
export class Recent extends Map {
  /** @param {number} limit @param {number} maxSize */
  constructor(limit, maxSize) {
    super();
    this.limit = limit;
    this.maxSize = maxSize;
    /** @type {Map<K,number>} */
    this.sizes = new Map();
    this.totalSize = 0;
  }
  /** @override @param {K} key @returns {V | undefined} */
  get(key) {
    const value = super.get(key);
    if (super.has(key)) {
      super.delete(key);
      super.set(key, /** @type {V} */ (value));
    }
    return value;
  }
  /** @override @param {K} key @param {V} value @param {number} [size] @returns {this} */
  set(key, value, size = 0) {
    this.delete(key);
    super.set(key,value);
    this.sizes.set(key,size);
    this.totalSize += size;
    while (this.size > this.limit || this.totalSize > this.maxSize) {
      this.delete(/** @type {K} */ (this.keys().next().value));
    }
    return this;
  }
  /** @override @param {K} key @returns {boolean} */
  delete(key) {
    this.totalSize -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key);
    return super.delete(key);
  }
  /** @override */
  clear() {
    super.clear();
    this.sizes.clear();
    this.totalSize = 0;
  }
}
