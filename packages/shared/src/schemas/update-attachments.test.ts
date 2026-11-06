import { describe, expect, it } from 'vitest';
import { itemUpdateSchema, updateReplySchema } from './update';
import {
  UPDATE_ATTACHMENT_MAX_BYTES,
  UPDATE_ATTACHMENT_MAX_PER_POST,
  deleteUpdateAttachmentRequestSchema,
  finalizeUpdateAttachmentRequestSchema,
  getUpdateAttachmentUrlRequestSchema,
  requestUpdateAttachmentUploadRequestSchema,
  updateAttachmentsSchema,
} from './update-attachments';

const attachment = (id: string) => ({
  id,
  name: 'a.pdf',
  storagePath: `boards/b/items/i/updates/u/${id}`,
  size: 10,
  mimeType: 'application/pdf',
  uploadedAt: '2026-11-05T00:00:00.000Z',
  uploadedBy: 'u1',
});
const ts = { toDate: () => new Date(), toMillis: () => 1 };
const post = {
  authorId: 'u1',
  content: 'hi',
  likes: [],
  createdAt: ts,
  updatedAt: ts,
};
const ids = { boardId: 'b', itemId: 'i', updateId: 'u' };
const bad = ['../x', 'a/b', '..', '', 'a b', 'a'.repeat(129)];

describe('update attachments', () => {
  it('caps the list at 10 and refuses duplicate ids', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => attachment(`f${i}`));
    expect(updateAttachmentsSchema.safeParse(many(UPDATE_ATTACHMENT_MAX_PER_POST)).success).toBe(
      true,
    );
    expect(
      updateAttachmentsSchema.safeParse(many(UPDATE_ATTACHMENT_MAX_PER_POST + 1)).success,
    ).toBe(false);
    expect(updateAttachmentsSchema.safeParse([attachment('a'), attachment('a')]).success).toBe(
      false,
    );
  });

  it('is optional on updates and replies and validated when present', () => {
    expect(itemUpdateSchema.safeParse({ ...post, itemId: 'i', repliesCount: 0 }).success).toBe(
      true,
    );
    expect(
      itemUpdateSchema.safeParse({
        ...post,
        itemId: 'i',
        repliesCount: 0,
        attachments: [attachment('a')],
      }).success,
    ).toBe(true);
    expect(
      itemUpdateSchema.safeParse({ ...post, itemId: 'i', repliesCount: 0, attachments: [{}] })
        .success,
    ).toBe(false);
    expect(updateReplySchema.safeParse({ ...post, updateId: 'u' }).success).toBe(true);
    expect(
      updateReplySchema.safeParse({ ...post, updateId: 'u', attachments: [attachment('a')] })
        .success,
    ).toBe(true);
  });

  it('enforces the 25 MB per-file cap on the request', () => {
    const base = { ...ids, fileName: 'a.pdf', contentType: 'application/pdf' };
    expect(
      requestUpdateAttachmentUploadRequestSchema.safeParse({
        ...base,
        size: UPDATE_ATTACHMENT_MAX_BYTES,
      }).success,
    ).toBe(true);
    expect(
      requestUpdateAttachmentUploadRequestSchema.safeParse({
        ...base,
        size: UPDATE_ATTACHMENT_MAX_BYTES + 1,
      }).success,
    ).toBe(false);
    expect(requestUpdateAttachmentUploadRequestSchema.safeParse({ ...base, size: 0 }).success).toBe(
      false,
    );
    expect(
      requestUpdateAttachmentUploadRequestSchema.safeParse({ ...base, size: 1, replyId: 'r1' })
        .success,
    ).toBe(true);
  });

  it('uses safe ids in every request and rejects unknown keys', () => {
    for (const id of bad) {
      for (const key of ['boardId', 'itemId', 'updateId', 'replyId'] as const) {
        const t = { ...ids, [key]: id };
        expect(getUpdateAttachmentUrlRequestSchema.safeParse({ ...t, fileId: 'f' }).success).toBe(
          false,
        );
        expect(deleteUpdateAttachmentRequestSchema.safeParse({ ...t, fileId: 'f' }).success).toBe(
          false,
        );
        expect(
          finalizeUpdateAttachmentRequestSchema.safeParse({ ...t, fileId: 'f', fileName: 'a' })
            .success,
        ).toBe(false);
      }
      expect(getUpdateAttachmentUrlRequestSchema.safeParse({ ...ids, fileId: id }).success).toBe(
        false,
      );
    }
    expect(
      getUpdateAttachmentUrlRequestSchema.safeParse({ ...ids, fileId: 'f', extra: 1 }).success,
    ).toBe(false);
  });
});
