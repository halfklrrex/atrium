import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../../test/fixtures';
import { syntheticMainView } from '../../data/views';
import { useToastStore } from '../toast-store';
import { BoardViewsProvider } from './BoardViewsProvider';
import { useBoardViewsContext } from './view-context';

const saveSettings = vi.hoisted(() => vi.fn());

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  viewWrites: { saveSettings },
}));

function SaveButton() {
  const views = useBoardViewsContext();
  return <button onClick={() => void views?.save()}>Save</button>;
}

function renderProvider() {
  const main = syntheticMainView();
  return render(
    <MemoryRouter>
      <BoardViewsProvider board={makeBoard({ id: 'b1' })} views={[main]} view={main} canEdit>
        <SaveButton />
      </BoardViewsProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  saveSettings.mockReset();
  useToastStore.setState({ toasts: [] });
});

describe('saving a view', () => {
  it('keeps the friendly text, adds the error code to the toast and warns in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    saveSettings.mockRejectedValue(error);
    renderProvider();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0]!;
    expect(toast.text).toContain('Could not save the view. Check your connection and try again.');
    expect(toast.text).toContain('permission-denied');
    expect(toast.type).toBe('negative');
    expect(warn).toHaveBeenCalledWith('Could not save the view', error);
    warn.mockRestore();
  });

  it('shows just the friendly text when the error has no code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    saveSettings.mockRejectedValue(new Error('boom'));
    renderProvider();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0]!.text).toBe(
      'Could not save the view. Check your connection and try again.',
    );
  });
});
