// The two things read from Markdown by code rather than by grammar: the
// `ebnf` blocks of a grammar document (engine §8), and the stages of a
// pipeline document (design, "Pipelines").

import { GencmuError } from "./errors.js";

// The grammar text of a document: its `ebnf` blocks joined with a newline,
// with the line and column of every code point in the document.
export function extractGrammarText(markdown, path) {
  const lines = splitLines(markdown);
  const chars = [];
  const positions = [];
  let inside = null;
  let first = true;
  for (let number = 0; number < lines.length; number++) {
    const line = lines[number];
    if (inside === null) {
      const open = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/.exec(line);
      if (open && open[2] === "ebnf") {
        inside = open[1];
        if (!first) {
          chars.push("\n");
          positions.push([number + 1, 1]);
        }
        first = false;
      } else if (open) {
        inside = { skip: open[1] };
      }
      continue;
    }
    const fence = typeof inside === "string" ? inside : inside.skip;
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
      inside = null;
      continue;
    }
    if (typeof inside !== "string") continue;
    let column = 1;
    for (const character of line) {
      chars.push(character);
      positions.push([number + 1, column++]);
    }
    chars.push("\n");
    positions.push([number + 1, column]);
  }
  if (inside !== null) {
    throw new GencmuError("grammar", `${path}: an unclosed code block`, { document: path });
  }
  return { text: chars.join(""), positions };
}

export function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

// The stages of a pipeline document, each a name and a list of document
// paths as written, relative to the pipeline document.
export function readPipeline(markdown, path) {
  const stages = [];
  const lines = splitLines(markdown);
  for (let number = 0; number < lines.length; number++) {
    const line = lines[number].replace(/\s+$/, "");
    const marker = /<\?([a-z]+)(?:\s+([^?]*?))?\s*\?>$/.exec(line);
    if (!marker) continue;
    const at = { document: path, line: number + 1, column: marker.index + 1 };
    if (marker[1] === "stage") {
      const name = (marker[2] || "").trim();
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) {
        throw new GencmuError("grammar", `${path}:${number + 1}: a stage needs a name, <?stage NAME?>`, at);
      }
      if (stages.some((stage) => stage.name === name)) {
        throw new GencmuError("grammar", `${path}:${number + 1}: two stages are named ${name}`, at);
      }
      stages.push({ name, documents: [] });
    } else if (marker[1] === "grammar") {
      if (stages.length === 0) {
        throw new GencmuError("grammar", `${path}:${number + 1}: a grammar before any stage`, at);
      }
      const link = /\[[^\]]*\]\(([^\s()\\]+)\)/.exec(line.slice(0, marker.index));
      if (!link) {
        throw new GencmuError("grammar", `${path}:${number + 1}: <?grammar?> needs a link [text](path) on its line`, at);
      }
      stages[stages.length - 1].documents.push(link[1]);
    }
  }
  if (stages.length === 0) {
    throw new GencmuError("grammar", `${path}: a pipeline document needs at least one <?stage NAME?>`, { document: path });
  }
  for (const stage of stages) {
    if (stage.documents.length === 0) {
      throw new GencmuError("grammar", `${path}: stage ${stage.name} has no <?grammar?> documents`, { document: path });
    }
  }
  return stages;
}

// A path relative to a document, resolved and normalized.
export function resolvePath(from, relative) {
  const parts = from.split("/").slice(0, -1);
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
