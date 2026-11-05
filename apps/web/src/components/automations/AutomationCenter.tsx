import { canManageBoard, type BoardRole } from '@atrium/shared';
import {
  Button,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalHeader,
  Tab,
  TabList,
} from '@vibe/core';
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import {
  automationInputOf,
  automationWrites,
  duplicateAutomationName,
  useAutomationRuns,
  useBoardAutomations,
  type AutomationDoc,
} from '../../data/automations';
import type { BoardDoc } from '../../data/model';
import { UNKNOWN_PERSON_NAME, useWorkspaceMembers } from '../../data/members-store';
import { describeError } from '../boards/board-actions';
import { openItem } from '../board-table/open-item';
import { showToast } from '../toast-store';
import { RecipesTab } from './RecipesTab';
import { RunHistoryTab } from './RunHistoryTab';
import { lastRunByAutomation } from './run-history';
import styles from './AutomationCenter.module.css';

type CenterTab = 'recipes' | 'history';

/** What the center asks the recipe builder (B2) to open. */
export type BuilderTarget = { mode: 'create' } | { mode: 'edit'; automation: AutomationDoc };

export interface AutomationCenterProps {
  board: BoardDoc;
  /** The viewer's role on the board; only owners get the controls and the run history. */
  role: BoardRole | null;
  onClose: () => void;
  /**
   * Hook for the recipe builder (P5b B2). While it is not wired, "Create automation" and "Edit"
   * show a clearly marked placeholder instead.
   */
  onOpenBuilder?: (target: BuilderTarget) => void;
}

/**
 * The Automation center: a modal with the board's recipes and, for owners, the run history.
 * Editors and viewers see the recipes read-only.
 */
export function AutomationCenter(props: AutomationCenterProps) {
  // A retry remounts the body, which re-subscribes both listeners.
  const [attempt, setAttempt] = useState(0);
  return (
    <Modal id="automation-center" show size="large" onClose={props.onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Automations" />
        <ModalContent>
          <CenterBody key={attempt} {...props} onRetry={() => setAttempt((n) => n + 1)} />
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}

function CenterBody({
  board,
  role,
  onClose,
  onOpenBuilder,
  onRetry,
}: AutomationCenterProps & { onRetry: () => void }) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const isOwner = canManageBoard(role);
  const [tab, setTab] = useState<CenterTab>('recipes');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AutomationDoc | null>(null);
  const [builder, setBuilder] = useState<BuilderTarget | null>(null);

  const automations = useBoardAutomations(board.id);
  // Owners only: everyone else never subscribes to the history.
  const runs = useAutomationRuns(board.id, isOwner);
  const lastRuns = useMemo(
    () => (isOwner ? lastRunByAutomation(runs.data) : null),
    [isOwner, runs.data],
  );

  const { members } = useWorkspaceMembers(board.workspaceId);
  const describeOptions = useMemo(
    () => ({
      personName: (id: string) => {
        const member = members.find((m) => m.id === id);
        return member ? member.displayName || member.email || UNKNOWN_PERSON_NAME : null;
      },
    }),
    [members],
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
    if (onOpenBuilder) onOpenBuilder(target);
    else setBuilder(target);
  };

  if (builder) {
    return (
      <div className={styles.placeholder} data-testid="builder-placeholder">
        <p className={styles.sentence}>
          Recipe builder coming in the next update. For now you can switch automations on and off,
          duplicate and delete them.
        </p>
        <Button kind="secondary" size="small" onClick={() => setBuilder(null)}>
          Back to automations
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.body}>
      <TabList
        activeTabId={tab === 'recipes' ? 0 : 1}
        onTabChange={(id: number) => setTab(id === 0 ? 'recipes' : 'history')}
      >
        <Tab>Recipes</Tab>
        <Tab>Run history</Tab>
      </TabList>
      <div className={styles.scroll}>
        {tab === 'recipes' ? (
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
                    { enabled: false },
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
}
