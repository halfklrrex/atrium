import type { Editor } from '@tiptap/react';
import type { FileAttachment } from '@atrium/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemUpdateDoc, UpdateReplyDoc } from '../../data/model';
import { UpdateReplies } from './UpdateReplies';
import { UpdatesFeed } from './UpdatesFeed';

const mockCreateUpdate = vi.fn();
const mockCreateReply = vi.fn();
const mockRequestUpload = vi.fn();
const mockFinalize = vi.fn();
const mockGetUrl = vi.fn();
const mockRemove = vi.fn();
const mockPut = vi.fn();
const mockToast = vi.fn();

let mockUpdatesData: ItemUpdateDoc[] = [];
let mockReplies: UpdateReplyDoc[] = [];

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Ada Lovelace' } }),
}));
vi.mock('../../data/updates', () => ({
  useItemUpdates: () => ({ data: mockUpdatesData, loading: false, error: null }),
  useUpdateReplies: () => ({ data: mockReplies, loading: false, error: null }),
  createUpdate: (p: unknown) => mockCreateUpdate(p),
  createReply: (p: unknown) => mockCreateReply(p),
  toggleLikeUpdate: vi.fn(),
  toggleLikeReply: vi.fn(),
  deleteUpdate: vi.fn(),
  deleteReply: vi.fn(),
}));
vi.mock('../../lib/callables', () => ({
  updateAttachmentCalls: {
    requestUpload: (r: unknown) => mockRequestUpload(r),
    finalize: (r: unknown) => mockFinalize(r),
    getUrl: (r: unknown) => mockGetUrl(r),
    remove: (r: unknown) => mockRemove(r),
  },
  describeCallableError: (e: unknown, fallback: string) =>
    (e as { message?: string }).message ?? fallback,
}));
vi.mock('../item-view/description-image-upload', () => ({
  putWithProgress: (...args: unknown[]) => mockPut(...args),
}));
vi.mock('../toast-store', () => ({
  showToast: (...args: unknown[]) => mockToast(...args),
}));

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
const openComposer = async () => {
  await screen.findByRole('textbox');
  act(() => {
    editorOf().commands.focus();
  });
  await screen.findByRole('toolbar', { name: 'Text formatting' });
};
const attachInput = () => screen.getByTestId('composer-attach-input') as HTMLInputElement;
const pick = (...files: File[]) => fireEvent.change(attachInput(), { target: { files } });
const file = (name: string, type = 'text/plain', bytes = 10) =>
  new File([new Uint8Array(bytes)], name, { type });

const stamp = {
  seconds: 1700000000,
  nanoseconds: 0,
  toDate: () => new Date(),
  toMillis: () => 1700000000000,
};
const att = (over: Partial<FileAttachment>): FileAttachment => ({
  id: 'f1',
  name: 'notes.txt',
  storagePath: 'x',
  size: 2048,
  mimeType: 'text/plain',
  uploadedAt: '2026-11-01T10:00:00.000Z',
  uploadedBy: 'u2',
  ...over,
});
const makeUpdate = (over: Partial<ItemUpdateDoc>): ItemUpdateDoc => ({
  id: 'up1',
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
const makeReply = (over: Partial<UpdateReplyDoc>): UpdateReplyDoc =>
  ({
    id: 'r1',
    authorId: 'u2',
    authorName: 'Jordan Lee',
    content: 'reply',
    likes: [],
    createdAt: stamp,
    ...over,
  }) as UpdateReplyDoc;

describe('update attachments', () => {
  beforeAll(async () => {
    await import('./UpdateComposer');
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdatesData = [];
    mockReplies = [];
    mockCreateUpdate.mockResolvedValue('new-up');
    mockCreateReply.mockResolvedValue('new-reply');
    mockRequestUpload.mockResolvedValue({
      uploadUrl: 'https://upload.example.com/x',
      fileId: 'fid1',
      expiresAt: 1,
      headers: { 'content-type': 'text/plain' },
    });
    mockFinalize.mockResolvedValue({ attachment: att({}) });
    mockGetUrl.mockResolvedValue({ downloadUrl: 'https://dl.example.com/x', expiresAt: 1 });
    mockRemove.mockResolvedValue({ success: true, attachments: [] });
    mockPut.mockResolvedValue(undefined);
  });

  describe('composer', () => {
    it('shows the attach button after the mention button and lists chosen files as chips', async () => {
      render(<UpdatesFeed boardId="b1" itemId="i1" />);
      await openComposer();
      const mention = screen.getByRole('button', { name: 'Mention someone' });
      const attach = screen.getByRole('button', { name: 'Attach files' });
      expect(
        mention.compareDocumentPosition(attach) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(attachInput()).toHaveAttribute('multiple');

      pick(file('a.txt'), file('b.png', 'image/png'));
      const chips = within(await screen.findByRole('list', { name: 'Files to attach' }));
      expect(chips.getByText('a.txt')).toBeInTheDocument();
      expect(chips.getByText('b.png')).toBeInTheDocument();

      await userEvent.click(chips.getByRole('button', { name: 'Remove a.txt' }));
      expect(chips.queryByText('a.txt')).not.toBeInTheDocument();
    });

    it('refuses an over-cap file and a sixth-plus-tenth file with a message', async () => {
      render(<UpdatesFeed boardId="b1" itemId="i1" />);
      await openComposer();
      pick(file('big.bin', 'application/octet-stream', 26 * 1024 * 1024));
      expect(mockToast).toHaveBeenCalledWith(
        'File "big.bin" exceeds the 25 MB limit.',
        expect.objectContaining({ type: 'negative' }),
      );
      expect(screen.queryByRole('list', { name: 'Files to attach' })).not.toBeInTheDocument();

      pick(...Array.from({ length: 11 }, (_, i) => file(`f${i}.txt`)));
      expect(mockToast).toHaveBeenCalledWith(
        'A post can have at most 10 attachments.',
        expect.objectContaining({ type: 'negative' }),
      );
      const chips = within(await screen.findByRole('list', { name: 'Files to attach' }));
      expect(chips.getAllByRole('listitem')).toHaveLength(10);
    });

    it('posts the update first, then uploads each file against the new update', async () => {
      const order: string[] = [];
      mockCreateUpdate.mockImplementation(async () => {
        order.push('post');
        return 'new-up';
      });
      mockRequestUpload.mockImplementation(async () => {
        order.push('request');
        return {
          uploadUrl: 'https://upload.example.com/x',
          fileId: 'fid1',
          expiresAt: 1,
          headers: {},
        };
      });
      mockFinalize.mockImplementation(async () => {
        order.push('finalize');
        return { attachment: att({}) };
      });

      render(<UpdatesFeed boardId="b1" itemId="i1" />);
      await openComposer();
      typeInto('see attached');
      pick(file('a.txt'));
      await userEvent.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => expect(mockFinalize).toHaveBeenCalled());
      expect(order).toEqual(['post', 'request', 'finalize']);
      expect(mockRequestUpload).toHaveBeenCalledWith({
        boardId: 'b1',
        itemId: 'i1',
        updateId: 'new-up',
        fileName: 'a.txt',
        contentType: 'text/plain',
        size: 10,
      });
      expect(mockPut).toHaveBeenCalledWith(
        'https://upload.example.com/x',
        {},
        expect.any(File),
        expect.any(Function),
      );
      expect(mockFinalize).toHaveBeenCalledWith({
        boardId: 'b1',
        itemId: 'i1',
        updateId: 'new-up',
        fileId: 'fid1',
        fileName: 'a.txt',
      });
      // Done: the chip is gone.
      await waitFor(() =>
        expect(screen.queryByRole('list', { name: 'Files to attach' })).not.toBeInTheDocument(),
      );
    });

    it('keeps the post and shows a retry on a failed upload', async () => {
      mockRequestUpload.mockRejectedValueOnce(new Error('Storage is down'));
      render(<UpdatesFeed boardId="b1" itemId="i1" />);
      await openComposer();
      typeInto('with a file');
      pick(file('a.txt'));
      await userEvent.click(screen.getByRole('button', { name: 'Update' }));

      const retry = await screen.findByRole('button', { name: 'Retry a.txt' });
      expect(mockCreateUpdate).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        'Storage is down',
        expect.objectContaining({ type: 'negative' }),
      );
      expect(screen.getByText('Failed')).toBeInTheDocument();

      await userEvent.click(retry);
      await waitFor(() => expect(mockFinalize).toHaveBeenCalledTimes(1));
      // The retry targets the same post, and does not post again.
      expect(mockRequestUpload).toHaveBeenLastCalledWith(
        expect.objectContaining({ updateId: 'new-up' }),
      );
      expect(mockCreateUpdate).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Retry a.txt' })).not.toBeInTheDocument(),
      );
    });

    it('does not upload when the post itself fails; the chips stay for another try', async () => {
      mockCreateUpdate.mockRejectedValueOnce(new Error('nope'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      render(<UpdatesFeed boardId="b1" itemId="i1" />);
      await openComposer();
      typeInto('text');
      pick(file('a.txt'));
      await userEvent.click(screen.getByRole('button', { name: 'Update' }));
      await waitFor(() => expect(mockCreateUpdate).toHaveBeenCalled());
      expect(mockRequestUpload).not.toHaveBeenCalled();
      expect(await screen.findByText('a.txt')).toBeInTheDocument();
    });

    it('attaches to a reply against the new reply', async () => {
      render(<UpdateReplies boardId="b1" itemId="i1" updateId="up1" autoFocusComposer />);
      await openComposer();
      typeInto('a reply');
      pick(file('r.txt'));
      await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
      await waitFor(() => expect(mockFinalize).toHaveBeenCalled());
      expect(mockFinalize).toHaveBeenCalledWith(
        expect.objectContaining({ updateId: 'up1', replyId: 'new-reply', fileId: 'fid1' }),
      );
    });
  });

  describe('feed', () => {
    it('shows chips with name and size, and opens the signed URL on click', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      mockUpdatesData = [makeUpdate({ attachments: [att({})] })];
      render(<UpdatesFeed boardId="b1" itemId="i1" />);
      const list = within(screen.getByRole('list', { name: 'Attachments' }));
      expect(list.getByText('notes.txt')).toBeInTheDocument();
      expect(list.getByText('2.0 KB')).toBeInTheDocument();

      await userEvent.click(list.getByRole('button', { name: 'Download notes.txt' }));
      expect(mockGetUrl).toHaveBeenCalledWith({
        boardId: 'b1',
        itemId: 'i1',
        updateId: 'up1',
        fileId: 'f1',
      });
      await waitFor(() =>
        expect(open).toHaveBeenCalledWith(
          'https://dl.example.com/x',
          '_blank',
          'noopener,noreferrer',
        ),
      );
    });

    it('requests a thumbnail for an image only, and renders it', async () => {
      mockUpdatesData = [
        makeUpdate({
          attachments: [
            att({ id: 'img', name: 'p.png', mimeType: 'image/png' }),
            att({ id: 'doc', name: 'n.txt' }),
          ],
        }),
      ];
      const { container } = render(<UpdatesFeed boardId="b1" itemId="i1" />);
      await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
      expect(container.querySelector('img')).toHaveAttribute('src', 'https://dl.example.com/x');
      expect(mockGetUrl).toHaveBeenCalledTimes(1);
      expect(mockGetUrl).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'img' }));
    });

    it('lets the author remove a file; a failure names the cause', async () => {
      mockUpdatesData = [makeUpdate({ authorId: 'u1', attachments: [att({ uploadedBy: 'u1' })] })];
      render(<UpdatesFeed boardId="b1" itemId="i1" />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
      expect(mockRemove).toHaveBeenCalledWith({
        boardId: 'b1',
        itemId: 'i1',
        updateId: 'up1',
        fileId: 'f1',
      });

      mockRemove.mockRejectedValueOnce(new Error('Not allowed'));
      await userEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          'Not allowed',
          expect.objectContaining({ type: 'negative' }),
        ),
      );
    });

    it('shows a viewer or another member the chips but no remove, a board owner can', () => {
      mockUpdatesData = [makeUpdate({ attachments: [att({})] })];
      const { rerender } = render(<UpdatesFeed boardId="b1" itemId="i1" />);
      expect(screen.getByText('notes.txt')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove notes.txt' })).not.toBeInTheDocument();

      rerender(<UpdatesFeed boardId="b1" itemId="i1" canManage />);
      expect(screen.getByRole('button', { name: 'Remove notes.txt' })).toBeInTheDocument();
    });

    it('leaves an automation post without attachments untouched', () => {
      mockUpdatesData = [makeUpdate({ authorId: 'automation:abc', authorName: undefined })];
      render(<UpdatesFeed boardId="b1" itemId="i1" />);
      expect(screen.getByText('Automations')).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Attachments' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
    });
  });

  describe('replies', () => {
    it('shows chips on a reply and passes its replyId', async () => {
      mockReplies = [makeReply({ attachments: [att({})] })];
      render(<UpdateReplies boardId="b1" itemId="i1" updateId="up1" />);
      vi.spyOn(window, 'open').mockReturnValue(null);
      await userEvent.click(screen.getByRole('button', { name: 'Download notes.txt' }));
      expect(mockGetUrl).toHaveBeenCalledWith({
        boardId: 'b1',
        itemId: 'i1',
        updateId: 'up1',
        replyId: 'r1',
        fileId: 'f1',
      });
      expect(screen.queryByRole('button', { name: 'Remove notes.txt' })).not.toBeInTheDocument();
    });
  });
});
