import {countWork,hooks} from "./testing.js";

/** @typedef {{characters:string[],breaks:number[]}} LineIndex */

/**
 * @param {Iterable<string>} text
 * @returns {LineIndex}
 */
export function lineIndex(text) {
  /** @type {string[]} */
  const characters = [];
  for (const character of text) {
    if (hooks.work) countWork(hooks.work, "text");
    characters.push(character);
  }
  const breaks = [];
  for (let index = 0; index < characters.length; index++) {
    if (hooks.work) countWork(hooks.work, "text");
    const character = characters[index];
    if (character === "\n" || (character === "\r" && characters[index + 1] !== "\n")) breaks.push(index);
  }
  return { characters, breaks };
}

/** @param {LineIndex} lines @param {number} offset */
export function positionAt({breaks},offset) {
  // The number of breaks before the range's start, by binary search.
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    if (hooks.work) countWork(hooks.work, "text");
    const middle = (low + high) >> 1;
    if (breaks[middle] < offset) low = middle + 1;
    else high = middle;
  }
  return {line:low+1,column:offset-(low===0?0:breaks[low-1]+1)+1,lineStart:low===0?0:breaks[low-1]+1};
}

/**
 * @param {LineIndex} lines
 * @param {import("./types.js").Span} source code point range
 * @returns {{line: number, column: number, excerpt: string}}
 */
export function excerptAt({ characters, breaks }, source) {
  const {line,column,lineStart}=positionAt({characters,breaks},source[0]);
  let lineEnd = lineStart;
  while (lineEnd < characters.length && characters[lineEnd] !== "\n" && characters[lineEnd] !== "\r") {
    if (hooks.work) countWork(hooks.work, "text");
    lineEnd++;
  }
  const shown = characters.slice(lineStart, lineEnd).join("").replace(/\t/g, " ");
  const width = Math.max(1, Math.min(source[1], lineEnd) - source[0]);
  const gutter = `${line} | `;
  const excerpt = `${gutter}${shown}\n${" ".repeat(gutter.length - 2)}| ${" ".repeat(column - 1)}${"^".repeat(width)}`;
  return { line, column, excerpt };
}

