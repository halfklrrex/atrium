import { render, screen, waitFor } from '@testing-library/react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useEffect, useMemo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDescriptionImageUrlCache } from '../item-view/description-image-url';
import { MentionController } from '../item-view/mention/mention-controller';
import { createComposerExtensions } from './composer-extensions';
import { RichText } from './RichText';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  getUrl: vi.fn(),
  requestUpload: vi.fn(),
  finalize: vi.fn(),
}));
vi.mock('../toast-store', () => ({ showToast: mocks.showToast }));
vi.mock('../../lib/callables', () => ({
  descriptionImageCalls: {
    getUrl: mocks.getUrl,
    requestUpload: mocks.requestUpload,
    finalize: mocks.finalize,
  },
  describeCallableError: (_error: unknown, fallback: string) => fallback,
}));

/** An XMLHttpRequest whose upload always succeeds at once. */
class FakeXhr {
  status = 200;
  upload: { onprogress?: unknown } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send() {
    queueMicrotask(() => this.onload?.());
  }
}

const holder = { editor: undefined as unknown as Editor };

function Harness() {
  const mentionController = useMemo(() => new MentionController(), []);
  const instance = useEditor({
    extensions: createComposerExtensions({
      mentionController,
      placeholder: 'Write',
      boardId: 'b1',
      itemId: 'i1',
    }),
    content: '',
    immediatelyRender: true,
  });
  useEffect(() => {
    if (instance) holder.editor = instance;
  });
  return instance ? <EditorContent editor={instance} /> : null;
}

const paste = (file: File) => {
  const { editor } = holder;
  const preventDefault = vi.fn();
  const handled = editor.view.someProp('handlePaste', (f) =>
    f(editor.view, { clipboardData: { files: [file] }, preventDefault } as never, null as never),
  );
  return { handled, preventDefault };
};

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  clearDescriptionImageUrlCache();
});

describe('composer image paste', () => {
  it('uploads a pasted image through the description pipeline and inserts it', async () => {
    mocks.requestUpload.mockResolvedValue({ uploadUrl: 'https://u', headers: {}, fileId: 'f9' });
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    mocks.finalize.mockResolvedValue({ fileId: 'f9' });
    mocks.getUrl.mockResolvedValue({ url: 'https://img/f9', expiresAt: Date.now() + 3_600_000 });
    render(<Harness />);

    const { handled, preventDefault } = paste(new File(['x'], 'shot.png', { type: 'image/png' }));
    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();

    await waitFor(() =>
      expect(holder.editor.getJSON().content).toContainEqual(
        expect.objectContaining({
          type: 'image',
          attrs: expect.objectContaining({ fileId: 'f9' }),
        }),
      ),
    );
    expect(mocks.requestUpload).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'b1', itemId: 'i1', contentType: 'image/png' }),
    );
    expect(mocks.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'b1', itemId: 'i1', fileId: 'f9' }),
    );
  });

  it('removes the placeholder and shows a toast when the upload fails', async () => {
    mocks.requestUpload.mockRejectedValue(new Error('nope'));
    render(<Harness />);
    paste(new File(['x'], 'shot.png', { type: 'image/png' }));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalled());
    expect(JSON.stringify(holder.editor.getJSON())).not.toContain('imageUpload');
    expect(JSON.stringify(holder.editor.getJSON())).not.toContain('"image"');
  });

  it('refuses a file type the pipeline does not accept', async () => {
    render(<Harness />);
    paste(new File(['x'], 'a.bmp', { type: 'image/bmp' }));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalled());
    expect(mocks.requestUpload).not.toHaveBeenCalled();
  });
});

describe('RichText image', () => {
  const image = { type: 'doc', content: [{ type: 'image', attrs: { fileId: 'f9', width: 50 } }] };

  it('renders a stored image from its signed URL', async () => {
    mocks.getUrl.mockResolvedValue({ url: 'https://img/f9', expiresAt: Date.now() + 3_600_000 });
    render(<RichText doc={image} boardId="b1" itemId="i1" />);
    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'https://img/f9');
    expect(mocks.getUrl).toHaveBeenCalledWith({ boardId: 'b1', itemId: 'i1', fileId: 'f9' });
  });

  it('shows an unavailable tile when the URL cannot be loaded or the scope is missing', async () => {
    mocks.getUrl.mockRejectedValue(new Error('gone'));
    const { unmount } = render(<RichText doc={image} boardId="b1" itemId="i1" />);
    expect(await screen.findByRole('img', { name: 'Image unavailable' })).toBeInTheDocument();
    unmount();
    render(<RichText doc={image} />);
    expect(screen.getByRole('img', { name: 'Image unavailable' })).toBeInTheDocument();
  });
});

describe('composer image paste speed', () => {
  it('shows a local preview while uploading and skips getUrl after finalize', async () => {
    const createObjectURL = vi.fn(() => 'blob:local-1');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    mocks.requestUpload.mockResolvedValue({ uploadUrl: 'https://u', headers: {}, fileId: 'f1' });
    let release: () => void = () => {};
    mocks.finalize.mockReturnValue(new Promise((r) => (release = () => r({ fileId: 'f1' }))));
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const { container } = render(<Harness />);

    paste(new File(['x'], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(container.querySelector('img[src="blob:local-1"]')).not.toBeNull());
    release();
    await waitFor(() =>
      expect(holder.editor.getJSON().content).toContainEqual(
        expect.objectContaining({ type: 'image' }),
      ),
    );
    await waitFor(() => expect(container.querySelector('img[src="blob:local-1"]')).not.toBeNull());
    expect(mocks.getUrl).not.toHaveBeenCalled();
  });

  it('uploads several pasted images in parallel, keeping their order', async () => {
    let started = 0;
    mocks.requestUpload.mockImplementation(async () => {
      started += 1;
      return { uploadUrl: 'https://u', headers: {}, fileId: `f${started}` };
    });
    mocks.finalize.mockImplementation(async (r: { fileId: string }) => ({ fileId: r.fileId }));
    mocks.getUrl.mockResolvedValue({ url: 'https://img/x', expiresAt: Date.now() + 3_600_000 });
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    render(<Harness />);
    const { editor } = holder;
    const files = ['a', 'b'].map((n) => new File(['x'], `${n}.png`, { type: 'image/png' }));
    editor.view.someProp('handlePaste', (f) =>
      f(editor.view, { clipboardData: { files }, preventDefault: vi.fn() } as never, null as never),
    );
    await waitFor(() => expect(mocks.requestUpload).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const ids = (holder.editor.getJSON().content ?? [])
        .filter((n) => n.type === 'image')
        .map((n) => n.attrs?.fileId);
      expect(ids).toHaveLength(2);
    });
  });
});
