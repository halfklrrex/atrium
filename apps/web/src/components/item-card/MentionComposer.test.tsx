import type { Editor } from '@tiptap/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

// The editor chunk is lazy; load it once up front so no test waits on the first transform.
beforeAll(async () => {
  await import('./UpdateComposer');
}, 60_000);

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

/** The TipTap editor behind the (first) composer on screen. */
const editorOf = (): Editor => {
  const dom = document.querySelector('.ProseMirror') as (HTMLElement & { editor: Editor }) | null;
  if (!dom) throw new Error('no editor');
  return dom.editor;
};
const typeInto = (editor: Editor, value: string) =>
  act(() => {
    editor.commands.focus();
    editor.commands.insertContent(value);
  });
const chipsIn = (editor: Editor) => {
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'mention') found.push(node.attrs);
  });
  return found;
};

describe('@mentions in the update composer', () => {
  const mount = async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await screen.findByRole('textbox', { name: 'Write an update and mention others with @' });
  };

  it('opens a list of members who can read the board and filters it as you type', async () => {
    await mount();
    typeInto(editorOf(), 'Hi @');
    const list = await screen.findByRole('listbox', { name: 'People' });
    // Like the description's list: everyone who can read the board, but not the member without access.
    expect(list).toHaveTextContent('Avery Quinn');
    expect(list).toHaveTextContent('Jordan Lee');
    expect(list).toHaveTextContent('Sam Rivera');
    expect(list).not.toHaveTextContent('Jules Former');

    typeInto(editorOf(), 'sam');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Jordan Lee/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: /Sam Rivera/ })).toBeInTheDocument();
  });

  it('inserts a chip when picked and sends its uid with the update', async () => {
    await mount();
    typeInto(editorOf(), 'Hi @jor');
    await userEvent.click(await screen.findByRole('option', { name: /Jordan Lee/ }));
    expect(chipsIn(editorOf())).toEqual([
      expect.objectContaining({ id: 'u2', label: 'Jordan Lee' }),
    ]);
    expect(editorOf().getText()).toBe('Hi @Jordan Lee ');
    expect(screen.queryByRole('listbox', { name: 'People' })).not.toBeInTheDocument();

    typeInto(editorOf(), 'please look');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(mockCreateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Hi @Jordan Lee please look',
        mentions: ['u2'],
        contentDoc: expect.objectContaining({ type: 'doc' }),
      }),
    );
  });

  it('picks with the keyboard', async () => {
    await mount();
    typeInto(editorOf(), '@');
    await screen.findByRole('listbox', { name: 'People' });
    fireEvent.keyDown(editorOf().view.dom, { key: 'ArrowDown' });
    fireEvent.keyDown(editorOf().view.dom, { key: 'Enter' });
    expect(chipsIn(editorOf())).toEqual([expect.objectContaining({ id: 'u2' })]);
  });

  it('drops the id when the chip was deleted before sending', async () => {
    await mount();
    typeInto(editorOf(), '@jor');
    await userEvent.click(await screen.findByRole('option', { name: /Jordan Lee/ }));
    act(() => {
      editorOf().commands.clearContent();
    });
    typeInto(editorOf(), 'never mind');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    const sent = mockCreateUpdate.mock.calls[0]?.[0] as { mentions?: string[] };
    expect(sent.mentions).toEqual([]);
  });

  it('does not open for an @ inside a word', async () => {
    await mount();
    typeInto(editorOf(), 'mail avery@');
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
    // The editor only exists once the reply box is opened.
    expect(document.querySelector('.ProseMirror')).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Write a reply and mention others with @' }),
    );
    await screen.findByRole('textbox', { name: 'Write a reply and mention others with @' });
    typeInto(editorOf(), '@sam');
    await userEvent.click(await screen.findByRole('option', { name: /Sam Rivera/ }));
    typeInto(editorOf(), 'thanks');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(mockCreateReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '@Sam Rivera thanks', mentions: ['u3'] }),
    );
  });
});
