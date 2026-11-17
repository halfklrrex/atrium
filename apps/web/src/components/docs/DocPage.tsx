import { canEditBoard, canManageBoard, resolveBoardRole } from '@atrium/shared';
import { Button, Loader } from '@vibe/core';
import type { Editor } from '@tiptap/react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useUiStore } from '../AppShell/ui-store';
import { useFolders, useUserLookup, useWorkspace } from '../../data';
import { useDocMeta } from '../../data/docs';
import { formatUpdated } from '../../lib/format';
import { docParam, idFromSlugParam, workspacePath } from '../../lib/paths';
import { NotFoundPage } from '../../pages/NotFoundPage';
import pageStyles from '../../pages/Pages.module.css';
import { CanonicalUrl } from '../CanonicalUrl';
import { docToText, stripTransientNodes } from '../item-view/description';
import { PresenceAvatars } from '../presence';
import { showToast } from '../toast-store';
import { ConflictBanner } from './ConflictBanner';
import { InlineEdit } from '../InlineEdit';
import { buildDocValue, docMentionSource } from './doc-body';
import { docActions } from './doc-actions';
import { DocMenu } from './DocMenu';
import { useDocBody } from './use-doc-body';
import styles from './doc.module.css';

const RichDocEditor = lazy(() =>
  import('../rich-doc/RichDocEditor').then((m) => ({ default: m.RichDocEditor })),
);

/** `/docs/:docId`: the title, who edited last, and the rich-text body with autosave. */
export function DocPage() {
  const { docId: docParamValue } = useParams();
  const docId = idFromSlugParam(docParamValue);
  const { user, rememberWorkspace } = useAuth();
  const uid = user?.uid ?? '';
  const { data: doc, loading } = useDocMeta(docId);
  const { data: workspace } = useWorkspace(doc?.workspaceId);
  const workspaceId = doc?.workspaceId ?? null;

  // Opening a doc remembers its workspace as the user's last one.
  useEffect(() => {
    if (workspaceId) rememberWorkspace(workspaceId);
  }, [workspaceId, rememberWorkspace]);

  if (loading) {
    return (
      <div className={pageStyles.center} role="status">
        <Loader size="medium" />
      </div>
    );
  }

  // Missing docs and ones the user cannot read look the same on purpose.
  if (!doc) return <NotFoundPage />;

  const role = resolveBoardRole(doc, uid, workspace?.roles[uid]);
  if (!role) return <NotFoundPage />;

  return (
    <>
      <CanonicalUrl param={docParamValue} canonical={docParam(doc)} />
      <DocView
        key={doc.id}
        doc={doc}
        canEdit={canEditBoard(role) && doc.state === 'active'}
        isOwner={canManageBoard(role)}
        workspaceName={workspace?.name}
      />
    </>
  );
}

function DocView({
  doc,
  canEdit,
  isOwner,
  workspaceName,
}: {
  doc: NonNullable<ReturnType<typeof useDocMeta>['data']>;
  canEdit: boolean;
  isOwner: boolean;
  workspaceName: string | undefined;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: folders } = useFolders(doc.workspaceId);
  const folder = doc.folderId ? folders.find((f) => f.id === doc.folderId) : undefined;
  const lookup = useUserLookup(doc.workspaceId);
  const body = useDocBody(doc.id);
  const mentions = useMemo(() => docMentionSource(doc.id), [doc.id]);
  const deleted = doc.state === 'deleted';
  const openDialog = useUiStore((s) => s.openDialog);

  // A new doc opens with its title ready to type over.
  const [editingTitle, setEditingTitle] = useState(
    () => (location.state as { focusTitle?: boolean } | null)?.focusTitle === true,
  );
  useEffect(() => {
    if (editingTitle) void navigate(location.pathname, { replace: true, state: null });
    // Only when the page opens: clear the router state so a reload doesn't focus the title again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tiptap, setTiptap] = useState<Editor | null>(null);
  const handleEditor = useCallback((next: Editor | null) => setTiptap(next), []);

  const keepMine = async () => {
    if (!tiptap) return;
    const result = buildDocValue(tiptap.getJSON() as Record<string, unknown>);
    if (!result.ok) {
      showToast(result.message, { type: 'negative' });
      return;
    }
    if (result.value) await body.keepMine(result.value);
  };

  const copyMine = () => {
    const text = tiptap
      ? docToText(stripTransientNodes(tiptap.getJSON() as Record<string, unknown>))
      : '';
    navigator.clipboard
      .writeText(text)
      .then(() => showToast('Your text was copied.', { type: 'positive' }))
      .catch(() => showToast('Could not copy your text.', { type: 'negative' }));
  };

  const editor = body.meta ? lookup(body.meta.updatedBy)?.name : undefined;

  return (
    <div className={styles.page} data-print="reset">
      <header className={styles.header} data-print="hide">
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link
            to={workspacePath({ id: doc.workspaceId, name: workspaceName })}
            className={styles.crumb}
          >
            {workspaceName ?? 'Workspace'}
          </Link>
          {folder ? (
            <>
              <span aria-hidden="true">&gt;</span>
              <span className={styles.crumb}>{folder.name}</span>
            </>
          ) : null}
        </nav>
        <div className={styles.headerActions}>
          <PresenceAvatars docId={doc.id} />
          {isOwner && !deleted ? (
            <Button
              kind="secondary"
              size="small"
              onClick={() => openDialog({ type: 'shareDoc', docId: doc.id })}
            >
              Share
            </Button>
          ) : null}
          <DocMenu doc={doc} size="small" openDocId={doc.id} />
        </div>
      </header>

      <div className={styles.column}>
        {deleted ? (
          <div className={styles.banner} role="status">
            <p className={styles.bannerText}>This doc is in the trash</p>
            {isOwner ? (
              <button
                type="button"
                className={pageStyles.link}
                onClick={() => void docActions.restore(doc)}
              >
                Restore
              </button>
            ) : null}
          </div>
        ) : null}

        {body.conflict && canEdit ? (
          <ConflictBanner
            authorName={lookup(body.conflict.updatedBy ?? '')?.name}
            onLoadTheirs={body.loadTheirs}
            onKeepMine={keepMine}
            onCopyMine={copyMine}
          />
        ) : null}

        <InlineEdit
          value={doc.name}
          ariaLabel="Doc title"
          readOnly={!canEdit}
          maxLength={80}
          editing={editingTitle}
          onEditingChange={setEditingTitle}
          onCommit={(name) => void docActions.rename(doc, name)}
          className={styles.title}
        />

        <p className={styles.meta}>
          {body.meta
            ? `Last edited${editor ? ` by ${editor}` : ''} · ${formatUpdated(body.meta.updatedAt)}`
            : 'Not edited yet'}
        </p>

        <div className={styles.editorHost}>
          {body.ready ? (
            <Suspense fallback={<div aria-busy="true" />}>
              <RichDocEditor
                initial={body.initial}
                readOnly={!canEdit}
                onSave={body.save}
                onEdit={body.onEdit}
                external={body.external}
                onEditor={handleEditor}
                buildValue={buildDocValue}
                mentions={mentions}
                placeholder="Start writing..."
                expandLabel="Doc"
                canExpand={false}
              />
            </Suspense>
          ) : (
            <div className={pageStyles.center} role="status">
              <Loader size="medium" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
