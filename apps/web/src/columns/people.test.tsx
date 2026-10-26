import type { ColumnDef, PeopleSettings, PeopleValue } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { PersonFilterPopover } from '../components/board-filters/PersonFilterPopover';
import { UserAvatar } from '../components/UserAvatar';
import { resetMembersStore, useMembersStore } from '../data/members-store';
import type { MemberDoc } from '../data/model';
import { makeBoard, ts } from '../test/fixtures';
import { peopleUi } from './people';
import type { CellContext } from './types';

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../data/members-source', () => ({ subscribeToMembers: () => () => undefined }));

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

afterEach(() => resetMembersStore());

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
