import { Loader } from "../src/dialect.js";
import { readGrammarFile } from "./shared.js";

export function valueNotation(aliases) {
  const bootstrap = JSON.parse(readGrammarFile("notation/bootstrap.json"));
  const lexical = bootstrap.stages.find(stage => stage.name === "lexical").documents[0].dom;
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

export function valueLoader(testCase, file, compiled, LoaderClass = Loader) {
  const bootstrap = valueNotation(testCase.aliases);
  return new LoaderClass(relative => relative === file ? testCase.document
    : relative === "notation/bootstrap.json" ? bootstrap
    : relative === "compiled.json" ? compiled : readGrammarFile(relative));
}
