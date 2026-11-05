import { TextArea, TextField } from '@vibe/core';
import { useId, useState } from 'react';

interface Props {
  label: string;
  value: string;
  maxLength: number;
  /** Called on blur (or Enter in a single line field) with the changed text. */
  onCommit: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** An empty value isn't allowed: it reverts to the saved text. */
  required?: boolean;
}

/** A text field that edits locally and saves once, when the user leaves it. */
export function CommitField({
  label,
  value,
  maxLength,
  onCommit,
  multiline,
  disabled,
  placeholder,
  required,
}: Props) {
  const id = useId();
  const [text, setText] = useState(value);
  // The saved text changed elsewhere (or after our own save): show it.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setText(value);
  }

  const commit = () => {
    const next = required ? text.trim() : text;
    if (required && !next) {
      setText(value);
      return;
    }
    if (next !== value) onCommit(next);
  };

  if (multiline) {
    return (
      <TextArea
        label={label}
        aria-label={label}
        value={text}
        rows={3}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
        onBlur={commit}
      />
    );
  }
  return (
    <TextField
      id={id}
      title={label}
      value={text}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(next: string) => setText(next)}
      onBlur={commit}
    />
  );
}
