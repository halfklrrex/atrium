import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../../test/fixtures';
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog';

const mocks = vi.hoisted(() => ({
  saveBoardAsTemplate: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../toast-store', () => ({ showToast: mocks.showToast }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useBoard: () => ({
    data: makeBoard({ id: 'b1', name: 'Roadmap' }),
    loading: false,
    error: null,
  }),
  writes: { saveBoardAsTemplate: mocks.saveBoardAsTemplate },
}));

beforeEach(() => {
  mocks.saveBoardAsTemplate.mockReset().mockResolvedValue('t1');
  mocks.showToast.mockReset();
});

describe('SaveAsTemplateDialog', () => {
  it('prefills the board name and saves with the chosen options', async () => {
    const onClose = vi.fn();
    render(<SaveAsTemplateDialog boardId="b1" onClose={onClose} />);
    expect(screen.getByLabelText('Template name')).toHaveValue('Roadmap');
    await userEvent.type(
      screen.getAllByLabelText('Description').find((e) => e.tagName === 'INPUT')!,
      'My plan',
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include items' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => expect(mocks.saveBoardAsTemplate).toHaveBeenCalledTimes(1));
    const [uid, board, input] = mocks.saveBoardAsTemplate.mock.calls[0] as [
      string,
      { id: string },
      unknown,
    ];
    expect(uid).toBe('u1');
    expect(board.id).toBe('b1');
    expect(input).toEqual({ name: 'Roadmap', description: 'My plan', includeItems: true });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.showToast).toHaveBeenCalled();
  });

  it('blocks an empty name', async () => {
    render(<SaveAsTemplateDialog boardId="b1" onClose={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText('Template name'));
    expect(screen.getByRole('button', { name: 'Save template' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('shows the error and stays open when saving fails', async () => {
    mocks.saveBoardAsTemplate.mockRejectedValue(
      new Error('This board is too large to save as a template. Try without its items.'),
    );
    const onClose = vi.fn();
    render(<SaveAsTemplateDialog boardId="b1" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('too large');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('explains a permission failure', async () => {
    mocks.saveBoardAsTemplate.mockRejectedValue({ code: 'permission-denied' });
    render(<SaveAsTemplateDialog boardId="b1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission");
  });
});
