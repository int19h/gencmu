// Tag sets: a map from tag to strength, true for strong and false for weak.

export function tagSet(entries) {
  return new Map(entries || []);
}

export function strongTag(tag) {
  return new Map([[tag, true]]);
}

export function weakTag(tag) {
  return new Map([[tag, false]]);
}

// Every tag of either set, strong if it is strong in either.
export function tagUnion(left, right) {
  const result = new Map(left);
  for (const [tag, strong] of right) {
    result.set(tag, (result.get(tag) || false) || strong);
  }
  return result;
}

// The tags of the first set that are also in the second, with the first's
// strength.
export function tagIntersection(left, right) {
  const result = new Map();
  for (const [tag, strong] of left) {
    if (right.has(tag)) result.set(tag, strong);
  }
  return result;
}

// A stable, unambiguous string for a tag set: its tags in code point order,
// each with its strength.
export function tagKey(tags) {
  return JSON.stringify([...tags.keys()].sort(compareCodePoints).map((tag) => [tag, tags.get(tag)]));
}

export function sameTagNames(left, right) {
  if (left.size !== right.size) return false;
  for (const tag of left.keys()) if (!right.has(tag)) return false;
  return true;
}

// Orders strings by code point, as the specification requires, rather than
// by UTF-16 unit as JavaScript's default comparison does.
export function compareCodePoints(left, right) {
  const a = [...left];
  const b = [...right];
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function sortedTagObject(tags) {
  const result = {};
  for (const tag of [...tags.keys()].sort(compareCodePoints)) result[tag] = tags.get(tag);
  return result;
}
