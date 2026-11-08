import { IconButton } from '@vibe/core';
import { Feedback } from '@vibe/icons';
import type { KeyboardEvent } from 'react';
import styles from './CenterHeader.module.css';

/** The two halves of the center: browse templates to make an automation, or manage the board's. */
export type CenterView = 'create' | 'manage';

export const CENTER_TAB_ID = (view: CenterView) => `automation-center-tab-${view}`;
export const CENTER_PANEL_ID = 'automation-center-panel';

export interface CenterHeaderProps {
  /** Id of the title element; the dialog is named by it. */
  titleId: string;
  boardName: string;
  view: CenterView;
  onViewChange: (view: CenterView) => void;
  /** How many automations the board has; shown next to Manage. */
  manageCount: number;
  /** Opens the Send feedback dialog; the icon button is left out when this is not given. */
  onGiveFeedback?: () => void;
}

const VIEWS: readonly { view: CenterView; label: string }[] = [
  { view: 'create', label: 'Create' },
  { view: 'manage', label: 'Manage' },
];

/**
 * The center's fixed 64px bar: the title on the left, the Create | Manage segmented control in the
 * middle. The modal's own close button sits on the right (see CenterShell.module.css).
 */
export function CenterHeader({
  titleId,
  boardName,
  view,
  onViewChange,
  manageCount,
  onGiveFeedback,
}: CenterHeaderProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = view === 'create' ? 'manage' : 'create';
    onViewChange(next);
    document.getElementById(CENTER_TAB_ID(next))?.focus();
  };

  return (
    <header className={styles.header}>
      <h2 className={styles.title} id={titleId}>
        <strong className={styles.product}>Automations</strong>
        {boardName ? (
          <>
            {' '}
            <span className={styles.board}>{boardName}</span>
          </>
        ) : null}
      </h2>
      <div className={styles.segments} role="tablist" aria-label="Automation center view">
        {VIEWS.map(({ view: value, label }) => {
          const selected = view === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              id={CENTER_TAB_ID(value)}
              aria-selected={selected}
              aria-controls={CENTER_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              className={styles.segment}
              onClick={() => onViewChange(value)}
              onKeyDown={onKeyDown}
            >
              {label}
              {value === 'manage' ? (
                <>
                  {' '}
                  <span className={styles.count}>{manageCount}</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      {onGiveFeedback ? (
        <div className={styles.actions}>
          <IconButton
            icon={Feedback}
            kind="tertiary"
            size="small"
            ariaLabel="Give feedback"
            tooltipContent="Give feedback"
            onClick={onGiveFeedback}
          />
        </div>
      ) : null}
    </header>
  );
}
