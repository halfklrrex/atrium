import {
  UPDATE_ATTACHMENT_MAX_BYTES,
  UPDATE_ATTACHMENT_MAX_PER_POST,
  isFileAllowed,
  filesSettingsSchema,
} from '@atrium/shared';
import { File as FileIcon, Image as ImageIcon, PDF as PdfIcon } from '@vibe/icons';
import { putWithProgress } from '../item-view/description-image-upload';
import { updateAttachmentCalls } from '../../lib/callables';

/** Where a post's files live: an update, or a reply when `replyId` is set. */
export interface AttachmentTarget {
  boardId: string;
  itemId: string;
  updateId: string;
  replyId?: string;
}

const MAX_MB = UPDATE_ATTACHMENT_MAX_BYTES / (1024 * 1024);
// Same rule the callables apply: the size cap, no type restriction.
const SETTINGS = filesSettingsSchema.parse({ maxFileSizeMb: MAX_MB });

export const contentTypeOf = (file: Pick<File, 'type'>): string =>
  file.type || 'application/octet-stream';

/** A message naming why `file` can't be attached, or null when it can. */
export function explainAttachmentRefusal(file: File, alreadyChosen: number): string | null {
  if (alreadyChosen >= UPDATE_ATTACHMENT_MAX_PER_POST) {
    return `A post can have at most ${UPDATE_ATTACHMENT_MAX_PER_POST} attachments.`;
  }
  if (file.size > UPDATE_ATTACHMENT_MAX_BYTES) {
    return `File "${file.name}" exceeds the ${MAX_MB} MB limit.`;
  }
  if (file.size === 0) return `File "${file.name}" is empty.`;
  if (
    !isFileAllowed({ name: file.name, mimeType: contentTypeOf(file), size: file.size }, SETTINGS)
  ) {
    return `File "${file.name}" is not an allowed type.`;
  }
  return null;
}

/** Request a signed URL, PUT the bytes, then finalize (the server appends it to the post). */
export async function uploadUpdateAttachment(
  target: AttachmentTarget,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  const grant = await updateAttachmentCalls.requestUpload({
    ...target,
    fileName: file.name,
    contentType: contentTypeOf(file),
    size: file.size,
  });
  await putWithProgress(grant.uploadUrl, grant.headers, file, onProgress);
  await updateAttachmentCalls.finalize({ ...target, fileId: grant.fileId, fileName: file.name });
}

export const isImageType = (mimeType: string): boolean =>
  mimeType.toLowerCase().startsWith('image/');

export function attachmentIcon(mimeType: string) {
  if (isImageType(mimeType)) return ImageIcon;
  if (mimeType.toLowerCase() === 'application/pdf') return PdfIcon;
  return FileIcon;
}
