// The browser factory shares one scope, so import names must stay unchanged.
export function browserModule(file, text) {
  const imports = [];
  const body = text.replace(/^[ \t]*import\s+([^;]*?)\s+from\s+(["'])([^"']+)\2[ \t]*;[ \t]*$/gm, (statement, names, quote, target) => {
    if (!/^\{\s*(?:[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*,?\s*)?\}$/.test(names.trim())) {
      throw new Error(`${file}: the browser bundle requires named imports without aliases`);
    }
    if (!target.startsWith("./")) throw new Error(`${file}: the browser bundle requires relative imports`);
    imports.push(target.slice(2));
    return "";
  });
  if (/^[ \t]*import(?:\s|["'])/m.test(body)) throw new Error(`${file}: unsupported browser import syntax`);
  return { text: body, imports };
}
