import { AUTOMATION_LIMITS } from '@atrium/shared';
import { Button, IconButton, Loader, Toggle } from '@vibe/core';
import { Delete, Duplicate, Edit } from '@vibe/icons';
import classNames from 'classnames';
import type { AutomationDoc, AutomationRunDoc } from '../../data/automations';
import { UNKNOWN_PERSON_NAME } from '../../data/members-store';
import { formatUpdated } from '../../lib/format';
import { EmptyState } from '../EmptyState/EmptyState';
import { EmptyWorkspace, NoSearchResults } from '../illustrations';
import { UserAvatar } from '../UserAvatar';
import { attentionReason } from './attention';
import {
  describeAutomation,
  describeAutomationParts,
  type DescribeBoard,
  type DescribeOptions,
} from './describe-automation';
import { AttentionChip, RunStatusChip } from './RunStatusChip';
import { RichSentence } from './RichSentence';
import styles from './AutomationCenter.module.css';

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
  /** The Manage search term: filters by sentence or name. */
  search: string;
  /** A recipe just created, duplicated or saved; its row is highlighted. */
  highlightId?: string | null;
  /** Switches the center to Create (the empty state's "Browse templates"). */
  onBrowseTemplates: () => void;
  onCreate: () => void;
  onEdit: (automation: AutomationDoc) => void;
  onDuplicate: (automation: AutomationDoc) => void;
  onToggle: (automation: AutomationDoc, enabled: boolean) => void;
  onAskDelete: (automation: AutomationDoc | null) => void;
  onConfirmDelete: (automation: AutomationDoc) => void;
}

function LastRun({ run, attention }: { run: AutomationRunDoc | undefined; attention: boolean }) {
  return (
    <span className={styles.lastRun}>
      {attention ? <AttentionChip /> : null}
      {run ? (
        <>
          <RunStatusChip status={run.status} />
          <span className={styles.meta}>{formatUpdated(run.startedAt)}</span>
        </>
      ) : (
        <span className={styles.meta}>Never ran</span>
      )}
    </span>
  );
}

function RecipeRow(props: RecipesTabProps & { automation: AutomationDoc; columns: number }) {
  const { automation, board, describeOptions, isOwner, lastRuns, busyId, columns } = props;
  const sentence = describeAutomation(automation, board, describeOptions);
  const parts = describeAutomationParts(automation, board, describeOptions);
  const title = automation.name.trim() || sentence;
  const busy = busyId === automation.id;
  const attention = attentionReason(automation, lastRuns?.get(automation.id)) !== null;

  if (props.deleting?.id === automation.id) {
    return (
      <tr className={styles.tableRow}>
        <td colSpan={columns}>
          <div className={styles.confirm} role="alertdialog" aria-label="Delete automation">
            <p className={styles.confirmText}>
              {`Delete “${title}”? It stops running at once and its run history is kept for ${AUTOMATION_LIMITS.runTtlDays} days.`}
            </p>
            <Button kind="secondary" size="small" onClick={() => props.onAskDelete(null)}>
              Cancel
            </Button>
            <Button
              kind="primary"
              color="negative"
              size="small"
              disabled={busy}
              onClick={() => props.onConfirmDelete(automation)}
            >
              Delete
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  const createdBy = describeOptions.personName?.(automation.createdBy) ?? UNKNOWN_PERSON_NAME;
  return (
    <tr
      className={classNames(
        styles.tableRow,
        !automation.enabled && styles.off,
        props.highlightId === automation.id && styles.highlight,
      )}
    >
      <td className={styles.switchCell}>
        {isOwner ? (
          <Toggle
            isSelected={automation.enabled}
            disabled={busy}
            onChange={(on) => props.onToggle(automation, on)}
            aria-label={`${automation.enabled ? 'Turn off' : 'Turn on'} ${title}`}
            areLabelsHidden
          />
        ) : (
          <span className={styles.meta}>{automation.enabled ? 'On' : 'Off'}</span>
        )}
      </td>
      <td>
        <div className={styles.text}>
          <span className={styles.sentence}>
            <RichSentence parts={parts} />
          </span>
          {automation.name.trim() ? <span className={styles.meta}>{automation.name}</span> : null}
          {!lastRuns && attention ? <AttentionChip /> : null}
          {!automation.enabled && automation.disabledReason ? (
            <span className={styles.warning} role="status">
              <span className={styles.warningDot} aria-hidden="true" />
              <span>{automation.disabledReason}</span>
              {isOwner ? (
                <>
                  <Button
                    kind="tertiary"
                    size="xs"
                    disabled={busy}
                    onClick={() => props.onEdit(automation)}
                  >
                    Fix
                  </Button>
                  <Button
                    kind="tertiary"
                    size="xs"
                    disabled={busy}
                    onClick={() => props.onToggle(automation, true)}
                  >
                    Turn on
                  </Button>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      </td>
      <td>
        <span className={styles.person}>
          <UserAvatar uid={automation.createdBy} name={createdBy} />
          <span>{createdBy}</span>
        </span>
      </td>
      {lastRuns ? (
        <td>
          <LastRun run={lastRuns.get(automation.id)} attention={attention} />
        </td>
      ) : null}
      <td className={styles.actionsCell}>
        {isOwner ? (
          <span className={styles.rowActions}>
            <IconButton
              icon={Edit}
              kind="tertiary"
              size="small"
              aria-label={`Edit ${title}`}
              disabled={busy}
              onClick={() => props.onEdit(automation)}
            />
            <IconButton
              icon={Duplicate}
              kind="tertiary"
              size="small"
              aria-label={`Duplicate ${title}`}
              disabled={busy}
              onClick={() => props.onDuplicate(automation)}
            />
            <IconButton
              icon={Delete}
              kind="tertiary"
              size="small"
              aria-label={`Delete ${title}`}
              disabled={busy}
              onClick={() => props.onAskDelete(automation)}
            />
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/** The Board automations sub-tab: the list with its states. The tab row lives in `ManageBar`. */
export function RecipesTab(props: RecipesTabProps) {
  const { automations, loading, error, isOwner, lastRuns, search } = props;

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
        illustration={<EmptyWorkspace />}
        title="No automations on this board yet"
        body={
          isOwner
            ? `Automations do the routine work for you: move finished items, notify the right person, keep names tidy. A board can have up to ${AUTOMATION_LIMITS.maxPerBoard}.`
            : 'Board owners can add automations that act when something happens on this board.'
        }
        primaryAction={
          isOwner ? { label: 'Create from scratch', onClick: props.onCreate } : undefined
        }
        secondaryAction={
          isOwner
            ? { label: 'Browse templates', variant: 'button', onClick: props.onBrowseTemplates }
            : undefined
        }
      />
    );
  }

  const term = search.trim().toLowerCase();
  const visible = term
    ? automations.filter(
        (a) =>
          a.name.toLowerCase().includes(term) ||
          describeAutomation(a, props.board, props.describeOptions).toLowerCase().includes(term),
      )
    : automations;
  const columns = lastRuns ? 5 : 4;

  return (
    <>
      {isOwner ? null : (
        <p className={styles.toolbarHint}>Only board owners can change automations.</p>
      )}
      {visible.length === 0 ? (
        <EmptyState
          size="panel"
          illustration={<NoSearchResults />}
          title={`No automations match “${search.trim()}”`}
          body="Try a word from the sentence or the name."
        />
      ) : (
        <table className={styles.table} aria-label="Automations">
          <thead>
            <tr>
              <th scope="col">On</th>
              <th scope="col">Automation</th>
              <th scope="col">Created by</th>
              {lastRuns ? <th scope="col">Last run</th> : null}
              <th scope="col">
                <span className={styles.srOnly}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((automation) => (
              <RecipeRow key={automation.id} {...props} automation={automation} columns={columns} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
