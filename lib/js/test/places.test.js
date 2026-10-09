// The places of the shared fixtures (tests/README.md, "Places in
// fixtures"): the helpers of every library's runner agree with
// tests/places.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findPlaces, positionOf, repository, substitute } from "./shared.js";

const places = JSON.parse(fs.readFileSync(path.join(repository, "tests", "places.json"), "utf8"));

test("a needle stands at its line and column, or stands nowhere or more than once", () => {
  for (const item of places.positions) {
    if (item.line === null) assert.throws(() => positionOf(item.text, item.needle), JSON.stringify(item));
    else assert.deepEqual(positionOf(item.text, item.needle), { line: item.line, column: item.column }, JSON.stringify(item));
  }
});

test("a find with wildcards finds its places, and a replace takes their positions", () => {
  for (const item of places.substitutions) {
    assert.equal(findPlaces(item.text, item.find).length, item.places, JSON.stringify(item));
    if (item.expect === null) assert.throws(() => substitute(item.text, item.find, item.replace), JSON.stringify(item));
    else assert.equal(substitute(item.text, item.find, item.replace), item.expect, JSON.stringify(item));
  }
});
