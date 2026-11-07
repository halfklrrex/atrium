import { canManageBoard, type BoardRole } from '@atrium/shared';
import { Button, Modal } from '@vibe/core';
import { NavigationChevronLeft } from '@vibe/icons';
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import {
  automationInputOf,
  automationWrites,
  duplicateAutomationName,
  type AutomationInput,
  useAutomationRuns,
  useBoardAutomations,
  type AutomationDoc,
} from '../../data/automations';
import type { BoardDoc } from '../../data/model';
import { useUserLookup } from '../../data/members-store';
import { describeError } from '../boards/board-actions';
import { openItem } from '../board-table/open-item';
import { PopupLayer } from '../PopupLayer';
import { showToast } from '../toast-store';
import { CENTER_PANEL_ID, CENTER_TAB_ID, CenterHeader, type CenterView } from './CenterHeader';
import { CreateTab } from './CreateTab';
import { describeAutomation } from './describe-automation';
import { ManageBar, type ManageTab } from './ManageBar';
import { RecipesTab } from './RecipesTab';
import { RecipeBuilder } from './RecipeBuilder';
import { RunHistoryTab } from './RunHistoryTab';
import { lastRunByAutomation } from './run-history';
import shell from './CenterShell.module.css';

const TITLE_ID = 'automation-center-title';

/** What the center asks the recipe builder to open; a new recipe may begin from a preset. */
export type BuilderTarget =
  { mode: 'create'; initial?: AutomationInput } | { mode: 'edit'; automation: AutomationDoc };

export interface AutomationCenterProps {
  board: BoardDoc;
  /** The viewer's role on the board; only owners get the controls and the run history. */
  role: BoardRole | null;
  onClose: () => void;
  /** Overrides the built-in recipe builder (tests, or hosting the builder elsewhere). */
  onOpenBuilder?: (target: BuilderTarget) => void;
}

/**
 * The Automation center: a modal with the board's recipes and, for owners, the run history.
 * Editors and viewers see the recipes read-only.
 */
export function AutomationCenter(props: AutomationCenterProps) {
  // A retry remounts the body, which re-subscribes both listeners.
  const [attempt, setAttempt] = useState(0);
  // Opens on Create, as the mockup does; kept here so a retry doesn't throw the view away.
  const [view, setView] = useState<CenterView>('create');
  return (
    <Modal
      id="automation-center"
      show
      size="full-view"
      className={shell.modal}
      aria-labelledby={TITLE_ID}
      closeButtonAriaLabel="Close"
      onClose={props.onClose}
    >
      <PopupLayer>
        <CenterBody
          key={attempt}
          {...props}
          view={view}
          onViewChange={setView}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </PopupLayer>
    </Modal>
  );
}

function CenterBody({
  board,
  role,
  onClose,
  onOpenBuilder,
  onRetry,
  view,
  onViewChange: setView,
}: AutomationCenterProps & {
  onRetry: () => void;
  view: CenterView;
  onViewChange: (view: CenterView) => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const isOwner = canManageBoard(role);
  const [tab, setTab] = useState<ManageTab>('recipes');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AutomationDoc | null>(null);
  const [builder, setBuilder] = useState<BuilderTarget | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const automations = useBoardAutomations(board.id);
  // Owners only: everyone else never subscribes to the history.
  const runs = useAutomationRuns(board.id, isOwner);
  const lastRuns = useMemo(
    () => (isOwner ? lastRunByAutomation(runs.data) : null),
    [isOwner, runs.data],
  );

  const lookup = useUserLookup(board.workspaceId);
  const describeOptions = useMemo(
    () => ({ personName: (id: string) => lookup(id)?.name ?? null }),
    [lookup],
  );

  const ctx = useMemo(() => ({ boardId: board.id, uid, board, role }), [board, uid, role]);

  const run = useCallback(
    async (id: string | null, task: () => Promise<unknown>, failure: string) => {
      setBusyId(id);
      try {
        await task();
        return true;
      } catch (error) {
        console.error(failure, error);
        showToast(
          error instanceof Error && !(error as { code?: string }).code
            ? error.message
            : describeError(error, failure),
          { type: 'negative' },
        );
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  const openBuilder = (target: BuilderTarget) => {
    if (onOpenBuilder) {
      onOpenBuilder(target);
      return;
    }
    setBuilder(target);
  };

  const closeBuilder = () => {
    setBuilder(null);
    // Give focus back to the segment, where the Create or Edit control lived.
    requestAnimationFrame(() => document.getElementById(CENTER_TAB_ID(view))?.focus());
  };

  // A save lands on Manage > Board automations, where the new or changed recipe shows up.
  const builderSaved = (savedId: string) => {
    setBuilder(null);
    setHighlightId(savedId);
    setView('manage');
    setTab('recipes');
    requestAnimationFrame(() => document.getElementById(CENTER_TAB_ID('manage'))?.focus());
  };

  const changeView = (next: CenterView) => {
    // Clicking Create or Manage while building leaves the builder, like Cancel.
    setBuilder(null);
    setView(next);
  };

  const builderCrumb = (target: BuilderTarget) => {
    if (target.mode === 'edit') {
      const { automation } = target;
      return `Editing: ${automation.name.trim() || describeAutomation(automation, board, describeOptions)}`;
    }
    return target.initial
      ? `From template: ${describeAutomation(target.initial, board, describeOptions)}`
      : 'New automation from scratch';
  };

  const body = builder ? (
    <div className={shell.builder}>
      <div className={shell.backBar}>
        <Button
          kind="tertiary"
          size="small"
          leftIcon={NavigationChevronLeft}
          onClick={closeBuilder}
        >
          {view === 'create' ? 'Back to templates' : 'Back to Manage'}
        </Button>
        <span className={shell.crumb}>{builderCrumb(builder)}</span>
      </div>
      <div className={shell.builderScroll}>
        <RecipeBuilder
          board={board}
          role={role}
          uid={uid}
          existingCount={automations.data.length}
          existing={automations.data}
          automation={builder.mode === 'edit' ? builder.automation : null}
          initial={builder.mode === 'create' ? builder.initial : undefined}
          onCancel={closeBuilder}
          onSaved={builderSaved}
        />
      </div>
    </div>
  ) : (
    <div className={view === 'create' ? shell.create : shell.manage}>
      {view === 'manage' ? (
        <ManageBar
          tab={tab}
          onTabChange={setTab}
          count={automations.data.length}
          isOwner={isOwner}
          search={search}
          onSearchChange={setSearch}
          onCreate={() => openBuilder({ mode: 'create' })}
        />
      ) : null}
      <div className={view === 'create' ? shell.createBody : shell.manageScroll}>
        {view === 'create' ? (
          <CreateTab
            board={board}
            uid={uid}
            isOwner={isOwner}
            onOpenBuilder={(initial) => openBuilder({ mode: 'create', initial })}
          />
        ) : tab === 'recipes' ? (
          <RecipesTab
            automations={automations.data}
            loading={automations.loading}
            error={automations.error}
            onRetry={onRetry}
            board={board}
            describeOptions={describeOptions}
            isOwner={isOwner}
            lastRuns={lastRuns}
            busyId={busyId}
            deleting={deleting}
            search={search}
            highlightId={highlightId}
            onBrowseTemplates={() => changeView('create')}
            onCreate={() => openBuilder({ mode: 'create' })}
            onEdit={(automation) => openBuilder({ mode: 'edit', automation })}
            onDuplicate={(automation) =>
              void run(
                automation.id,
                async () => {
                  await automationWrites.create(
                    ctx,
                    {
                      ...automationInputOf(automation),
                      name: duplicateAutomationName(automation.name),
                    },
                    automations.data.length,
                    // The copy starts off so the board never runs the same recipe twice by surprise.
                    { enabled: false, others: automations.data },
                  );
                  showToast('Automation duplicated. The copy is switched off.', {
                    type: 'positive',
                  });
                },
                'Could not duplicate that automation.',
              )
            }
            onToggle={(automation, enabled) =>
              void run(
                automation.id,
                () => automationWrites.setEnabled(ctx, automation, enabled),
                'Could not change that automation.',
              )
            }
            onAskDelete={setDeleting}
            onConfirmDelete={(automation) =>
              void run(
                automation.id,
                async () => {
                  await automationWrites.remove(board.id, automation.id);
                  setDeleting(null);
                },
                'Could not delete that automation.',
              )
            }
          />
        ) : (
          <RunHistoryTab
            boardId={board.id}
            isOwner={isOwner}
            runs={runs.data}
            loading={runs.loading}
            error={runs.error}
            onRetry={onRetry}
            automations={automations.data}
            board={board}
            describeOptions={describeOptions}
            onOpenItem={(itemId) => {
              onClose();
              openItem(board.id, itemId);
            }}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className={shell.shell}>
      <CenterHeader
        titleId={TITLE_ID}
        boardName={board.name}
        view={view}
        onViewChange={changeView}
        manageCount={automations.data.length}
      />
      <div
        className={shell.body}
        role="tabpanel"
        id={CENTER_PANEL_ID}
        aria-labelledby={CENTER_TAB_ID(view)}
      >
        {body}
      </div>
    </div>
  );
}
