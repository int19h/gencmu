// Basic grammar document editor backed by a plain <textarea>.
// Implements the playground editor interface without syntax colors, wrapped
// line numbers, or margin marks.

export function offsetToPosition(text, offset) {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  const column = [...text.slice(lineStart, clamped)].length + 1;
  let lineEnd = clamped;
  while (lineEnd < text.length && text.charCodeAt(lineEnd) !== 10) lineEnd++;
  return {
    line,
    column,
    offset: clamped,
    lineText: text.slice(lineStart, lineEnd),
  };
}

export function positionToOffset(text, targetLine, targetColumn = 1) {
  const lineGoal = Math.max(1, Math.trunc(targetLine || 1));
  const colGoal = Math.max(1, Math.trunc(targetColumn || 1));
  let currentLine = 1;
  let i = 0;
  while (i < text.length && currentLine < lineGoal) {
    if (text.charCodeAt(i) === 10) currentLine++;
    i++;
  }
  let col = 1;
  while (i < text.length && text.charCodeAt(i) !== 10 && col < colGoal) {
    const code = text.codePointAt(i);
    i += code !== undefined && code > 0xffff ? 2 : 1;
    col++;
  }
  return i;
}

export function createBasicEditor(container, options = {}) {
  container.replaceChildren();
  container.classList.remove("full-editor");
  container.classList.add("basic-editor");
  container.dataset.editorVariant = "basic";
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Grammar document");

  const LINE_HEIGHT_PX = 20;
  const PADDING_TOP_PX = 8;

  const srError = document.createElement("span");
  srError.id = "editor-error-sr";
  srError.className = "sr-only";

  const textarea = document.createElement("textarea");
  textarea.id = "doc-text";
  textarea.className = "ecode-basic";
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("aria-label", "Grammar document");
  textarea.setAttribute("aria-describedby", "editor-error-sr");

  container.append(textarea, srError);

  const changeListeners = new Set();
  if (typeof options.onChange === "function") changeListeners.add(options.onChange);

  const cursorListeners = new Set();
  if (typeof options.onCursorChange === "function") cursorListeners.add(options.onCursorChange);

  function getCursor() {
    return offsetToPosition(textarea.value, textarea.selectionStart || 0);
  }

  function reportCursor() {
    const pos = getCursor();
    for (const fn of cursorListeners) fn(pos);
  }

  textarea.addEventListener("input", () => {
    reportCursor();
    const val = textarea.value;
    for (const fn of changeListeners) fn(val);
  });

  for (const evt of ["keyup", "click", "select", "focus"]) {
    textarea.addEventListener(evt, reportCursor);
  }

  const api = {
    variant: "basic",
    capabilities: Object.freeze({
      syntaxColors: false,
      wrappedLineNumbers: false,
      marginMarks: false,
    }),
    textarea,
    getValue() {
      return textarea.value;
    },
    setValue(text) {
      const next = String(text ?? "");
      if (textarea.value !== next) {
        textarea.value = next;
      }
      textarea.setSelectionRange(0, 0);
      textarea.scrollTop = 0;
      reportCursor();
    },
    editValue(text) {
      const next = String(text ?? "");
      textarea.value = next;
      reportCursor();
      for (const fn of changeListeners) fn(next);
    },
    getCursor,
    onChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
    onCursorChange(fn) {
      cursorListeners.add(fn);
      return () => cursorListeners.delete(fn);
    },
    goTo(line, column = 1) {
      const text = textarea.value;
      let lineCount = 1;
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) lineCount++;
      }
      const ln = Math.max(1, Math.min(lineCount, Math.trunc(line || 1)));
      const col = Math.max(1, Math.trunc(column || 1));
      const offset = positionToOffset(text, ln, col);
      const lineStartOffset = positionToOffset(text, ln, 1);

      const probe = document.createElement("div");
      const cs = window.getComputedStyle(textarea);
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      probe.style.boxSizing = "border-box";
      probe.style.width = `${textarea.clientWidth || container.clientWidth || 600}px`;
      probe.style.padding = cs.padding;
      probe.style.font = cs.font;
      probe.style.lineHeight = cs.lineHeight;
      probe.style.whiteSpace = "pre-wrap";
      probe.style.overflowWrap = "anywhere";
      probe.textContent = text.slice(0, lineStartOffset) || " ";
      container.appendChild(probe);
      const lineTop = Math.max(0, probe.scrollHeight - LINE_HEIGHT_PX);
      probe.remove();

      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(offset, offset);
      const viewHeight = textarea.clientHeight || container.clientHeight || 320;
      const isPhone = typeof document !== "undefined" &&
        document.getElementById("app")?.classList.contains("phone");
      textarea.scrollTop = isPhone
        ? Math.max(0, lineTop - PADDING_TOP_PX)
        : Math.max(0, lineTop - Math.floor(viewHeight / 3));
      reportCursor();
    },
    markError(line, message = "") {
      const ln = Math.max(1, Math.trunc(line || 1));
      const msg = String(message ?? "").split("\n")[0];
      srError.textContent = msg ? `Line ${ln}, error: ${msg}` : `Line ${ln}, error`;
    },
    clearMarks() {
      srError.textContent = "";
    },
    setLabel(label) {
      const text = String(label || "Grammar document");
      container.setAttribute("aria-label", text);
      textarea.setAttribute("aria-label", text);
    },
    focus() {
      textarea.focus();
    },
  };

  return api;
}

if (typeof globalThis !== "undefined") {
  globalThis.gencmuEditorBasic = {
    createBasicEditor,
    offsetToPosition,
    positionToOffset,
  };
}
