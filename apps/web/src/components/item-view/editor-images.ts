import { Image, type ImageOptions } from '@tiptap/extension-image';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension, mergeAttributes, Node, ReactNodeViewRenderer } from '@tiptap/react';
import { uploadDescriptionImages, type ImageContext } from './description-image-upload';
import { ImageNodeView, ImageUploadNodeView } from './ImageNodeView';

export const IMAGE_MIN_WIDTH = 25;
export const IMAGE_MAX_WIDTH = 100;

/** A stored width as a percentage of the content width, or null (full width). */
export function normalizeImageWidth(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(IMAGE_MAX_WIDTH, Math.max(IMAGE_MIN_WIDTH, Math.round(n)));
}

export type DescriptionImageOptions = ImageOptions & ImageContext;

/**
 * A description image. The doc stores `{ fileId, alt, width }` and never a `src`: the node view
 * asks the server for a short-lived signed URL (see description-image-url.ts).
 */
export const DescriptionImage = Image.extend<DescriptionImageOptions>({
  addOptions() {
    return { ...this.parent?.(), boardId: '', itemId: '' } as DescriptionImageOptions;
  },

  addAttributes() {
    return {
      fileId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-file-id'),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.fileId ? { 'data-file-id': attributes.fileId } : {},
      },
      alt: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('alt') ?? '',
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.alt ? { alt: attributes.alt } : {},
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          normalizeImageWidth(element.getAttribute('data-width')),
        renderHTML: (attributes: Record<string, unknown>) => {
          const width = normalizeImageWidth(attributes.width);
          return width ? { 'data-width': String(width) } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-file-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },

  // The base image's `![alt](src)` rule and `setImage` need a src; ours never has one.
  addInputRules() {
    return [];
  },
  addCommands() {
    return {};
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

/** The placeholder shown while an image uploads. It is never saved and never parsed. */
export const ImageUpload = Node.create({
  name: 'imageUpload',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return { uploadId: { default: '' } };
  },

  parseHTML() {
    return [];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-image-upload': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageUploadNodeView);
  },
});

const imageFilesOf = (files: FileList | null | undefined): File[] =>
  Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));

/** Pasting or dropping image files uploads them as description images. */
export const ImageFileHandlers = Extension.create<ImageContext>({
  name: 'imageFileHandlers',

  addOptions() {
    return { boardId: '', itemId: '' };
  },

  addProseMirrorPlugins() {
    const ctx = () => ({ boardId: this.options.boardId, itemId: this.options.itemId });
    return [
      new Plugin({
        key: new PluginKey('atriumImageFiles'),
        props: {
          handlePaste: (_view, event) => {
            const files = imageFilesOf(event.clipboardData?.files);
            if (!this.editor.isEditable || files.length === 0) return false;
            event.preventDefault();
            void uploadDescriptionImages(this.editor, files, ctx());
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            const files = imageFilesOf(event.dataTransfer?.files);
            if (moved || !this.editor.isEditable || files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            void uploadDescriptionImages(this.editor, files, ctx(), at?.pos);
            return true;
          },
        },
      }),
    ];
  },
});
