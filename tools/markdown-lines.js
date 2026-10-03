// One reading of the Markdown layout that the repository's documents use,
// for the tools that check their prose (tools/prose-lines.js,
// tools/quoted-texts.js). It models only that layout: headings,
// paragraphs, list items nested to any depth, table rows, and fenced
// blocks at the top level or in a list item. Any other layout, such as a
// quote, an HTML block, an indented code block or a tab before a line's
// text, is an error of its line, so that no tool reads it as something
// else and passes it in silence.

/**
 * @typedef {object} MarkdownLine
 * @property {number} line the line number, counted from 1
 * @property {string} text the whole line
 * @property {number} indent the container's indentation: the column where
 *   the text of the list item that holds the line begins, or 0
 * @property {string} content the line without that indentation
 * @property {"blank" | "heading" | "paragraph" | "item" | "table" | "fence-open" | "fence" | "fence-close" | "unmodelled"} kind
 *   `item` is a line that begins a list item, and `fence` a line inside a
 *   fenced block
 * @property {string} [error] why the line is `unmodelled`
 */

/**
 * The fence that a line's content opens, as Markdown reads it: three
 * backticks or tildes or more, and after backticks no other backtick on
 * the line. So a line that begins with a code span of three backticks
 * opens no fence.
 * @param {string} content
 * @returns {string | null}
 */
export function fenceOf(content) {
  const fence = /^(`{3,}|~{3,})(.*)$/.exec(content);
  if (!fence || (fence[1][0] === "`" && fence[2].includes("`"))) return null;
  return fence[1];
}

/**
 * Each line of `markdown`, classified.
 * @param {string} markdown
 * @returns {MarkdownLine[]}
 */
export function classifyLines(markdown) {
  /** @type {MarkdownLine[]} */
  const lines = [];
  // The text columns of the open list items, innermost last.
  /** @type {number[]} */
  const items = [];
  /** @type {{fence: string, indent: number, line: number} | null} */
  let fence = null;
  const texts = markdown.split(/\r\n|\r|\n/);
  // A final line break ends the last line; it begins no line of its own.
  if (texts.length > 1 && texts[texts.length - 1] === "") texts.pop();
  texts.forEach((text, index) => {
    const line = index + 1;
    /** @param {MarkdownLine["kind"]} kind @param {number} indent @param {string} [error] */
    const push = (kind, indent, error) => {
      const entry = { line, text, indent, content: text.slice(Math.min(indent, text.length)), kind };
      if (error) entry.error = error;
      lines.push(/** @type {MarkdownLine} */ (entry));
    };
    const spaces = /^ */.exec(text)[0].length;
    const blank = !text.trim();
    if (fence) {
      // A fenced block lies inside its container: a line indented less
      // than the container, unless blank, ends the container and so the
      // block, which the layout does not allow.
      if (!blank && spaces < fence.indent) {
        push("unmodelled", spaces, `the fenced block opened on line ${fence.line} ends with its list item, before its closing fence`);
        fence = null;
        return;
      }
      const content = text.slice(Math.min(fence.indent, text.length));
      const close = /^(`{3,}|~{3,})\s*$/.exec(content);
      if (close && close[1][0] === fence.fence[0] && close[1].length >= fence.fence.length) {
        push("fence-close", fence.indent);
        fence = null;
      } else push("fence", fence.indent);
      return;
    }
    if (blank) { push("blank", items.length ? items[items.length - 1] : 0); return; }
    if (/^ *\t/.test(text)) { push("unmodelled", spaces, "a tab before the text of a line"); return; }
    // The list items that this line's indentation leaves.
    while (items.length && spaces < items[items.length - 1]) items.pop();
    const indent = items.length ? items[items.length - 1] : 0;
    const content = text.slice(indent);
    const marker = /^ *([-*+]|\d{1,9}[.)]) +(?=\S)/.exec(content);
    if (marker && spaces - indent < 4) {
      items.push(indent + marker[0].length);
      push("item", indent);
      return;
    }
    if (spaces > indent) { push("unmodelled", indent, "text indented within its container, as an indented code block or a lazy line"); return; }
    const opened = fenceOf(content);
    if (opened) {
      fence = { fence: opened, indent, line };
      push("fence-open", indent);
      return;
    }
    if (/^#{1,6}(\s|$)/.test(content)) push("heading", indent);
    else if (content.startsWith("|")) push("table", indent);
    else if (/^(>|<|\[[^\]]+\]:\s|([-*_=])( *\2){2,} *$)/.test(content)) push("unmodelled", indent, "a quote, an HTML block, a link reference definition, a thematic break or a heading underline");
    else push("paragraph", indent);
  });
  if (fence) {
    const { line } = fence;
    lines.push({ line: texts.length + 1, text: "", indent: fence.indent, content: "", kind: "unmodelled", error: `the fenced block opened on line ${line} has no closing fence` });
  }
  return lines;
}
