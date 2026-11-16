// Layered pattern constructors (docs/output.md, "Pattern values").
// This walk keeps pattern and item positions distinct before substitution.

/**
 * @param {any} root
 * @param {{name?:(name:string)=>boolean, terminal?:(name:string)=>boolean, range?:(range:any)=>string|null, test?:(test:any)=>string|null, depth?:number, deferDepth?:boolean}} [inspect]
 * @returns {{problem:string, node:any}|null}
 */
export function layeredPatternFault(root, inspect = {}) {
  return inspectPattern(root, inspect, false);
}

/**
 * @param {any} root
 * @param {{name?:(name:string)=>boolean, terminal?:(name:string)=>boolean, range?:(range:any)=>string|null, test?:(test:any)=>string|null, depth?:number, deferDepth?:boolean}} [inspect]
 * @returns {string|null}
 */
export function layeredPatternProblem(root, inspect = {}) {
  return inspectPattern(root, inspect, false)?.problem ?? null;
}

/**
 * @internal
 * @param {any} root
 * @param {Parameters<typeof layeredPatternProblem>[1]} [inspect]
 * @returns {string|null}
 */
export function sourcePatternProblem(root, inspect = {}) {
  return inspectPattern(root, inspect, true)?.problem ?? null;
}

/**
 * @param {any} root
 * @param {NonNullable<Parameters<typeof layeredPatternProblem>[1]>} inspect
 * @param {boolean} deferGroups
 * @returns {{problem:string, node:any}|null}
 */
function inspectPattern(root, inspect, deferGroups) {
  const check = patternChecker(inspect, deferGroups, root);
  const stack = [{node:root,item:false,repeated:false,depth:inspect.depth ?? 0,inner:false}];
  while (stack.length) {
    const {fault, pending} = check(/** @type {any} */ (stack.pop()));
    if (fault) return fault;
    for (const child of pending) stack.push(child);
  }
  return null;
}

/**
 * @param {NonNullable<Parameters<typeof layeredPatternProblem>[1]>} inspect
 * @param {boolean} deferGroups
 * @param {any} root
 * @returns {(entry:{node:any, item:boolean, repeated:boolean, depth:number, inner:boolean}) => {fault:{problem:string, node:any}|null, pending:any[]}}
 */
function patternChecker(inspect, deferGroups, root) {
  const object = (/** @type {any} */ n) => n && typeof n === 'object' && !Array.isArray(n);
  const position = (/** @type {any} */ n) => Array.isArray(n) && n.length === 2 && n.every((/** @type {any} */ x) => Number.isSafeInteger(x) && x > 0);
  const stringTerm = (/** @type {any} */ n) => object(n) && !n.grouped && (
    Object.keys(n).length === 1 && typeof n.string === 'string' && [...n.string].every(c => c.codePointAt(0) < 0xd800 || c.codePointAt(0) > 0xdfff)
    || Object.keys(n).length === 2 && position(n.at) && (typeof n.const === 'string' && /^[A-Z][A-Za-z0-9_-]*$/.test(n.const) || typeof n.param === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(n.param))
  );
  const requirementTerm = (/** @type {any} */ n) => !n?.grouped && (stringTerm(n) && !('string' in n) || object(n) && Object.keys(n).length === 1 && typeof n.tag === 'string' && (inspect.terminal ? inspect.terminal(n.tag) : /^[A-Z][A-Za-z0-9_-]*$/.test(n.tag) || n.tag.startsWith('_')));
  const ruleName = (/** @type {any} */ name) => typeof name === 'string' && (inspect.name ? inspect.name(name) : /^[a-z][A-Za-z0-9_-]*$/.test(name) || [...name].length === 1 && (name.codePointAt(0) ?? 0) > 127);
  const terminalAtom = (/** @type {any} */ n) => object(n) && ['terminal','literal','range','wildcard','constant','param'].some(k => k in n) && !('exact' in n || 'children' in n);
  /** @param {{node:any, item:boolean, repeated:boolean, depth:number, inner:boolean}} entry */
  const check = (entry) => {
    const {node:n,item,repeated,depth,inner} = entry;
    /** @type {any[]} */
    const pending = [];
    if (!inspect.deferDepth && depth > 256) return {fault:{problem:'nested too deeply',node:root}, pending};
    if (!object(n)) return {fault:{problem:'a malformed pattern',node:n}, pending};
    const err = (/** @type {string} */ problem, /** @type {any} */ target = n) => ({problem, node:target});
    const keys = Object.keys(n);
    const exact = (/** @type {string[]} */ fields) => keys.length === fields.length && fields.every(k => k in n);
    const push = (/** @type {any} */ node, isItem = false, inRepeat = repeated, isInner = false) => pending.push({node,item:isItem,repeated:inRepeat,depth:depth+1,inner:isInner});
    const items = (/** @type {any} */ array, inRepeat = repeated, empty = false) => {
      if (!Array.isArray(array) || !empty && !array.length) return false;
      for (let i = array.length - 1; i >= 0; i--) push(array[i],true,inRepeat);
      return true;
    };
    if (item) {
      if (deferGroups && exact(['sequence'])) {
        if (!items(n.sequence)) return {fault:err('a malformed pattern sequence'), pending};
      } else if (exact(['child'])) push(n.child,false,false);
      else if (exact(['siblings'])) {
        if (n.siblings !== true) return {fault:err('a malformed sibling ellipsis'), pending};
        if (repeated) return {fault:err('a sibling ellipsis cannot be a repeat item or separator', null), pending};
      } else if (exact(['optional'])) {
        if (!items(n.optional)) return {fault:err('a malformed pattern optional'), pending};
      } else if (exact(['repeat']) || exact(['repeat','separator'])) {
        if ('separator' in n && !items(n.separator,true) || !items(n.repeat,true)) return {fault:err('a malformed pattern repeat'), pending};
      } else if (exact(['choice'])) {
        if (!Array.isArray(n.choice) || n.choice.length < 2) return {fault:err('a malformed pattern choice'), pending};
        for (let i = n.choice.length - 1; i >= 0; i--) {
          const arm = n.choice[i];
          if (!items(arm) || !deferGroups && arm.length === 1 && object(arm[0]) && 'choice' in arm[0]) return {fault:err('a malformed pattern choice', arm?.[0] ?? n), pending};
        }
      } else return {fault:err('a malformed pattern child item'), pending};
      return {fault:null, pending};
    }
    const compound = ['union','intersection','difference'].find(k => k in n);
    if (compound) {
      const operands = n[compound];
      if (!exact([compound]) || !Array.isArray(operands) || operands.length < 2 || compound === 'difference' && operands.length !== 2) return {fault:err('a malformed pattern'), pending};
      if (!deferGroups && compound !== 'difference' && operands.some((/** @type {any} */ x) => object(x) && compound in x)) return {fault:err('a nested pattern set must be flat'), pending};
      for (let i = operands.length - 1; i >= 0; i--) push(operands[i],false,false);
      return {fault:null, pending};
    }
    if ('path' in n) {
      if (!exact(['path','pattern']) || !['descendant','first','last'].includes(n.path)) return {fault:err('a malformed pattern path'), pending};
      push(n.pattern,false,false);
      return {fault:null, pending};
    }
    const form = ['name','call','param','terminal','literal','range','wildcard','constant','test','any'].filter(k => k in n);
    if (form.length !== 1) return {fault:err('a malformed pattern node test'), pending};
    const key = form[0];
    if ('exact' in n && (n.exact !== true || inner)) return {fault:err('a malformed exact pattern prefix'), pending};
    if ('children' in n && (inner || !['name','call','param','any'].includes(key))) return {fault:err('a child list requires a rule test', n.listAt ? {at: n.listAt} : n), pending};
    let fields = [key, ...('exact' in n ? ['exact'] : []), ...('children' in n ? ['children'] : [])];
    if (key === 'test') {
      if (n.test === 'tags') {
        fields.push('requirements', 'expr');
        const ruleAtom = object(n.expr) && ['name','call'].some(k => k in n.expr) && !('exact' in n.expr || 'children' in n.expr);
        if (!(terminalAtom(n.expr) || ruleAtom) || !Array.isArray(n.requirements)) return {fault:err('a pattern tag test requires a node atom'), pending};
      } else {
        fields.push('value','expr');
        if (!['=','≠'].includes(n.test) || !(terminalAtom(n.expr) || object(n.expr) && ['name','call'].some(k => k in n.expr) || object(n.expr) && n.expr.test === 'tags' && !('exact' in n.expr || 'children' in n.expr) && (terminalAtom(n.expr.expr) || object(n.expr.expr) && ['name','call'].some(k => k in n.expr.expr)))) return {fault:err('a pattern value test requires a node atom'), pending};
      }
      if (!exact(fields)) return {fault:err('a malformed pattern node test'), pending};
      const problem = inspect.test?.(n);
      if (problem) return {fault:err(problem), pending};
    } else if (key === 'any') {
      if (n.any !== true || !('children' in n)) return {fault:err('a malformed bare child list'), pending};
    } else {
      fields.push('at');
      if (!position(n.at)) return {fault:err('a malformed pattern position'), pending};
      if (key === 'call') {
        fields.push('args');
        if (!ruleName(n.call) || !Array.isArray(n.args) || !n.args.length || n.args.some((/** @type {any} */ x) => !object(x))) return {fault:err('a malformed pattern call'), pending};
      } else if (key === 'name') {
        if (!ruleName(n.name)) return {fault:err('a malformed pattern rule name'), pending};
      } else if (key === 'param' || key === 'constant') {
        if (typeof n[key] !== 'string' || !(key === 'param' ? /^[A-Za-z][A-Za-z0-9_-]*$/ : /^[A-Z][A-Za-z0-9_-]*$/).test(n[key])) return {fault:err('a malformed pattern reference'), pending};
      } else if (key === 'terminal') {
        if (n.terminal === '_Elided') return {fault:err('_Elided stands only in a pattern tag test'), pending};
        if (typeof n.terminal !== 'string' || !(inspect.terminal ? inspect.terminal(n.terminal) : /^[A-Z][A-Za-z0-9_-]*$/.test(n.terminal) || n.terminal.startsWith('_'))) return {fault:err('a malformed pattern terminal'), pending};
      } else if (key === 'wildcard') {
        if (n.wildcard !== true) return {fault:err('a malformed pattern wildcard'), pending};
      } else if (key === 'literal') {
        if (!stringTerm(n.literal) || !('string' in n.literal)) return {fault:err('a malformed pattern literal'), pending};
      } else if (key === 'range') {
        if (!Array.isArray(n.range) || n.range.length !== 2 || n.range.some((/** @type {any} */ x) => !stringTerm(x))) return {fault:err('a malformed pattern range'), pending};
        const problem = inspect.range?.(n.range);
        if (problem) return {fault:err(problem), pending};
      }
    }
    if (!exact(fields)) return {fault:err('a malformed pattern node test'), pending};
    if ('children' in n && !items(n.children,false,true)) return {fault:err('a malformed pattern child list'), pending};
    if (key === 'test') {
      // Check n.expr BEFORE test operands so base atom faults precede test operand faults.
      if (n.test === 'tags') {
        for (const requirement of n.requirements) {
          if (!object(requirement) || Object.keys(requirement).length !== 2 || !('value' in requirement) || typeof requirement.negated !== 'boolean' || !requirementTerm(requirement.value)) {
            if (object(n.expr)) {
              const baseFault = inspectPattern(n.expr, {...inspect, depth:depth+1}, deferGroups);
              if (baseFault) return {fault:baseFault, pending};
            }
            return {fault:err('a malformed pattern requirement', requirement?.value ?? requirement ?? n), pending};
          }
        }
      } else if (!stringTerm(n.value)) {
        if (object(n.expr)) {
          const baseFault = inspectPattern(n.expr, {...inspect, depth:depth+1}, deferGroups);
          if (baseFault) return {fault:baseFault, pending};
        }
        return {fault:err('a malformed pattern value test', n.value ?? n), pending};
      }
      if ("expr" in n) push(n.expr,false,false,true);
    }
    return {fault:null, pending};
  };
  return check;
}

/**
 * The fault of one pattern node or pattern item, without its children.
 * @param {any} node
 * @param {{name?:(name:string)=>boolean, terminal?:(name:string)=>boolean, range?:(range:any)=>string|null, test?:(test:any)=>string|null, depth?:number, deferDepth?:boolean, repeated?:boolean, inner?:boolean}} [inspect]
 * @param {boolean} [item]
 * @returns {{problem:string, node:any}|null}
 */
export function layeredPatternNodeFault(node, inspect = {}, item = false) {
  const check = patternChecker(inspect, false, node);
  return check({node, item, repeated: inspect.repeated ?? false, depth: inspect.depth ?? 0, inner: inspect.inner ?? false}).fault;
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
  const children = (/** @type {any[]} */ array) => array.length ? '⁅ '+items(array)+' ⁆' : '⁅⁆';
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
    if (n.test) text = (n.any ? '' : pattern(n.expr))+(n.test === 'tags' ? term({requirements:n.requirements}) : n.test+term(n.value));
    else if (n.any) text = '';
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
