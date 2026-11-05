import {
  columnRegistry,
  defaultFormSettings,
  defaultViewSettings,
  type ColumnDef,
  type FormSettings,
} from '@atrium/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardViewDoc } from '../../data';
import { syntheticMainView } from '../../data/views';
import { makeBoard } from '../../test/fixtures';
import { chooseMenuItem } from '../../test/menu';
import { BoardViewsContext, type BoardViewsValue } from '../board-views/view-context';
import { viewPermissions } from '../board-views/view-permissions';
import { FormBuilder } from './FormBuilder';

const saveFormFields = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  viewWrites: { saveFormFields },
}));

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const board = makeBoard({
  id: 'b1',
  columns: [
    column('notes', 'text', 'Notes', 'a0'),
    column('when', 'date', 'When', 'a1'),
    column('who', 'people', 'Who', 'a2'),
  ],
  groups: [
    { id: 'g1', title: 'Inbox', color: '#579bfc', position: 'a0' },
    { id: 'g2', title: 'Later', color: '#00c875', position: 'a1' },
  ],
});

const baseForm = (over: Partial<FormSettings> = {}): FormSettings => ({
  ...defaultFormSettings('g1'),
  title: 'Request',
  questions: [
    { columnId: 'name', label: 'Your name', required: true },
    { columnId: 'notes', label: 'Anything else?', required: false },
  ],
  ...over,
});

function renderBuilder(
  options: {
    form?: FormSettings | null;
    canEdit?: boolean;
    boardOver?: Partial<typeof board>;
  } = {},
) {
  const { form = baseForm(), canEdit = true } = options;
  const view: BoardViewDoc = {
    ...syntheticMainView(),
    id: 'v1',
    name: 'Form',
    type: 'form',
    ownerId: null,
    synthetic: undefined,
    settings: { ...defaultViewSettings(), ...(form ? { form } : {}) },
  };
  const value: BoardViewsValue = {
    views: [view],
    view,
    actions: { boardId: 'b1', uid: 'u1', canEdit, views: [view], goTo: vi.fn() },
    permissions: viewPermissions(view, 'u1', canEdit),
    save: () => Promise.resolve(),
    ready: true,
  };
  return render(
    <BoardViewsContext.Provider value={value}>
      <FormBuilder board={{ ...board, ...options.boardOver }} />
    </BoardViewsContext.Provider>,
  );
}

beforeEach(() => saveFormFields.mockClear());

describe('form builder', () => {
  it('shows a live preview of the questions', () => {
    renderBuilder();
    const preview = screen.getByRole('region', { name: 'Form preview' });
    expect(within(preview).getByRole('heading', { name: 'Request' })).toBeInTheDocument();
    expect(within(preview).getByText('Your name')).toBeInTheDocument();
    expect(within(preview).getByText('Anything else?')).toBeInTheDocument();
  });

  it('saves a changed title as a field path patch on blur', async () => {
    renderBuilder();
    const title = screen.getByLabelText('Form title');
    fireEvent.change(title, { target: { value: 'Help request' } });
    fireEvent.blur(title);
    await waitFor(() => expect(saveFormFields).toHaveBeenCalledTimes(1));
    expect(saveFormFields).toHaveBeenCalledWith('b1', 'u1', 'v1', baseForm(), {
      title: 'Help request',
    });
  });

  it('edits a question label and help, and the required switch', async () => {
    renderBuilder();
    const row = screen
      .getByRole('list', { name: 'Questions' })
      .querySelector('[data-question-row="notes"]') as HTMLElement;
    const label = within(row).getByLabelText('Question');
    fireEvent.change(label, { target: { value: 'Notes for us' } });
    fireEvent.blur(label);
    await waitFor(() => expect(saveFormFields).toHaveBeenCalled());
    const patch = saveFormFields.mock.calls[0]![4] as unknown as Partial<FormSettings>;
    expect(patch.questions![1]).toMatchObject({ columnId: 'notes', label: 'Notes for us' });

    await userEvent.click(within(row).getByRole('switch', { name: /Required/ }));
    await waitFor(() => expect(saveFormFields).toHaveBeenCalledTimes(2));
    const second = saveFormFields.mock.calls[1]![4] as unknown as Partial<FormSettings>;
    expect(second.questions![1]!.required).toBe(true);
  });

  it('keeps the item name first, required and not removable', () => {
    renderBuilder();
    const row = document.querySelector('[data-question-row="name"]') as HTMLElement;
    expect(within(row).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Drag/ })).not.toBeInTheDocument();
    expect(within(row).getByRole('switch', { name: /Required/ })).toBeDisabled();
  });

  it('removes a question', async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Anything else?' }));
    await waitFor(() => expect(saveFormFields).toHaveBeenCalled());
    const patch = saveFormFields.mock.calls[0]![4] as unknown as Partial<FormSettings>;
    expect(patch.questions!.map((q) => q.columnId)).toEqual(['name']);
  });

  it('adds a question from the allowed columns only', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderBuilder();
    await user.click(screen.getByRole('button', { name: 'Add question' }));
    expect(await screen.findByRole('menuitem', { name: 'When' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Who' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Notes' })).not.toBeInTheDocument();
    await chooseMenuItem(user, 'When');
    await waitFor(() => expect(saveFormFields).toHaveBeenCalled());
    const patch = saveFormFields.mock.calls[0]![4] as unknown as Partial<FormSettings>;
    expect(patch.questions!.at(-1)).toEqual({ columnId: 'when', label: 'When', required: false });
  });

  it('turns accepting responses on when the form can be published', async () => {
    renderBuilder();
    expect(screen.getByLabelText('Form link')).toHaveValue(`${window.location.origin}/forms/b1/v1`);
    await userEvent.click(screen.getByRole('switch', { name: 'Accepting responses' }));
    await waitFor(() => expect(saveFormFields).toHaveBeenCalled());
    expect(saveFormFields.mock.calls[0]![4]).toEqual({ acceptingResponses: true });
  });

  it('blocks accepting responses and says why when the form is not publishable', async () => {
    renderBuilder({
      form: baseForm({
        questions: [
          { columnId: 'name', label: 'Your name', required: true },
          { columnId: 'gone', label: 'Old question', required: false },
        ],
      }),
    });
    expect(
      screen.getByText(/"Old question" asks about a column that no longer exists/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Accepting responses' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fix these before');
    expect(saveFormFields).not.toHaveBeenCalled();
  });

  it('blocks accepting responses when the target group is gone', async () => {
    renderBuilder({ form: baseForm({ targetGroupId: 'missing' }) });
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Accepting responses' }));
    expect(saveFormFields).not.toHaveBeenCalled();
  });

  it('copies the link', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderBuilder();
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/forms/b1/v1`);
  });

  it('shows viewers the preview only', () => {
    renderBuilder({ canEdit: false });
    expect(screen.getByRole('region', { name: 'Form preview' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Accepting responses' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Form title')).not.toBeInTheDocument();
    expect(screen.getByText(/Only editors of this board can change the form/)).toBeInTheDocument();
  });

  it('offers editors a way to set up a form view without settings', async () => {
    renderBuilder({ form: null });
    await userEvent.click(screen.getByRole('button', { name: 'Set up form' }));
    await waitFor(() => expect(saveFormFields).toHaveBeenCalled());
  });
});
