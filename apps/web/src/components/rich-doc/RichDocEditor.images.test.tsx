import type { Editor } from '@tiptap/react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDescriptionImageUrlCache } from '../item-view/description-image-url';
import { uploadDescriptionImages } from '../item-view/description-image-upload';
import { RichDocEditor } from './RichDocEditor';

const mocks = vi.hoisted(() => ({
  docGetUrl: vi.fn(),
  docRequestUpload: vi.fn(),
  docFinalize: vi.fn(),
  itemGetUrl: vi.fn(),
  itemRequestUpload: vi.fn(),
  itemFinalize: vi.fn(),
  putWithProgress: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../toast-store', () => ({ showToast: mocks.showToast }));
vi.mock('../../lib/callables', () => ({
  docImageCalls: {
    getUrl: mocks.docGetUrl,
    requestUpload: mocks.docRequestUpload,
    finalize: mocks.docFinalize,
  },
  descriptionImageCalls: {
    getUrl: mocks.itemGetUrl,
    requestUpload: mocks.itemRequestUpload,
    finalize: mocks.itemFinalize,
  },
  describeCallableError: (_error: unknown, fallback: string) => fallback,
}));

const editorOf = (): Editor =>
  (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;

const imageNodes = () => (editorOf().getJSON().content ?? []).filter((n) => n.type === 'image');

const imageDoc = {
  type: 'doc',
  content: [{ type: 'image', attrs: { fileId: 'img_1', alt: '', width: null } }],
};

const png = () => new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' });

class FakeXhr {
  status = 200;
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn(() => queueMicrotask(() => this.onload?.()));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDescriptionImageUrlCache();
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  URL.createObjectURL = vi.fn(() => 'blob:local-preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('doc images in the shared editor', () => {
  it('a viewer sees the image: the node asks getDocImageUrl with the doc id', async () => {
    mocks.docGetUrl.mockResolvedValue({
      url: 'https://storage.example.com/a.png',
      expiresAt: Date.now() + 3_600_000,
    });
    render(
      <RichDocEditor
        initial={imageDoc}
        readOnly
        onSave={vi.fn()}
        images={{ docId: 'd1' }}
        canExpand={false}
      />,
    );
    const img = await waitFor(() => {
      const el = document.querySelector('.ProseMirror img') as HTMLImageElement | null;
      if (!el) throw new Error('no image yet');
      return el;
    });
    expect(img.src).toBe('https://storage.example.com/a.png');
    expect(mocks.docGetUrl).toHaveBeenCalledWith({ docId: 'd1', fileId: 'img_1' });
    expect(mocks.itemGetUrl).not.toHaveBeenCalled();
  });

  it('uploads through the doc callables, shows the local preview and never asks for a URL', async () => {
    mocks.docRequestUpload.mockResolvedValue({
      uploadUrl: 'https://storage.example.com/up',
      fileId: 'img_9',
      expiresAt: 1,
      headers: { 'content-type': 'image/png' },
    });
    mocks.docFinalize.mockResolvedValue({ fileId: 'img_9', image: {} });
    render(
      <RichDocEditor
        initial={null}
        readOnly={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
        images={{ docId: 'd1' }}
      />,
    );
    await screen.findByRole('button', { name: 'Image' });
    await uploadDescriptionImages(editorOf(), [png()], { docId: 'd1' });

    expect(mocks.docRequestUpload).toHaveBeenCalledWith({
      docId: 'd1',
      fileName: 'shot.png',
      contentType: 'image/png',
      size: 8,
    });
    expect(mocks.docFinalize).toHaveBeenCalledWith({
      docId: 'd1',
      fileId: 'img_9',
      fileName: 'shot.png',
    });
    expect(mocks.itemRequestUpload).not.toHaveBeenCalled();
    expect(imageNodes()).toEqual([
      { type: 'image', attrs: { fileId: 'img_9', alt: '', width: null } },
    ]);
    await waitFor(() =>
      expect((document.querySelector('.ProseMirror img') as HTMLImageElement | null)?.src).toBe(
        'blob:local-preview',
      ),
    );
    expect(mocks.docGetUrl).not.toHaveBeenCalled();
  });

  it('uploads several pasted images in parallel, in the order picked', async () => {
    let n = 0;
    mocks.docRequestUpload.mockImplementation(async () => ({
      uploadUrl: 'https://storage.example.com/up',
      fileId: `img_${++n}`,
      expiresAt: 1,
      headers: {},
    }));
    mocks.docFinalize.mockImplementation(async (r: { fileId: string }) => ({
      fileId: r.fileId,
      image: {},
    }));
    render(
      <RichDocEditor
        initial={null}
        readOnly={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
        images={{ docId: 'd1' }}
      />,
    );
    await screen.findByRole('button', { name: 'Image' });
    await uploadDescriptionImages(editorOf(), [png(), png()], { docId: 'd1' });
    const ids = imageNodes().map((node) => (node.attrs as { fileId: string }).fileId);
    expect(ids).toEqual(['img_1', 'img_2']);
  });

  it('keeps description images on the item callables', async () => {
    mocks.itemRequestUpload.mockResolvedValue({
      uploadUrl: 'https://storage.example.com/up',
      fileId: 'img_5',
      expiresAt: 1,
      headers: {},
    });
    mocks.itemFinalize.mockResolvedValue({ fileId: 'img_5', image: {} });
    render(
      <RichDocEditor
        initial={null}
        readOnly={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
        images={{ boardId: 'b1', itemId: 'i1' }}
      />,
    );
    await screen.findByRole('button', { name: 'Image' });
    await uploadDescriptionImages(editorOf(), [png()], { boardId: 'b1', itemId: 'i1' });
    expect(mocks.itemRequestUpload).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'b1', itemId: 'i1', fileName: 'shot.png' }),
    );
    expect(mocks.docRequestUpload).not.toHaveBeenCalled();
  });
});
