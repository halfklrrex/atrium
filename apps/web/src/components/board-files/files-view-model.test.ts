import type { FileAttachment, FilesViewSettings } from '@atrium/shared';
import { defaultFilesViewSettings } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { collectFiles, fileExtensionLabel, fileKind } from './files-view-model';

const file = (id: string, name: string, mimeType: string, uploadedAt: string): FileAttachment => ({
  id,
  name,
  storagePath: `boards/b1/items/i/files/${id}`,
  size: 1024,
  mimeType,
  uploadedAt,
  uploadedBy: 'u1',
});

const columns = [
  { id: 'docs', title: 'Docs' },
  { id: 'pics', title: 'Pictures' },
];

const items = [
  makeItem({
    id: 'i1',
    name: 'Kickoff deck',
    values: {
      docs: {
        files: [
          file('f1', 'brief.pdf', 'application/pdf', '2026-11-01T10:00:00.000Z'),
          file('f2', 'budget.xlsx', 'application/octet-stream', '2026-11-03T10:00:00.000Z'),
        ],
      },
    },
  }),
  makeItem({
    id: 'i2',
    name: 'Landing page',
    values: {
      pics: { files: [file('f3', 'Hero.png', 'image/png', '2026-11-03T10:00:00.000Z')] },
      docs: 'not a files value',
    },
  }),
  makeItem({ id: 'i3', name: 'Empty item', values: {} }),
  makeItem({
    id: 'i4',
    name: 'A subitem',
    parentItemId: 'i1',
    values: {
      docs: { files: [file('f4', 'sub.pdf', 'application/pdf', '2026-11-05T10:00:00.000Z')] },
    },
  }),
];

const run = (patch: Partial<FilesViewSettings> = {}, search = '') =>
  collectFiles({ items, columns, settings: { ...defaultFilesViewSettings(), ...patch }, search });

describe('fileKind', () => {
  it('uses the MIME type first and the extension as a fallback', () => {
    expect(fileKind('image/heic', 'x')).toBe('image');
    expect(fileKind('application/pdf', 'x')).toBe('pdf');
    expect(
      fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x'),
    ).toBe('document');
    expect(fileKind('text/csv', 'x')).toBe('spreadsheet');
    expect(fileKind('application/vnd.ms-powerpoint', 'x')).toBe('presentation');
    expect(fileKind('video/mp4', 'x')).toBe('video');
    expect(fileKind('audio/mpeg', 'x')).toBe('audio');
    expect(fileKind('application/zip', 'x')).toBe('archive');
    expect(fileKind('application/octet-stream', 'budget.XLSX')).toBe('spreadsheet');
    expect(fileKind('application/octet-stream', 'photo.jpeg')).toBe('image');
    expect(fileKind('application/octet-stream', 'mystery')).toBe('other');
  });
});

describe('fileExtensionLabel', () => {
  it('upper-cases the extension, caps it at 5 characters and falls back to FILE', () => {
    expect(fileExtensionLabel('a.pdf')).toBe('PDF');
    expect(fileExtensionLabel('a.verylong')).toBe('VERYL');
    expect(fileExtensionLabel('README')).toBe('FILE');
    expect(fileExtensionLabel('.env')).toBe('FILE');
    expect(fileExtensionLabel('trailing.')).toBe('FILE');
  });
});

describe('collectFiles', () => {
  it('returns one card per file, newest first, ties by item then name, without subitems', () => {
    expect(run().map((c) => c.file.name)).toEqual(['budget.xlsx', 'Hero.png', 'brief.pdf']);
    const card = run()[0];
    expect(card).toMatchObject({
      itemName: 'Kickoff deck',
      columnTitle: 'Docs',
      kind: 'spreadsheet',
    });
  });

  it('sorts oldest, by name and by item', () => {
    expect(run({ sort: 'oldest' }).map((c) => c.file.id)).toEqual(['f1', 'f2', 'f3']);
    expect(run({ sort: 'name' }).map((c) => c.file.name)).toEqual([
      'brief.pdf',
      'budget.xlsx',
      'Hero.png',
    ]);
    expect(run({ sort: 'item' }).map((c) => c.file.id)).toEqual(['f1', 'f2', 'f3']);
  });

  it('limits to the chosen columns and kinds', () => {
    expect(run({ columnIds: ['pics'] }).map((c) => c.file.id)).toEqual(['f3']);
    expect(run({ kinds: ['pdf', 'image'] }).map((c) => c.file.id)).toEqual(['f3', 'f1']);
  });

  it('searches file and item names case-insensitively', () => {
    expect(run({}, 'BRIEF').map((c) => c.file.id)).toEqual(['f1']);
    expect(run({}, 'landing').map((c) => c.file.id)).toEqual(['f3']);
    expect(run({}, 'kickoff').map((c) => c.file.id)).toEqual(['f2', 'f1']);
    expect(run({}, 'nothing')).toEqual([]);
  });
});

describe('collectFiles with update files', () => {
  const entry = (itemId: string, id: string, replyId: string | null = null) => ({
    itemId,
    updateId: 'u1',
    replyId,
    authorId: 'usr_1',
    createdAt: 1000,
    file: file(id, `${id}.png`, 'image/png', '2026-12-01T00:00:00.000Z'),
  });
  const run2 = (patch: Partial<FilesViewSettings> = {}, search = '') =>
    collectFiles({
      items,
      columns,
      settings: { ...defaultFilesViewSettings(), ...patch },
      search,
      updateFiles: [
        entry(items[0]!.id, 'upd1'),
        entry(items[0]!.id, 'rep1', 'r1'),
        entry('other', 'x'),
      ],
    });

  it('adds update and reply files of shown items only, labeled by source', () => {
    const cards = run2();
    const added = cards.filter((c) => c.source !== 'column');
    expect(added.map((c) => [c.file.id, c.source]).sort()).toEqual([
      ['rep1', 'reply'],
      ['upd1', 'update'],
    ]);
    expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
  });

  it('leaves them out when includeUpdates is off or specific columns are chosen', () => {
    expect(run2({ includeUpdates: false }).every((c) => c.source === 'column')).toBe(true);
    expect(run2({ columnIds: [columns[0]!.id] }).every((c) => c.source === 'column')).toBe(true);
  });

  it('applies the search and kind filters to them', () => {
    expect(run2({}, 'upd1').map((c) => c.file.id)).toEqual(['upd1']);
    expect(run2({ kinds: ['pdf'] }).some((c) => c.source !== 'column')).toBe(false);
  });
});
