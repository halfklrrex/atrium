import { safeUrlSchema, type LinkValue } from '@atrium/shared';
import { Link as LinkIcon } from '@vibe/icons';
import { useState, type KeyboardEvent } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function LinkCell({ value, ctx }: CellProps<LinkValue, unknown>) {
  if (!value) return <div className={styles.root} />;
  return (
    <div className={styles.root}>
      {/* The value was validated by the registry, so `url` is http(s), mailto or tel only. */}
      <a
        className={styles.link}
        href={value.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        <Highlight text={value.text || value.url} term={ctx.highlight} />
      </a>
    </div>
  );
}

/** "example.com" is what people type; the value needs a scheme. */
function withScheme(raw: string): string {
  const trimmed = raw.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function LinkEditor({ value, column, anchor, onChange, onClose }: EditorProps<LinkValue, unknown>) {
  const [url, setUrl] = useState(value?.url ?? '');
  const [text, setText] = useState(value?.text ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (url.trim() === '') {
      onChange(null);
      onClose();
      return;
    }
    const parsed = safeUrlSchema.safeParse(withScheme(url));
    if (!parsed.success) {
      setError('Enter a web address such as https://example.com');
      return;
    }
    const label = text.trim();
    onChange({ url: parsed.data, ...(label ? { text: label } : {}) });
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
          <span className={popups.fieldLabel}>Web address</span>
          <input
            className={popups.input}
            value={url}
            placeholder="https://"
            autoFocus
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className={popups.field}>
          <span className={popups.fieldLabel}>Text to display</span>
          <input
            className={popups.input}
            value={text}
            onChange={(event) => setText(event.target.value)}
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
            Remove link
          </button>
          <button type="button" className={popups.linkButton} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const linkUi = defineColumnUi<LinkValue, unknown>({
  type: 'link',
  icon: LinkIcon,
  tone: 'blue',
  editor: 'popover',
  Cell: LinkCell,
  Editor: LinkEditor,
});
