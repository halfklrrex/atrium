import { emailValueSchema, type EmailSettings, type EmailValue } from '@atrium/shared';
import { Email } from '@vibe/icons';
import { useState, type KeyboardEvent } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function EmailCell({ value, ctx }: CellProps<EmailValue, EmailSettings>) {
  if (!value?.email) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Email aria-hidden="true" />
        </span>
      </div>
    );
  }

  const label = value.text || value.email;

  return (
    <div className={styles.root}>
      <a
        className={styles.cellLink}
        href={`mailto:${value.email}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Email className={styles.cellIcon} aria-hidden="true" />
        <span className={styles.text}>
          <Highlight text={label} term={ctx.highlight} />
        </span>
      </a>
    </div>
  );
}

function EmailEditor({
  value,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<EmailValue, EmailSettings>) {
  const [email, setEmail] = useState(value?.email ?? '');
  const [text, setText] = useState(value?.text ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      onChange(null);
      onClose();
      return;
    }
    const label = text.trim();
    const candidate = { email: trimmedEmail, ...(label ? { text: label } : {}) };
    const parsed = emailValueSchema.safeParse(candidate);
    if (!parsed.success) {
      setError('Enter a valid email address');
      return;
    }
    onChange(parsed.data);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body} onKeyDown={onKeyDown}>
        <label className={popups.field}>
          <span className={popups.fieldLabel}>Email address</span>
          <input
            className={popups.input}
            value={email}
            placeholder="name@example.com"
            type="email"
            autoFocus
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        </label>
        <label className={popups.field}>
          <span className={popups.fieldLabel}>Text to display</span>
          <input
            className={popups.input}
            value={text}
            placeholder="Optional name"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {error ? <p className={popups.error}>{error}</p> : null}
        <div className={popups.footer}>
          <button
            type="button"
            className={popups.linkButton}
            onClick={() => {
              onChange(null);
              onClose();
            }}
          >
            Remove email
          </button>
          <button type="button" className={popups.linkButton} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const emailUi = defineColumnUi<EmailValue, EmailSettings>({
  type: 'email',
  icon: Email,
  tone: 'blue',
  editor: 'popover',
  Cell: EmailCell,
  Editor: EmailEditor,
});
