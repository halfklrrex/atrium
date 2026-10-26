import { phoneValueSchema, type PhoneSettings, type PhoneValue } from '@atrium/shared';
import { Mobile } from '@vibe/icons';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { InlineInput } from './InlineInput';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function PhoneCell({ value, ctx }: CellProps<PhoneValue, PhoneSettings>) {
  if (!value?.phone) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Mobile aria-hidden="true" />
        </span>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <a
        className={styles.cellLink}
        href={`tel:${value.phone}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Mobile className={styles.cellIcon} aria-hidden="true" />
        <span className={styles.text}>
          <Highlight text={value.phone} term={ctx.highlight} />
        </span>
      </a>
    </div>
  );
}

function PhoneEditor({ value, column, onChange, onClose }: EditorProps<PhoneValue, PhoneSettings>) {
  return (
    <InlineInput
      initial={value?.phone ?? ''}
      ariaLabel={column.title}
      inputMode="text"
      isValid={(text) => {
        const trimmed = text.trim();
        return trimmed === '' || phoneValueSchema.safeParse({ phone: trimmed }).success;
      }}
      onCommit={(text) => {
        const trimmed = text.trim();
        if (trimmed === '') {
          onChange(null);
          return;
        }
        const parsed = phoneValueSchema.safeParse({ phone: trimmed });
        if (parsed.success) {
          onChange(parsed.data);
        } else {
          return false;
        }
      }}
      onClose={onClose}
    />
  );
}

export const phoneUi = defineColumnUi<PhoneValue, PhoneSettings>({
  type: 'phone',
  icon: Mobile,
  tone: 'green',
  editor: 'inline',
  Cell: PhoneCell,
  Editor: PhoneEditor,
});
