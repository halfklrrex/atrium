import { TEAM_LIMITS } from '@atrium/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ts } from '../test/fixtures';
import type { TeamDoc } from './model';
import {
  buildTeamLookup,
  resetTeamsStore,
  retainTeams,
  teamWrites,
  useTeamLookup,
  useTeamsStore,
  useWorkspaceTeams,
} from './teams';

const team = (id: string, over: Partial<TeamDoc> = {}): TeamDoc => ({
  id,
  name: `Team ${id}`,
  color: '#579bfc',
  memberUids: ['u1'],
  createdAt: ts(),
  createdBy: 'u1',
  updatedAt: ts(),
  updatedBy: 'u1',
  ...over,
});

let pushed: Array<(teams: TeamDoc[]) => void> = [];
const subscribeToTeams = vi.fn((_ws: string, onData: (teams: TeamDoc[]) => void) => {
  pushed.push(onData);
  return () => undefined;
});
vi.mock('./teams-source', () => ({
  subscribeToTeams: (ws: string, onData: (teams: TeamDoc[]) => void) =>
    subscribeToTeams(ws, onData),
}));

const create = vi.fn(() => Promise.resolve('t1'));
const update = vi.fn(() => Promise.resolve());
const remove = vi.fn(() => Promise.resolve());
vi.mock('./teams-firestore', () => ({ teamWritesImpl: { create, update, remove } }));

afterEach(() => {
  resetTeamsStore();
  pushed = [];
  subscribeToTeams.mockClear();
  create.mockClear();
  update.mockClear();
  remove.mockClear();
});

describe('buildTeamLookup', () => {
  it('resolves a team and returns undefined for a deleted one', () => {
    const lookup = buildTeamLookup([team('a', { name: 'Kids', memberUids: ['u1', 'u2'] })]);
    expect(lookup('a')).toEqual({
      id: 'a',
      name: 'Kids',
      color: '#579bfc',
      memberUids: ['u1', 'u2'],
    });
    expect(lookup('gone')).toBeUndefined();
  });
});

describe('retainTeams', () => {
  it('shares one listener per workspace and closes it with the last release', () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const a = retainTeams('ws1', subscribe);
    const b = retainTeams('ws1', subscribe);
    expect(subscribe).toHaveBeenCalledTimes(1);
    a();
    a();
    expect(unsubscribe).not.toHaveBeenCalled();
    b();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the last teams when the listener errors', () => {
    let onData: (teams: TeamDoc[]) => void = () => undefined;
    let onError: (error: Error) => void = () => undefined;
    retainTeams('ws1', (_ws, d, e) => {
      onData = d;
      onError = e;
      return () => undefined;
    });
    act(() => onData([team('a')]));
    act(() => onError(new Error('denied')));
    const entry = useTeamsStore.getState().byWorkspace.ws1!;
    expect(entry.teams).toHaveLength(1);
    expect(entry.error?.message).toBe('denied');
  });
});

function Probe() {
  const { teams, loading } = useWorkspaceTeams('ws1');
  const lookup = useTeamLookup('ws1');
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : 'ready'}</span>
      <span data-testid="names">{teams.map((t) => t.name).join(',')}</span>
      <span data-testid="kids">{lookup('k')?.name ?? 'none'}</span>
    </div>
  );
}

describe('useWorkspaceTeams and useTeamLookup', () => {
  it('loads, sorts by name and resolves ids', () => {
    render(<Probe />);
    expect(screen.getByTestId('state').textContent).toBe('loading');
    act(() => pushed[0]!([team('k', { name: 'Kids' }), team('a', { name: 'Adults' })]));
    expect(screen.getByTestId('state').textContent).toBe('ready');
    expect(screen.getByTestId('names').textContent).toBe('Adults,Kids');
    expect(screen.getByTestId('kids').textContent).toBe('Kids');
  });
});

describe('teamWrites', () => {
  it('delegates to the Firestore implementation', async () => {
    const input = { name: 'Kids', color: '#579bfc', memberUids: [] };
    expect(await teamWrites.create('ws1', input)).toBe('t1');
    await teamWrites.update('ws1', 't1', input);
    await teamWrites.remove('ws1', 't1');
    expect(create).toHaveBeenCalledWith('ws1', input);
    expect(update).toHaveBeenCalledWith('ws1', 't1', input);
    expect(remove).toHaveBeenCalledWith('ws1', 't1');
  });

  it('exposes the per-workspace cap the dialog uses', () => {
    expect(TEAM_LIMITS.perWorkspace).toBe(50);
  });
});
