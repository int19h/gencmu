// Full grammar document editor on top of the vendored CodeMirror 6 bundle.
// Provides syntax colors for Markdown and jbogenbau code blocks, soft wrap
// with a 4ch hanging indent, line numbers on the first visual line of each
// wrapped line, error line marks in the margin, and current line highlight.

import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "./vendor/codemirror.js";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumberMarkers,
  lineNumbers,
} from "./vendor/codemirror.js";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "./vendor/codemirror.js";

const DEFINITION_DIRECTIVES = new Set([
  "%rule",
  "%extend-rule",
  "%redefine-rule",
  "%const",
  "%redefine-const",
  "%stage",
  "%extend-stage",
  "%redefine-stage",
  "%classifier",
]);

const markProse = Decoration.mark({ class: "pr" });
const markPunct = Decoration.mark({ class: "p" });
const markKeyword = Decoration.mark({ class: "k" });
const markDef = Decoration.mark({ class: "d" });
const markTerm = Decoration.mark({ class: "t" });

function tokenizeJbogenbauLine(text, lineFrom, builder, state) {
  let i = 0;
  const len = text.length;

  if (state.inBlockComment) {
    const closeIdx = text.indexOf("*)", i);
    if (closeIdx < 0) {
      if (len > 0) builder.add(lineFrom, lineFrom + len, markPunct);
      return;
    }
    builder.add(lineFrom, lineFrom + closeIdx + 2, markPunct);
    i = closeIdx + 2;
    state.inBlockComment = false;
  }

  while (i < len) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "-" && text[i + 1] === "-") {
      builder.add(lineFrom + i, lineFrom + len, markPunct);
      break;
    }

    if (ch === "(" && text[i + 1] === "*") {
      const closeIdx = text.indexOf("*)", i + 2);
      if (closeIdx < 0) {
        builder.add(lineFrom + i, lineFrom + len, markPunct);
        state.inBlockComment = true;
        break;
      }
      builder.add(lineFrom + i, lineFrom + closeIdx + 2, markPunct);
      i = closeIdx + 2;
      continue;
    }

    const rest = text.slice(i);

    if (ch === "%") {
      const dirMatch = /^%[A-Za-z][A-Za-z0-9_-]*/.exec(rest);
      if (dirMatch) {
        const dir = dirMatch[0];
        builder.add(lineFrom + i, lineFrom + i + dir.length, markKeyword);
        i += dir.length;
        if (DEFINITION_DIRECTIVES.has(dir)) {
          const wsMatch = /^[ \t]+/.exec(text.slice(i));
          if (wsMatch) i += wsMatch[0].length;
          const defMatch = /^[A-Za-z_][A-Za-z0-9_'-]*/.exec(text.slice(i));
          if (defMatch) {
            builder.add(lineFrom + i, lineFrom + i + defMatch[0].length, markDef);
            i += defMatch[0].length;
          }
        }
        continue;
      }
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < len && text[j] !== ch) {
        if (text[j] === "\\") j += 2;
        else j++;
      }
      if (j < len) j++;
      builder.add(lineFrom + i, lineFrom + j, markTerm);
      i = j;
      continue;
    }

    if (ch === "#") {
      const nextCh = text[i + 1] || "";
      if (nextCh === "·" || /[A-Za-z_]/.test(nextCh)) {
        const selMatch = /^#[^\s,()[\]{}]+/.exec(rest);
        if (selMatch) {
          i += selMatch[0].length;
          continue;
        }
      }
      builder.add(lineFrom + i, lineFrom + i + 1, markPunct);
      i++;
      continue;
    }

    if (ch === "$" || ch === "@") {
      const varMatch = /^[$@][A-Za-z_][A-Za-z0-9_'-]*/.exec(rest);
      if (varMatch) {
        i += varMatch[0].length;
        continue;
      }
    }

    const idMatch = /^[A-Za-z_][A-Za-z0-9_'-]*/.exec(rest);
    if (idMatch) {
      const id = idMatch[0];
      const code = id.charCodeAt(0);
      if (code >= 65 && code <= 90) {
        builder.add(lineFrom + i, lineFrom + i + id.length, markTerm);
      }
      i += id.length;
      continue;
    }

    const punctMatch = /^(?:[[\](){}|/+.:,;=<>&~^!*%?-]|≻|≺|≔|⇒|∪|∩|∖|¬|≅|≇|⁅|⁆|⋯|⋮|⋰|⋱)+/.exec(rest);
    if (punctMatch) {
      builder.add(lineFrom + i, lineFrom + i + punctMatch[0].length, markPunct);
      i += punctMatch[0].length;
      continue;
    }

    const cp = text.codePointAt(i);
    i += cp !== undefined && cp > 0xffff ? 2 : 1;
  }
}

function buildSyntaxDecorations(doc) {
  const builder = new RangeSetBuilder();
  const state = {
    fenceMode: null,
    inBlockComment: false,
  };

  for (let ln = 1; ln <= doc.lines; ln++) {
    const line = doc.line(ln);
    const text = line.text;
    const from = line.from;
    const to = line.to;

    if (state.fenceMode === null) {
      const openFence = /^\s*```(\S*)\s*$/.exec(text);
      if (openFence) {
        if (openFence[1] === "jbogenbau") {
          state.fenceMode = "jbogenbau";
          state.inBlockComment = false;
          if (to > from) builder.add(from, to, markPunct);
        } else {
          state.fenceMode = "other";
          if (to > from) builder.add(from, to, markProse);
        }
      } else if (to > from && text.trim().length > 0) {
        builder.add(from, to, markProse);
      }
    } else if (state.fenceMode === "other") {
      if (/^\s*```\s*$/.test(text)) {
        state.fenceMode = null;
      }
      if (to > from) builder.add(from, to, markProse);
    } else {
      if (/^\s*```\s*$/.test(text)) {
        state.fenceMode = null;
        state.inBlockComment = false;
        if (to > from) builder.add(from, to, markPunct);
      } else if (to > from) {
        tokenizeJbogenbauLine(text, from, builder, state);
      }
    }
  }

  return builder.finish();
}

const syntaxHighlightPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildSyntaxDecorations(view.state.doc);
    }
    update(update) {
      if (update.docChanged) {
        this.decorations = buildSyntaxDecorations(update.state.doc);
      }
    }
  },
  {
    decorations: (instance) => instance.decorations,
  }
);

const setErrorEffect = StateEffect.define();

class ErrorLineGutterMarker extends GutterMarker {
  constructor(line, message) {
    super();
    this.line = line;
    this.message = message;
    this.elementClass = "cm-errorLineGutter";
  }
  eq(other) {
    return (
      other instanceof ErrorLineGutterMarker &&
      this.line === other.line &&
      this.message === other.message
    );
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-errorLineNumber";
    span.setAttribute("aria-label", `${this.line}, error`);
    if (this.message) span.title = this.message;
    span.textContent = String(this.line);
    return span;
  }
}

function buildErrorState(doc, mark) {
  if (!mark || mark.line < 1 || mark.line > doc.lines) {
    return { mark: null, deco: Decoration.none, gutter: Decoration.none };
  }
  const lineObj = doc.line(mark.line);
  const decoBuilder = new RangeSetBuilder();
  decoBuilder.add(
    lineObj.from,
    lineObj.from,
    Decoration.line({
      class: "cm-errorLine",
      attributes: { "data-error-line": String(mark.line) },
    })
  );
  const gutterBuilder = new RangeSetBuilder();
  gutterBuilder.add(
    lineObj.from,
    lineObj.from,
    new ErrorLineGutterMarker(mark.line, mark.message)
  );
  return {
    mark,
    deco: decoBuilder.finish(),
    gutter: gutterBuilder.finish(),
  };
}

const errorStateField = StateField.define({
  create() {
    return { mark: null, deco: Decoration.none, gutter: Decoration.none };
  },
  update(value, tr) {
    let nextMark = value.mark;
    let changed = false;
    for (const effect of tr.effects) {
      if (effect.is(setErrorEffect)) {
        nextMark = effect.value;
        changed = true;
      }
    }
    if (!changed && !tr.docChanged) return value;
    return buildErrorState(tr.state.doc, nextMark);
  },
  provide(field) {
    return [
      EditorView.decorations.from(field, (val) => val.deco),
      lineNumberMarkers.from(field, (val) => val.gutter),
      EditorView.editorAttributes.from(field, (val) =>
        val.mark ? { class: "has-error-mark" } : null
      ),
    ];
  },
});

export function createFullEditor(container, options = {}) {
  container.replaceChildren();
  container.classList.remove("basic-editor");
  container.classList.add("full-editor");
  container.dataset.editorVariant = "full";
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Grammar document");

  const srError = document.createElement("span");
  srError.id = "editor-error-sr";
  srError.className = "sr-only";

  const changeListeners = new Set();
  if (typeof options.onChange === "function") changeListeners.add(options.onChange);

  const cursorListeners = new Set();
  if (typeof options.onCursorChange === "function") cursorListeners.add(options.onCursorChange);

  const labelCompartment = new Compartment();
  let suppressChange = false;

  function cursorFromState(state) {
    const head = state.selection.main.head;
    const lineObj = state.doc.lineAt(head);
    const column = [...lineObj.text.slice(0, head - lineObj.from)].length + 1;
    return {
      line: lineObj.number,
      column,
      offset: head,
      lineText: lineObj.text,
    };
  }

  function scrollEditorToOffset(offset, isPhone) {
    const applyScroll = () => {
      const block = view.lineBlockAt(offset);
      const viewHeight = view.scrollDOM.clientHeight || container.clientHeight || 720;
      view.scrollDOM.scrollTop = isPhone
        ? Math.max(0, block.top + 6)
        : Math.max(0, block.top - Math.floor(viewHeight / 3));
    };
    applyScroll();
    view.measure();
    applyScroll();
    view.measure();
  }

  function reportCursor(state) {
    const pos = cursorFromState(state);
    for (const fn of cursorListeners) fn(pos);
  }

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.selectionSet || update.docChanged) {
      reportCursor(update.state);
    }
    if (update.docChanged && !suppressChange) {
      const value = update.state.doc.toString();
      for (const fn of changeListeners) fn(value);
    }
  });

  const view = new EditorView({
    state: EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        keymap.of(defaultKeymap.concat(historyKeymap)),
        EditorView.lineWrapping,
        syntaxHighlightPlugin,
        errorStateField,
        labelCompartment.of(
          EditorView.contentAttributes.of({
            "aria-label": "Grammar document",
            "aria-describedby": "editor-error-sr",
            spellcheck: "false",
            autocapitalize: "off",
            autocomplete: "off",
            autocorrect: "off",
          })
        ),
        updateListener,
      ],
    }),
    parent: container,
  });

  container.appendChild(srError);

  return {
    variant: "full",
    capabilities: Object.freeze({
      syntaxColors: true,
      wrappedLineNumbers: true,
      marginMarks: true,
    }),
    view,
    getValue() {
      return view.state.doc.toString();
    },
    setValue(text) {
      const next = String(text ?? "");
      const current = view.state.doc.toString();
      suppressChange = true;
      try {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: next },
          selection: { anchor: 0 },
        });
      } finally {
        suppressChange = false;
      }
      view.scrollDOM.scrollTop = 0;
      reportCursor(view.state);
    },
    editValue(text) {
      const next = String(text ?? "");
      const current = view.state.doc.toString();
      if (next === current) return;
      const prevScrollTop = view.scrollDOM.scrollTop;
      let from = 0;
      const minLen = Math.min(current.length, next.length);
      while (from < minLen && current.charCodeAt(from) === next.charCodeAt(from)) {
        from++;
      }
      let curEnd = current.length;
      let nextEnd = next.length;
      while (curEnd > from && nextEnd > from && current.charCodeAt(curEnd - 1) === next.charCodeAt(nextEnd - 1)) {
        curEnd--;
        nextEnd--;
      }
      view.dispatch({
        changes: { from, to: curEnd, insert: next.slice(from, nextEnd) },
        selection: { anchor: nextEnd },
      });
      view.scrollDOM.scrollTop = prevScrollTop;
      view.measure();
    },
    getCursor() {
      return cursorFromState(view.state);
    },
    onChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
    onCursorChange(fn) {
      cursorListeners.add(fn);
      return () => cursorListeners.delete(fn);
    },
    goTo(line, column = 1) {
      const doc = view.state.doc;
      const ln = Math.max(1, Math.min(doc.lines, Math.trunc(line || 1)));
      const colGoal = Math.max(1, Math.trunc(column || 1));
      const lineObj = doc.line(ln);
      let rel = 0;
      let col = 1;
      while (rel < lineObj.text.length && col < colGoal) {
        const cp = lineObj.text.codePointAt(rel);
        rel += cp !== undefined && cp > 0xffff ? 2 : 1;
        col++;
      }
      const offset = lineObj.from + rel;
      const isPhone =
        typeof document !== "undefined" &&
        document.getElementById("app")?.classList.contains("phone");
      view.dispatch({
        selection: { anchor: offset },
      });
      scrollEditorToOffset(offset, isPhone);
      reportCursor(view.state);
    },
    markError(line, message = "", column = 1) {
      const ln = Math.max(1, Math.trunc(line || 1));
      const msg = String(message ?? "").split("\n")[0];
      const col = Math.max(1, Math.trunc(column || 1));
      srError.textContent = msg ? `Line ${ln}, error: ${msg}` : `Line ${ln}, error`;
      view.dispatch({
        effects: setErrorEffect.of({ line: ln, message: msg, column: col }),
      });
    },
    clearMarks() {
      srError.textContent = "";
      if (view.state.field(errorStateField).mark !== null) {
        view.dispatch({
          effects: setErrorEffect.of(null),
        });
      }
    },
    setLabel(label) {
      const text = String(label || "Grammar document");
      container.setAttribute("aria-label", text);
      view.dispatch({
        effects: labelCompartment.reconfigure(
          EditorView.contentAttributes.of({
            "aria-label": text,
            "aria-describedby": "editor-error-sr",
            spellcheck: "false",
            autocapitalize: "off",
            autocomplete: "off",
            autocorrect: "off",
          })
        ),
      });
    },
    focus() {
      view.focus();
    },
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.gencmuEditorFull = {
    createFullEditor,
  };
}
