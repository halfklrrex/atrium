import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamDoc } from '../../data';
import { ts } from '../../test/fixtures';
import { TeamAvatar } from './TeamAvatar';
import { TeamDialog, type TeamPerson } from './TeamDialog';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../UserAvatar', () => ({ UserAvatar: () => <span /> }));
vi.mock('../../data/teams-firestore', () => ({
  teamWritesImpl: { create: mocks.create, update: mocks.update, remove: vi.fn() },
}));

const people: TeamPerson[] = Array.from({ length: 101 }, (_, i) => ({
  uid: `u${i}`,
  name: `Person ${i}`,
  email: `p${i}@example.com`,
  photoURL: null,
}));

const fullTeam: TeamDoc = {
  id: 't1',
  name: 'Everyone',
  color: '#579bfc',
  memberUids: people.slice(0, 100).map((p) => p.uid),
  createdAt: ts(),
  createdBy: 'u0',
  updatedAt: ts(),
  updatedBy: 'u0',
};

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue('t2');
  mocks.update.mockReset().mockResolvedValue(undefined);
});

describe('TeamDialog', () => {
  it('stops adding people at 100 members', () => {
    render(<TeamDialog workspaceId="w1" team={fullTeam} people={people} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Edit team' });
    expect(within(dialog).getByText('(100/100)')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Person 100' })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Person 0' })).toBeEnabled();
    expect(within(dialog).getByText('A team holds at most 100 people.')).toBeInTheDocument();
  });

  it('keeps Create disabled until the team has a name, then writes it and closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TeamDialog workspaceId="w1" people={people.slice(0, 3)} onClose={onClose} />);
    const create = screen.getByRole('button', { name: 'Create team' });
    expect(create).toHaveAttribute('aria-disabled', 'true');
    await user.type(screen.getByLabelText('Team name'), '  Kids ');
    await user.click(screen.getByRole('checkbox', { name: 'Person 1' }));
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    await user.click(create);
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith('w1', {
        name: 'Kids',
        color: '#df2f4a',
        memberUids: ['u1'],
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows the error and stays open when the write is refused', async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error('nope'), { code: 'permission-denied' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TeamDialog workspaceId="w1" people={people.slice(0, 3)} onClose={onClose} />);
    await user.type(screen.getByLabelText('Team name'), 'Kids');
    await user.click(screen.getByRole('button', { name: 'Create team' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TeamAvatar', () => {
  it('shows one or two initials, and a neutral circle for a deleted team', () => {
    const { rerender } = render(<TeamAvatar name="Garden crew" color="#00c875" />);
    expect(screen.getByRole('img', { name: 'Garden crew' })).toHaveTextContent('GC');
    rerender(<TeamAvatar name="Deleted team" color={null} />);
    expect(screen.getByRole('img', { name: 'Deleted team' })).toHaveTextContent('DT');
  });
});
