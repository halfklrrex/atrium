import type { ColumnDef, PeopleSettings, PeopleValue } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { PersonFilterPopover } from '../components/board-filters/PersonFilterPopover';
import { useFilterStore } from '../components/board-filters/filter-store';
import { UserAvatar } from '../components/UserAvatar';
import { resetMembersStore, useMembersStore } from '../data/members-store';
import type { MemberDoc, TeamDoc } from '../data/model';
import { resetTeamsStore, useTeamsStore } from '../data/teams';
import { makeBoard, ts } from '../test/fixtures';
import { peopleUi } from './people';
import type { CellContext } from './types';

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../data/members-source', () => ({ subscribeToMembers: () => () => undefined }));
vi.mock('../data/teams-source', () => ({ subscribeToTeams: () => () => undefined }));

const member = (id: string, name: string, photoURL: string | null = null): MemberDoc => ({
  id,
  displayName: name,
  photoURL,
  email: `${id}@example.com`,
  role: 'member',
  joinedAt: ts(),
  updatedAt: ts(),
});

const auth = {
  status: 'ready',
  user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
} as unknown as AuthContextValue;

const column: ColumnDef = {
  id: 'p1',
  type: 'people',
  title: 'Owner',
  position: 'a0',
  settings: {},
};
const ctx: CellContext = { highlight: '', rowDone: false, canEdit: true };
const settings = {} as PeopleSettings;

beforeEach(() => {
  useMembersStore.setState({
    activeWorkspaceId: 'w1',
    byWorkspace: {
      w1: {
        loaded: true,
        error: null,
        members: [
          member('u1', 'Avery Quinn'),
          member('u2', 'Jordan Lee', 'https://example.com/jordan.png'),
          member('u3', 'Sam Rivera'),
        ],
      },
    },
  });
});

afterEach(() => {
  resetMembersStore();
  resetTeamsStore();
});

const team = (id: string, name: string, color: string, memberUids: string[] = []): TeamDoc =>
  ({ id, name, color, memberUids }) as unknown as TeamDoc;

function seedTeams(...teams: TeamDoc[]) {
  useTeamsStore.setState({ byWorkspace: { w1: { teams, loaded: true, error: null } } });
}

function openEditor(value: PeopleValue | null, onChange = vi.fn(), single = false) {
  const Editor = peopleUi.Editor;
  if (!Editor) throw new Error('people has an editor');
  withAuth(
    <Editor
      value={value}
      settings={{ singlePerson: single }}
      column={column}
      ctx={ctx}
      onChange={onChange}
      onClose={vi.fn()}
      anchor={document.body}
      saveSettings={vi.fn()}
    />,
  );
  return onChange;
}

const withAuth = (ui: React.ReactElement) =>
  render(<AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>);

describe('people cell with workspace members', () => {
  it('shows names and photos of other members instead of "Board member"', () => {
    const value: PeopleValue = {
      personsAndTeams: [
        { id: 'u2', kind: 'person' },
        { id: 'u3', kind: 'person' },
        { id: 'gone', kind: 'person' },
      ],
    };
    const { Cell } = peopleUi;
    withAuth(
      <Cell value={value} settings={settings} column={column} ctx={ctx} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('img', { name: 'Jordan Lee' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sam Rivera' })).toHaveTextContent('SR');
    // Someone who left the workspace stays a neutral avatar.
    expect(screen.getByRole('img', { name: 'Board member' })).toBeInTheDocument();
  });

  it('lists every workspace member in the picker, searchable by name and email', async () => {
    const Editor = peopleUi.Editor;
    if (!Editor) throw new Error('people has an editor');
    const onChange = vi.fn();
    withAuth(
      <Editor
        value={null}
        settings={settings}
        column={column}
        ctx={ctx}
        onChange={onChange}
        onClose={vi.fn()}
        anchor={document.body}
        saveSettings={vi.fn()}
      />,
    );
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(/Avery Quinn$/);
    expect(options[1]).toHaveTextContent(/Jordan Lee$/);
    expect(options[2]).toHaveTextContent(/Sam Rivera$/);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search people'), 'u3@');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.click(screen.getByRole('option', { name: /Sam Rivera/ }));
    expect(onChange).toHaveBeenCalledWith({ personsAndTeams: [{ id: 'u3', kind: 'person' }] });
  });
});

describe('UserAvatar with workspace members', () => {
  it('draws a member from the lookup and lets explicit props win', () => {
    withAuth(
      <>
        <UserAvatar uid="u3" />
        <UserAvatar uid="u3" name="Override Name" />
      </>,
    );
    expect(screen.getByLabelText('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByLabelText('Override Name')).toBeInTheDocument();
  });
});

describe('person filter with workspace members', () => {
  it('offers the workspace members by name when nobody is assigned yet', async () => {
    const board = makeBoard({
      id: 'b1',
      workspaceId: 'w1',
      columns: [column],
    });
    withAuth(<PersonFilterPopover board={board} items={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Filter by person' }));
    expect(screen.getByRole('option', { name: /Jordan Lee/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Sam Rivera/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Board member/ })).not.toBeInTheDocument();
  });
});

describe('people with teams (TEAMS PR 3)', () => {
  beforeEach(() => seedTeams(team('t1', 'Kids', '#0073ea'), team('t2', 'Parents', '#e2445c')));

  it('shows a Teams section only when the workspace has teams', () => {
    openEditor(null);
    expect(screen.getByRole('group', { name: 'Teams' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Kids/ })).toBeInTheDocument();
  });

  it('hides the section without teams', () => {
    seedTeams();
    openEditor(null);
    expect(screen.queryByRole('group', { name: 'Teams' })).not.toBeInTheDocument();
  });

  it('writes a team entry, next to the people already on the cell, and removes it again', async () => {
    const user = userEvent.setup();
    const onChange = openEditor({ personsAndTeams: [{ id: 'u2', kind: 'person' }] });
    await user.click(screen.getByRole('option', { name: /Kids/ }));
    expect(onChange).toHaveBeenCalledWith({
      personsAndTeams: [
        { id: 'u2', kind: 'person' },
        { id: 't1', kind: 'team' },
      ],
    });
  });

  it('deselects a team without touching a person', async () => {
    const user = userEvent.setup();
    const onChange = openEditor({
      personsAndTeams: [
        { id: 'u2', kind: 'person' },
        { id: 't1', kind: 'team' },
      ],
    });
    expect(screen.getByRole('option', { name: /Kids/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: /Kids/ }));
    expect(onChange).toHaveBeenCalledWith({ personsAndTeams: [{ id: 'u2', kind: 'person' }] });
  });

  it('lets a single-person column hold one team, replacing a person', async () => {
    const user = userEvent.setup();
    const onChange = openEditor({ personsAndTeams: [{ id: 'u2', kind: 'person' }] }, vi.fn(), true);
    await user.click(screen.getByRole('option', { name: /Parents/ }));
    expect(onChange).toHaveBeenCalledWith({ personsAndTeams: [{ id: 't2', kind: 'team' }] });
  });

  it('searches teams by name and keeps a deleted team removable', async () => {
    const user = userEvent.setup();
    const onChange = openEditor({ personsAndTeams: [{ id: 'gone', kind: 'team' }] });
    await user.type(screen.getByLabelText('Search people'), 'par');
    expect(screen.queryByRole('option', { name: /Kids/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Parents/ })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search people'));
    await user.click(screen.getByRole('option', { name: /Deleted team/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders team avatars in the cell, and a gray one for a deleted team', () => {
    const { Cell } = peopleUi;
    const value: PeopleValue = {
      personsAndTeams: [
        { id: 't1', kind: 'team' },
        { id: 'gone', kind: 'team' },
      ],
    };
    withAuth(
      <Cell value={value} settings={settings} column={column} ctx={ctx} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('img', { name: 'Kids' })).toHaveTextContent('K');
    expect(screen.getByRole('img', { name: 'Deleted team' })).toBeInTheDocument();
  });
});

describe('person filter with teams (TEAMS PR 3)', () => {
  it('lists teams after the people and toggles a team id', async () => {
    seedTeams(team('t1', 'Kids', '#0073ea'));
    const board = makeBoard({ id: 'b1', workspaceId: 'w1', columns: [column] });
    withAuth(<PersonFilterPopover board={board} items={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Filter by person' }));
    const options = screen.getAllByRole('option');
    expect(options[options.length - 1]).toHaveTextContent('Kids');
    await userEvent.click(screen.getByRole('option', { name: /Kids/ }));
    expect(useFilterStore.getState().getFilterState('b1').personIds).toEqual(['t1']);
  });
});
