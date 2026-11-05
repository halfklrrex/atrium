import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
}));

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }));
vi.mock('../../data/members-store', () => ({
  UNKNOWN_PERSON_NAME: 'Board member',
  useUserLookup: () => () => undefined,
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

function open(role: 'owner' | 'editor' | 'viewer' | null = 'owner', onClose = vi.fn()) {
  render(<AutomationCenter board={board} role={role} onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.automations = { data: [], loading: false, error: null };
  mocks.runs = { data: [], loading: false, error: null };
  mocks.runsEnabled = [];
  mocks.items = [makeItem({ id: 'i1', name: 'Write brief' })];
  mocks.writes.create.mockResolvedValue('new');
  mocks.writes.setEnabled.mockResolvedValue(undefined);
  mocks.writes.remove.mockResolvedValue(undefined);
});

describe('Center shell', () => {
  it('is titled with the board name and toggles between Manage and Create', () => {
    open('owner');
    expect(screen.getByRole('dialog', { name: `Automations: ${board.name}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Start with the basics')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Run history' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(screen.getByRole('tab', { name: 'Run history' })).toBeInTheDocument();
  });
});

describe('Recipes tab', () => {
  it('shows the empty state with Create for an owner, and a plain note for others', () => {
    open('owner');
    expect(screen.getByText('No automations yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create automation' })).toBeInTheDocument();
  });

  it('hides Create from non-owners', () => {
    open('editor');
    expect(screen.getByText('No automations yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create automation' })).toBeNull();
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

  it('lists recipes as sentences with the last run, and "Never" when none', () => {
    mocks.automations = {
      data: [recipe({ id: 'a1' }), recipe({ id: 'a2', name: 'Second' })],
      loading: false,
      error: null,
    };
    mocks.runs = { data: [runDoc({ id: 'r1', automationId: 'a1' })], loading: false, error: null };
    open();
    expect(screen.getAllByText(SENTENCE)).toHaveLength(2);
    expect(screen.getByText('Second')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Automations' });
    expect(within(table).getByRole('columnheader', { name: 'Last run' })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + two automations
    expect(within(rows[1]!).getByText(/5 minutes ago/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Never')).toBeInTheDocument();
    expect(screen.queryByText('Needs attention')).toBeNull();
  });

  it('marks failing and breaker-disabled automations and filters to them', () => {
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
    const filter = screen.getByRole('button', { name: 'Needs attention (2)' });
    expect(filter).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(filter);
    expect(filter).toHaveAttribute('aria-pressed', 'true');
    const table = screen.getByRole('table', { name: 'Automations' });
    expect(within(table).queryByText('Fine')).toBeNull();
    expect(within(table).queryByText('Paused')).toBeNull();
    expect(within(table).getByText('Broken')).toBeInTheDocument();
    expect(within(table).getByText('Tripped')).toBeInTheDocument();
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

  it('a disabled recipe shows its reason and a Turn on action', async () => {
    const a1 = recipe({ id: 'a1', enabled: false, disabledReason: 'Failed 5 times in a row' });
    mocks.automations = { data: [a1], loading: false, error: null };
    open();
    expect(screen.getByText('Turned off: Failed 5 times in a row')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() =>
      expect(mocks.writes.setEnabled).toHaveBeenCalledWith(expect.anything(), a1, true),
    );
  });

  it('non-owners see the list read-only and never subscribe to the history', () => {
    mocks.automations = { data: [recipe({ id: 'a1' })], loading: false, error: null };
    open('editor');
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /Options for/ })).toBeNull();
    expect(screen.queryByText(/Last run/)).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Last run' })).toBeNull();
    expect(mocks.runsEnabled.every((enabled) => enabled === false)).toBe(true);
  });

  it('Create opens the builder; Save waits for a valid recipe and then creates it', async () => {
    mocks.automations = { data: [recipe({ id: 'a1' })], loading: false, error: null };
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    const form = screen.getByRole('form', { name: 'New automation' });
    const save = within(form).getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(within(form).getByRole('combobox', { name: 'Add action' }), {
      target: { value: 'move_to_group' },
    });
    // The new action starts on the first group, so the recipe is valid.
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'false'));
    fireEvent.click(save);
    await waitFor(() => expect(mocks.writes.create).toHaveBeenCalledTimes(1));
    expect(mocks.writes.create.mock.calls[0]![1]).toEqual({
      name: '',
      trigger: { type: 'item_created' },
      conditions: [],
      actions: [{ type: 'move_to_group', groupId: 'g1' }],
    });
    expect(mocks.writes.create.mock.calls[0]![2]).toBe(1);
  });

  it('shows the first failure next to the trigger and keeps Save off', async () => {
    mocks.automations = {
      data: [recipe({ id: 'a1', trigger: { type: 'status_changed', columnId: 'gone' } })],
      loading: false,
      error: null,
    };
    open('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: /Options for/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Edit automation' });
    expect(within(form).getByRole('alert')).toHaveTextContent('the column no longer exists');
    expect(within(form).getByRole('button', { name: 'Save' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('offers up to three conditions and only fitting columns', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    const form = screen.getByRole('form', { name: 'New automation' });
    const add = within(form).getByRole('button', { name: '+ Add condition' });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(within(form).getAllByRole('group', { name: /^Condition / })).toHaveLength(3);
    expect(add).toHaveAttribute('aria-disabled', 'true');
    const columns = within(
      within(form).getAllByRole('group', { name: 'Condition 1' })[0]!,
    ).getAllByRole('combobox')[0]!;
    expect(
      within(columns)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a column', 'Status']);
  });

  it('reads the builder as a sentence with When, and only if and then parts', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    const form = screen.getByRole('form', { name: 'New automation' });
    expect(within(form).getByText('When')).toBeInTheDocument();
    expect(within(form).getByText('then')).toBeInTheDocument();
    expect(within(form).getByRole('combobox', { name: 'When' })).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: '+ Add condition' }));
    expect(within(form).getByText('and only if')).toBeInTheDocument();
    expect(
      within(form).getByText('Fill in the highlighted parts to finish the sentence.'),
    ).toBeInTheDocument();
  });

  it('removes conditions one at a time and re-enables adding', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    const form = screen.getByRole('form', { name: 'New automation' });
    const add = within(form).getByRole('button', { name: '+ Add condition' });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(within(form).getByText('3/3')).toBeInTheDocument();
    expect(within(form).getByText('At most 3 conditions.')).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Remove condition 2' }));
    expect(within(form).getAllByRole('group', { name: /^Condition / })).toHaveLength(2);
    expect(within(form).getByText('2/3')).toBeInTheDocument();
    expect(add).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(within(form).getByRole('button', { name: 'Remove condition 1' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Remove condition 1' }));
    expect(within(form).queryByRole('group', { name: /^Condition / })).toBeNull();
    expect(within(form).getByText(/matches the trigger/)).toBeInTheDocument();
  });

  it('adds up to five actions, then blocks more, and removing one frees a slot', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    const form = screen.getByRole('form', { name: 'New automation' });
    const addAction = () =>
      fireEvent.change(within(form).getByRole('combobox', { name: 'Add action' }), {
        target: { value: 'move_to_group' },
      });
    for (let i = 0; i < 5; i++) addAction();
    expect(within(form).getAllByRole('group', { name: /^Action / })).toHaveLength(5);
    expect(within(form).getByText('5/5 actions')).toBeInTheDocument();
    expect(within(form).getByRole('combobox', { name: 'Add action' })).toBeDisabled();
    fireEvent.click(within(form).getAllByRole('button', { name: 'Remove' })[0]!);
    expect(within(form).getAllByRole('group', { name: /^Action / })).toHaveLength(4);
    expect(within(form).getByRole('combobox', { name: 'Add action' })).toBeEnabled();
  });

  it('shows a condition problem inside that condition and keeps Save off', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    const form = screen.getByRole('form', { name: 'New automation' });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Add action' }), {
      target: { value: 'move_to_group' },
    });
    const save = within(form).getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(within(form).getByRole('button', { name: '+ Add condition' }));
    const condition = within(form).getByRole('group', { name: 'Condition 1' });
    // A fresh "Status is ..." has no label yet, so the engine refuses it right there.
    fireEvent.change(within(condition).getByRole('combobox', { name: 'Column' }), {
      target: { value: 'status' },
    });
    expect(within(condition).getByRole('alert')).toBeInTheDocument();
    expect(save).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(within(condition).getByRole('combobox', { name: 'Value' }), {
      target: { value: '1' },
    });
    expect(within(condition).queryByRole('alert')).toBeNull();
    expect(save).toHaveAttribute('aria-disabled', 'false');
  });

  it('a starter opens the builder prefilled', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: /notify the board owner/ }));
    const form = screen.getByRole('form', { name: 'New automation' });
    expect(within(form).getByRole('group', { name: /^Action 1: / })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('warns that saving takes over a recipe someone else made, then updates it', async () => {
    mocks.automations = {
      data: [recipe({ id: 'a1', runAs: 'u9', createdBy: 'u9' })],
      loading: false,
      error: null,
    };
    mocks.writes.update.mockResolvedValue(undefined);
    open('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: /Options for/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Edit automation' });
    expect(within(form).getByRole('note')).toHaveTextContent(
      'Saving makes you the person this runs as.',
    );
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.writes.update).toHaveBeenCalledTimes(1));
    expect(mocks.writes.update.mock.calls[0]![1]).toBe('a1');
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('Cancel returns to the list without saving', () => {
    open('owner');
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('No automations yet')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(onOpenBuilder).toHaveBeenCalledWith({ mode: 'create' });
  });

  it('Delete asks first, then removes the recipe', async () => {
    mocks.automations = { data: [recipe({ id: 'a1', name: 'Tidy' })], loading: false, error: null };
    open();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Options for Tidy' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete automation' });
    expect(mocks.writes.remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.writes.remove).toHaveBeenCalledWith('b1', 'a1'));
  });

  it('Duplicate creates a switched-off copy', async () => {
    mocks.automations = { data: [recipe({ id: 'a1', name: 'Tidy' })], loading: false, error: null };
    open();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Options for Tidy' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(mocks.writes.create).toHaveBeenCalled());
    const [, input, count, options] = mocks.writes.create.mock.calls[0]!;
    expect(input.name).toBe('Tidy (copy)');
    expect(count).toBe(1);
    expect(options).toEqual({ enabled: false });
  });
});

describe('Run history tab', () => {
  const goToHistory = () => fireEvent.click(screen.getByRole('tab', { name: 'Run history' }));

  it('is a "no access" state for non-owners', () => {
    open('editor');
    goToHistory();
    expect(screen.getByText("You don't have access to the run history")).toBeInTheDocument();
  });

  it('shows the empty, loading and error states for owners', () => {
    open();
    goToHistory();
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
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
    expect(screen.getByText(/Showing the latest 200 runs/)).toBeInTheDocument();
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
