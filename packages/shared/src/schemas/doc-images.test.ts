import { describe, expect, it } from 'vitest';
import {
  DOC_IMAGE_MAX_PER_DOC,
  docImagesSchema,
  finalizeDocImageRequestSchema,
  getDocImageUrlRequestSchema,
  requestDocImageUploadRequestSchema,
} from './doc-images';

const bad = ['../x', 'a/b', '.', '..', '', 'a b', 'a'.repeat(129)];
const image = {
  name: 'a.png',
  size: 1,
  mimeType: 'image/png',
  uploadedAt: '2026-11-17T00:00:00.000Z',
  uploadedBy: 'u1',
};

describe('doc image schemas', () => {
  it('caps images at 100 per doc', () => {
    expect(DOC_IMAGE_MAX_PER_DOC).toBe(100);
  });

  it('accepts plain ids', () => {
    expect(docImagesSchema.safeParse({ img_1: image }).success).toBe(true);
    expect(getDocImageUrlRequestSchema.safeParse({ docId: 'd-1', fileId: 'f3' }).success).toBe(
      true,
    );
  });

  it('rejects traversal and unsafe ids everywhere', () => {
    const upload = { fileName: 'a.png', contentType: 'image/png', size: 1 };
    for (const id of bad) {
      expect(docImagesSchema.safeParse({ [id]: image }).success, id).toBe(false);
      expect(getDocImageUrlRequestSchema.safeParse({ docId: id, fileId: 'f' }).success, id).toBe(
        false,
      );
      expect(getDocImageUrlRequestSchema.safeParse({ docId: 'd', fileId: id }).success, id).toBe(
        false,
      );
      expect(
        requestDocImageUploadRequestSchema.safeParse({ ...upload, docId: id }).success,
        id,
      ).toBe(false);
      expect(
        finalizeDocImageRequestSchema.safeParse({ docId: 'd', fileId: id, fileName: 'a.png' })
          .success,
        id,
      ).toBe(false);
    }
  });

  it('refuses unknown keys and non-image types in entries', () => {
    expect(
      requestDocImageUploadRequestSchema.safeParse({
        docId: 'd',
        fileName: 'a.png',
        contentType: 'image/png',
        size: 1,
        boardId: 'b',
      }).success,
    ).toBe(false);
    expect(docImagesSchema.safeParse({ f: { ...image, mimeType: 'image/svg+xml' } }).success).toBe(
      false,
    );
  });
});
