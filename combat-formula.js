/** Bounded system formula DSL. Random values always come from native, journaled rolls. */
export const formulaError = code => Object.assign(new Error(code), {code});
const bad = () => {throw formulaError('combat-formula-invalid');};
const finite = value => {if (!Number.isFinite(value)) bad();return value;};
const blocked = new Set(['__proto__','constructor','prototype']);

function tokenize(expression) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 200) bad();
  const tokens = [];
  let text = expression;
  while (text.length) {
    const space = /^\s+/.exec(text);
    if (space) {text = text.slice(space[0].length);continue;}
    const match = /^(?:(\d+d\d+(?:kh1|kl1)?)|((?:\d+(?:\.\d*)?|\.\d+))|(@[A-Za-z0-9_.]+)|([A-Za-z_][A-Za-z0-9_.]*)|(==|!=|<=|>=|&&|\|\||[-+*/<>(),]))/i.exec(text);
    if (!match) bad();
    const kind = match[1] ? 'dice' : match[2] ? 'number' : match[3] ? 'path' : match[4] ? 'name' : 'op';
    tokens.push({kind,value:match[0],index:tokens.length});text = text.slice(match[0].length);
  }
  tokens.push({kind:'end',value:'',index:tokens.length});
  return tokens;
}

function parse(expression) {
  const tokens = tokenize(expression);
  let cursor = 0, depth = 0;
  const peek = () => tokens[cursor], take = () => tokens[cursor++];
  const accept = value => peek().value === value ? (take(),true) : false;
  const expect = value => {if (!accept(value)) bad();};
  function primary() {
    if (++depth > 64) bad();
    const token = take();let node;
    if (token.kind === 'number') node = {kind:'number',value:finite(Number(token.value))};
    else if (token.kind === 'dice') {
      const [,count,sides,keep=''] = /^(\d+)d(\d+)(kh1|kl1)?$/i.exec(token.value);
      node = {kind:'dice',count:Number(count),sides:Number(sides),keep:keep.toLowerCase(),id:token.index};
    } else if (token.kind === 'path') {
      const parts = token.value.slice(1).split('.');
      if (parts.some(part => !part || blocked.has(part))) bad();
      node = {kind:'path',parts};
    } else if (token.value === '(') {node = logicalOr();expect(')');}
    else if (token.kind === 'name') {
      if (accept('(')) {
        const args = [];
        if (peek().value !== ')') {args.push(logicalOr());while (accept(',')) args.push(logicalOr());}
        expect(')');node = {kind:'call',name:token.value,args,id:token.index};
      } else node = {kind:'number',value:0}; // The former provider supplied no variables/scope.
    } else bad();
    depth--;return node;
  }
  function unary() {if (accept('-')) return {kind:'unary',value:unary()};return primary();}
  function binary(child,operators) {
    let node = child();
    while (operators.includes(peek().value)) node = {kind:'binary',operation:take().value,left:node,right:child()};
    return node;
  }
  const multiply = () => binary(unary,['*','/']);
  const add = () => binary(multiply,['+','-']);
  function compare() {
    const left = add();
    return ['==','!=','<','<=','>','>='].includes(peek().value)
      ? {kind:'binary',operation:take().value,left,right:add()} : left;
  }
  const logicalAnd = () => binary(compare,['&&']);
  const logicalOr = () => binary(logicalAnd,['||']);
  const root = logicalOr();if (peek().kind !== 'end') bad();return root;
}

function asNumber(value) {
  if (typeof value === 'boolean') return Number(value);
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const number = Number(value);return Number.isFinite(number) ? number : 0;
}
function roundEven(value) {
  const floor = Math.floor(value), remainder = value-floor;
  return remainder === 0.5 ? floor+(Math.abs(floor%2) ? 1 : 0) : Math.round(value);
}

export async function evaluateCombatFormula(expression, data, {roll, prefix='formula'} = {}) {
  const root = parse(expression), context = {sheet:data};
  async function dice(count,sides,keep,id) {
    if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(sides) || sides < 2 || sides > 1000) bad();
    if (typeof roll !== 'function') throw formulaError('combat-formula-roll-required');
    // The native host accepts at most 99 dice per term; the system DSL allows 100.
    const results = [];
    for (let remaining=count,part=0;remaining>0;part++) {
      const amount = Math.min(remaining,99);
      const nodeId = `${prefix}:${id}${count>99 ? `:part:${part}` : ''}`;
      const result = await roll(`${amount}d${sides}${keep}`,nodeId);
      if (!Number.isInteger(result) || result < (keep ? 1 : amount) || result > (keep ? sides : amount*sides)) bad();
      results.push(result);remaining-=amount;
    }
    return keep === 'kh1' ? Math.max(...results) : keep === 'kl1' ? Math.min(...results) : results.reduce((sum,value)=>sum+value,0);
  }
  async function evaluate(node) {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'path') {
      let value = context;
      for (const part of node.parts) value = value && typeof value === 'object' && Object.hasOwn(value,part) ? value[part] : undefined;
      return asNumber(value);
    }
    if (node.kind === 'dice') return dice(node.count,node.sides,node.keep,node.id);
    if (node.kind === 'unary') return finite(-(await evaluate(node.value)));
    if (node.kind === 'binary') {
      // Deliberately eager, matching the previous DSL's if/logic semantics.
      const left = await evaluate(node.left), right = await evaluate(node.right);
      switch (node.operation) {
        case '+':return finite(left+right);case '-':return finite(left-right);case '*':return finite(left*right);
        case '/':if (!right) bad();return finite(left/right);
        case '==':return Number(left===right);case '!=':return Number(left!==right);
        case '<':return Number(left<right);case '<=':return Number(left<=right);
        case '>':return Number(left>right);case '>=':return Number(left>=right);
        case '&&':return Number(left!==0&&right!==0);case '||':return Number(left!==0||right!==0);
        default:bad();
      }
    }
    const args = [];
    for (const argument of node.args) args.push(await evaluate(argument));
    const unary = fn => {if (args.length!==1) bad();return finite(fn(args[0]));};
    switch (node.name) {
      case 'floor':return unary(Math.floor);case 'ceil':return unary(Math.ceil);case 'round':return unary(roundEven);case 'abs':return unary(Math.abs);
      case 'min':return args.length ? Math.min(...args) : 0;case 'max':return args.length ? Math.max(...args) : 0;
      case 'clamp':if (args.length!==3) bad();return Math.min(Math.max(args[0],args[1]),args[2]);
      case 'if':if (args.length!==3) bad();return args[0]!==0 ? args[1] : args[2];
      case 'die': {
        if (![1,2].includes(args.length)) bad();
        return dice(args.length===1 ? 1 : Math.trunc(args[0]),Math.trunc(args.at(-1)),'',node.id);
      }
      case 'draw':if (args.length!==1) bad();return dice(1,Math.trunc(args[0]),'',node.id);
      case 'fate':if (args.length) bad();return (await dice(4,3,'',node.id))-8;
      case 'successes':case 'under': {
        if (args.length!==3) bad();const [count,sides,target] = args.map(Math.trunc);
        if (count<1 || count>100 || sides<2 || sides>1000 || target<1 || target>sides) bad();
        let hits = 0;
        for (let index=0;index<count;index++) {const value=await dice(1,sides,'',`${node.id}:${index}`);hits+=Number(node.name==='under' ? value<=target : value>=target);}
        return hits;
      }
      case 'explode': {
        if (args.length!==2) bad();const [sides,threshold] = args.map(Math.trunc);
        if (sides<2 || sides>1000 || threshold<1 || threshold>sides) bad();
        let total = 0;
        for (let index=0;index<100;index++) {const value=await dice(1,sides,'',`${node.id}:${index}`);total+=value;if (value<threshold) break;}
        return total;
      }
      default:bad();
    }
  }
  return finite(await evaluate(root));
}
