#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fixtureProblems } from "./check-fixtures.js";
import { parseMarkdown, walk } from "./markdown.js";

const name = "tree-emission/pairs.json";
const bytes = readFileSync(new URL("../tests/" + name, import.meta.url));
const problems = fixtureProblems(name, bytes);
if (problems.length) throw new Error(problems.join("\n"));

const pairs = JSON.parse(bytes);

function verifyHeadings(directory) {
  const headings = new Map();
  let count = 0;
  for (const pair of pairs) {
    for (const { file, heading } of pair.manuals) {
      if (!headings.has(file)) {
        const text = readFileSync(path.join(directory, path.basename(file)), "utf8");
        const titles = [...walk(parseMarkdown(text))].filter(({ node }) => node.type === "heading")
          .map(({ node }) => [...walk(node)].map(({ node: part }) => part.value ?? "").join(""));
        headings.set(file, titles);
      }
      const matches = headings.get(file).filter((title) => title === heading);
      if (matches.length !== 1) throw new Error(`${pair.id}: expected one heading "${heading}" in ${file}`);
      count++;
    }
  }
  console.log(`Verified ${count} citations across ${pairs.length} fixture pairs in ${headings.size} manuals.`);
}

function describe({ expect }) {
  return expect.phase ? `${expect.outcome} (${expect.phase})` : expect.outcome;
}

function listCases(markdown) {
  if (markdown) {
    console.log("| Pair | Manual headings | Valid | Malformed | Controls |");
    console.log("| --- | --- | --- | --- | --- |");
  }
  for (const pair of pairs) {
    const citations = pair.manuals.map(({ file, heading }) => `${file} › ${heading}`).join(" / ");
    const controls = pair.controls ?? [];
    if (markdown) {
      console.log(`| \`${pair.id}\` | ${citations} | ${describe(pair.valid)} | ${describe(pair.malformed)} | ${controls.length} |`);
    } else {
      console.log(`${pair.id}/valid\t${describe(pair.valid)}\t${citations}`);
      console.log(`${pair.id}/malformed\t${describe(pair.malformed)}\t${citations}`);
      controls.forEach((control, index) => {
        console.log(`${pair.id}/control-${index + 1}\t${describe(control)}\t${citations}`);
      });
    }
  }
}

const args = process.argv.slice(2);
if (args.length === 2 && args[0] === "--check-manuals") verifyHeadings(args[1]);
else if (args.length === 0 || args.length === 1 && args[0] === "--markdown") listCases(args.length === 1);
else throw new Error("Use --markdown or --check-manuals DOCS.");
