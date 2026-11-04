import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../../test/fixtures';
import { NewBoardDialog } from './BoardDialogs';

const mocks = vi.hoisted(() => ({
  createBoard: vi.fn(),
  createBoardFromTemplate: vi.fn(),
  boards: [] as unknown[],
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1' } }),
}));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useBoards: () => ({ data: mocks.boards, loading: false, error: null }),
  useTemplates: () => ({ data: [], loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
  writes: {
    createBoard: mocks.createBoard,
    createBoardFromTemplate: mocks.createBoardFromTemplate,
  },
}));

function renderDialog(props: { folderId?: string | null } = {}) {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <NewBoardDialog workspaceId="w1" folderId={props.folderId ?? null} onClose={onClose} />
          }
        />
        <Route path="/boards/:id" element={<p>board page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return onClose;
}

beforeEach(() => {
  mocks.createBoard.mockReset().mockResolvedValue('new-board');
  mocks.createBoardFromTemplate.mockReset().mockResolvedValue('from-template');
  mocks.boards = [];
});

describe('NewBoardDialog', () => {
  it('keeps "Create board" disabled until the board has a name', async () => {
    renderDialog();
    const create = screen.getByRole('button', { name: 'Create board' });
    expect(create).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(screen.getByLabelText('Board name'), '   ');
    expect(create).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(screen.getByLabelText('Board name'), 'Roadmap');
    expect(create).toHaveAttribute('aria-disabled', 'false');
  });

  it('offers Main, Private and Shareable with Main selected by default', () => {
    renderDialog();
    expect(screen.getByRole('radio', { name: 'Main' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Private' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Shareable' })).not.toBeChecked();
  });

  it('creates the board with the chosen name and type, then opens it', async () => {
    const onClose = renderDialog({ folderId: 'f1' });
    mocks.boards = [makeBoard({ id: 'x', folderId: 'f1', position: 'a0' })];
    await userEvent.type(screen.getByLabelText('Board name'), '  Plans  ');
    await userEvent.click(screen.getByRole('radio', { name: 'Private' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }));

    await waitFor(() => expect(mocks.createBoard).toHaveBeenCalledTimes(1));
    const [uid, workspaceId, input, position] = mocks.createBoard.mock.calls[0] as [
      string,
      string,
      { name: string; kind: string; folderId: string | null },
      string,
    ];
    expect(uid).toBe('u1');
    expect(workspaceId).toBe('w1');
    expect(input).toEqual({ name: 'Plans', kind: 'private', folderId: 'f1' });
    expect(typeof position).toBe('string');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText('board page')).toBeInTheDocument();
  });

  it('shows an error and stays open when the write fails', async () => {
    mocks.createBoard.mockRejectedValue({ code: 'permission-denied' });
    const onClose = renderDialog();
    await userEvent.type(screen.getByLabelText('Board name'), 'Nope');
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission");
    expect(onClose).not.toHaveBeenCalled();
  });

  it('creates a board from a built-in template with its name prefilled', async () => {
    renderDialog();
    expect(screen.getByRole('radio', { name: 'Blank board' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Template' }));
    // Nothing picked yet.
    expect(screen.getByRole('button', { name: 'Create board' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('radio', { name: /Project tracker/ }));
    expect(screen.getByLabelText('Board name')).toHaveValue('Project tracker');
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }));

    await waitFor(() => expect(mocks.createBoardFromTemplate).toHaveBeenCalledTimes(1));
    const call = mocks.createBoardFromTemplate.mock.calls[0] as unknown[];
    expect(call[0]).toBe('u1');
    expect(call[2]).toMatchObject({ name: 'Project tracker', kind: 'main', folderId: null });
    expect(call[4]).toMatchObject({ structure: expect.anything() });
    expect(call[5]).toEqual({ includeSampleItems: true });
    expect(mocks.createBoard).not.toHaveBeenCalled();
    expect(await screen.findByText('board page')).toBeInTheDocument();
  });

  it('passes the sample items choice and reports a template failure', async () => {
    mocks.createBoardFromTemplate.mockRejectedValue({ code: 'unavailable' });
    const onClose = renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: 'Template' }));
    await userEvent.click(screen.getByRole('radio', { name: /Bug tracker/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include sample items' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(mocks.createBoardFromTemplate.mock.calls[0]?.[5]).toEqual({ includeSampleItems: false });
    expect(onClose).not.toHaveBeenCalled();
  });
});
