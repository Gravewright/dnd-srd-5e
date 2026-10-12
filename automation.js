// Interpret the native server result; discarded dice never become natural rolls.
export function rollResult(message) {
  const result = message?.roll?.result ?? message?.result ?? message;
  const total = Number(result?.value?.value);
  if (!Number.isFinite(total)) throw Error('Invalid roll result');
  const pool = result.rolls?.find(roll => roll.plan?.initial?.sides === 20);
  const kept = pool?.facts?.filter(fact => pool.selection?.[fact.id] === 'active') || [];
  return {result, total, natural: kept.length === 1 ? kept[0].face : undefined};
}

export function rollOutcome(actionId, {total, natural}, {ac, dc,criticalOnHit=false} = {}) {
  if (actionId.includes('attack')) {
    if (natural === 1) return 'miss';
    if (natural === 20) return 'critical';
    return Number.isFinite(ac) ? (total >= ac ? criticalOnHit?'critical':'hit' : 'miss') : null;
  }
  return Number.isFinite(dc) ? (total >= dc ? 'success' : 'failure') : null;
}

// Heroic Inspiration replaces ONE die, including a discarded advantage die.
// Freeze other dice so submitting the new expression cannot reroll them too.
export function heroicDice(result) {
  return (result?.rolls || []).flatMap((pool, poolIndex) => {
    const sides = pool.plan?.initial?.sides;
    const operations = pool.plan?.operations || [];
    if (!Number.isInteger(sides) || operations.some(op => op.category !== 'selection') ||
        operations.length && !(operations.length === 1 && operations[0].kind === 'keep' && operations[0].count === 1)) return [];
    return (pool.facts || []).map(fact => ({poolIndex, factId: fact.id, face: fact.face, sides}));
  });
}

function selectedPool(values, operations) {
  let active = values.map((value, index) => ({value, index}));
  for (const op of operations) {
    const order = [...active].sort((a,b) => (op.direction === 'lowest' ? a.value-b.value : b.value-a.value) || a.index-b.index);
    const removed = new Set((op.kind === 'keep' ? order.slice(op.count) : order.slice(0,op.count)).map(die => die.index));
    active = active.filter(die => !removed.has(die.index));
  }
  return active.reduce((sum, die) => sum+die.value, 0);
}

function symbolicPool(values, operations) {
  if (!operations.length) return `(${values.join(' + ')})`;
  if (operations.length === 1 && operations[0].kind === 'keep' && operations[0].count === 1) {
    return `${operations[0].direction === 'highest' ? 'max' : 'min'}(${values.join(', ')})`;
  }
  // Other selection chains remain readable as manual rolls, without offering
  // a reroll that would silently choose the wrong dice.
  throw Error('Unsupported die selection');
}

export function heroicReroll(expression, result, chosen) {
  const pool = result?.rolls?.[chosen.poolIndex];
  if (!heroicDice(result).some(die => die.poolIndex === chosen.poolIndex && die.factId === chosen.factId)) throw Error('Invalid reroll die');
  const replacement = `1d${pool.plan.initial.sides}`;
  const edits = result.rolls.map((entry, index) => {
    const active = entry.facts.filter(fact => entry.selection[fact.id] === 'active');
    const text = index === chosen.poolIndex
      ? symbolicPool(entry.facts.map(fact => fact.id === chosen.factId ? replacement : String(fact.face)), entry.plan.operations || [])
      : `(${active.reduce((sum, fact) => sum+fact.face, 0)})`;
    return {...entry.sourceSpan, text};
  }).sort((a,b) => b.start-a.start);
  let next = expression;
  for (const edit of edits) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end > expression.length) throw Error('Invalid dice span');
    next = next.slice(0,edit.start)+edit.text+next.slice(edit.end);
  }
  if (next.length > 512) throw Error('Reroll expression too long');
  return {
    expression: next,
    natural(replacementResult) {
      const original = result.rolls.find(entry => entry.plan?.initial?.sides === 20);
      if (!original) return undefined;
      if (original !== pool) {
        const kept = original.facts.filter(fact => original.selection[fact.id] === 'active');
        return kept.length === 1 ? kept[0].face : undefined;
      }
      const fresh = replacementResult.rolls?.[0]?.facts?.[0]?.face;
      return selectedPool(pool.facts.map(fact => fact.id === chosen.factId ? fresh : fact.face), pool.plan.operations || []);
    },
  };
}
