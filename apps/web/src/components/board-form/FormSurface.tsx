import type { PublicFormQuestion } from '@atrium/shared';
import type { ReactNode } from 'react';
import type { Drafts } from './form-answers';
import { FormQuestionInput } from './FormQuestionInput';
import styles from './form.module.css';

interface Props {
  title: string;
  description: string;
  questions: readonly PublicFormQuestion[];
  drafts?: Drafts;
  errors?: Record<string, string>;
  onChange?: (columnId: string, value: unknown) => void;
  disabled?: boolean;
  /** What the title shows when empty. */
  emptyTitle: string;
  children?: ReactNode;
}

/** The form as a visitor sees it: used by the live preview and by the public page. */
export function FormSurface({
  title,
  description,
  questions,
  drafts = {},
  errors = {},
  onChange,
  disabled,
  emptyTitle,
  children,
}: Props) {
  return (
    <div className={styles.surface}>
      <h2 className={title ? styles.surfaceTitle : styles.surfaceTitleEmpty}>
        {title || emptyTitle}
      </h2>
      {description ? <p className={styles.surfaceDescription}>{description}</p> : null}
      <div className={styles.questions}>
        {questions.map((q) => (
          <FormQuestionInput
            key={q.columnId}
            question={q}
            value={drafts[q.columnId]}
            error={errors[q.columnId]}
            disabled={disabled}
            onChange={(value) => onChange?.(q.columnId, value)}
          />
        ))}
      </div>
      {children}
    </div>
  );
}
