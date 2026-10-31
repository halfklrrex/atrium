import { describe, expect, it } from 'vitest';
import { makeBoard, makeItem, makeWorkspace } from '../../test/fixtures';
import {
  capGroups,
  filterByName,
  flattenGroups,
  groupsForTab,
  highlightParts,
  moveActive,
  nameMatchesWords,
  rankByPrefix,
  resultPath,
  termWords,
  type SearchGroups,
} from './search-model';

describe('nameMatchesWords', () => {
  it('needs every typed word to start a word of the name', () => {
    expect(nameMatchesWords('Ship the pipeline', termWords('pipe ship'))).toBe(true);
    expect(nameMatchesWords('Ship the pipeline', termWords('pipe deploy'))).toBe(false);
  });

  it('folds accents and case, and checks single characters on the name', () => {
    expect(nameMatchesWords('Café menu', termWords('CAFE m'))).toBe(true);
    expect(nameMatchesWords('Café menu', termWords('cafe z'))).toBe(false);
  });

  it('never matches an empty term', () => {
    expect(nameMatchesWords('Anything', [])).toBe(false);
  });
});

describe('filterByName and rankByPrefix', () => {
  const rows = ['Roadmap', 'Product roadmap', 'Budget'];
  it('filters by substring and puts names starting with the term first', () => {
    expect(filterByName(rows, (r) => r, 'road')).toEqual(['Roadmap', 'Product roadmap']);
    expect(filterByName(['Product roadmap', 'Roadmap'], (r) => r, 'road')).toEqual([
      'Roadmap',
      'Product roadmap',
    ]);
  });

  it('returns nothing for a blank term', () => {
    expect(filterByName(rows, (r) => r, '  ')).toEqual([]);
    expect(rankByPrefix([], (r: string) => r, 'x')).toEqual([]);
  });
});

describe('groups', () => {
  const board = makeBoard({ id: 'b1', name: 'Roadmap' });
  const groups: SearchGroups = {
    workspaces: [
      { kind: 'workspace', id: 'w', workspace: makeWorkspace({ id: 'w1', name: 'Home' }) },
    ],
    boards: [{ kind: 'board', id: 'b', board, workspaceName: 'Home' }],
    items: [
      {
        kind: 'item',
        id: 'i',
        item: makeItem({ id: 'i1', name: 'Ship it' }),
        board,
        groupTitle: 'Now',
      },
    ],
  };

  it('shows the groups of each tab', () => {
    expect(flattenGroups(groupsForTab(groups, 'all'))).toHaveLength(3);
    expect(flattenGroups(groupsForTab(groups, 'boards')).map((r) => r.kind)).toEqual(['board']);
    expect(flattenGroups(groupsForTab(groups, 'items')).map((r) => r.kind)).toEqual(['item']);
  });

  it('caps the total, keeping group order', () => {
    const capped = capGroups(groups, 2);
    expect(flattenGroups(capped).map((r) => r.kind)).toEqual(['workspace', 'board']);
  });

  it('builds the paths', () => {
    expect(resultPath(groups.workspaces[0]!)).toBe('/workspaces/w1');
    expect(resultPath(groups.boards[0]!)).toBe('/boards/b1');
    expect(resultPath(groups.items[0]!)).toBe('/boards/b1/items/i1');
  });
});

describe('moveActive', () => {
  it('wraps and handles an empty list', () => {
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(-1, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});

describe('highlightParts', () => {
  it('marks every typed word, ignoring case and accents', () => {
    expect(highlightParts('Café menu planning', 'cafe PLAN')).toEqual([
      { text: 'Café', match: true },
      { text: ' menu ', match: false },
      { text: 'plan', match: true },
      { text: 'ning', match: false },
    ]);
  });

  it('returns the text untouched without a term', () => {
    expect(highlightParts('Plain', '')).toEqual([{ text: 'Plain', match: false }]);
  });
});
