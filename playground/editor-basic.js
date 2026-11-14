// Basic grammar document editor backed by a plain <textarea>.
// Implements the playground editor interface.
(function (root) {
  "use strict";

  const LINE_HEIGHT_PX = 20;
  const PADDING_TOP_PX = 10;

  function offsetToPosition(text, offset) {
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
    return { line, column };
  }

  function positionToOffset(text, targetLine, targetColumn = 1) {
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

  function createBasicEditor(container, options = {}) {
    container.replaceChildren();

    const gutter = document.createElement("div");
    gutter.id = "gutter";
    gutter.className = "gutter";
    gutter.setAttribute("aria-hidden", "true");

    const codeWrap = document.createElement("div");
    codeWrap.className = "ecode-wrap";

    const overlay = document.createElement("div");
    overlay.className = "ecode-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const textarea = document.createElement("textarea");
    textarea.id = "doc-text";
    textarea.className = "ecode";
    textarea.spellcheck = false;
    textarea.autocapitalize = "off";
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocorrect", "off");
    textarea.setAttribute("aria-label", "Grammar document");

    codeWrap.append(overlay, textarea);
    container.append(gutter, codeWrap);

    const changeListeners = new Set();
    if (typeof options.onChange === "function") changeListeners.add(options.onChange);

    const cursorListeners = new Set();
    if (typeof options.onCursorChange === "function") cursorListeners.add(options.onCursorChange);

    let lineCount = 1;
    let errorMark = null;
    let highlightedLine = null;

    function renderGutterAndOverlay() {
      const text = textarea.value;
      let count = 1;
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) count++;
      }
      lineCount = count;

      const parts = [];
      for (let ln = 1; ln <= count; ln++) {
        if (errorMark && errorMark.line === ln) {
          const escapedTitle = errorMark.message
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;");
          parts.push(`<mark class="gl-err" title="${escapedTitle}">${ln}</mark>`);
        } else if (highlightedLine === ln) {
          parts.push(`<span class="gl-hl">${ln}</span>`);
        } else {
          parts.push(String(ln));
        }
      }
      gutter.innerHTML = parts.join("\n");

      overlay.replaceChildren();
      if (errorMark && errorMark.line >= 1 && errorMark.line <= count) {
        const bar = document.createElement("div");
        bar.className = "ecode-line-err";
        bar.style.top = `${PADDING_TOP_PX + (errorMark.line - 1) * LINE_HEIGHT_PX}px`;
        bar.style.height = `${LINE_HEIGHT_PX}px`;
        overlay.appendChild(bar);
      } else if (highlightedLine && highlightedLine >= 1 && highlightedLine <= count) {
        const bar = document.createElement("div");
        bar.className = "ecode-line-hl";
        bar.style.top = `${PADDING_TOP_PX + (highlightedLine - 1) * LINE_HEIGHT_PX}px`;
        bar.style.height = `${LINE_HEIGHT_PX}px`;
        overlay.appendChild(bar);
      }

      const minHeight = PADDING_TOP_PX * 2 + count * LINE_HEIGHT_PX;
      textarea.style.height = `${minHeight}px`;
      codeWrap.style.minHeight = `${minHeight}px`;
    }

    function reportCursor() {
      const pos = offsetToPosition(textarea.value, textarea.selectionStart || 0);
      for (const fn of cursorListeners) fn(pos);
    }

    textarea.addEventListener("input", () => {
      renderGutterAndOverlay();
      reportCursor();
      const val = textarea.value;
      for (const fn of changeListeners) fn(val);
    });

    for (const evt of ["keyup", "click", "select", "focus"]) {
      textarea.addEventListener(evt, reportCursor);
    }

    renderGutterAndOverlay();

    return {
      capabilities: Object.freeze({
        syntaxColors: false,
        wrappedLineNumbers: false,
        marginMarks: true,
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
        renderGutterAndOverlay();
        reportCursor();
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
        const ln = Math.max(1, Math.min(lineCount, Math.trunc(line || 1)));
        const col = Math.max(1, Math.trunc(column || 1));
        const offset = positionToOffset(textarea.value, ln, col);
        highlightedLine = ln;
        renderGutterAndOverlay();
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(offset, offset);
        const lineTop = PADDING_TOP_PX + (ln - 1) * LINE_HEIGHT_PX;
        const viewHeight = container.clientHeight || 320;
        container.scrollTop = Math.max(0, lineTop - Math.floor(viewHeight / 3));
        reportCursor();
      },
      markError(line, message = "", column = 1) {
        errorMark = {
          line: Math.max(1, Math.trunc(line || 1)),
          message: String(message ?? ""),
          column: Math.max(1, Math.trunc(column || 1)),
        };
        renderGutterAndOverlay();
      },
      clearMarks() {
        if (errorMark !== null || highlightedLine !== null) {
          errorMark = null;
          highlightedLine = null;
          renderGutterAndOverlay();
        }
      },
      focus() {
        textarea.focus();
      },
    };
  }

  root.gencmuEditorBasic = {
    createBasicEditor,
    offsetToPosition,
    positionToOffset,
  };
})(self);
