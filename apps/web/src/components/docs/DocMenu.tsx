import { canEditBoard, canManageBoard, resolveBoardRole } from '@atrium/shared';
import { Menu, MenuButton, MenuDivider, MenuItem } from '@vibe/core';
import { Delete, Edit, Link as LinkIcon } from '@vibe/icons';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useWorkspace, type DocMetaDoc } from '../../data';
import { docPath } from '../../lib/paths';
import { showToast } from '../toast-store';
import { docActions } from './doc-actions';

/** "⋯" menu of a doc in the sidebar and on its page: rename, copy link and move to trash. */
export function DocMenu({
  doc,
  openDocId,
  size = 'xs',
  onRename,
  onMenuShow,
  onMenuHide,
}: {
  doc: DocMetaDoc;
  /** Id of the doc whose page is open; trashing it leaves the page. */
  openDocId?: string | null;
  size?: 'xxs' | 'xs' | 'small';
  onRename?: () => void;
  onMenuShow?: () => void;
  onMenuHide?: () => void;
}) {
  return (
    <MenuButton
      size={size}
      aria-label={`Options for ${doc.name}`}
      closeMenuOnItemClick
      onMenuShow={onMenuShow}
      onMenuHide={onMenuHide}
    >
      <DocMenuContent doc={doc} openDocId={openDocId} onRename={onRename} />
    </MenuButton>
  );
}

/** Separate component so the workspace listener only runs while the menu is open. */
function DocMenuContent({
  doc,
  openDocId,
  onRename,
}: {
  doc: DocMetaDoc;
  openDocId?: string | null;
  onRename?: () => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const navigate = useNavigate();
  const { data: workspace } = useWorkspace(doc.workspaceId);
  const role = resolveBoardRole(doc, uid, workspace?.roles[uid]);
  const canEdit = canEditBoard(role);
  const isOwner = canManageBoard(role);

  const copyLink = () => {
    const url = `${window.location.origin}${docPath(doc)}`;
    navigator.clipboard
      .writeText(url)
      .then(() => showToast('Link copied.', { type: 'positive' }))
      .catch(() => showToast('Could not copy the link.', { type: 'negative' }));
  };

  return (
    <Menu id={`doc-menu-${doc.id}`} size="medium">
      {onRename ? (
        <MenuItem
          title="Rename"
          icon={Edit}
          disabled={!canEdit}
          disableReason="You can't rename this doc"
          onClick={onRename}
        />
      ) : null}
      <MenuItem title="Copy link" icon={LinkIcon} onClick={copyLink} />
      <MenuDivider />
      <MenuItem
        title="Move to trash"
        icon={Delete}
        disabled={!isOwner}
        disableReason="Only doc owners can delete it"
        onClick={() => {
          void docActions.trash(doc).then((ok) => {
            if (ok && openDocId === doc.id) void navigate('/');
          });
        }}
      />
    </Menu>
  );
}
