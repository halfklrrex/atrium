import { FORM_LIMITS, type PublicFormQuestion } from '@atrium/shared';
import { Checkbox, Dropdown, TextArea, TextField } from '@vibe/core';
import { Favorite, Heart } from '@vibe/icons';
import classNames from 'classnames';
import { useId } from 'react';
import styles from './form.module.css';

type Option = { value: string; label: string };

interface Props {
  question: PublicFormQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  /** The preview: inputs are drawn but can't be used. */
  disabled?: boolean;
}

const labelsOf = (settings: Record<string, unknown>): Array<Record<string, unknown>> =>
  Array.isArray(settings.labels) ? (settings.labels as Array<Record<string, unknown>>) : [];

function statusOptions(question: PublicFormQuestion): Option[] {
  return labelsOf(question.settings)
    .filter((l) => typeof l.label === 'string' && l.label !== '' && typeof l.index === 'number')
    .map((l) => ({ value: String(l.index), label: l.label as string }));
}

function dropdownOptions(question: PublicFormQuestion): Option[] {
  return labelsOf(question.settings)
    .filter((l) => typeof l.label === 'string' && typeof l.id === 'number')
    .map((l) => ({ value: String(l.id), label: l.label as string }));
}

/** One question's label, help text, input and error: the same in the preview and on the public page. */
export function FormQuestionInput({ question, value, onChange, error, disabled }: Props) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [question.help ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  const validation = error ? { status: 'error' as const } : undefined;
  const isCheckbox = question.type === 'checkbox';

  let input;
  switch (question.type) {
    case 'long_text':
      input = (
        <TextArea
          id={id}
          value={typeof value === 'string' ? value : ''}
          rows={4}
          disabled={disabled}
          maxLength={FORM_LIMITS.answersMaxBytes}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          aria-describedby={describedBy || undefined}
        />
      );
      break;
    case 'status':
    case 'dropdown': {
      const multi = question.type === 'dropdown' && question.settings.limitSelect !== true;
      const options =
        question.type === 'status' ? statusOptions(question) : dropdownOptions(question);
      const selected = (
        Array.isArray(value) ? (value as number[]) : typeof value === 'number' ? [value] : []
      ).map(String);
      const common = {
        id,
        inputAriaLabel: question.label,
        options,
        clearable: true,
        searchable: false as const,
        disabled,
        placeholder: 'Select',
      };
      input = multi ? (
        <Dropdown
          {...common}
          multi
          value={options.filter((o) => selected.includes(o.value))}
          onChange={(next: unknown) =>
            onChange(((next as Option[] | null) ?? []).map((o) => Number(o.value)))
          }
        />
      ) : (
        <Dropdown
          {...common}
          value={options.find((o) => selected.includes(o.value))}
          onChange={(next: unknown) => {
            const picked = next ? Number((next as Option).value) : null;
            onChange(question.type === 'status' ? picked : picked === null ? [] : [picked]);
          }}
        />
      );
      break;
    }
    case 'checkbox':
      input = (
        <Checkbox
          label={question.label}
          checked={value === true}
          disabled={disabled}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        />
      );
      break;
    case 'rating': {
      const limit = typeof question.settings.limit === 'number' ? question.settings.limit : 5;
      const Symbol = question.settings.symbol === 'hearts' ? Heart : Favorite;
      const current = typeof value === 'number' ? value : 0;
      input = (
        <div className={styles.rating} role="radiogroup" aria-label={question.label}>
          {Array.from({ length: limit }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={current === n}
              aria-label={`${n} of ${limit}`}
              disabled={disabled}
              className={classNames(styles.ratingButton, n <= current && styles.ratingActive)}
              onClick={() => onChange(current === n ? 0 : n)}
            >
              <Symbol aria-hidden="true" />
            </button>
          ))}
        </div>
      );
      break;
    }
    default: {
      const type =
        question.type === 'numbers'
          ? 'number'
          : question.type === 'email'
            ? 'email'
            : question.type === 'phone'
              ? 'tel'
              : question.type === 'link'
                ? 'url'
                : question.type === 'date'
                  ? 'date'
                  : 'text';
      input = (
        <TextField
          id={id}
          type={type}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          maxLength={question.type === 'name' ? FORM_LIMITS.nameMax : undefined}
          validation={validation}
          onChange={(next: string) => onChange(next)}
          inputAriaLabel={question.label}
        />
      );
    }
  }

  return (
    <div className={styles.question} data-question={question.columnId}>
      {isCheckbox ? null : (
        <label className={styles.label} htmlFor={id}>
          {question.label}
          {question.required ? (
            <span className={styles.asterisk} aria-hidden="true">
              {' *'}
            </span>
          ) : null}
        </label>
      )}
      {question.help ? (
        <p className={styles.help} id={helpId}>
          {question.help}
        </p>
      ) : null}
      {input}
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
