// Layered pattern constructors (docs/output.md, "Pattern values").
// This walk keeps pattern and item positions distinct before substitution.

/** @param {any} node @returns {any[]} */
export function layeredPatternParts(node) {
  if (node.union || node.intersection || node.difference) return node.union ?? node.intersection ?? node.difference;
  if (node.path) return [node.pattern];
  if (node.test) return [node.expr];
  return node.children ?? [];
}

/** @param {any} node @returns {any[]} */
export function patternItemParts(node) {
  if (node.child) return [node.child];
  if (node.choice) return node.choice.flat();
  return [...(node.optional ?? node.repeat ?? []), ...(node.separator ?? [])];
}

/**
 * @param {any} root
 * @param {{name?:(name:string)=>boolean, terminal?:(name:string)=>boolean, test?:(test:any)=>string|null, depth?:number}} [inspect]
 * @returns {string|null}
 */
export function layeredPatternProblem(root, inspect = {}) {
  const stack = [{node:root,item:false,repeated:false,depth:inspect.depth ?? 0,inner:false}];
  const repeats = [];
  const object = (/** @type {any} */ n) => n && typeof n === 'object' && !Array.isArray(n);
  const position = (/** @type {any} */ n) => Array.isArray(n) && n.length === 2 && n.every((/** @type {any} */ x) => Number.isInteger(x) && x > 0);
  const stringTerm = (/** @type {any} */ n) => object(n) && (
    Object.keys(n).length === 1 && typeof n.string === 'string' && [...n.string].every(c => c.codePointAt(0) < 0xd800 || c.codePointAt(0) > 0xdfff)
    || Object.keys(n).length === 2 && position(n.at) && (typeof n.const === 'string' && /^[A-Z][A-Za-z0-9_-]*$/.test(n.const) || typeof n.param === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(n.param))
  );
  const requirementTerm = (/** @type {any} */ n) => stringTerm(n) && !('string' in n) || object(n) && Object.keys(n).length === 1 && typeof n.tag === 'string' && (inspect.terminal ? inspect.terminal(n.tag) : /^[A-Z][A-Za-z0-9_-]*$/.test(n.tag) || n.tag.startsWith('_'));
  const terminalAtom = (/** @type {any} */ n) => object(n) && ['terminal','literal','range','wildcard','constant','param'].some(k => k in n) && !('exact' in n || 'children' in n);
  while (stack.length) {
    const {node:n,item,repeated,depth,inner} = /** @type {any} */ (stack.pop());
    if (depth > 256) return 'nested too deeply';
    if (!object(n)) return 'a malformed pattern';
    const keys = Object.keys(n);
    const exact = (/** @type {string[]} */ fields) => keys.length === fields.length && fields.every(k => k in n);
    const push = (/** @type {any} */ node, isItem = false, inRepeat = repeated, isInner = false) => stack.push({node,item:isItem,repeated:inRepeat,depth:depth+1,inner:isInner});
    const items = (/** @type {any} */ array, inRepeat = repeated, empty = false) => {
      if (!Array.isArray(array) || !empty && !array.length) return false;
      for (const node of array) push(node,true,inRepeat);
      return true;
    };
    if (item) {
      if (exact(['child'])) push(n.child,false,false);
      else if (exact(['siblings'])) {
        if (n.siblings !== true) return 'a malformed sibling ellipsis';
        if (repeated) return 'a sibling ellipsis cannot be a repeat item or separator';
      } else if (exact(['optional'])) {
        if (!items(n.optional)) return 'a malformed pattern optional';
      } else if (exact(['repeat']) || exact(['repeat','separator'])) {
        if (!items(n.repeat,true) || 'separator' in n && !items(n.separator,true)) return 'a malformed pattern repeat';
        repeats.push(n.repeat);
      } else if (exact(['choice'])) {
        if (!Array.isArray(n.choice) || n.choice.length < 2) return 'a malformed pattern choice';
        for (const arm of n.choice) {
          if (!items(arm) || arm.length === 1 && object(arm[0]) && 'choice' in arm[0]) return 'a malformed pattern choice';
        }
      } else return 'a malformed pattern child item';
      continue;
    }
    const compound = ['union','intersection','difference'].find(k => k in n);
    if (compound) {
      const operands = n[compound];
      if (!exact([compound]) || !Array.isArray(operands) || operands.length < 2 || compound === 'difference' && operands.length !== 2) return 'a malformed pattern';
      if (compound !== 'difference' && operands.some((/** @type {any} */ x) => object(x) && compound in x)) return 'a nested pattern set must be flat';
      for (const node of operands) push(node,false,false);
      continue;
    }
    if ('path' in n) {
      if (!exact(['path','pattern']) || !['descendant','first','last'].includes(n.path)) return 'a malformed pattern path';
      push(n.pattern,false,false);
      continue;
    }
    const form = ['name','call','param','terminal','literal','range','wildcard','constant','test','any'].filter(k => k in n);
    if (form.length !== 1) return 'a malformed pattern node test';
    const key = form[0];
    if ('exact' in n && (n.exact !== true || inner)) return 'a malformed exact pattern prefix';
    if ('children' in n && (inner || !['name','call','param','any'].includes(key))) return 'a child list requires a rule test';
    let fields = [key, ...('exact' in n ? ['exact'] : []), ...('children' in n ? ['children'] : [])];
    if (key === 'test') {
      if (n.test === 'tags') {
        fields.push('requirements','expr');
        if (!terminalAtom(n.expr) || !Array.isArray(n.requirements)) return 'a pattern tag test requires a terminal atom';
        for (const requirement of n.requirements) {
          if (!object(requirement) || Object.keys(requirement).length !== 2 || !('value' in requirement) || typeof requirement.negated !== 'boolean' || !requirementTerm(requirement.value)) return 'a malformed pattern requirement';
        }
      } else {
        fields.push('value','expr');
        if (!['=','≠'].includes(n.test) || !(terminalAtom(n.expr) || object(n.expr) && n.expr.test === 'tags' && !('exact' in n.expr || 'children' in n.expr) && terminalAtom(n.expr.expr))) return 'a pattern value test requires a terminal atom';
        if (!stringTerm(n.value)) return 'a malformed pattern value test';
      }
      const problem = inspect.test?.(n);
      if (problem) return problem;
      push(n.expr,false,false,true);
    } else if (key === 'any') {
      if (n.any !== true || !('children' in n)) return 'a malformed bare child list';
    } else {
      fields.push('at');
      if (!position(n.at)) return 'a malformed pattern position';
      if (key === 'call') {
        fields.push('args');
        if (typeof n.call !== 'string' || !Array.isArray(n.args) || !n.args.length || n.args.some((/** @type {any} */ x) => !object(x)) || inspect.name && !inspect.name(n.call)) return 'a malformed pattern call';
      } else if (key === 'name') {
        if (typeof n.name !== 'string' || !(inspect.name ? inspect.name(n.name) : /^[a-z][A-Za-z0-9_-]*$/.test(n.name) || [...n.name].length === 1 && n.name.codePointAt(0) > 127)) return 'a malformed pattern rule name';
      } else if (key === 'param' || key === 'constant') {
        if (typeof n[key] !== 'string' || !(key === 'param' ? /^[A-Za-z][A-Za-z0-9_-]*$/ : /^[A-Z][A-Za-z0-9_-]*$/).test(n[key])) return 'a malformed pattern reference';
      } else if (key === 'terminal') {
        if (typeof n.terminal !== 'string' || !(inspect.terminal ? inspect.terminal(n.terminal) : /^[A-Z][A-Za-z0-9_-]*$/.test(n.terminal) || n.terminal.startsWith('_'))) return 'a malformed pattern terminal';
      } else if (key === 'wildcard') {
        if (n.wildcard !== true) return 'a malformed pattern wildcard';
      } else if (key === 'literal') {
        if (!stringTerm(n.literal) || !('string' in n.literal)) return 'a malformed pattern literal';
      } else if (key === 'range') {
        if (!Array.isArray(n.range) || n.range.length !== 2 || n.range.some((/** @type {any} */ x) => !stringTerm(x))) return 'a malformed pattern range';
      }
    }
    if (!exact(fields)) return 'a malformed pattern node test';
    if ('children' in n && !items(n.children,false,true)) return 'a malformed pattern child list';
  }
  for (const repeat of repeats) {
    const pending = [...repeat];
    let consumes = false;
    while (pending.length && !consumes) {
      const item = pending.pop();
      if ('child' in item) consumes = true;
      else pending.push(...patternItemParts(item));
    }
    if (!consumes) return 'a pattern repeat cannot match only empty sequences';
  }
  return null;
}

/**
 * @param {any} root
 * @param {(term:any)=>string} term
 * @param {boolean} [literal]
 * @returns {string}
 */
export function layeredPatternText(root, term, literal = true) {
  const atom = (/** @type {any} */ n) => !['union','intersection','difference','path'].some(k => k in n);
  const set = (/** @type {any} */ n) => ['union','intersection','difference'].some(k => k in n);
  /** @type {(items:any[])=>string} */
  const items = array => array.map(n => {
    let text;
    if (n.child) text = pattern(n.child);
    else if (n.siblings) return '⋯';
    else if (n.optional) return '['+items(n.optional)+']';
    else if (n.repeat) return '{'+items(n.repeat)+(n.separator?' / '+items(n.separator):'')+'}';
    else text = n.choice.map(items).join(' | ');
    return array.length > 1 && (n.choice || n.child && set(n.child)) ? '('+text+')' : text;
  }).join(' ');
  const children = (/** @type {any[]} */ array) => array.length ? '« '+items(array)+' »' : '«»';
  /** @type {(n:any)=>string} */
  const pattern = n => {
    if (n.path) {
      const operand = atom(n.pattern) ? pattern(n.pattern) : '('+pattern(n.pattern)+')';
      return n.path === 'first' ? operand+' ⋰' : (n.path === 'last' ? '⋱ ' : '⋮ ')+operand;
    }
    if (set(n)) {
      const key = n.union ? 'union' : n.intersection ? 'intersection' : 'difference';
      return n[key].map((/** @type {any} */ x,/** @type {number} */ i) => {
        const grouped = key === 'intersection' && (x.union || x.difference)
          || key === 'difference' && i === 1 && (x.union || x.difference)
          || key === 'union' && i > 0 && x.difference;
        const text = pattern(x);
        return grouped ? '('+text+')' : text;
      }).join(key === 'union' ? ' ∪ ' : key === 'intersection' ? ' ∩ ' : ' ∖ ');
    }
    let text;
    if (n.any) text = '';
    else if (n.test) text = pattern(n.expr)+(n.test === 'tags' ? term({requirements:n.requirements}) : n.test+term(n.value));
    else if (n.literal) text = term(n.literal);
    else if (n.range) text = n.range.map(term).join('..');
    else if (n.wildcard) text = '_';
    else if (n.constant) text = '$'+n.constant;
    else text = term(n);
    return (n.exact ? '·' : '')+text+('children' in n ? children(n.children) : '');
  };
  const text = pattern(root);
  return literal ? '#'+(atom(root) ? text : '('+text+')') : text;
}
