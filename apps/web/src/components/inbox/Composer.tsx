import { INBOX_LIMITS, normalizeInboxText } from '@atrium/shared';
import { Button, TextArea } from '@vibe/core';
import { useRef, useState } from 'react';
import styles from './Composer.module.css';

export interface ComposerProps {
  /** Accessible name of the text box. */
  label: string;
  placeholder?: string;
  submitLabel: string;
  /** Sends the text. Throw to show `describeError(error)` under the box and keep the text. */
  onSubmit: (text: string, requestId: string) => Promise<void>;
  /** Text shown under the box for a failure. Not needed when `onError` handles failures. */
  describeError?: (error: unknown) => string;
  /** Handles a failure itself (for example a toast) instead of showing `describeError` under the box. */
  onError?: (error: unknown) => void;
  /** Turns the box and the button off (for example during the wait after a rejected appeal). */
  disabled?: boolean;
}

/** "123 / 2000", red when over the limit. */
export function MessageCounter({ length }: { length: number }) {
  const over = length > INBOX_LIMITS.text;
  return (
    <span className={over ? `${styles.counter} ${styles.counterOver}` : styles.counter}>
      {`${length} / ${INBOX_LIMITS.text}`}
    </span>
  );
}

/**
 * A message box (appeal, appeal reply, feedback reply, admin reply): 2000 characters, a
 * counter, one `requestId` per message that a retry after a failure reuses (the server is
 * idempotent on it).
 */
export function Composer({
  label,
  placeholder,
  submitLabel,
  onSubmit,
  describeError,
  onError,
  disabled = false,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const normalized = normalizeInboxText(text);
  const over = text.length > INBOX_LIMITS.text;
  const invalid = normalized.length === 0 || over;

  const send = async () => {
    if (invalid || sending || disabled) return;
    requestId.current ??= crypto.randomUUID();
    setSending(true);
    setError(null);
    try {
      await onSubmit(normalized, requestId.current);
      requestId.current = null;
      setText('');
    } catch (e) {
      if (onError) onError(e);
      else setError(describeError ? describeError(e) : 'Could not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.composer}>
      <TextArea
        label={label}
        aria-label={label}
        value={text}
        rows={4}
        placeholder={placeholder}
        disabled={disabled || sending}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
          // A new text is a new message, so it gets a new id; a retry of the same text keeps it.
          requestId.current = null;
          setText(e.target.value);
        }}
      />
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.footer}>
        <MessageCounter length={text.length} />
        <Button
          size="small"
          disabled={invalid || disabled}
          loading={sending}
          onClick={() => void send()}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
