import { describe, expect, it } from 'vitest';
import {
  descriptionImagesSchema,
  finalizeDescriptionImageRequestSchema,
  getDescriptionImageUrlRequestSchema,
  requestDescriptionImageUploadRequestSchema,
} from './description-images';

const bad = ['../x', 'a/b', '.', '..', '', 'a b', 'a'.repeat(129)];
const image = {
  name: 'a.png',
  size: 1,
  mimeType: 'image/png',
  uploadedAt: '2026-10-25T00:00:00.000Z',
  uploadedBy: 'u1',
};

describe('description image schemas use safe ids', () => {
  it('accepts plain ids', () => {
    expect(descriptionImagesSchema.safeParse({ img_1: image }).success).toBe(true);
    expect(
      getDescriptionImageUrlRequestSchema.safeParse({ boardId: 'b-1', itemId: 'i_2', fileId: 'f3' })
        .success,
    ).toBe(true);
  });

  it('rejects traversal and unsafe ids everywhere', () => {
    const upload = { fileName: 'a.png', contentType: 'image/png', size: 1 };
    for (const id of bad) {
      expect(descriptionImagesSchema.safeParse({ [id]: image }).success, id).toBe(false);
      for (const key of ['boardId', 'itemId'] as const) {
        const ids = { boardId: 'b', itemId: 'i', [key]: id };
        expect(
          requestDescriptionImageUploadRequestSchema.safeParse({ ...ids, ...upload }).success,
        ).toBe(false);
        expect(getDescriptionImageUrlRequestSchema.safeParse({ ...ids, fileId: 'f' }).success).toBe(
          false,
        );
      }
      const fin = { boardId: 'b', itemId: 'i', fileId: id, fileName: 'a.png' };
      expect(finalizeDescriptionImageRequestSchema.safeParse(fin).success).toBe(false);
      expect(
        getDescriptionImageUrlRequestSchema.safeParse({ boardId: 'b', itemId: 'i', fileId: id })
          .success,
      ).toBe(false);
    }
  });
});
