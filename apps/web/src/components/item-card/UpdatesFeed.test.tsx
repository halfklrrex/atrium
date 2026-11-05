import type { Editor } from '@tiptap/react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemUpdateDoc } from '../../data/model';
import { UpdatesFeed } from './UpdatesFeed';

const mockCreateUpdate = vi.fn();
const mockToggleLikeUpdate = vi.fn();

let mockUpdatesData: ItemUpdateDoc[] = [];

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Ada Lovelace' } }),
}));

vi.mock('../../data/updates', () => ({
  useItemUpdates: () => ({
    data: mockUpdatesData,
    loading: false,
    error: null,
  }),
  useUpdateReplies: () => ({
    data: [],
    loading: false,
    error: null,
  }),
  createUpdate: (params: unknown) => mockCreateUpdate(params),
  toggleLikeUpdate: (params: unknown) => mockToggleLikeUpdate(params),
  deleteUpdate: vi.fn(),
}));

/** The TipTap editor behind the composer (ProseMirror's element carries it). */
const editorOf = (): Editor => {
  const dom = document.querySelector('.ProseMirror') as (HTMLElement & { editor: Editor }) | null;
  if (!dom) throw new Error('no editor');
  return dom.editor;
};
const typeInto = (value: string) =>
  act(() => {
    editorOf().commands.focus();
    editorOf().commands.insertContent(value);
  });

/** Focuses the composer like a click would (jsdom cannot hit-test the click). */
const openComposer = async () => {
  await screen.findByRole('textbox');
  act(() => {
    editorOf().commands.focus();
  });
  await screen.findByRole('toolbar', { name: 'Text formatting' });
};

const stamp = {
  seconds: 1700000000,
  nanoseconds: 0,
  toDate: () => new Date(),
  toMillis: () => 1700000000000,
};
const makeUpdate = (over: Partial<ItemUpdateDoc>): ItemUpdateDoc => ({
  id: 'up',
  itemId: 'i1',
  authorId: 'u2',
  authorName: 'Jordan Lee',
  content: 'text',
  likes: [],
  repliesCount: 0,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});

const PLACEHOLDER = 'Write an update and mention others with @';

describe('UpdatesFeed', () => {
  // The editor chunk is lazy; load it once up front so no test waits on the first transform.
  beforeAll(async () => {
    await import('./UpdateComposer');
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdatesData = [];
  });

  it('renders empty state when there are no updates', () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);

    expect(screen.getByText('No updates yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Share updates, ask questions, or post notes for this item/i),
    ).toBeInTheDocument();
  });

  it('renders composer and allows submitting an update', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);

    await screen.findByRole('textbox', { name: PLACEHOLDER });
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();

    await openComposer();
    const submitBtn = screen.getByRole('button', { name: 'Update' });
    expect(submitBtn).toHaveAttribute('aria-disabled', 'true');

    typeInto('Working on responsive layout');
    expect(submitBtn).toHaveAttribute('aria-disabled', 'false');

    await userEvent.click(submitBtn);
    expect(mockCreateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 'b1',
        itemId: 'i1',
        authorId: 'u1',
        content: 'Working on responsive layout',
        contentDoc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Working on responsive layout' }],
            },
          ],
        },
        mentions: [],
      }),
    );
    // Posted: the editor is cleared.
    await waitFor(() => expect(editorOf().isEmpty).toBe(true));
  });

  it('has the real formatting toolbar and not the old markdown-inserting buttons', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await openComposer();
    const toolbar = screen.getByRole('toolbar', { name: 'Text formatting' });
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Link',
      'Bulleted list',
      'Numbered list',
      'Checklist',
      'Text colour and highlight',
    ]) {
      expect(within(toolbar).getByRole('button', { name })).toBeInTheDocument();
    }
    // Emoji and @ moved to the bottom row, under the text.
    for (const name of ['Emoji', 'Mention someone']) {
      expect(within(toolbar).queryByRole('button', { name })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Format bold' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Format italic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Format list' })).not.toBeInTheDocument();
  });

  it('bolds with Ctrl+B', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await openComposer();
    typeInto('Ship it');
    act(() => {
      editorOf().commands.selectAll();
    });
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(editorOf().getJSON().content?.[0]?.content?.[0]).toMatchObject({
      type: 'text',
      text: 'Ship it',
      marks: [{ type: 'bold' }],
    });
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('makes a bulleted list from the toolbar', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await openComposer();
    typeInto('First');
    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));
    expect(editorOf().getJSON().content?.[0]).toMatchObject({
      type: 'bulletList',
      content: [{ type: 'listItem' }],
    });
  });

  it('posts with Ctrl+Enter, mirrors the text and the mentions, and clears', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await openComposer();
    act(() => {
      editorOf().commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }],
              },
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'Two ', marks: [{ type: 'bold' }] },
                      { type: 'mention', attrs: { id: 'u2', label: 'Jordan Lee' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(mockCreateUpdate).toHaveBeenCalledTimes(1));
    expect(mockCreateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'One\nTwo @Jordan Lee',
        mentions: ['u2'],
        contentDoc: expect.objectContaining({ type: 'doc' }),
      }),
    );
    await waitFor(() => expect(editorOf().isEmpty).toBe(true));
  });

  it('cannot post an empty or whitespace-only update', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await openComposer();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    typeInto('   ');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByRole('button', { name: 'Update' })).toHaveAttribute('aria-disabled', 'true');
    expect(mockCreateUpdate).not.toHaveBeenCalled();
  });

  it('keeps the text when posting fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreateUpdate.mockRejectedValueOnce(new Error('offline'));
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    await openComposer();
    typeInto('Keep me');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(editorOf().getText()).toBe('Keep me');
    error.mockRestore();
  });

  it('renders a rich update from its contentDoc and a plain one as before', () => {
    mockUpdatesData = [
      makeUpdate({
        id: 'rich',
        content: 'Bold news',
        contentDoc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Bold news', marks: [{ type: 'bold' }] }],
            },
          ],
        },
      }),
      makeUpdate({ id: 'plain', content: 'Plain old text' }),
    ];
    render(<UpdatesFeed boardId="b1" itemId="i1" />);
    expect(screen.getByText('Bold news').tagName).toBe('STRONG');
    expect(screen.getByText('Plain old text')).toBeInTheDocument();
  });

  it('renders updates with author name, content, and like button', async () => {
    mockUpdatesData = [
      makeUpdate({
        id: 'up1',
        authorId: 'u1',
        authorName: 'Ada Lovelace',
        content: 'Deployed initial version to staging',
        likes: ['u2'],
        repliesCount: 2,
      }),
    ];

    render(<UpdatesFeed boardId="b1" itemId="i1" />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Deployed initial version to staging')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Like update \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replies \(2\)/i })).toBeInTheDocument();

    const likeBtn = screen.getByRole('button', { name: /Like update \(1\)/i });
    await userEvent.click(likeBtn);

    expect(mockToggleLikeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 'b1',
        itemId: 'i1',
        updateId: 'up1',
        uid: 'u1',
      }),
    );
  });
});
