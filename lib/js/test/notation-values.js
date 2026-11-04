import { Loader } from "../src/pipeline.js";
import { readGrammarFile } from "./shared.js";

export function valueNotation(aliases) {
  const bootstrap = JSON.parse(readGrammarFile("data/preparsed/gencmu.json"));
  const lexical = bootstrap.documents["grammars/gencmu/jbogenbau/lexical.md"].dom;
  if (aliases.length) lexical.directives.find(directive => directive.name === "ambiguity-resolution").steps.unshift({ step: "leftmost-longest", pattern: aliases.length === 1 ? {name:"value-alias-0",exact:true,at:[1,1]} : {union:aliases.map((_,index)=>({name:`value-alias-${index}`,exact:true,at:[1,1]}))} });
  for (const [index, alias] of aliases.entries()) {
    const name = `value-alias-${index}`;
    const tags = alias.tags.map(tag => ({tag}));
    lexical.rules.find(rule => rule.name === "piece").alternatives.push({guards: [], expr: {ref: name}});
    lexical.rules.push({
      name, op: "define", at: [100000 + index, 1], conditions: [],
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
