import { Button, Counter, Icon } from '@vibe/core';
import { Board, BoardPrivate, BoardShareable, Search, Workspace } from '@vibe/icons';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { BoardThumb } from '../components/boards/BoardThumb';
import { FavoriteStar } from '../components/boards/FavoriteStar';
import { useUiStore } from '../components/AppShell/ui-store';
import { showComingSoon } from '../components/toast-store';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { PendingInvitations } from '../components/membership/PendingInvitations';
import { EmptyRecents } from '../components/illustrations';
import { WorkspaceTile } from '../components/WorkspaceTile';
import {
  useBoardsByIds,
  useFavorites,
  useRecents,
  useWorkspaces,
  type BoardDoc,
  type WorkspaceDoc,
} from '../data';
import { firstNameOf, greetingFor } from '../lib/greeting';
import styles from './Home.module.css';

const INITIAL_CARDS = 8;

/** `/` - monday's Home: greeting strip, recently visited boards, workspaces and a right rail. */
export function HomePage() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const openDialog = useUiStore((s) => s.openDialog);
  const { data: workspaces } = useWorkspaces(uid);
  const { data: recents, loading: recentsLoading } = useRecents(uid);
  const { data: favorites } = useFavorites(uid);
  const recentIds = useMemo(() => recents.map((r) => r.boardId), [recents]);
  const { boards, loading: boardsLoading } = useBoardsByIds(recentIds);
  const [showAll, setShowAll] = useState(false);

  const greeting = greetingFor(new Date(), firstNameOf(user?.displayName, user?.email));
  const visited = recents.flatMap((r) => {
    const board = boards[r.boardId];
    return board && board.state === 'active' ? [board] : [];
  });
  const shown = showAll ? visited : visited.slice(0, INITIAL_CARDS);
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]));
  const firstWorkspace = workspaces[0];

  const steps = [
    { label: 'Set up your account', done: true },
    { label: 'Create a workspace', done: workspaces.length > 0 },
    { label: 'Open your first board', done: recents.length > 0 },
    { label: 'Add a favorite', done: favorites.length > 0 },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className={styles.home}>
      <header className={styles.strip}>
        <div>
          <p className={styles.greeting}>{greeting}</p>
          <h1 className={styles.subtitle}>Quickly access your recent boards and workspaces</h1>
        </div>
        <div className={styles.stripActions}>
          <Button
            kind="secondary"
            size="medium"
            className={styles.feedbackButton}
            onClick={() => showComingSoon('Feedback')}
          >
            Give feedback
          </Button>
          <Button
            kind="primary"
            size="medium"
            leftIcon={Search}
            onClick={() => showComingSoon('Quick search')}
          >
            Quick Search
          </Button>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.main}>
          <PendingInvitations />

          <CollapsibleSection title="Recently visited">
            {recentsLoading || (recentIds.length > 0 && boardsLoading) ? (
              <p className={styles.muted}>Loading…</p>
            ) : visited.length === 0 ? (
              <EmptyState
                size="panel"
                illustration={<EmptyRecents width={200} />}
                title="No boards visited yet"
                body="Boards you open will appear here for quick access"
                primaryAction={{
                  label: 'Create board',
                  disabled: !firstWorkspace,
                  onClick: () =>
                    firstWorkspace &&
                    openDialog({
                      type: 'newBoard',
                      workspaceId: firstWorkspace.id,
                      folderId: null,
                    }),
                }}
              />
            ) : (
              <>
                <ul className={styles.cards}>
                  {shown.map((board) => (
                    <li key={board.id}>
                      <BoardCard board={board} workspace={workspaceById.get(board.workspaceId)} />
                    </li>
                  ))}
                </ul>
                {visited.length > INITIAL_CARDS ? (
                  <div className={styles.showAll}>
                    <Button kind="tertiary" size="small" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? 'Show less' : 'Show all'}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Update feed (Inbox)"
            defaultOpen={false}
            badge={<Counter count={0} size="small" kind="fill" />}
          >
            <p className={styles.muted}>
              Updates and mentions will appear here in a later release.
            </p>
          </CollapsibleSection>

          <CollapsibleSection title="My workspaces">
            <ul className={styles.workspaces}>
              {workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <Link to={`/workspaces/${workspace.id}`} className={styles.workspaceCard}>
                    <WorkspaceTile icon={workspace.icon} color={workspace.color} size="md" />
                    <span className={styles.workspaceText}>
                      <span className={styles.workspaceName}>{workspace.name}</span>
                      <span className={styles.workspaceMeta}>
                        <Icon icon={Workspace} size={14} />
                        {workspace.kind === 'closed' ? 'Closed workspace' : 'Open workspace'}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </div>

        <aside className={styles.rail} aria-label="Getting started">
          <section className={styles.railCard}>
            <h2 className={styles.railTitle}>Getting started</h2>
            <ul className={styles.checklist}>
              {steps.map((step) => (
                <li key={step.label} className={step.done ? styles.stepDone : styles.step}>
                  <span className={styles.stepMark} aria-hidden="true" />
                  <span>{step.label}</span>
                  <span className={styles.srOnly}>{step.done ? ' (done)' : ' (to do)'}</span>
                </li>
              ))}
            </ul>
            <div
              className={styles.progress}
              role="progressbar"
              aria-label="Getting started progress"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={doneCount}
            >
              <div
                className={styles.progressFill}
                style={{ '--progress': doneCount / steps.length } as CSSProperties}
              />
            </div>
          </section>

          <p className={styles.railHeading}>Learn &amp; get inspired</p>
          <button type="button" className={styles.learn} onClick={() => showComingSoon('Guides')}>
            <span className={styles.learnTitle}>Getting started</span>
            <span className={styles.muted}>Learn how Atrium works</span>
          </button>
          <button type="button" className={styles.learn} onClick={() => showComingSoon('Help')}>
            <span className={styles.learnTitle}>Help center</span>
            <span className={styles.muted}>Learn and get support</span>
          </button>
        </aside>
      </div>
    </div>
  );
}

function BoardCard({ board, workspace }: { board: BoardDoc; workspace: WorkspaceDoc | undefined }) {
  const icon =
    board.kind === 'private' ? BoardPrivate : board.kind === 'shareable' ? BoardShareable : Board;
  return (
    <div className={styles.card}>
      <Link to={`/boards/${board.id}`} className={styles.cardLink} tabIndex={-1} aria-hidden="true">
        <span className={styles.cardThumb}>
          <BoardThumb />
        </span>
      </Link>
      <div className={styles.cardInfo}>
        <Icon icon={icon} size={16} className={styles.cardIcon} />
        <Link to={`/boards/${board.id}`} className={styles.cardName}>
          {board.name}
        </Link>
        <FavoriteStar board={board} size="xs" />
      </div>
      <p className={styles.cardCrumb}>
        {workspace ? (
          <>
            <WorkspaceTile icon={workspace.icon} color={workspace.color} size="xs" />
            <span className={styles.crumbText}>{workspace.name}</span>
          </>
        ) : (
          <span className={styles.crumbText}>Workspace</span>
        )}
      </p>
    </div>
  );
}
