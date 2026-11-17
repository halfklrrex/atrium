import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc } from '../../test/fixtures';
import { NewDocDialog } from './DocDialogs';

const mocks = vi.hoisted(() => ({ createDoc: vi.fn(), docs: [] as unknown[] }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useWorkspaceDocs: () => ({ data: mocks.docs, loading: false, error: null }),
  docWrites: { createDoc: mocks.createDoc },
}));

function renderDialog(folderId: string | null = null) {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={<NewDocDialog workspaceId="w1" folderId={folderId} onClose={onClose} />}
        />
        <Route path="/docs/:id" element={<p>doc page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return onClose;
}

beforeEach(() => {
  mocks.createDoc.mockReset().mockResolvedValue('new-doc');
  mocks.docs = [];
});

describe('NewDocDialog', () => {
  it('starts with the name "New doc" and Main selected', () => {
    renderDialog();
    expect(screen.getByLabelText('Doc name')).toHaveValue('New doc');
    expect(screen.getByRole('radio', { name: 'Main' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Private' })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Shareable' })).not.toBeInTheDocument();
  });

  it('needs a name', async () => {
    renderDialog();
    await userEvent.clear(screen.getByLabelText('Doc name'));
    expect(screen.getByRole('button', { name: 'Create doc' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('creates the doc after its siblings and opens it', async () => {
    mocks.docs = [makeDoc({ id: 'n0', folderId: 'f1', position: 'a0' })];
    const onClose = renderDialog('f1');
    await userEvent.clear(screen.getByLabelText('Doc name'));
    await userEvent.type(screen.getByLabelText('Doc name'), 'House rules');
    await userEvent.click(screen.getByRole('radio', { name: 'Private' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create doc' }));
    await waitFor(() => expect(mocks.createDoc).toHaveBeenCalled());
    const [uid, workspaceId, input, position] = mocks.createDoc.mock.calls[0] as [
      string,
      string,
      { name: string; kind: string; folderId: string },
      string,
    ];
    expect([uid, workspaceId]).toEqual(['u1', 'w1']);
    expect(input).toMatchObject({ name: 'House rules', kind: 'private', folderId: 'f1' });
    expect(position > 'a0').toBe(true);
    await waitFor(() => expect(screen.getByText('doc page')).toBeInTheDocument());
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the error and stays open when creating fails', async () => {
    mocks.createDoc.mockRejectedValue(new Error('nope'));
    const onClose = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Create doc' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
