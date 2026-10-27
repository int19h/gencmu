import { Loader } from "../src/dialect.js";
import { readGrammarFile } from "./shared.js";

export function valueNotation(aliases) {
  const bootstrap = JSON.parse(readGrammarFile("data/preparsed/gencmu.json"));
  const lexical = bootstrap.documents["grammars/notation/lexical.md"].dom;
  for (const [index, alias] of aliases.entries()) {
    const name = `value-alias-${index}`;
    const tags = alias.tags.map(tag => ({tag}));
    lexical.rules.find(rule => rule.name === "piece").alternatives.push({guards: [], expr: {ref: name}});
    lexical.rules.push({
      name, op: "define", flags: ["leftmost-longest"], at: [100000 + index, 1], conditions: [],
      alternatives: [{guards: [], expr: {seq: [...alias.spelling].map(string => ({literal: {string}}))}}],
      emit: {items: [{capture: "", tags: tags.length === 1 ? tags[0] : {union: tags}, value: {concat: [{string: alias.value}]}}]},
    });
  }
  return JSON.stringify(bootstrap);
}

export function valueLoader(testCase, file, preparsed, LoaderClass = Loader) {
  const bootstrap = valueNotation(testCase.aliases);
  return new LoaderClass(relative => relative === file ? testCase.document
    : relative === "data/preparsed/gencmu.json" ? bootstrap
    : relative === "data/preparsed/test.json" ? preparsed : readGrammarFile(relative));
}
