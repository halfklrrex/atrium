import { describe, expect, it } from 'vitest';
import {
  DOC_BODY_MAX_BYTES,
  DOC_LIMITS,
  createDocInputSchema,
  docBodyBytes,
  docBodySchema,
  docMetaSchema,
  type TimestampLike,
} from '../index';

const ts = (ms = 1_700_000_000_000): TimestampLike => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});

const meta = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: 'w1',
  folderId: null,
  name: 'Packing list',
  kind: 'main',
  access: { u1: 'owner' },
  accessUids: ['u1'],
  position: 'a0',
  icon: null,
  state: 'active',
  deletedAt: null,
  createdAt: ts(),
  createdBy: 'u1',
  updatedAt: ts(),
  ...overrides,
});

const body = (overrides: Record<string, unknown> = {}) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph' }] },
  text: 'Hello',
  rev: 1,
  updatedAt: ts(),
  updatedBy: 'u1',
  ...overrides,
});

describe('docMetaSchema', () => {
  it('accepts a valid doc, with and without updatedBy', () => {
    expect(docMetaSchema.safeParse(meta()).success).toBe(true);
    expect(docMetaSchema.safeParse(meta({ updatedBy: 'u1' })).success).toBe(true);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a name over the limit', { name: 'x'.repeat(DOC_LIMITS.name + 1) }],
    ['a bad kind', { kind: 'secret' }],
    ['a non-null icon', { icon: 'x' }],
    ['a bad state', { state: 'archived' }],
    ['empty accessUids', { accessUids: [] }],
    ['a bad role', { access: { u1: 'boss' } }],
  ])('rejects %s', (_label, overrides) => {
    expect(docMetaSchema.safeParse(meta(overrides)).success).toBe(false);
  });
});

describe('docBodySchema', () => {
  it('accepts a body and an empty doc', () => {
    expect(docBodySchema.safeParse(body()).success).toBe(true);
    expect(docBodySchema.safeParse(body({ doc: { type: 'doc' } })).success).toBe(true);
  });

  it.each([
    ['a non-doc root', { doc: { type: 'paragraph' } }],
    ['text over the cap', { text: 'x'.repeat(DOC_LIMITS.text + 1) }],
    ['rev 0', { rev: 0 }],
    ['a fractional rev', { rev: 1.5 }],
    ['a missing author', { updatedBy: '' }],
  ])('rejects %s', (_label, overrides) => {
    expect(docBodySchema.safeParse(body(overrides)).success).toBe(false);
  });

  it('accepts text at the cap and refuses a body over the byte cap', () => {
    expect(docBodySchema.safeParse(body({ text: 'x'.repeat(DOC_LIMITS.text) })).success).toBe(true);
    const big = { type: 'doc', content: [{ type: 'text', text: 'x'.repeat(DOC_BODY_MAX_BYTES) }] };
    expect(docBodyBytes(big)).toBeGreaterThan(DOC_BODY_MAX_BYTES);
    expect(docBodySchema.safeParse(body({ doc: big })).success).toBe(false);
  });

  it('counts UTF-8 bytes, not characters', () => {
    expect(docBodyBytes('é')).toBe(4);
    expect(DOC_LIMITS.bodyBytes).toBe(DOC_BODY_MAX_BYTES);
  });
});

describe('createDocInputSchema', () => {
  it('defaults to a main doc outside any folder and trims the name', () => {
    expect(createDocInputSchema.parse({ name: '  Notes ' })).toEqual({
      name: 'Notes',
      kind: 'main',
      folderId: null,
    });
  });

  it('rejects a blank or long name', () => {
    expect(createDocInputSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(createDocInputSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
  });
});
