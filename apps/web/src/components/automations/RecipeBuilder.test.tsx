import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationDoc } from '../../data/automations';
import { makeBoard, ts } from '../../test/fixtures';

const mocks = vi.hoisted(() => ({
  writes: { create: vi.fn(), update: vi.fn() },
  timezone: 'Europe/Madrid' as string | null,
  toast: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }));
vi.mock('../../data/user-timezone', () => ({ useUserTimezone: () => mocks.timezone }));
vi.mock('../../data/members-store', () => ({
  UNKNOWN_PERSON_NAME: 'Board member',
  useUserLookup: () => (uid: string) =>
    uid === 'u2' ? { name: 'Avery Quinn', photoURL: null } : undefined,
  useWorkspaceMembers: () => ({
    members: [{ id: 'u2', displayName: 'Avery Quinn', email: 'avery@example.com' }],
  }),
}));
vi.mock('../toast-store', () => ({ showToast: mocks.toast }));
vi.mock('../../data/automations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  automationWrites: mocks.writes,
}));

import { RecipeBuilder, type RecipeBuilderProps } from './RecipeBuilder';

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
  groups: [
    { id: 'g1', title: 'Done items', color: '#00c875', position: 'a0' },
    { id: 'g2', title: 'New', color: '#579bfc', position: 'a1' },
  ],
});

const dated = makeBoard({
  ...board,
  columns: [
    ...board.columns,
    { id: 'due', type: 'date', title: 'Due date', position: 'a1', settings: {} },
  ],
});

const recipe = (over: Partial<AutomationDoc> = {}): AutomationDoc => ({
  id: 'a1',
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

function renderBuilder(over: Partial<RecipeBuilderProps> = {}) {
  const props: RecipeBuilderProps = {
    board,
    role: 'owner',
    uid: 'u1',
    existingCount: 1,
    automation: null,
    onCancel: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  };
  render(<RecipeBuilder {...props} />);
  return {
    props,
    form: screen.getByRole('form', {
      name: props.automation ? 'Edit automation' : 'New automation',
    }),
  };
}

/** Opens the token called `name` (its accessible name starts with it) and returns its list. */
function open(root: HTMLElement, name: string | RegExp) {
  fireEvent.click(within(root).getByRole('button', { name }));
  return screen.getByRole('listbox');
}

/** Opens a token and picks the row called `option`. */
function pick(root: HTMLElement, name: string | RegExp, option: string | RegExp) {
  fireEvent.click(within(open(root, name)).getByRole('option', { name: option }));
}

const create = (form: HTMLElement) =>
  within(form).getByRole('button', { name: 'Create automation' });
const reads = () => screen.getByRole('status', { name: 'Reads as' });
const blanksLeft = () => screen.getByRole('status', { name: 'Blanks left' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.timezone = 'Europe/Madrid';
  mocks.writes.create.mockResolvedValue('new');
  mocks.writes.update.mockResolvedValue(undefined);
});

describe('The sentence builder', () => {
  it('starts from scratch with a blank trigger and a blank action, and counts the blanks', () => {
    const { form } = renderBuilder();
    expect(within(form).getByText('When')).toBeInTheDocument();
    expect(within(form).getByText('then')).toBeInTheDocument();
    expect(
      within(form).getByRole('button', { name: 'Trigger: something happens' }),
    ).toHaveAttribute('data-blank');
    expect(within(form).getByRole('button', { name: 'Action: do something' })).toBeInTheDocument();
    expect(blanksLeft()).toHaveTextContent('2 blanks left to fill');
    expect(create(form)).toHaveAttribute('aria-disabled', 'true');
    expect(reads()).toHaveTextContent('Fill in the blue blanks to finish the sentence.');
    expect(within(form).queryByRole('alert')).toBeNull();
  });

  it('fills the blanks, then creates the automation and says so', async () => {
    const onSaved = vi.fn();
    const { form } = renderBuilder({ onSaved });
    pick(form, /^Trigger:/, 'an item is created');
    expect(blanksLeft()).toHaveTextContent('1 blank left to fill');
    pick(form, /^Action:/, 'move the item');
    expect(blanksLeft()).toHaveTextContent('1 blank left to fill');
    pick(form, /^Group:/, 'Done items');
    expect(blanksLeft()).toHaveTextContent('Ready');
    expect(reads()).toHaveTextContent('When an item is created, then move the item to Done items');
    await waitFor(() => expect(create(form)).toHaveAttribute('aria-disabled', 'false'));
    fireEvent.click(create(form));
    await waitFor(() => expect(mocks.writes.create).toHaveBeenCalledTimes(1));
    expect(mocks.writes.create.mock.calls[0]![1]).toEqual({
      name: '',
      trigger: { type: 'item_created' },
      conditions: [],
      actions: [{ type: 'move_to_group', groupId: 'g1' }],
    });
    expect(mocks.writes.create.mock.calls[0]![2]).toBe(1);
    expect(mocks.toast).toHaveBeenCalledWith('Automation created and switched on', {
      type: 'positive',
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('saves the optional name', async () => {
    const { form } = renderBuilder({ initial: { ...recipe() } });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: ' Tidy up ' } });
    fireEvent.click(create(form));
    await waitFor(() => expect(mocks.writes.create).toHaveBeenCalled());
    expect(mocks.writes.create.mock.calls[0]![1].name).toBe('Tidy up');
  });

  it('shows the first failure next to the trigger and keeps Save off', () => {
    const { form } = renderBuilder({
      automation: recipe({ trigger: { type: 'status_changed', columnId: 'gone' } }),
    });
    expect(within(form).getByRole('alert')).toHaveTextContent('the column no longer exists');
    expect(within(form).getByRole('button', { name: 'Save changes' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(blanksLeft()).toHaveTextContent('Fix the problem marked in red to continue');
  });

  it('offers up to three conditions and only fitting columns', () => {
    const { form } = renderBuilder({ initial: { ...recipe() } });
    const add = within(form).getByRole('button', { name: /^Add a condition/ });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(within(form).getAllByRole('group', { name: /^Condition / })).toHaveLength(3);
    expect(add).toHaveAttribute('aria-disabled', 'true');
    const list = open(within(form).getByRole('group', { name: 'Condition 1' }), /^Column:/);
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Status']);
  });

  it('keeps "Add a condition" off until a trigger is chosen', () => {
    const { form } = renderBuilder();
    const add = within(form).getByRole('button', { name: /^Add a condition/ });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    pick(form, /^Trigger:/, 'an item is created');
    expect(add).toHaveAttribute('aria-disabled', 'false');
  });

  it('removes conditions one at a time and re-enables adding', () => {
    const { form } = renderBuilder({ initial: { ...recipe() } });
    const add = within(form).getByRole('button', { name: /^Add a condition/ });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(within(form).getByText('(3/3)')).toBeInTheDocument();
    expect(within(form).getByText('At most 3 conditions.')).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Remove condition 2' }));
    expect(within(form).getAllByRole('group', { name: /^Condition / })).toHaveLength(2);
    expect(within(form).getByText('(2/3)')).toBeInTheDocument();
    expect(add).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(within(form).getByRole('button', { name: 'Remove condition 1' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Remove condition 1' }));
    expect(within(form).queryByRole('group', { name: /^Condition / })).toBeNull();
    expect(within(form).getByText('(0/3)')).toBeInTheDocument();
  });

  it('a condition without its value is a blank, and picking the value finishes it', () => {
    const { form } = renderBuilder({ initial: { ...recipe() } });
    expect(blanksLeft()).toHaveTextContent('Ready');
    fireEvent.click(within(form).getByRole('button', { name: /^Add a condition/ }));
    const condition = within(form).getByRole('group', { name: 'Condition 1' });
    // A fresh "Status is ..." has no label yet: one blank, no red message.
    pick(condition, /^Column:/, 'Status');
    expect(within(condition).queryByRole('alert')).toBeNull();
    expect(blanksLeft()).toHaveTextContent('1 blank left to fill');
    expect(create(form)).toHaveAttribute('aria-disabled', 'true');
    pick(condition, /^Value:/, 'Working on it');
    expect(blanksLeft()).toHaveTextContent('Ready');
    expect(reads()).toHaveTextContent('and Status is Working on it');
  });

  it('adds up to five actions, then blocks more, and removing one frees a slot', () => {
    const { form } = renderBuilder({ initial: { ...recipe() } });
    const add = within(form).getByRole('button', { name: /^Add an action/ });
    for (let i = 0; i < 4; i++) fireEvent.click(add);
    expect(within(form).getAllByRole('group', { name: /^Action / })).toHaveLength(5);
    expect(within(form).getByText('(5/5)')).toBeInTheDocument();
    expect(add).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(within(form).getByRole('button', { name: 'Remove action 5' }));
    expect(within(form).getAllByRole('group', { name: /^Action / })).toHaveLength(4);
    expect(add).toHaveAttribute('aria-disabled', 'false');
  });

  it('later actions start with "and" and only a single action cannot be removed', () => {
    const { form } = renderBuilder({ initial: { ...recipe() } });
    expect(within(form).queryByRole('button', { name: /^Remove action/ })).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: /^Add an action/ }));
    expect(within(form).getByText('and')).toBeInTheDocument();
    expect(within(form).getAllByRole('button', { name: /^Remove action/ })).toHaveLength(2);
  });

  it('a starter opens prefilled and ready', () => {
    const { form } = renderBuilder({ initial: { ...recipe() } });
    expect(within(form).getByRole('group', { name: /^Action 1: / })).toBeInTheDocument();
    expect(blanksLeft()).toHaveTextContent('Ready');
    expect(create(form)).toHaveAttribute('aria-disabled', 'false');
  });

  it('warns that saving takes over a recipe someone else made, then updates it', async () => {
    const onSaved = vi.fn();
    const { form } = renderBuilder({
      automation: recipe({ runAs: 'u9', createdBy: 'u9' }),
      onSaved,
    });
    expect(within(form).getByRole('note')).toHaveTextContent(
      'Saving makes you the person this runs as.',
    );
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.writes.update).toHaveBeenCalledTimes(1));
    expect(mocks.writes.update.mock.calls[0]![1]).toBe('a1');
    expect(mocks.toast).toHaveBeenCalledWith('Automation saved', { type: 'positive' });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('Cancel leaves without saving', () => {
    const onCancel = vi.fn();
    const { form } = renderBuilder({ onCancel });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(mocks.writes.create).not.toHaveBeenCalled();
  });

  it('shows a save failure in a toast and stays open', async () => {
    mocks.writes.create.mockRejectedValue(new Error('Nope'));
    const onSaved = vi.fn();
    const { form } = renderBuilder({ initial: { ...recipe() }, onSaved });
    fireEvent.click(create(form));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Nope', { type: 'negative' }));
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('The trigger line', () => {
  it('reads "Status changes to anything" with a Change trigger link', () => {
    const { form } = renderBuilder({
      automation: recipe({ trigger: { type: 'status_changed', columnId: 'status' } }),
    });
    expect(within(form).getByRole('button', { name: 'Status column: Status' })).toBeInTheDocument();
    expect(within(form).getByText('changes to')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Changes to: anything' })).toBeInTheDocument();
    pick(form, 'Change trigger', 'an item is created');
    expect(
      within(form).getByRole('button', { name: /^Trigger: an item is created/ }),
    ).toBeInTheDocument();
    expect(within(form).queryByRole('button', { name: 'Change trigger' })).toBeNull();
  });

  it('lists the status labels as coloured chips, and picks one', () => {
    const { form } = renderBuilder({
      automation: recipe({ trigger: { type: 'status_changed', columnId: 'status' } }),
    });
    const list = open(form, /^Changes to:/);
    const done = within(list).getByRole('option', { name: 'Done' });
    expect(within(done).getByText('Done')).toHaveStyle({ backgroundColor: 'rgb(0, 200, 117)' });
    fireEvent.click(done);
    expect(reads()).toHaveTextContent('When Status changes to Done');
  });

  it('item created has a group token with every group', () => {
    const { form } = renderBuilder({
      initial: { ...recipe({ trigger: { type: 'item_created' } }) },
    });
    const list = open(form, /^In group:/);
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['any group', 'Done items', 'New']);
    fireEvent.click(within(list).getByRole('option', { name: 'New' }));
    expect(reads()).toHaveTextContent('When an item is created in New');
  });

  it('disables a trigger whose column the board lacks and says why', () => {
    const { form } = renderBuilder();
    const list = open(form, /^Trigger:/);
    const option = within(list).getByRole('option', { name: /a date arrives/ });
    expect(option).toBeDisabled();
    expect(option).toHaveTextContent('(no Date column)');
    expect(within(list).getByRole('option', { name: /a button is clicked/ })).toBeDisabled();
    expect(within(list).getByRole('option', { name: /a person is assigned/ })).toBeDisabled();
    expect(within(list).getByRole('option', { name: /a status changes/ })).toBeEnabled();
  });

  it('builds a "Date arrives" recipe with the creator zone', () => {
    const { form } = renderBuilder({ board: dated });
    pick(form, /^Trigger:/, 'a date arrives');
    pick(form, /^When relative to the date:/, 'days before');
    fireEvent.change(within(form).getByLabelText('Days'), { target: { value: '3' } });
    fireEvent.change(within(form).getByLabelText('Time of day'), { target: { value: '08:30' } });
    pick(form, /^Action:/, 'create an item');
    fireEvent.change(within(form).getByLabelText('Item name'), {
      target: { value: 'Weekly review {date}' },
    });
    expect(reads()).toHaveTextContent('3 days before Due date at 08:30 (Europe/Madrid)');
    expect(within(form).getAllByText('(Europe/Madrid)').length).toBeGreaterThan(0);
  });

  it('builds a weekly recurring recipe and limits actions to create item and notify', () => {
    const { form } = renderBuilder({ board: dated });
    pick(form, /^Trigger:/, 'every day, week or month');
    pick(form, /^Repeat:/, 'week');
    pick(form, /^Weekday:/, 'Friday');
    fireEvent.change(within(form).getByLabelText('Time of day'), { target: { value: '17:00' } });
    const list = open(form, /^Action:/);
    const rows = within(list).getAllByRole('option');
    expect(
      rows.filter((o) => !(o as HTMLButtonElement).disabled).map((o) => o.textContent),
    ).toEqual(['notify someone', 'create an item']);
    fireEvent.click(within(list).getByRole('option', { name: 'create an item' }));
    fireEvent.change(within(form).getByLabelText('Item name'), { target: { value: 'Review' } });
    expect(reads()).toHaveTextContent(
      'Every Friday at 17:00 (Europe/Madrid), then create an item "Review"',
    );
  });

  it('saves a scheduled recipe with the timezone', async () => {
    const { form } = renderBuilder({ board: dated });
    pick(form, /^Trigger:/, 'every day, week or month');
    pick(form, /^Repeat:/, 'month');
    pick(form, /^Day of month:/, '15');
    pick(form, /^Action:/, 'create an item');
    fireEvent.change(within(form).getByLabelText('Item name'), { target: { value: 'Review' } });
    await waitFor(() => expect(create(form)).toHaveAttribute('aria-disabled', 'false'));
    fireEvent.click(create(form));
    await waitFor(() => expect(mocks.writes.create).toHaveBeenCalledTimes(1));
    const input = mocks.writes.create.mock.calls[0]![1];
    expect(input.timezone).toBe('Europe/Madrid');
    expect(input.trigger).toEqual({
      type: 'recurring',
      every: 'month',
      dayOfMonth: 15,
      at: '09:00',
    });
  });

  it('falls back to the browser zone when the profile has none', () => {
    mocks.timezone = null;
    const { form } = renderBuilder({ board: dated });
    pick(form, /^Trigger:/, 'every day, week or month');
    expect(within(form).getAllByText(/^\(/)[0]).toBeInTheDocument();
  });

  it('shows the scheduled cap message when the board already has five', () => {
    const scheduled = Array.from({ length: 5 }, (_, i) =>
      recipe({
        id: `s${i}`,
        trigger: { type: 'recurring', every: 'day', at: '09:00' },
        timezone: 'UTC',
        actions: [{ type: 'notify', uids: ['u1'] }],
      }),
    );
    const { form } = renderBuilder({ board: dated, existing: scheduled, existingCount: 5 });
    pick(form, /^Trigger:/, 'every day, week or month');
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'A board can have at most 5 scheduled automations',
    );
  });
});

describe('The Reads as panel', () => {
  it('shows bold names and coloured chips once the sentence is complete', () => {
    renderBuilder({ automation: recipe() });
    const panel = reads();
    expect(panel).toHaveTextContent(
      'When Status changes to Done, then move the item to Done items',
    );
    expect(within(panel).getByText('Status').tagName).toBe('STRONG');
    expect(within(panel).getByText('Done')).toHaveStyle({ backgroundColor: 'rgb(0, 200, 117)' });
  });

  it('lists what is still to come and the run limits', () => {
    renderBuilder({ automation: recipe() });
    expect(screen.getByRole('heading', { name: 'Coming soon to the builder' })).toBeInTheDocument();
    expect(screen.getByText('Email, calendar and chat apps')).toBeInTheDocument();
    expect(
      screen.getByText(/at most 100 times an hour, and a chain of automations stops after 3 steps/),
    ).toBeInTheDocument();
  });
});
