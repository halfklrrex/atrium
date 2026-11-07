import { INBOX_LIMITS } from '@atrium/shared';
import { TextArea } from '@vibe/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { inboxWrites, useInboxNote } from '../../data/inbox';
import { NOTE_SAVE_DEBOUNCE_MS } from './inbox';
import styles from './Inbox.module.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** The admin-only internal note of a thread: saved on blur and shortly after typing stops. */
export function InboxNote({ threadId, uid }: { threadId: string; uid: string }) {
  const { data: note } = useInboxNote(threadId);
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string | null>(null);

  const text = draft ?? note?.text ?? '';

  const save = useCallback(
    (value: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setState('saving');
      inboxWrites.saveNote(threadId, uid, value).then(
        () => {
          setState('saved');
          // The saved text is now the stored one; drop the draft unless typing went on meanwhile.
          setDraft((current) => (current === value ? null : current));
        },
        (e: unknown) => {
          console.error('Could not save the internal note', e);
          setState('error');
        },
      );
    },
    [threadId, uid],
  );

  const onChange = (value: string) => {
    latest.current = value;
    setDraft(value);
    setState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(value), NOTE_SAVE_DEBOUNCE_MS);
  };

  const onBlur = () => {
    if (draft !== null && draft !== (note?.text ?? '')) save(draft);
  };

  // Leaving the page with an unsaved edit still saves it.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (latest.current !== null) {
          void inboxWrites.saveNote(threadId, uid, latest.current).catch(() => undefined);
        }
      }
    },
    [threadId, uid],
  );

  return (
    <section className={styles.note} aria-label="Internal note">
      <h2 className={styles.noteTitle}>Internal note</h2>
      <p className={styles.noteHint}>Only site admins see this.</p>
      <TextArea
        label="Internal note"
        aria-label="Internal note"
        value={text}
        rows={5}
        maxLength={INBOX_LIMITS.note}
        placeholder="Add a note for the other admins"
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <div className={styles.noteStatus} role="status" aria-live="polite">
        {state === 'saving'
          ? 'Saving...'
          : state === 'saved'
            ? 'Saved'
            : state === 'error'
              ? 'Could not save the note. Try again.'
              : ''}
      </div>
    </section>
  );
}
