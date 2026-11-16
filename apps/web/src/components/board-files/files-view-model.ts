import {
  filesValueSchema,
  type FileAttachment,
  type FilesViewKind,
  type FilesViewSettings,
  type UpdateFileEntry,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';

export interface FileCard {
  /** Unique within the view. */
  key: string;
  itemId: string;
  itemName: string;
  /** A Files column, or an update or reply the file was attached to. */
  source: 'column' | 'update' | 'reply';
  /** Set for column files. */
  columnId: string;
  columnTitle: string;
  /** Set for update and reply files. */
  updateId: string;
  replyId: string | null;
  authorId: string;
  /** When the update or reply was posted (epoch ms); 0 for column files. */
  postedAt: number;
  file: FileAttachment;
  kind: FilesViewKind;
  /** The item's index in the order `items` came in (board order). */
  itemIndex: number;
}

const EXTENSION_KINDS: Record<string, FilesViewKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  heic: 'image',
  pdf: 'pdf',
  doc: 'document',
  docx: 'document',
  odt: 'document',
  rtf: 'document',
  txt: 'document',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  csv: 'spreadsheet',
  ods: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  zip: 'archive',
  '7z': 'archive',
  rar: 'archive',
  tar: 'archive',
  gz: 'archive',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mp3: 'audio',
  wav: 'audio',
};

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
};

/** The kind of a file: its MIME type first, its extension as the fallback. */
export function fileKind(mimeType: string, name: string): FilesViewKind {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (
    mime === 'application/msword' ||
    mime.includes('wordprocessingml') ||
    mime === 'application/vnd.oasis.opendocument.text' ||
    mime === 'application/rtf' ||
    mime === 'text/plain'
  ) {
    return 'document';
  }
  if (
    mime === 'application/vnd.ms-excel' ||
    mime.includes('spreadsheetml') ||
    mime === 'text/csv' ||
    mime === 'application/vnd.oasis.opendocument.spreadsheet'
  ) {
    return 'spreadsheet';
  }
  if (
    mime === 'application/vnd.ms-powerpoint' ||
    mime.includes('presentationml') ||
    mime === 'application/vnd.oasis.opendocument.presentation'
  ) {
    return 'presentation';
  }
  if (
    mime === 'application/zip' ||
    mime === 'application/x-7z-compressed' ||
    mime === 'application/vnd.rar' ||
    mime === 'application/x-rar-compressed' ||
    mime === 'application/x-tar' ||
    mime === 'application/gzip'
  ) {
    return 'archive';
  }
  return EXTENSION_KINDS[extensionOf(name)] ?? 'other';
}

/** The upper-case extension (at most 5 characters), or "FILE". */
export function fileExtensionLabel(name: string): string {
  const ext = extensionOf(name);
  return ext ? ext.slice(0, 5).toUpperCase() : 'FILE';
}

export interface CollectFilesInput {
  /** Active top-level items already narrowed by the board's filters, in board order. */
  items: readonly ItemDoc[];
  /** The board's files columns, in order. */
  columns: readonly { id: string; title: string }[];
  settings: FilesViewSettings;
  /** Matches the item name or the file name, case-insensitively. */
  search: string;
  /** Files of the board's updates and replies; used when `settings.includeUpdates` is on. */
  updateFiles?: readonly UpdateFileEntry[];
}

const byName = (a: FileCard, b: FileCard) =>
  a.file.name.localeCompare(b.file.name, undefined, { sensitivity: 'base' });
const uploadedAt = (c: FileCard): number => Date.parse(c.file.uploadedAt) || 0;
const byItem = (a: FileCard, b: FileCard) => a.itemIndex - b.itemIndex;

/** One card per file in the chosen files columns, filtered and sorted. */
export function collectFiles({
  items,
  columns,
  settings,
  search,
  updateFiles = [],
}: CollectFilesInput): FileCard[] {
  const chosen = settings.columnIds ? new Set(settings.columnIds) : null;
  const shownColumns = columns.filter((c) => !chosen || chosen.has(c.id));
  const kinds = settings.kinds.length > 0 ? new Set<FilesViewKind>(settings.kinds) : null;
  const needle = search.trim().toLowerCase();
  const cards: FileCard[] = [];

  items.forEach((item, itemIndex) => {
    if (item.parentItemId !== null && item.parentItemId !== undefined) return;
    for (const column of shownColumns) {
      const parsed = filesValueSchema.safeParse(item.values?.[column.id]);
      if (!parsed.success) continue;
      for (const file of parsed.data.files) {
        const kind = fileKind(file.mimeType, file.name);
        if (kinds && !kinds.has(kind)) continue;
        if (
          needle &&
          !file.name.toLowerCase().includes(needle) &&
          !item.name.toLowerCase().includes(needle)
        ) {
          continue;
        }
        cards.push({
          key: `${item.id}/${column.id}/${file.id}`,
          itemId: item.id,
          itemName: item.name,
          source: 'column',
          columnId: column.id,
          columnTitle: column.title,
          updateId: '',
          replyId: null,
          authorId: '',
          postedAt: 0,
          file,
          kind,
          itemIndex,
        });
      }
    }
  });

  if (settings.includeUpdates && !chosen && updateFiles.length > 0) {
    const itemIndexes = new Map<string, number>();
    items.forEach((item, index) => {
      if (item.parentItemId === null || item.parentItemId === undefined) {
        itemIndexes.set(item.id, index);
      }
    });
    const names = new Map(items.map((item) => [item.id, item.name]));
    for (const entry of updateFiles) {
      const itemIndex = itemIndexes.get(entry.itemId);
      if (itemIndex === undefined) continue;
      const { file } = entry;
      const kind = fileKind(file.mimeType, file.name);
      if (kinds && !kinds.has(kind)) continue;
      const itemName = names.get(entry.itemId) ?? '';
      if (
        needle &&
        !file.name.toLowerCase().includes(needle) &&
        !itemName.toLowerCase().includes(needle)
      ) {
        continue;
      }
      cards.push({
        key: `${entry.itemId}/update/${entry.updateId}/${entry.replyId ?? ''}/${file.id}`,
        itemId: entry.itemId,
        itemName,
        source: entry.replyId ? 'reply' : 'update',
        columnId: '',
        columnTitle: '',
        updateId: entry.updateId,
        replyId: entry.replyId,
        authorId: entry.authorId,
        postedAt: entry.createdAt,
        file,
        kind,
        itemIndex,
      });
    }
  }

  const newest = (a: FileCard, b: FileCard) =>
    uploadedAt(b) - uploadedAt(a) || byItem(a, b) || byName(a, b);
  const sorters: Record<FilesViewSettings['sort'], (a: FileCard, b: FileCard) => number> = {
    newest,
    oldest: (a, b) => uploadedAt(a) - uploadedAt(b) || byItem(a, b) || byName(a, b),
    name: (a, b) => byName(a, b) || byItem(a, b),
    item: (a, b) => byItem(a, b) || byName(a, b),
  };
  return cards.sort(sorters[settings.sort]);
}
