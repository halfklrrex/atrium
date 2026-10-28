import {
  computeTotalSeconds,
  formatDuration,
  type TimeTrackingSession,
  type TimeTrackingSettings,
  type TimeTrackingValue,
} from '@atrium/shared';
import { Time } from '@vibe/icons';
import classNames from 'classnames';
import { useRef, useState, type MouseEvent } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { showToast } from '../components/toast-store';
import { columnActionCalls, describeCallableError } from '../lib/callables';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { useSharedTicker } from './shared-ticker';
import { defineColumnUi, type CellProps } from './types';

export function formatSessionTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TimeTrackingCell({
  value,
  settings,
  column,
  ctx,
}: CellProps<TimeTrackingValue, TimeTrackingSettings>) {
  const nowMs = useSharedTicker();
  const cellRef = useRef<HTMLDivElement>(null);
  const [activePopup, setActivePopup] = useState<'note' | 'history' | null>(null);
  const [popupAnchor, setPopupAnchor] = useState<HTMLElement | null>(null);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);

  const effectiveValue: TimeTrackingValue = value ?? { duration: 0, running: false };
  const running = effectiveValue.running;
  const totalSeconds = computeTotalSeconds(effectiveValue, nowMs);
  const durationText = formatDuration(totalSeconds);

  const trackHistory = settings?.trackHistory ?? true;
  const requireNote = settings?.requireNote ?? false;
  const canAct = ctx.canAct ?? ctx.canEdit;
  const sessions: readonly TimeTrackingSession[] = effectiveValue.history ?? [];

  const runStart = async (note?: string) => {
    if (!ctx.boardId || !ctx.itemId || busy) return;
    setBusy(true);
    try {
      await columnActionCalls.startTimeTracking({
        boardId: ctx.boardId,
        itemId: ctx.itemId,
        columnId: column.id,
        ...(note !== undefined ? { note } : {}),
      });
      setActivePopup(null);
      setNoteText('');
    } catch (err) {
      showToast(describeCallableError(err, 'Failed to start timer.'), { type: 'negative' });
    } finally {
      setBusy(false);
    }
  };

  const runStop = async () => {
    if (!ctx.boardId || !ctx.itemId || busy) return;
    setBusy(true);
    try {
      await columnActionCalls.stopTimeTracking({
        boardId: ctx.boardId,
        itemId: ctx.itemId,
        columnId: column.id,
      });
    } catch (err) {
      showToast(describeCallableError(err, 'Failed to stop timer.'), { type: 'negative' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!canAct || busy) return;
    if (running) {
      void runStop();
      return;
    }
    if (requireNote) {
      setNoteText('');
      setPopupAnchor(cellRef.current ?? e.currentTarget);
      setActivePopup('note');
      return;
    }
    void runStart();
  };

  const handleStartWithNote = () => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    void runStart(trimmed);
  };

  const handleDurationClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!trackHistory) return;
    setPopupAnchor(cellRef.current ?? e.currentTarget);
    setActivePopup((prev) => (prev === 'history' ? null : 'history'));
  };

  return (
    <div ref={cellRef} className={styles.root}>
      <div className={styles.timeTrackingCell}>
        <button
          type="button"
          className={classNames(styles.timerToggleBtn, running && styles.timerToggleBtnRunning)}
          aria-label={running ? 'Stop' : 'Play'}
          disabled={busy || !canAct}
          onClick={handleToggleClick}
        >
          {running ? (
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="4" y="4" width="8" height="8" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M5 3.5L12.5 8L5 12.5V3.5Z" />
            </svg>
          )}
        </button>
        {trackHistory ? (
          <button type="button" className={styles.timerDurationBtn} onClick={handleDurationClick}>
            {durationText}
          </button>
        ) : (
          <span className={styles.text}>{durationText}</span>
        )}
      </div>

      {activePopup === 'note' ? (
        <AnchoredPopup
          anchor={popupAnchor}
          onClose={() => setActivePopup(null)}
          label={`${column.title} note`}
        >
          <div className={popups.body} onKeyDown={(e) => e.stopPropagation()}>
            <label className={popups.field}>
              <span className={popups.fieldLabel}>Note</span>
              <input
                className={popups.input}
                value={noteText}
                placeholder="Add a session note…"
                maxLength={500}
                autoFocus
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleStartWithNote();
                  }
                }}
              />
            </label>
            <div className={popups.footer}>
              <button
                type="button"
                className={popups.linkButton}
                onClick={() => setActivePopup(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={popups.linkButton}
                disabled={busy || !noteText.trim()}
                onClick={handleStartWithNote}
              >
                Start timer
              </button>
            </div>
          </div>
        </AnchoredPopup>
      ) : null}

      {activePopup === 'history' && trackHistory ? (
        <AnchoredPopup
          anchor={popupAnchor}
          onClose={() => setActivePopup(null)}
          label={`${column.title} history`}
        >
          <div className={popups.body} onKeyDown={(e) => e.stopPropagation()}>
            <div className={popups.list} role="list" aria-label="Session history">
              {sessions.length === 0 ? (
                <p className={popups.muted}>No sessions recorded yet</p>
              ) : (
                sessions.map((session) => (
                  <div key={session.id} role="listitem" className={popups.listRow}>
                    <span>{session.userId}</span>
                    <span className={popups.muted}>
                      {formatSessionTimestamp(session.startedAt)} –{' '}
                      {session.endedAt !== undefined
                        ? formatSessionTimestamp(session.endedAt)
                        : 'Running'}
                    </span>
                    <span>{formatDuration(session.duration)}</span>
                    {session.note ? <span className={popups.muted}>{session.note}</span> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </AnchoredPopup>
      ) : null}
    </div>
  );
}

export const timeTrackingUi = defineColumnUi<TimeTrackingValue, TimeTrackingSettings>({
  type: 'time_tracking',
  icon: Time,
  tone: 'orange',
  editor: 'none',
  Cell: TimeTrackingCell,
});
