import { describe, expect, it } from 'vitest';
import { TOOL_HIDE_ORDER, toolsThatFit } from './toolbar-fit';

const items = TOOL_HIDE_ORDER.map((id) => ({ id, width: 30 }));
const total = items.length * 30;

describe('toolsThatFit', () => {
  it('keeps every tool when they all fit', () => {
    expect([...toolsThatFit(items, total)]).toHaveLength(items.length);
    expect([...toolsThatFit(items, total + 100)]).toHaveLength(items.length);
  });

  it('hides tools in the fixed priority order, Image first', () => {
    const one = toolsThatFit(items, total - 1);
    expect(one.has('image')).toBe(false);
    expect(one.size).toBe(items.length - 1);

    const four = toolsThatFit(items, total - 4 * 30);
    for (const id of ['image', 'emoji', 'font', 'undo']) expect(four.has(id)).toBe(false);
    expect(four.has('redo')).toBe(true);
    expect(four.size).toBe(items.length - 4);
  });

  it('uses each tool width, not a count', () => {
    const wide = [
      { id: 'image', width: 100 },
      { id: 'bold', width: 30 },
    ];
    expect([...toolsThatFit(wide, 40)]).toEqual(['bold']);
  });

  it('hides everything hideable when nothing fits, Bold last', () => {
    expect(toolsThatFit(items, 0).size).toBe(0);
    const last = toolsThatFit(items, 30);
    expect([...last]).toEqual(['bold']);
  });

  it('never removes ids that are not in the hide order', () => {
    const mixed = [...items, { id: 'fixed', width: 500 }];
    const kept = toolsThatFit(mixed, 0);
    expect([...kept]).toEqual(['fixed']);
  });
});
