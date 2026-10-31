import {
  CLEARED_WARNING,
  columnRegistry,
  columnTypeChangeSupport,
  conversionSamples,
  findColumnDependents,
  planColumnConversion,
  type BoardView,
  type ColumnDef,
  type ColumnDependent,
} from '@atrium/shared';
import { Modal, ModalBasicLayout, ModalContent, ModalFooter, ModalHeader } from '@vibe/core';
import { useMemo, useState } from 'react';
import type { ItemDoc } from '../../data';
import { useWorkspaceMembers } from '../../data/members-store';
import { useBoardViewsContext } from '../board-views/view-context';
import styles from './ChangeColumnTypeDialog.module.css';
import { describeConversionCounts } from './conversion-text';
import { derivedCellValue } from './derived';

const DEPENDENT_KIND: Record<ColumnDependent['kind'], string> = {
  formula: 'Formula column',
  progress: 'Progress column',
  mirror: 'Mirror column',
  dependency: 'Dependency column',
  view: 'View',
};

export interface ChangeColumnTypeDialogProps {
  boardId: string;
  workspaceId?: string;
  /** The column being changed, and every column of its list (formulas and mirrors may use it). */
  column: ColumnDef;
  columns: readonly ColumnDef[];
  toType: string;
  /** The rows the column writes to (top-level items, or subitems). */
  items: readonly ItemDoc[];
  /** Views to check for use of the column; defaults to the board's views. */
  views?: ReadonlyArray<Pick<BoardView, 'name' | 'settings'>>;
  /** Display names by uid to convert People to text; defaults to the workspace members. */
  personNames?: Readonly<Record<string, string>>;
  onConfirm: (info: {
    toSettings: Record<string, unknown>;
    valueCount: number;
  }) => Promise<unknown>;
  onClose: () => void;
}

/** "Change Budget from Numbers to Text?" with what will happen to the values, before anything runs. */
export function ChangeColumnTypeDialog({
  boardId,
  workspaceId,
  column,
  columns,
  toType,
  items,
  views: viewsOverride,
  personNames: namesOverride,
  onConfirm,
  onClose,
}: ChangeColumnTypeDialogProps) {
  const [busy, setBusy] = useState(false);
  const viewsContext = useBoardViewsContext();
  const { members } = useWorkspaceMembers(workspaceId);
  const views = viewsOverride ?? viewsContext?.views;
  const personNames = useMemo(
    () =>
      namesOverride ??
      Object.fromEntries(members.flatMap((m) => (m.displayName ? [[m.id, m.displayName]] : []))),
    [namesOverride, members],
  );
  const fromLabel = columnRegistry.find(column.type)?.label ?? column.type;
  const toLabel = columnRegistry.find(toType)?.label ?? toType;

  const preview = useMemo(() => {
    const toSettings = columnRegistry.defaultSettings(toType) as Record<string, unknown>;
    const derivedSource = columnRegistry.isDerived(column.type);
    const entries = items.flatMap((item) => {
      const value = derivedSource
        ? derivedCellValue(boardId, columns, column, item)
        : item.values[column.id];
      return value === null || value === undefined ? [] : [{ id: item.id, value }];
    });
    const options = { personNames };
    const plan = planColumnConversion(column, toType, toSettings, entries, options);
    return {
      toSettings,
      plan,
      samples: conversionSamples(column, toType, plan, entries, 3, options),
      dependents: findColumnDependents(columns, column.id, views),
    };
  }, [boardId, column, columns, toType, items, views, personNames]);

  const support = columnTypeChangeSupport(column.type, toType);
  const { plan } = preview;

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm({
        toSettings: preview.toSettings,
        valueCount: plan.converted + plan.cleared,
      });
    } finally {
      onClose();
    }
  };

  return (
    <Modal id="change-column-type-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={`Change "${column.title}" from ${fromLabel} to ${toLabel}?`} />
        <ModalContent>
          <p className={styles.text} data-testid="change-type-counts">
            {describeConversionCounts(plan.converted, plan.cleared)}
          </p>
          {support.warning ? (
            <p className={styles.warning} data-testid="change-type-warning">
              {support.warning === CLEARED_WARNING
                ? `${CLEARED_WARNING}: ${fromLabel} values can't be carried over to ${toLabel}.`
                : support.warning}
            </p>
          ) : null}
          {preview.samples.length > 0 ? (
            <div className={styles.section}>
              <h3 className={styles.heading}>Preview</h3>
              <ul className={styles.samples} data-testid="change-type-samples">
                {preview.samples.map((sample, index) => (
                  <li key={index} className={styles.sample}>
                    <span className={styles.before}>{sample.before}</span>
                    <span aria-hidden="true" className={styles.arrow}>
                      →
                    </span>
                    <span className={sample.after === null ? styles.cleared : styles.after}>
                      {sample.after ?? 'Cleared'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview.dependents.length > 0 ? (
            <div className={styles.section} data-testid="change-type-dependents">
              <h3 className={styles.heading}>Used by</h3>
              <p className={styles.text}>
                {preview.dependents.map((d) => `${DEPENDENT_KIND[d.kind]} "${d.title}"`).join(', ')}
                . They may stop working after the change.
              </p>
            </div>
          ) : null}
          <p className={styles.note}>You can undo this from the column menu for 30 days.</p>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: 'Change',
          onClick: () => void confirm(),
          disabled: busy,
          loading: busy,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: busy }}
      />
    </Modal>
  );
}
