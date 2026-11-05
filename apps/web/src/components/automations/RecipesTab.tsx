import { AUTOMATION_LIMITS, type AutomationRunStatus } from '@atrium/shared';
import { Button, Icon, Label, Loader, Menu, MenuButton, MenuItem, Toggle } from '@vibe/core';
import { Alert, Delete, Duplicate, Edit } from '@vibe/icons';
import type { AutomationDoc, AutomationRunDoc } from '../../data/automations';
import { formatUpdated } from '../../lib/format';
import { EmptyState } from '../EmptyState/EmptyState';
import {
  describeAutomation,
  type DescribeBoard,
  type DescribeOptions,
} from './describe-automation';
import { RUN_STATUS_LABELS } from './run-history';
import styles from './AutomationCenter.module.css';

const STATUS_COLOR: Record<AutomationRunStatus, 'positive' | 'negative' | 'dark'> = {
  ok: 'positive',
  failed: 'negative',
  skipped: 'dark',
};

export interface RecipesTabProps {
  automations: readonly AutomationDoc[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  board: DescribeBoard;
  describeOptions: DescribeOptions;
  /** Board owners only: switch, edit, duplicate, delete and create. */
  isOwner: boolean;
  /** The newest run of each recipe; `null` when the viewer can't read the history. */
  lastRuns: ReadonlyMap<string, AutomationRunDoc> | null;
  busyId: string | null;
  deleting: AutomationDoc | null;
  onCreate: () => void;
  onEdit: (automation: AutomationDoc) => void;
  onDuplicate: (automation: AutomationDoc) => void;
  onToggle: (automation: AutomationDoc, enabled: boolean) => void;
  onAskDelete: (automation: AutomationDoc | null) => void;
  onConfirmDelete: (automation: AutomationDoc) => void;
}

function LastRun({ run }: { run: AutomationRunDoc | undefined }) {
  if (!run) return <span className={styles.meta}>Last run: Never</span>;
  return (
    <span className={styles.meta}>
      {`Last run ${formatUpdated(run.startedAt)} `}
      <Label
        text={RUN_STATUS_LABELS[run.status]}
        color={STATUS_COLOR[run.status]}
        size="small"
        kind="line"
      />
    </span>
  );
}

function RecipeRow(props: RecipesTabProps & { automation: AutomationDoc }) {
  const { automation, board, describeOptions, isOwner, lastRuns, busyId } = props;
  const sentence = describeAutomation(automation, board, describeOptions);
  const title = automation.name.trim() || sentence;
  const busy = busyId === automation.id;
  return (
    <li className={styles.row}>
      <div className={styles.switchCell}>
        {isOwner ? (
          <Toggle
            isSelected={automation.enabled}
            disabled={busy}
            onChange={(on) => props.onToggle(automation, on)}
            aria-label={`${automation.enabled ? 'Turn off' : 'Turn on'} ${title}`}
            areLabelsHidden
          />
        ) : (
          <Label
            text={automation.enabled ? 'On' : 'Off'}
            color={automation.enabled ? 'positive' : 'dark'}
            size="small"
            kind="line"
          />
        )}
      </div>
      <div className={styles.text}>
        {automation.name.trim() ? <span className={styles.name}>{automation.name}</span> : null}
        <span className={styles.sentence}>{sentence}</span>
        {!automation.enabled && automation.disabledReason ? (
          <span className={styles.warning} role="status">
            <Icon icon={Alert} className={styles.warningIcon} ignoreFocusStyle />
            <span>{`Turned off: ${automation.disabledReason}`}</span>
            {isOwner ? (
              <Button
                kind="tertiary"
                size="xs"
                disabled={busy}
                onClick={() => props.onToggle(automation, true)}
              >
                Turn on
              </Button>
            ) : null}
          </span>
        ) : null}
        {lastRuns ? <LastRun run={lastRuns.get(automation.id)} /> : null}
      </div>
      <div>
        {isOwner ? (
          <MenuButton
            size="xs"
            aria-label={`Options for ${title}`}
            closeMenuOnItemClick
            disabled={busy}
          >
            <Menu id={`automation-menu-${automation.id}`}>
              <MenuItem icon={Edit} title="Edit" onClick={() => props.onEdit(automation)} />
              <MenuItem
                icon={Duplicate}
                title="Duplicate"
                onClick={() => props.onDuplicate(automation)}
              />
              <MenuItem
                icon={Delete}
                title="Delete"
                onClick={() => props.onAskDelete(automation)}
              />
            </Menu>
          </MenuButton>
        ) : null}
      </div>
    </li>
  );
}

/** The Recipes tab: create, the list with its states, and the delete confirmation. */
export function RecipesTab(props: RecipesTabProps) {
  const { automations, loading, error, isOwner, deleting } = props;

  if (loading) {
    return (
      <div className={styles.center} role="status" aria-label="Loading automations">
        <Loader size="medium" />
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        size="panel"
        title="Automations are unavailable"
        body="We couldn't load the automations. Check your connection and try again."
        primaryAction={{ label: 'Retry', onClick: props.onRetry }}
      />
    );
  }
  if (automations.length === 0) {
    return (
      <EmptyState
        size="panel"
        title="No automations yet"
        body={
          isOwner
            ? 'Automations do the routine work for you: when something happens on this board, they act on it.'
            : 'Board owners can add automations that act when something happens on this board.'
        }
        primaryAction={
          isOwner ? { label: 'Create automation', onClick: props.onCreate } : undefined
        }
      />
    );
  }

  return (
    <>
      {isOwner ? (
        <div className={styles.toolbar}>
          <p
            className={styles.toolbarHint}
          >{`${automations.length} of ${AUTOMATION_LIMITS.maxPerBoard} automations`}</p>
          <Button
            kind="primary"
            size="small"
            disabled={automations.length >= AUTOMATION_LIMITS.maxPerBoard}
            onClick={props.onCreate}
          >
            Create automation
          </Button>
        </div>
      ) : (
        <p className={styles.toolbarHint}>Only board owners can change automations.</p>
      )}
      {deleting ? (
        <div className={styles.confirm} role="alertdialog" aria-label="Delete automation">
          <p className={styles.confirmText}>
            {`Delete "${deleting.name.trim() || describeAutomation(deleting, props.board, props.describeOptions)}"? Its run history stays for 30 days.`}
          </p>
          <div className={styles.confirmActions}>
            <Button
              kind="primary"
              color="negative"
              size="small"
              onClick={() => props.onConfirmDelete(deleting)}
            >
              Delete
            </Button>
            <Button kind="tertiary" size="small" onClick={() => props.onAskDelete(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <ul className={styles.list} aria-label="Automations">
        {automations.map((automation) => (
          <RecipeRow key={automation.id} {...props} automation={automation} />
        ))}
      </ul>
    </>
  );
}
