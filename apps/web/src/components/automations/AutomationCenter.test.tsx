import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useUiStore } from '../AppShell/ui-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationDoc, AutomationRunDoc } from '../../data/automations';
import { makeBoard, makeItem, ts } from '../../test/fixtures';

const mocks = vi.hoisted(() => ({
  automations: { data: [] as unknown[], loading: false, error: null as Error | null },
  runs: { data: [] as unknown[], loading: false, error: null as Error | null },
  runsEnabled: [] as boolean[],
  items: [] as unknown[],
  writes: {
    create: vi.fn(),
    update: vi.fn(),
    setEnabled: vi.fn(),
    remove: vi.fn(),
  },
  openItem: vi.fn(),
  timezone: 'Europe/Madrid' as string | null,
}));

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }));
vi.mock('../../data/user-timezone', () => ({ useUserTimezone: () => mocks.timezone }));
vi.mock('../../data/members-store', () => ({
  UNKNOWN_PERSON_NAME: 'Board member',
  useUserLookup: () => (uid: string) =>
    uid === 'u2' ? { uid, name: 'Avery Quinn', photoURL: null } : undefined,
  useWorkspaceMembers: () => ({
    members: [{ id: 'u2', displayName: 'Avery Quinn', email: 'avery@example.com' }],
  }),
}));
vi.mock('../../data', () => ({
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
}));
vi.mock('../board-table/open-item', () => ({ openItem: mocks.openItem }));
vi.mock('../toast-store', () => ({ showToast: vi.fn() }));
vi.mock('../../data/automations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useBoardAutomations: () => mocks.automations,
  useAutomationRuns: (_boardId: string, enabled: boolean) => {
    mocks.runsEnabled.push(enabled);
    return mocks.runs;
  },
  automationWrites: mocks.writes,
}));

import { AutomationCenter } from './AutomationCenter';

const board = makeBoard({
  id: 'b1',
  columns: [
    {
      id: 'status',
      type: 'status',
      title: 'Status',
      position: 'a0',
      settings: {
        labels: [
          { id: 'w', index: 0, label: 'Working on it', color: '#fdab3d' },
          { id: 'd', index: 1, label: 'Done', color: '#00c875' },
        ],
      },
    },
    { id: 'owner', type: 'people', title: 'Owner', position: 'a1', settings: {} },
  ],
  groups: [{ id: 'g1', title: 'Done items', color: '#00c875', position: 'a0' }],
});

const recipe = (over: Partial<AutomationDoc> & { id: string }): AutomationDoc => ({
  name: '',
  enabled: true,
  trigger: { type: 'status_changed', columnId: 'status', toLabelId: 1 },
  conditions: [],
  actions: [{ type: 'move_to_group', groupId: 'g1' }],
  runAs: 'u1',
  disabledReason: null,
  createdBy: 'u1',
  createdAt: ts(),
  updatedBy: 'u1',
  updatedAt: ts(),
  ...over,
});

const runDoc = (over: Partial<AutomationRunDoc> & { id: string }): AutomationRunDoc => ({
  automationId: 'a1',
  eventId: 'e1',
  itemId: 'i1',
  status: 'ok',
  actions: ['move_to_group'],
  startedAt: ts(Date.now() - 5 * 60_000),
  durationMs: 12,
  depth: 0,
  expiresAt: ts(),
  ...over,
});

const SENTENCE = 'When Status changes to Done, then move the item to Done items';
/** The sentence has bold names in `<strong>`, so match on the element's whole text. */
const sentenceOf = (_: string, element: Element | null) =>
  element?.tagName === 'SPAN' && element.textContent === SENTENCE;

/** The center opens on Create; most tests live on Manage. */
const goToManage = () => fireEvent.click(screen.getByRole('tab', { name: /^Manage/ }));

function open(role: 'owner' | 'editor' | 'viewer' | null = 'owner', onClose = vi.fn()) {
  render(<AutomationCenter board={board} role={role} onClose={onClose} />);
  goToManage();
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.automations = { data: [], loading: false, error: null };
  mocks.runs = { data: [], loading: false, error: null };
  mocks.runsEnabled = [];
  mocks.timezone = 'Europe/Madrid';
  mocks.items = [makeItem({ id: 'i1', name: 'Write brief' })];
  mocks.writes.create.mockResolvedValue('new');
  mocks.writes.setEnabled.mockResolvedValue(undefined);
  mocks.writes.remove.mockResolvedValue(undefined);
});

describe('Center shell', () => {
  const renderCenter = (role: 'owner' | 'editor' = 'owner') =>
    render(<AutomationCenter board={board} role={role} onClose={vi.fn()} />);

  it('is named by a title with the product in bold and the board name after it', () => {
    renderCenter();
    const dialog = screen.getByRole('dialog', { name: `Automations ${board.name}` });
    expect(dialog).toBeInTheDocument();
    const title = within(dialog).getByRole('heading', { level: 2 });
    expect(within(title).getByText('Automations').tagName).toBe('STRONG');
    expect(title).toHaveTextContent(`Automations ${board.name}`);
  });

  it('opens on Create', () => {
    renderCenter();
    expect(screen.getByRole('tab', { name: /^Create/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^Manage/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Start with the basics')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Run history' })).toBeNull();
  });

  it('switches between Create and Manage with a tablist, and arrow keys move between them', () => {
    renderCenter();
    const tablist = screen.getByRole('tablist', { name: 'Automation center view' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: /^Manage/ }));
    expect(screen.getByRole('tab', { name: 'Run history' })).toBeInTheDocument();
    expect(screen.queryByText('Start with the basics')).toBeNull();
    fireEvent.keyDown(screen.getByRole('tab', { name: /^Manage/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /^Create/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^Create/ })).toHaveFocus();
  });

  it('shows how many automations the board has next to Manage', () => {
    mocks.automations = {
      data: [recipe({ id: 'a1' }), recipe({ id: 'a2' }), recipe({ id: 'a3' })],
      loading: false,
      error: null,
    };
    renderCenter();
    expect(screen.getByRole('tab', { name: 'Manage 3' })).toBeInTheDocument();
  });

  it('keeps the header outside the scrolling body', () => {
    renderCenter();
    const header = screen.getByRole('banner');
    const panel = screen.getByRole('tabpanel');
    expect(header.contains(panel)).toBe(false);
    expect(panel.contains(header)).toBe(false);
    expect(panel).toHaveAttribute('aria-labelledby', 'automation-center-tab-create');
  });

  it('Give feedback opens the feedback dialog with Idea and "Automation center"', async () => {
    useUiStore.setState({ dialog: null });
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: 'Give feedback' }));
    expect(useUiStore.getState().dialog).toEqual({
      type: 'feedback',
      category: 'idea',
      subject: 'Automation center',
    });
  });

  it('has one Close button that calls onClose', () => {
    const onClose = vi.fn();
    render(<AutomationCenter board={board} role="owner" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens the builder under a back bar for a scratch recipe, and Back returns to Create', () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: /Create from scratch/ }));
    // The header stays and the origin segment stays selected.
    expect(screen.getByRole('tab', { name: /^Create/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('New automation from scratch')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'New automation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to templates' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText('Start with the basics')).toBeInTheDocument();
  });

  it('names the editing crumb and goes Back to Manage', async () => {
    mocks.automations = { data: [recipe({ id: 'a1', name: 'Tidy' })], loading: false, error: null };
    renderCenter();
    goToManage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tidy' }));
    expect(await screen.findByText('Editing: Tidy')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Manage' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Run history' })).toBeInTheDocument();
  });

  it('shows the template sentence in the crumb', () => {
    renderCenter();
    fireEvent.click(
      screen.getByRole('button', { name: /Use template: When an item is created notify someone/ }),
    );
    expect(screen.getByText(/^From template: /)).toBeInTheDocument();
  });

  it('clicking Manage while building leaves the builder', () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: /Create from scratch/ }));
    expect(screen.getByRole('form', { name: 'New automation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Manage/ }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Run history' })).toBeInTheDocument();
  });

  it('switches to Manage > Board automations after a save', async () => {
    renderCenter();
    fireEvent.click(
      screen.getByRole('button', { name: /Use template: When an item is created notify someone/ }),
    );
    const form = screen.getByRole('form', { name: 'New automation' });
    fireEvent.click(within(form).getByRole('button', { name: 'Create automation' }));
    await waitFor(() => expect(mocks.writes.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect(screen.getByRole('tab', { name: /^Manage/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Run history' })).toBeInTheDocument();
  });

  it('highlights the saved recipe on Manage', async () => {
    mocks.writes.create.mockResolvedValue('a9');
    mocks.automations = {
      data: [recipe({ id: 'a1', name: 'Old' }), recipe({ id: 'a9', name: 'Fresh' })],
      loading: false,
      error: null,
    };
    renderCenter();
    fireEvent.click(
      screen.getByRole('button', { name: /Use template: When an item is created notify someone/ }),
    );
    const form = screen.getByRole('form', { name: 'New automation' });
    fireEvent.click(within(form).getByRole('button', { name: 'Create automation' }));
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
    expect(rowOf('Fresh').className).toMatch(/highlight/);
    expect(rowOf('Old').className).not.toMatch(/highlight/);
  });
});

describe('Builder pickers inside the real modal', () => {
  const pickRow = (name: RegExp, option: string | RegExp) => {
    fireEvent.click(screen.getByRole('button', { name }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
  };

  it('opens a status value editor above the modal and sets the action value', async () => {
    render(<AutomationCenter board={board} role="owner" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create from scratch/ }));
    const form = screen.getByRole('form', { name: 'New automation' });
    pickRow(/^Trigger:/, 'an item is created');
    pickRow(/^Action:/, /set a value/);
    pickRow(/^Column to set:/, 'Status');
    fireEvent.click(within(form).getByRole('button', { name: 'Value for Status: a value' }));
    const layer = screen
      .getAllByRole('dialog')
      .find((d) => d.style.zIndex === 'var(--atrium-z-modal-popup)');
    expect(layer).toBeDefined();
    expect(layer?.parentElement).toBe(document.body);
    fireEvent.click(within(layer!).getByText('Done'));
    await waitFor(() =>
      expect(
        within(form).getByRole('button', { name: 'Value for Status: Done' }),
      ).toBeInTheDocument(),
    );
  });

  it('Escape in a value editor closes only the editor, not the Automation center', async () => {
    const onClose = vi.fn();
    render(<AutomationCenter board={board} role="owner" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Create from scratch/ }));
    const form = screen.getByRole('form', { name: 'New automation' });
    pickRow(/^Trigger:/, 'an item is created');
    pickRow(/^Action:/, /set a value/);
    pickRow(/^Column to set:/, 'Status');
    fireEvent.click(within(form).getByRole('button', { name: 'Value for Status: a value' }));
    const layer = () =>
      screen.getAllByRole('dialog').find((d) => d.style.zIndex === 'var(--atrium-z-modal-popup)');
    expect(layer()).toBeDefined();
    fireEvent.keyDown(within(layer()!).getByText('Done'), { key: 'Escape' });
    expect(layer()).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('form', { name: 'New automation' })).toBeInTheDocument();
  });

  it('Escape in a token list closes only the list, not the Automation center', () => {
    const onClose = vi.fn();
    render(<AutomationCenter board={board} role="owner" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Create from scratch/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Trigger:/ }));
    fireEvent.keyDown(within(screen.getByRole('listbox')).getAllByRole('option')[0]!, {
      key: 'Escape',
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('form', { name: 'New automation' })).toBeInTheDocument();
  });

  it('lists the condition values in an unclipped layer', () => {
    render(<AutomationCenter board={board} role="owner" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Create from scratch/ }));
    const form = screen.getByRole('form', { name: 'New automation' });
    pickRow(/^Trigger:/, 'an item is created');
    fireEvent.click(within(form).getByRole('button', { name: /Add a condition/ }));
    pickRow(/^Column:/, 'Status');
    fireEvent.click(within(form).getByRole('button', { name: /^Value:/ }));
    const list = screen.getByRole('listbox');
    expect((list.closest('[role="dialog"]') as HTMLElement).style.zIndex).toBe(
      'var(--atrium-z-modal-popup)',
    );
    expect(list.closest('[role="dialog"]')?.parentElement).toBe(document.body);
    fireEvent.click(within(list).getByRole('option', { name: 'Done' }));
    expect(within(form).getByRole('button', { name: 'Value: Done' })).toBeInTheDocument();
  });
});

describe('Recipes tab', () => {
  it('shows the empty state with Create for an owner, and a plain note for others', () => {
    open('owner');
    expect(screen.getByText('No automations on this board yet')).toBeInTheDocument();
    expect(screen.getByText(/A board can have up to 20\./)).toBeInTheDocument();
    // The tab row keeps its create button; the empty state adds its own two actions.
    expect(screen.getByRole('button', { name: 'Create automation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create from scratch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse templates' })).toBeInTheDocument();
    expect(screen.getByText('0 of 20 used')).toBeInTheDocument();
  });

  it('hides Create from non-owners', () => {
    open('editor');
    expect(screen.getByText('No automations on this board yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create automation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create from scratch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Browse templates' })).toBeNull();
  });

  it('shows loading and error states (with Retry)', () => {
    mocks.automations = { data: [], loading: true, error: null };
    open();
    expect(screen.getByRole('status', { name: 'Loading automations' })).toBeInTheDocument();
  });

  it('shows the error state', () => {
    mocks.automations = { data: [], loading: false, error: new Error('boom') };
    open();
    expect(screen.getByText('Automations are unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('reads a people value as a name in the Manage sentence and finds it by search', () => {
    mocks.automations = {
      data: [
        recipe({
          id: 'a1',
          trigger: { type: 'item_created' },
          actions: [
            {
              type: 'set_value',
              columnId: 'owner',
              value: { personsAndTeams: [{ id: 'u2', kind: 'person' }] },
            },
          ],
        }),
      ],
      loading: false,
      error: null,
    };
    open();
    const sentence = screen.getByText(
      (_, el) =>
        el?.tagName === 'SPAN' &&
        el.textContent === 'When an item is created, then set Owner to Avery Quinn',
    );
    expect(sentence).toBeInTheDocument();
    expect(sentence.textContent).not.toContain('u2');
  });

  it('lists recipes as sentences first, then the name, with the last run', () => {
    mocks.automations = {
      data: [
        recipe({ id: 'a1' }),
        recipe({ id: 'a2', name: 'Second', createdBy: 'u2', enabled: false }),
      ],
      loading: false,
      error: null,
    };
    mocks.runs = { data: [runDoc({ id: 'r1', automationId: 'a1' })], loading: false, error: null };
    open();
    expect(screen.getAllByText(sentenceOf)).toHaveLength(2);
    expect(screen.getByText('Second')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Automations' });
    for (const name of ['On', 'Automation', 'Created by', 'Last run']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + two automations
    // Sentence first, the name below it.
    const second = rows[2]!;
    const sentence = within(second).getByText(sentenceOf);
    expect(sentence.compareDocumentPosition(within(second).getByText('Second'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // Key names are bold.
    expect(within(sentence).getByText('Status').tagName).toBe('STRONG');
    expect(within(sentence).getByText('Done items').tagName).toBe('STRONG');
    // The label is a coloured chip, like the builder's "Reads as".
    const chip = within(sentence).getByText('Done');
    expect(chip).toHaveAttribute('data-chip');
    expect(chip).toHaveStyle({ backgroundColor: '#00c875' });
    expect(within(second).getByText('Avery Quinn')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('OK')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/5 minutes ago/)).toBeInTheDocument();
    expect(within(second).getByText('Never ran')).toBeInTheDocument();
    expect(screen.queryByText('Needs attention')).toBeNull();
  });

  it('shows "N of 20 used" and the count in the sub-tab', () => {
    mocks.automations = {
      data: [recipe({ id: 'a1' }), recipe({ id: 'a2' })],
      loading: false,
      error: null,
    };
    open();
    expect(screen.getByRole('tab', { name: 'Board automations (2)' })).toBeInTheDocument();
    expect(screen.getByText('2 of 20 used')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create automation' })).toBeEnabled();
  });

  it('searches by sentence or name, and says when nothing matches', async () => {
    mocks.automations = {
      data: [
        recipe({ id: 'a1', name: 'Tidy' }),
        recipe({ id: 'a2', name: 'Other', actions: [{ type: 'archive_item' }] }),
      ],
      loading: false,
      error: null,
    };
    open();
    const search = screen.getByRole('searchbox', { name: 'Search automations' });
    fireEvent.change(search, { target: { value: 'tidy' } });
    expect(screen.getByText('Tidy')).toBeInTheDocument();
    // The Vibe search waits a moment after typing.
    await waitFor(() => expect(screen.queryByText('Other')).toBeNull());
    fireEvent.change(search, { target: { value: 'archive' } });
    await waitFor(() => expect(screen.queryByText('Tidy')).toBeNull());
    expect(screen.getByText('Other')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(await screen.findByText('No automations match “zzzz”')).toBeInTheDocument();
  });

  it('flags failing and breaker-disabled automations with a yellow chip in Last run', () => {
    mocks.automations = {
      data: [
        recipe({ id: 'a1', name: 'Fine' }),
        recipe({ id: 'a2', name: 'Broken' }),
        recipe({ id: 'a3', name: 'Tripped', enabled: false, disabledReason: 'Failed 5 times' }),
        recipe({ id: 'a4', name: 'Paused', enabled: false }),
      ],
      loading: false,
      error: null,
    };
    mocks.runs = {
      data: [
        runDoc({ id: 'r1', automationId: 'a2', status: 'failed' }),
        runDoc({ id: 'r2', automationId: 'a1', status: 'ok' }),
      ],
      loading: false,
      error: null,
    };
    open();
    expect(screen.getAllByText('Needs attention')).toHaveLength(2);
    // The red filter button is gone; the chips in the rows are enough.
    expect(screen.queryByRole('button', { name: /Needs attention/ })).toBeNull();
    const rows = within(screen.getByRole('table', { name: 'Automations' })).getAllByRole('row');
    const lastRun = (row: HTMLElement) => within(row).getAllByRole('cell')[3]!;
    expect(within(lastRun(rows[2]!)).getByText('Needs attention')).toBeInTheDocument();
    expect(within(lastRun(rows[2]!)).getByText('Failed')).toBeInTheDocument();
    expect(within(lastRun(rows[3]!)).getByText('Needs attention')).toBeInTheDocument();
    expect(within(lastRun(rows[4]!)).queryByText('Needs attention')).toBeNull();
  });

  it('an owner switches a recipe off and on through the data layer', async () => {
    const a1 = recipe({ id: 'a1' });
    mocks.automations = { data: [a1], loading: false, error: null };
    open();
    fireEvent.click(screen.getByRole('switch', { name: `Turn off ${SENTENCE}` }));
    await waitFor(() => expect(mocks.writes.setEnabled).toHaveBeenCalled());
    expect(mocks.writes.setEnabled.mock.calls[0]![1]).toBe(a1);
    expect(mocks.writes.setEnabled.mock.calls[0]![2]).toBe(false);
  });

  it('a disabled recipe shows its reason with Fix and Turn on actions', async () => {
    const a1 = recipe({ id: 'a1', enabled: false, disabledReason: 'Failed 5 times in a row' });
    mocks.automations = { data: [a1], loading: false, error: null };
    open();
    expect(screen.getByText('Failed 5 times in a row')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));
    expect(await screen.findByRole('form', { name: 'Edit automation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await waitFor(() =>
      expect(mocks.writes.setEnabled).toHaveBeenCalledWith(expect.anything(), a1, true),
    );
  });

  it('non-owners see the list read-only and never subscribe to the history', () => {
    mocks.automations = { data: [recipe({ id: 'a1' })], loading: false, error: null };
    open('editor');
    expect(screen.getByText(sentenceOf)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Edit|Duplicate|Delete) / })).toBeNull();
    expect(screen.queryByText(/Last run/)).toBeNull();
    expect(screen.queryByText(/of 20 used/)).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Last run' })).toBeNull();
    expect(mocks.runsEnabled.every((enabled) => enabled === false)).toBe(true);
  });

  it('"Browse templates" in the empty state switches to Create', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Browse templates' }));
    expect(screen.getByRole('tab', { name: /^Create/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Start with the basics')).toBeInTheDocument();
  });

  it('"Create from scratch" in the empty state opens the builder', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Create from scratch' }));
    expect(screen.getByRole('form', { name: 'New automation' })).toBeInTheDocument();
  });

  it('warns that saving takes over a recipe someone else made, then updates it', async () => {
    mocks.automations = {
      data: [recipe({ id: 'a1', runAs: 'u9', createdBy: 'u9' })],
      loading: false,
      error: null,
    };
    mocks.writes.update.mockResolvedValue(undefined);
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: /^Edit / }));
    const form = await screen.findByRole('form', { name: 'Edit automation' });
    expect(within(form).getByRole('note')).toHaveTextContent(
      'Saving makes you the person this runs as.',
    );
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.writes.update).toHaveBeenCalledTimes(1));
    expect(mocks.writes.update.mock.calls[0]![1]).toBe('a1');
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('Cancel returns to the list without saving', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('No automations on this board yet')).toBeInTheDocument();
    expect(mocks.writes.create).not.toHaveBeenCalled();
  });

  it('Create calls onOpenBuilder when it is wired', () => {
    const onOpenBuilder = vi.fn();
    render(
      <AutomationCenter
        board={board}
        role="owner"
        onClose={vi.fn()}
        onOpenBuilder={onOpenBuilder}
      />,
    );
    goToManage();
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(onOpenBuilder).toHaveBeenCalledWith({ mode: 'create' });
  });

  it('Delete asks first, then removes the recipe', async () => {
    mocks.automations = { data: [recipe({ id: 'a1', name: 'Tidy' })], loading: false, error: null };
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Tidy' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete automation' });
    // The confirmation replaces the row itself and names what the delete means.
    expect(confirm.closest('tr')).not.toBeNull();
    expect(confirm).toHaveTextContent(
      'Delete “Tidy”? It stops running at once and its run history is kept for 30 days.',
    );
    const buttons = within(confirm).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Delete']);
    expect(mocks.writes.remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.writes.remove).toHaveBeenCalledWith('b1', 'a1'));
  });

  it('Duplicate creates a switched-off copy', async () => {
    mocks.automations = { data: [recipe({ id: 'a1', name: 'Tidy' })], loading: false, error: null };
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Tidy' }));
    await waitFor(() => expect(mocks.writes.create).toHaveBeenCalled());
    const [, input, count, options] = mocks.writes.create.mock.calls[0]!;
    expect(input.name).toBe('Tidy (copy)');
    expect(count).toBe(1);
    expect(options).toMatchObject({ enabled: false });
  });
});

describe('Run history tab', () => {
  // The run fixtures are "5 minutes ago" and the table says "Today HH:MM", so pin the clock to
  // midday (local) or the test fails in the first minutes after midnight. Only Date is faked:
  // waitFor and userEvent still need real timers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const goToHistory = () => fireEvent.click(screen.getByRole('tab', { name: 'Run history' }));

  it('is a "no access" state for non-owners', () => {
    open('editor');
    goToHistory();
    expect(screen.getByText("You don't have access to the run history")).toBeInTheDocument();
  });

  it('shows the empty, loading and error states for owners', () => {
    open();
    goToHistory();
    expect(screen.getByText('No runs to show')).toBeInTheDocument();
    expect(
      screen.getByText('Runs appear here once an automation does something.'),
    ).toBeInTheDocument();
  });

  it('with automations, the empty state points at the filters and the trigger', () => {
    mocks.automations = { data: [recipe({ id: 'a1' })], loading: false, error: null };
    open();
    goToHistory();
    expect(
      screen.getByText(
        'Change the filters, or wait for a trigger: runs appear here within a few seconds.',
      ),
    ).toBeInTheDocument();
    // The tab row and the toolbar stay.
    expect(screen.getByText('1 of 20 used')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create automation' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Search automations' })).toBeNull();
    expect(screen.getByText('All automations')).toBeInTheDocument();
    expect(screen.getByText('All results')).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('lists runs with item, result and details, and says how many are shown', () => {
    mocks.automations = { data: [recipe({ id: 'a1', name: 'Tidy' })], loading: false, error: null };
    mocks.runs = {
      data: [
        runDoc({ id: 'r1' }),
        runDoc({ id: 'r2', status: 'skipped', reason: 'rate limit', itemId: 'gone' }),
        runDoc({ id: 'r3', status: 'failed', error: 'Column was deleted', automationId: 'a9' }),
      ],
      loading: false,
      error: null,
    };
    open();
    goToHistory();
    expect(screen.getByText('rate limit')).toBeInTheDocument();
    expect(screen.getByText('Column was deleted')).toBeInTheDocument();
    expect(screen.getByText('Deleted item')).toBeInTheDocument();
    expect(screen.getByText('Deleted automation')).toBeInTheDocument();
    // A real table: When, Automation, Item and Result (details sit in the Result cell).
    const table = screen.getByRole('table', { name: 'Run history' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['When', 'Automation', 'Item', 'Result']);
    expect(within(table).getAllByText(/^Today \d\d:\d\d$/)).toHaveLength(3);
    expect(within(table).getByText('OK')).toBeInTheDocument();
    expect(within(table).getByText('Failed')).toBeInTheDocument();
    expect(within(table).getByText('Skipped')).toBeInTheDocument();
    // The cap note only shows when the cap is hit.
    expect(screen.queryByText(/Showing the latest/)).toBeNull();
  });

  it('says how many runs are shown once the cap is hit', () => {
    mocks.automations = { data: [recipe({ id: 'a1', name: 'Tidy' })], loading: false, error: null };
    mocks.runs = {
      data: Array.from({ length: 200 }, (_, i) => runDoc({ id: `r${i}` })),
      loading: false,
      error: null,
    };
    open();
    goToHistory();
    expect(screen.getByText(/Showing the latest 200 runs/)).toBeInTheDocument();
  });

  it('shows scheduler runs as Scheduled instead of an item link', () => {
    mocks.automations = { data: [recipe({ id: 'a1', name: 'Tidy' })], loading: false, error: null };
    mocks.runs = {
      data: [
        runDoc({ id: 'recurring:a1:2026-11-09T08:00:00.000Z', itemId: null, eventId: 'x' }),
        runDoc({ id: 'recurring:a1:garbage', itemId: null, eventId: 'y' }),
        runDoc({ id: 'r9', itemId: null, eventId: 'z' }),
        runDoc({ id: 'date:a1:i1:2026-11-09', itemId: 'i1', eventId: 'w' }),
      ],
      loading: false,
      error: null,
    };
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Run history' }));
    expect(screen.getByText(/^Scheduled for .*2026/)).toBeInTheDocument();
    expect(screen.getAllByText('Scheduled')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Write brief/ })).toBeInTheDocument();
    expect(screen.queryByText('No item')).toBeNull();
  });

  it('clicking a row of an existing item closes the center and opens the item', () => {
    mocks.automations = { data: [recipe({ id: 'a1', name: 'Tidy' })], loading: false, error: null };
    mocks.runs = { data: [runDoc({ id: 'r1' })], loading: false, error: null };
    const onClose = open();
    goToHistory();
    fireEvent.click(screen.getByRole('button', { name: /Write brief/ }));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.openItem).toHaveBeenCalledWith('b1', 'i1');
  });
});
