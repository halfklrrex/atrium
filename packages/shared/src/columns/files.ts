import { z } from 'zod';
import { uidSchema } from '../schemas/common';
import { defineColumnType } from './registry';

export const fileAttachmentSchema = z
  .object({
    /** Unique ID of the attached file. */
    id: z.string().min(1),
    /** Original filename (e.g. "report.pdf", "photo.png"). */
    name: z.string().min(1).max(255),
    /** Firebase Cloud Storage bucket path: "boards/{bId}/items/{iId}/files/{fId}". */
    storagePath: z.string().min(1),
    /** File size in bytes. Display metadata; verified by upload callable. */
    size: z.number().int().min(0),
    /** MIME type (e.g. "application/pdf", "image/png"). Display metadata; verified by upload callable. */
    mimeType: z.string().min(1),
    /** ISO 8601 timestamp when the file was uploaded. */
    uploadedAt: z.string().datetime(),
    /** User ID of the uploader. */
    uploadedBy: uidSchema,
  })
  .strict();
export type FileAttachment = z.infer<typeof fileAttachmentSchema>;

export const filesSettingsSchema = z
  .object({
    /** Maximum allowed file size in megabytes (capped at 100 MB per column). */
    maxFileSizeMb: z.number().int().min(1).max(100).default(50),
    /** Optional list of allowed file extensions or MIME patterns (e.g. ["image/*", ".pdf"]). */
    allowedTypes: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type FilesSettings = z.infer<typeof filesSettingsSchema>;

export const filesValueSchema = z
  .object({
    files: z
      .array(fileAttachmentSchema)
      .max(100)
      .refine((files) => new Set(files.map((f) => f.id)).size === files.length, {
        message: 'File ids must be unique',
      }),
  })
  .strict();
export type FilesValue = z.infer<typeof filesValueSchema>;

/**
 * Validates that all file storage paths strictly adhere to canonical Atrium layout:
 * "boards/{boardId}/items/{itemId}/files/{fileId}", with no directory traversal ("..").
 */
export function validateFilesValue(
  value: FilesValue,
  context: { boardId: string; itemId: string },
): { valid: true } | { valid: false; error: string } {
  const { boardId, itemId } = context;
  if (!boardId || !itemId) {
    return { valid: false, error: 'boardId and itemId are required' };
  }

  const ids = new Set<string>();
  for (const file of value.files) {
    if (ids.has(file.id)) {
      return { valid: false, error: `Duplicate file id "${file.id}"` };
    }
    ids.add(file.id);

    if (file.storagePath.includes('..')) {
      return {
        valid: false,
        error: `Invalid storagePath containing path traversal: "${file.storagePath}"`,
      };
    }
    const expectedPath = `boards/${boardId}/items/${itemId}/files/${file.id}`;
    if (file.storagePath !== expectedPath) {
      return {
        valid: false,
        error: `storagePath "${file.storagePath}" must match expected path "${expectedPath}"`,
      };
    }
  }

  return { valid: true };
}

/**
 * Checks whether a candidate file matches the column's allowed type patterns and max size.
 * Supports file extensions (e.g. ".pdf", ".png"), MIME wildcard patterns (e.g. "image/*"),
 * and exact MIME types (e.g. "application/pdf").
 */
export function isFileAllowed(
  file: Pick<FileAttachment, 'name' | 'mimeType' | 'size'>,
  settings: FilesSettings,
): boolean {
  const maxBytes = (settings.maxFileSizeMb ?? 50) * 1024 * 1024;
  if (file.size > maxBytes) {
    return false;
  }
  if (!settings.allowedTypes || settings.allowedTypes.length === 0) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  const lowerMime = file.mimeType.toLowerCase();

  return settings.allowedTypes.some((pattern) => {
    const p = pattern.trim().toLowerCase();
    if (p.startsWith('.')) {
      return lowerName.endsWith(p);
    }
    if (p.endsWith('/*')) {
      const prefix = p.slice(0, -1);
      return lowerMime.startsWith(prefix);
    }
    return lowerMime === p;
  });
}

/**
 * Formats bytes into a human-readable size string (e.g. "1.5 MB", "420.0 KB", "12 B").
 * Rounds boundary values like 1048575 bytes up to "1.0 MB".
 */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;

  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }

  if (i < units.length - 1 && parseFloat(val.toFixed(1)) >= 1024) {
    val /= 1024;
    i++;
  }

  return `${i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

/**
 * Adds an attachment to a FilesValue immutably.
 * Enforces the 100-file cap and rejects duplicate file IDs.
 */
export function addFile(value: FilesValue | null | undefined, file: FileAttachment): FilesValue {
  const current = value?.files ?? [];
  if (current.length >= 100) {
    throw new Error('Maximum files limit (100) reached');
  }
  if (current.some((f) => f.id === file.id)) {
    throw new Error(`File ID "${file.id}" already exists in attachments`);
  }
  return { files: [...current, file] };
}

/**
 * Removes an attachment by ID from a FilesValue immutably.
 *
 * Note: Storage object cleanup is deferred to the Storage follow-up callable (Roadmap ID: 3307132989);
 * removing the file from the cell updates item metadata, leaving the file object in Storage until cleanup.
 */
export function removeFile(value: FilesValue, fileId: string): FilesValue {
  return { files: value.files.filter((f) => f.id !== fileId) };
}

/**
 * Computes the total byte size of all attachments in a cell.
 */
export function getTotalFilesSize(value: FilesValue): number {
  return value.files.reduce((acc, f) => acc + f.size, 0);
}

export const filesColumn = defineColumnType<FilesSettings, FilesValue>({
  type: 'files',
  label: 'Files',
  // Only the upload/delete callables write the cell: a client-forged `storagePath` would otherwise
  // let a board editor sign or delete another board's Storage object.
  serverManaged: true,
  settingsSchema: filesSettingsSchema,
  valueSchema: filesValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled', 'sum', 'average'],
  defaultSettings: () => ({ maxFileSizeMb: 50 }),
  toText: (value) => value.files.map((f) => f.name).join(', '),
  compare: (a, b) => {
    const countDiff = a.files.length - b.files.length;
    if (countDiff !== 0) return countDiff;
    const aFirst = a.files[0]?.name ?? '';
    const bFirst = b.files[0]?.name ?? '';
    return aFirst.localeCompare(bFirst);
  },
  aggregate: (values) => {
    let sum = 0;
    let count = 0;
    for (const v of values) {
      if (!v) continue;
      sum += v.files.length;
      count += 1;
    }
    if (count === 0) return null;
    return { kind: 'sum', sum, count };
  },
});
