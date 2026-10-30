import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDoc, ItemUpdateDoc, MemberDoc, WorkspaceDoc } from '../../data/model';
import { resetMembersStore, useMembersStore } from '../../data/members-store';
import { makeBoard, makeWorkspace, ts } from '../../test/fixtures';
import { UpdateReplies } from './UpdateReplies';
import { UpdatesFeed } from './UpdatesFeed';

const mockCreateUpdate = vi.fn();
const mockCreateReply = vi.fn();
let mockUpdates: ItemUpdateDoc[] = [];

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data/members-source', () => ({ subscribeToMembers: () => () => undefined }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com' } }),
}));
vi.mock('../../data', async () => ({
  useBoard: () => ({ data: mockBoard, loading: false, error: null }),
  useWorkspace: () => ({ data: mockWorkspace, loading: false, error: null }),
}));
vi.mock('../../data/updates', () => ({
  useItemUpdates: () => ({ data: mockUpdates, loading: false, error: null }),
  useUpdateReplies: () => ({ data: [], loading: false, error: null }),
  createUpdate: (params: unknown) => mockCreateUpdate(params),
  createReply: (params: unknown) => mockCreateReply(params),
  toggleLikeUpdate: vi.fn(),
  toggleLikeReply: vi.fn(),
  deleteUpdate: vi.fn(),
  deleteReply: vi.fn(),
}));

const member = (id: string, displayName: string): MemberDoc => ({
  id,
  displayName,
  photoURL: null,
  email: `${id}@example.com`,
  role: 'member',
  joinedAt: ts(),
  updatedAt: ts(),
});

let mockBoard: BoardDoc;
let mockWorkspace: WorkspaceDoc;

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdates = [];
  mockBoard = makeBoard({ id: 'b1', workspaceId: 'w1' });
  // u4 left the workspace: still listed as a member doc here, but without a role they cannot read.
  mockWorkspace = makeWorkspace({
    id: 'w1',
    roles: { u1: 'owner', u2: 'member', u3: 'viewer' },
  });
  useMembersStore.setState({
    activeWorkspaceId: 'w1',
    byWorkspace: {
      w1: {
        loaded: true,
        error: null,
        members: [
          member('u1', 'Avery Quinn'),
          member('u2', 'Jordan Lee'),
          member('u3', 'Sam Rivera'),
          member('u4', 'Jules Former'),
        ],
      },
    },
  });
});

afterEach(() => resetMembersStore());

describe('@mentions in the update composer', () => {
  const composer = () => screen.getByPlaceholderText('Write an update and mention others with @');

  it('opens a list of members who can read the board and filters it as you type', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await userEvent.type(composer(), 'Hi @');
    const list = await screen.findByRole('listbox', { name: 'People' });
    // Not the author herself, and not the member who has no access.
    expect(list).toHaveTextContent('Jordan Lee');
    expect(list).toHaveTextContent('Sam Rivera');
    expect(list).not.toHaveTextContent('Avery Quinn');
    expect(list).not.toHaveTextContent('Jules Former');

    await userEvent.type(composer(), 'sam');
    expect(screen.queryByRole('option', { name: /Jordan Lee/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Sam Rivera/ })).toBeInTheDocument();
  });

  it('inserts "@Name " when picked and sends the uid with the update', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await userEvent.type(composer(), 'Hi @jor');
    await userEvent.click(await screen.findByRole('option', { name: /Jordan Lee/ }));
    expect(composer()).toHaveValue('Hi @Jordan Lee ');
    expect(screen.queryByRole('listbox', { name: 'People' })).not.toBeInTheDocument();

    await userEvent.type(composer(), 'please look');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(mockCreateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Hi @Jordan Lee please look', mentions: ['u2'] }),
    );
  });

  it('picks with the keyboard', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await userEvent.type(composer(), '@');
    await screen.findByRole('listbox', { name: 'People' });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(composer()).toHaveValue('@Sam Rivera ');
  });

  it('drops the id when the @Name was deleted before sending', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await userEvent.type(composer(), '@jor');
    await userEvent.click(await screen.findByRole('option', { name: /Jordan Lee/ }));
    await userEvent.clear(composer());
    await userEvent.type(composer(), 'never mind');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    const sent = mockCreateUpdate.mock.calls[0]?.[0] as { mentions?: string[] };
    expect(sent.mentions).toEqual([]);
  });

  it('does not open for an @ inside a word', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await userEvent.type(composer(), 'mail avery@');
    expect(screen.queryByRole('listbox', { name: 'People' })).not.toBeInTheDocument();
  });

  it('shows a mentioned name in the primary colour in a posted update', () => {
    mockUpdates = [
      {
        id: 'up1',
        itemId: 'i1',
        authorId: 'u2',
        authorName: 'Jordan Lee',
        content: 'Thanks @Sam Rivera for the help',
        mentions: ['u3'],
        likes: [],
        repliesCount: 0,
        createdAt: ts(),
        updatedAt: ts(),
      },
    ];
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    const mention = screen.getByText('@Sam Rivera');
    expect(mention.tagName).toBe('SPAN');
    expect(mention.className).toMatch(/mention/);
  });
});

describe('opening an update from a notification', () => {
  const update = (): ItemUpdateDoc => ({
    id: 'up1',
    itemId: 'i1',
    authorId: 'u2',
    authorName: 'Jordan Lee',
    content: 'Status of the launch?',
    likes: [],
    repliesCount: 1,
    createdAt: ts(),
    updatedAt: ts(),
  });

  it('scrolls the update into view and marks it', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    mockUpdates = [update()];
    render(<UpdatesFeed boardId="b1" itemId="i1" focusUpdateId="up1" />);
    expect(scroll).toHaveBeenCalled();
    expect(document.getElementById('update-up1')?.className).toMatch(/updateTargeted/);
    scroll.mockRestore();
  });

  it('opens the thread when the notification is about a reply', () => {
    mockUpdates = [{ ...update(), repliesCount: 0 }];
    render(<UpdatesFeed boardId="b1" itemId="i1" focusUpdateId="up1" focusReplyId="r1" />);
    expect(screen.getByLabelText('Replies thread')).toBeInTheDocument();
  });
});

describe('@mentions in the reply composer', () => {
  it('sends the picked uid with the reply', async () => {
    render(<UpdateReplies boardId="b1" itemId="i1" updateId="up1" />);
    const input = screen.getByPlaceholderText('Write a reply and mention others with @');
    await userEvent.type(input, '@sam');
    await userEvent.click(await screen.findByRole('option', { name: /Sam Rivera/ }));
    await userEvent.type(input, 'thanks');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(mockCreateReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '@Sam Rivera thanks', mentions: ['u3'] }),
    );
  });
});
