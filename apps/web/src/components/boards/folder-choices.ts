import type { FolderDoc } from '../../data';

/** Folders as menu choices in tree order; sub-folders read "Parent / Child". */
export function folderChoices(
  folders: readonly FolderDoc[],
): { folder: FolderDoc; label: string }[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const roots = folders.filter((f) => !f.parentFolderId || !byId.has(f.parentFolderId));
  return roots.flatMap((root) => [
    { folder: root, label: root.name },
    ...folders
      .filter((f) => f.parentFolderId === root.id)
      .map((child) => ({ folder: child, label: `${root.name} / ${child.name}` })),
  ]);
}
