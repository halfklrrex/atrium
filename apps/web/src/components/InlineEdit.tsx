import classNames from 'classnames';
import { useRef, useState, type KeyboardEvent } from 'react';
import styles from './InlineEdit.module.css';

interface InlineEditProps {
  value: string;
  /** Called with the trimmed new value when it changed and is allowed (non-empty unless `allowEmpty`). */
  onCommit: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel: string;
  maxLength?: number;
  allowEmpty?: boolean;
  multiline?: boolean;
  /** Typography/layout of both the display text and the input. */
  className?: string;
  /** Controlled editing (e.g. started from a menu). Leave undefined for click-to-edit. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

/** Click-to-edit text: Enter or blur saves, Escape cancels. Not a form field until activated. */
export function InlineEdit({
  value,
  onCommit,
  readOnly = false,
  placeholder,
  ariaLabel,
  maxLength,
  allowEmpty = false,
  multiline = false,
  className,
  editing: controlledEditing,
  onEditingChange,
}: InlineEditProps) {
  const [localEditing, setLocalEditing] = useState(false);
  const editing = controlledEditing ?? localEditing;
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);

  const setEditing = (next: boolean) => {
    if (next) {
      cancelled.current = false;
      setDraft(value);
    }
    setLocalEditing(next);
    onEditingChange?.(next);
  };

  const finish = () => {
    if (!cancelled.current) {
      const next = draft.trim();
      if (next !== value && (allowEmpty || next.length > 0)) onCommit(next);
    }
    setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !(multiline && event.shiftKey)) {
      event.preventDefault();
      finish();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      cancelled.current = true;
      setEditing(false);
    }
  };

  if (editing && !readOnly) {
    const common = {
      className: classNames(styles.input, className),
      value: draft,
      maxLength,
      'aria-label': ariaLabel,
      autoFocus: true,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onBlur: finish,
      onKeyDown,
      onFocus: (e: { target: { select?: () => void } }) => e.target.select?.(),
    };
    return multiline ? <textarea rows={2} {...common} /> : <input type="text" {...common} />;
  }

  if (readOnly) {
    return (
      <span className={classNames(styles.text, !value && styles.placeholder, className)}>
        {value || placeholder}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={classNames(styles.text, styles.editable, !value && styles.placeholder, className)}
      aria-label={`${ariaLabel}: ${value || placeholder || 'empty'}. Click to edit`}
      onClick={() => setEditing(true)}
    >
      {value || placeholder}
    </button>
  );
}
