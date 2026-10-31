import { canEditBoard, resolveBoardRole } from '@atrium/shared';
import { AvatarGroup, Button, EditableHeading, IconButton, Tooltip } from '@vibe/core';
import { Bolt, DropdownChevronDown, DropdownChevronUp, Integrations } from '@vibe/icons';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useWorkspace, type BoardDoc } from '../../data';
import { formatDate } from '../../lib/format';
import { InlineEdit } from '../InlineEdit';
import { Popover } from '../Popover';
import { useUiStore } from '../AppShell/ui-store';
import { showComingSoon } from '../toast-store';
import { UserAvatar } from '../UserAvatar';
import { ViewTabs } from '../board-views/ViewTabs';
import { PresenceAvatars } from '../presence';
import { boardActions } from './board-actions';
import { BoardMenu } from './BoardMenu';
import styles from './BoardHeader.module.css';
import { FavoriteStar } from './FavoriteStar';
import { sharedCount } from './board-sharing';
import { BOARD_KIND_OPTIONS } from './kinds';

/** Board title row and the view tabs. */
export function BoardHeader({ board }: { board: BoardDoc }) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: workspace } = useWorkspace(board.workspaceId);
  const role = resolveBoardRole(board, uid, workspace?.roles[uid]);
  const canEdit = canEditBoard(role);
  const [infoOpen, setInfoOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const openDialog = useUiStore((s) => s.openDialog);

  const memberIds = board.accessUids;
  const kindLabel = BOARD_KIND_OPTIONS.find((o) => o.value === board.kind)?.label ?? board.kind;
  const ownerIds = memberIds.filter((id) => board.access[id] === 'owner');

  return (
    <header className={styles.header}>
      <div className={styles.topRow}>
        <div className={styles.titleGroup}>
          <EditableHeading
            type="h2"
            value={board.name}
            readOnly={!canEdit}
            isEditMode={renaming}
            onEditModeChange={setRenaming}
            aria-label="Board name"
            onChange={(name: string) => {
              const next = name.trim();
              if (next && next !== board.name) void boardActions.rename(board, next);
            }}
          />
          <Popover
            open={infoOpen}
            onClose={() => setInfoOpen(false)}
            label="Board info"
            panelClassName={styles.infoPanel}
            trigger={
              <IconButton
                icon={infoOpen ? DropdownChevronUp : DropdownChevronDown}
                size="xs"
                kind="tertiary"
                aria-label="Board info"
                aria-expanded={infoOpen}
                onClick={() => setInfoOpen((v) => !v)}
              />
            }
          >
            <div className={styles.infoBody}>
              <p className={styles.infoLabel}>Description</p>
              <InlineEdit
                value={board.description}
                ariaLabel="Board description"
                placeholder="Add a description"
                readOnly={!canEdit}
                allowEmpty
                multiline
                maxLength={1000}
                onCommit={(description) => void boardActions.setDescription(board, description)}
                className={styles.infoDescription}
              />
              <dl className={styles.facts}>
                <dt>Workspace</dt>
                <dd>
                  <Link to={`/workspaces/${board.workspaceId}`}>
                    {workspace?.name ?? 'Workspace'}
                  </Link>
                </dd>
                <dt>Owner</dt>
                <dd className={styles.owners}>
                  {ownerIds.map((id) => (
                    <UserAvatar key={id} uid={id} size="xs" />
                  ))}
                  <span>{ownerIds.includes(uid) ? 'You' : 'Board owner'}</span>
                </dd>
                <dt>Type</dt>
                <dd>{kindLabel}</dd>
                <dt>Created</dt>
                <dd>{formatDate(board.createdAt)}</dd>
              </dl>
            </div>
          </Popover>
        </div>

        <div className={styles.actions}>
          <Tooltip content="Coming soon">
            <Button
              kind="tertiary"
              size="small"
              leftIcon={Integrations}
              onClick={() => showComingSoon('Integrations')}
            >
              Integrate
            </Button>
          </Tooltip>
          <Tooltip content="Coming soon">
            <Button
              kind="tertiary"
              size="small"
              leftIcon={Bolt}
              onClick={() => showComingSoon('Automations')}
            >
              Automate
            </Button>
          </Tooltip>
          <PresenceAvatars boardId={board.id} />
          <AvatarGroup max={3} size="small" type="img">
            {memberIds.map((id) => (
              <UserAvatar key={id} uid={id} />
            ))}
          </AvatarGroup>
          <Button
            kind="secondary"
            size="small"
            onClick={() => openDialog({ type: 'shareBoard', boardId: board.id })}
          >
            Invite / {sharedCount(board, workspace)}
          </Button>
          <BoardMenu board={board} size="small" onRename={() => setRenaming(true)} />
          <FavoriteStar board={board} />
        </div>
      </div>

      <ViewTabs />
    </header>
  );
}
