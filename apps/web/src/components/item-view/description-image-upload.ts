import {
  DESCRIPTION_IMAGE_MAX_BYTES,
  DESCRIPTION_IMAGE_TYPES,
  isDescriptionImageType,
} from '@atrium/shared';
import type { Editor } from '@tiptap/react';
import { descriptionImageCalls, describeCallableError } from '../../lib/callables';
import { showToast } from '../toast-store';

export interface ImageContext {
  boardId: string;
  itemId: string;
}

/** The `accept` value for the file picker. */
export const IMAGE_ACCEPT = DESCRIPTION_IMAGE_TYPES.join(',');

// ---- Progress of the uploads in flight, by placeholder id (read by the placeholder node view) ----

const progress = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const uploadProgress = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** 0 to 100; 0 for an unknown id. */
  get: (uploadId: string) => progress.get(uploadId) ?? 0,
};

function setProgress(uploadId: string, percent: number | null) {
  if (percent === null) progress.delete(uploadId);
  else progress.set(uploadId, percent);
  emit();
}

/** PUTs the file to a signed URL, reporting progress (fetch cannot upload with progress). */
export function putWithProgress(
  url: string,
  headers: Record<string, string>,
  file: Blob,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(file);
  });
}

let counter = 0;
const newUploadId = () => `up_${Date.now().toString(36)}_${(counter++).toString(36)}`;

function findUpload(editor: Editor, uploadId: string): { pos: number; size: number } | null {
  let found: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'imageUpload' && node.attrs.uploadId === uploadId) {
      found = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

/** Why a file cannot be added, or null when it can. */
export function imageFileProblem(file: File): string | null {
  if (!isDescriptionImageType(file.type)) {
    return 'Only PNG, JPEG, GIF and WebP images can be added.';
  }
  if (file.size > DESCRIPTION_IMAGE_MAX_BYTES) return 'Images can be at most 10 MB.';
  return null;
}

/**
 * Adds one image: a placeholder with progress goes in at once, the file uploads to its signed URL,
 * and on finalize the placeholder becomes the image node. On any failure the placeholder is removed
 * and the reason shown as a toast.
 */
export async function uploadDescriptionImage(
  editor: Editor,
  file: File,
  ctx: ImageContext,
  position?: number,
): Promise<void> {
  const problem = imageFileProblem(file);
  if (problem) {
    showToast(problem, { type: 'negative' });
    return;
  }
  const uploadId = newUploadId();
  const placeholder = { type: 'imageUpload', attrs: { uploadId } };
  if (position === undefined) editor.chain().focus().insertContent(placeholder).run();
  else editor.chain().focus().insertContentAt(position, placeholder).run();
  setProgress(uploadId, 0);

  const fileName = (file.name || 'image').slice(0, 255);
  try {
    const target = await descriptionImageCalls.requestUpload({
      ...ctx,
      fileName,
      contentType: file.type,
      size: file.size,
    });
    await putWithProgress(target.uploadUrl, target.headers, file, (percent) =>
      setProgress(uploadId, percent),
    );
    const done = await descriptionImageCalls.finalize({
      ...ctx,
      fileId: target.fileId,
      fileName,
    });
    if (editor.isDestroyed) return;
    const at = findUpload(editor, uploadId);
    if (at) {
      editor
        .chain()
        .insertContentAt(
          { from: at.pos, to: at.pos + at.size },
          { type: 'image', attrs: { fileId: done.fileId, alt: '', width: null } },
        )
        .run();
    }
  } catch (error) {
    if (!editor.isDestroyed) {
      const at = findUpload(editor, uploadId);
      if (at)
        editor
          .chain()
          .deleteRange({ from: at.pos, to: at.pos + at.size })
          .run();
    }
    showToast(describeCallableError(error, 'Could not upload the image. Try again.'), {
      type: 'negative',
    });
  } finally {
    setProgress(uploadId, null);
  }
}

/** Adds several images, one after the other, so they land in the order they were picked. */
export async function uploadDescriptionImages(
  editor: Editor,
  files: File[],
  ctx: ImageContext,
  position?: number,
): Promise<void> {
  for (const file of files) {
    await uploadDescriptionImage(editor, file, ctx, position);
  }
}
