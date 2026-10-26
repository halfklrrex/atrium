import { describe, expect, it } from 'vitest';
import {
  addFile,
  columnRegistry,
  filesColumn,
  filesSettingsSchema,
  filesValueSchema,
  formatFileSize,
  getTotalFilesSize,
  isFileAllowed,
  removeFile,
  validateFilesValue,
  type FileAttachment,
  type FilesValue,
} from './index';

describe('P2 Files Column', () => {
  const sampleFile1: FileAttachment = {
    id: 'f_1',
    name: 'architecture.pdf',
    storagePath: 'boards/b_1/items/i_1/files/f_1',
    size: 1572864, // 1.5 MB
    mimeType: 'application/pdf',
    uploadedAt: '2026-10-24T18:00:00.000Z',
    uploadedBy: 'usr_avery_1',
  };

  const sampleFile2: FileAttachment = {
    id: 'f_2',
    name: 'wireframe.png',
    storagePath: 'boards/b_1/items/i_1/files/f_2',
    size: 204800, // 200 KB
    mimeType: 'image/png',
    uploadedAt: '2026-10-24T18:05:00.000Z',
    uploadedBy: 'usr_avery_1',
  };

  it('validates files value schema without url property and rejects duplicate ids', () => {
    expect(filesValueSchema.safeParse({ files: [] }).success).toBe(true);
    expect(filesValueSchema.safeParse({ files: [sampleFile1, sampleFile2] }).success).toBe(true);

    // Rejects if url is included (strict schema)
    const withUrl = filesValueSchema.safeParse({
      files: [{ ...sampleFile1, url: 'https://example.com/file.pdf' }],
    });
    expect(withUrl.success).toBe(false);

    // Rejects duplicate file ids in value
    const duplicateIds = filesValueSchema.safeParse({
      files: [sampleFile1, { ...sampleFile2, id: 'f_1' }],
    });
    expect(duplicateIds.success).toBe(false);

    // Rejects negative size
    const negativeSize = filesValueSchema.safeParse({
      files: [{ ...sampleFile1, size: -1 }],
    });
    expect(negativeSize.success).toBe(false);
  });

  it('validates settings schema and enforces 100 MB max cap', () => {
    const defaults = filesColumn.defaultSettings();
    expect(defaults).toEqual({ maxFileSizeMb: 50 });
    expect(filesSettingsSchema.safeParse(defaults).success).toBe(true);

    const maxAllowed = filesSettingsSchema.safeParse({
      maxFileSizeMb: 100,
      allowedTypes: ['image/*', '.pdf'],
    });
    expect(maxAllowed.success).toBe(true);

    // Over 100 MB is rejected
    const overMax = filesSettingsSchema.safeParse({
      maxFileSizeMb: 101,
    });
    expect(overMax.success).toBe(false);
  });

  it('validates storagePath with validateFilesValue', () => {
    const val: FilesValue = { files: [sampleFile1, sampleFile2] };

    // Valid path matching context
    const valid = validateFilesValue(val, { boardId: 'b_1', itemId: 'i_1' });
    expect(valid.valid).toBe(true);

    // Rejects path traversal ("..")
    const traversalVal: FilesValue = {
      files: [
        {
          ...sampleFile1,
          storagePath: 'boards/b_1/items/i_1/files/../other/f_1',
        },
      ],
    };
    const traversalRes = validateFilesValue(traversalVal, { boardId: 'b_1', itemId: 'i_1' });
    expect(traversalRes.valid).toBe(false);
    expect(traversalRes).toHaveProperty('error', expect.stringContaining('traversal'));

    // Rejects mismatched board/item IDs
    const mismatchRes = validateFilesValue(val, { boardId: 'b_other', itemId: 'i_1' });
    expect(mismatchRes.valid).toBe(false);
    expect(mismatchRes).toHaveProperty(
      'error',
      expect.stringContaining('must match expected path'),
    );
  });

  it('checks allowed file types and size with isFileAllowed', () => {
    const settings = {
      maxFileSizeMb: 10,
      allowedTypes: ['image/*', '.pdf', 'application/json'],
    };

    // Allowed by extension
    expect(
      isFileAllowed(
        { name: 'document.pdf', mimeType: 'application/octet-stream', size: 1024 },
        settings,
      ),
    ).toBe(true);

    // Allowed by MIME wildcard
    expect(isFileAllowed({ name: 'photo.jpg', mimeType: 'image/jpeg', size: 1024 }, settings)).toBe(
      true,
    );

    // Allowed by exact MIME
    expect(
      isFileAllowed({ name: 'config', mimeType: 'application/json', size: 1024 }, settings),
    ).toBe(true);

    // Disallowed extension and MIME
    expect(
      isFileAllowed({ name: 'archive.zip', mimeType: 'application/zip', size: 1024 }, settings),
    ).toBe(false);

    // Disallowed by size (> 10 MB)
    expect(
      isFileAllowed({ name: 'photo.png', mimeType: 'image/png', size: 11 * 1024 * 1024 }, settings),
    ).toBe(false);
  });

  it('formats file sizes accurately and rounds boundary 1048575 up to 1.0 MB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1048575)).toBe('1.0 MB');
    expect(formatFileSize(1572864)).toBe('1.5 MB');
    expect(formatFileSize(1073741824)).toBe('1.0 GB');
  });

  it('adds and removes attachments immutably with caps and unique ids', () => {
    let val: FilesValue = { files: [] };
    val = addFile(val, sampleFile1);
    expect(val.files).toHaveLength(1);
    expect(val.files[0]?.id).toBe('f_1');

    val = addFile(val, sampleFile2);
    expect(val.files).toHaveLength(2);
    expect(getTotalFilesSize(val)).toBe(1572864 + 204800);

    // Rejects duplicate file id
    expect(() => addFile(val, sampleFile1)).toThrow(/already exists/);

    // Enforces 100-file cap
    const maxFiles = Array.from({ length: 100 }, (_, i) => ({
      ...sampleFile1,
      id: `f_${i}`,
    }));
    const fullVal: FilesValue = { files: maxFiles };
    expect(() => addFile(fullVal, { ...sampleFile1, id: 'f_101' })).toThrow(/100.*reached/);

    // Remove file
    val = removeFile(val, 'f_1');
    expect(val.files).toHaveLength(1);
    expect(val.files[0]?.id).toBe('f_2');
  });

  it('toText, compare, and aggregate', () => {
    const val1 = { files: [sampleFile1] };
    const val2 = { files: [sampleFile1, sampleFile2] };
    const settings = filesColumn.defaultSettings();

    expect(filesColumn.toText(val2, settings)).toBe('architecture.pdf, wireframe.png');
    expect(filesColumn.compare(val1, val2, settings)).toBeLessThan(0);
    expect(filesColumn.compare(val2, val1, settings)).toBeGreaterThan(0);

    const agg = filesColumn.aggregate?.([val1, null, val2, { files: [] }], settings);
    expect(agg).toEqual({
      kind: 'sum',
      sum: 3,
      count: 3,
    });

    // aggregate returns null for all-empty inputs
    expect(filesColumn.aggregate?.([null, undefined], settings)).toBeNull();
  });

  it('integrates into columnRegistry', () => {
    expect(columnRegistry.has('files')).toBe(true);
    const col = columnRegistry.get('files');
    expect(col.label).toBe('Files');
  });
});
