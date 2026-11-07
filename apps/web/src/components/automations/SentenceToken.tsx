import { Check, DropdownChevronDown } from '@vibe/icons';
import classNames from 'classnames';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import { UserAvatar } from '../UserAvatar';
import styles from './SentenceToken.module.css';

/** One choice in a token's list. */
export interface TokenOption {
  value: string;
  /** Plain text: the list row, and the token once chosen. */
  label: string;
  /** A status or dropdown label's own colour: the row then draws as a coloured chip. */
  chip?: string;
  /** A workspace member: the row shows their avatar and name. */
  uid?: string;
  /** A group's colour, shown as a dot before the name. */
  dot?: string;
  disabled?: boolean;
  /** Secondary text after the label, for example why the option is unavailable. */
  hint?: string;
  /** A small tag at the end of the row ("Soon", "Planned"). */
  badge?: string;
}

interface BaseProps {
  /** Accessible name of the token and its list ("Status column"). */
  label: string;
  options: readonly TokenOption[];
  /** What a blank reads as ("something happens", "a group"). */
  placeholder: string;
  /** Overrides the text shown once filled (for a value whose option is gone, or a short form). */
  display?: string;
  disabled?: boolean;
  /** `link`: a link-coloured text button ("Change trigger") instead of a token. */
  variant?: 'token' | 'link';
  /** Shown in place of the rows when `options` is empty ("No status column on this board"). */
  emptyText?: string;
}

export interface SentenceTokenProps extends BaseProps {
  /** The chosen option's value, or `null` while the blank is unfilled. */
  value: string | null;
  onChange: (value: string) => void;
}

export interface SentenceMultiTokenProps extends BaseProps {
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** The most that can be chosen; further rows are disabled until one is unticked. */
  max?: number;
}

function Row({ option }: { option: TokenOption }) {
  return (
    <span className={styles.rowContent}>
      {option.chip ? (
        <span className={styles.chip} style={{ backgroundColor: option.chip }}>
          {option.label}
        </span>
      ) : option.uid ? (
        <>
          <UserAvatar uid={option.uid} size="xs" />
          <span>{option.label}</span>
        </>
      ) : (
        <>
          {option.dot ? (
            <span className={styles.dot} style={{ backgroundColor: option.dot }} />
          ) : null}
          <span>{option.label}</span>
        </>
      )}
      {option.hint ? <span className={styles.hint}>{option.hint}</span> : null}
      {option.badge ? <span className={styles.badge}>{option.badge}</span> : null}
    </span>
  );
}

/**
 * A token and the list it opens. Opens on click, closes on Escape (focus returns to the token), Tab
 * or a press outside; arrows, Home and End move between the enabled rows. `children` are the rows.
 */
function TokenShell({
  base,
  text,
  filled,
  multiple = false,
  children,
}: {
  base: BaseProps;
  text: string;
  filled: boolean;
  multiple?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const link = base.variant === 'link';

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const rows = panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)');
    const selected = panelRef.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]:not(:disabled)',
    );
    const first = selected ?? rows?.[0];
    first?.focus();
    // The popup is hidden until it has been placed; a hidden row can't take focus, so retry once.
    const frame = requestAnimationFrame(() => {
      if (!panelRef.current?.contains(document.activeElement)) first?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // The Automation center closes on Escape; this one only closes the list.
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const rows = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? []),
    ];
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? rows.length - 1
          : event.key === 'ArrowDown'
            ? (at + 1) % rows.length
            : (at - 1 + rows.length) % rows.length;
    rows[next]?.focus();
  };

  return (
    <span className={styles.wrap}>
      <button
        ref={(node) => {
          buttonRef.current = node;
          setAnchor(node);
        }}
        type="button"
        className={classNames(
          link ? styles.link : filled ? styles.token : styles.blank,
          open && styles.tokenOpen,
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={link ? base.label : `${base.label}: ${text}`}
        data-blank={!filled && !link ? '' : undefined}
        disabled={base.disabled}
        onClick={() => setOpen(!open)}
      >
        {text}
        {link ? null : <DropdownChevronDown className={styles.chevron} aria-hidden="true" />}
      </button>
      {open ? (
        <AnchoredPopup
          anchor={anchor}
          onClose={() => setOpen(false)}
          label={base.label}
          matchAnchorWidth
        >
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            aria-label={base.label}
            aria-multiselectable={multiple || undefined}
            className={styles.panel}
            onKeyDown={onKeyDown}
            onClick={(event) => {
              // Choosing a row closes a single-choice list; a multi-choice list stays open.
              const row = (event.target as HTMLElement).closest('[role="option"]');
              if (row && !multiple && !(row as HTMLButtonElement).disabled) close(true);
            }}
          >
            {children}
          </div>
        </AnchoredPopup>
      ) : null}
    </span>
  );
}

/**
 * A blank in the automation sentence: a button that reads as the chosen value (or as an underlined
 * blank) and opens a small list of choices. Status and dropdown labels show as coloured chips and
 * people with their avatar.
 */
export function SentenceToken(props: SentenceTokenProps) {
  const current = props.options.find((o) => o.value === props.value);
  const filled = props.value !== null;
  const text = filled ? (props.display ?? current?.label ?? props.value ?? '') : props.placeholder;
  return (
    <TokenShell base={props} text={text} filled={filled}>
      {props.options.length === 0 ? (
        <p className={styles.empty}>{props.emptyText ?? 'Nothing to choose from'}</p>
      ) : null}
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === props.value}
          disabled={option.disabled}
          className={classNames(styles.option, option.value === props.value && styles.optionOn)}
          onClick={() => {
            if (option.value !== props.value) props.onChange(option.value);
          }}
        >
          <Row option={option} />
        </button>
      ))}
    </TokenShell>
  );
}

/** Like `SentenceToken`, but several rows can be ticked; the list stays open while choosing. */
export function SentenceMultiToken(props: SentenceMultiTokenProps) {
  const filled = props.values.length > 0;
  const text = filled ? (props.display ?? props.values.join(', ')) : props.placeholder;
  const full = props.max !== undefined && props.values.length >= props.max;
  return (
    <TokenShell base={props} text={text} filled={filled} multiple>
      {props.options.length === 0 ? (
        <p className={styles.empty}>{props.emptyText ?? 'No one found'}</p>
      ) : null}
      {props.options.map((option) => {
        const on = props.values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={on}
            disabled={option.disabled || (full && !on)}
            className={classNames(styles.option, on && styles.optionOn)}
            onClick={() =>
              props.onChange(
                on
                  ? props.values.filter((v) => v !== option.value)
                  : [...props.values, option.value],
              )
            }
          >
            <Row option={option} />
            {on ? <Check className={styles.check} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </TokenShell>
  );
}

/** The first failure of a part of the sentence, in red under its line. */
export function SentenceProblem({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className={styles.problem}>
      {message}
    </p>
  ) : null;
}

export interface TokenInputProps extends Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'placeholder' | 'maxLength' | 'min' | 'max' | 'title' | 'required'
> {
  /** Accessible name. */
  label: string;
  value: string;
  onChange: (value: string, valueAsNumber: number) => void;
  /** `wide` for a sentence of text (an update), `narrow` for a number. */
  size?: 'narrow' | 'normal' | 'wide';
}

/** A typed blank in the sentence: filled it looks like a token, empty like an underlined blank. */
export function TokenInput({ label, value, onChange, size = 'normal', ...rest }: TokenInputProps) {
  return (
    <input
      {...rest}
      className={classNames(
        styles.input,
        size === 'wide' && styles.inputWide,
        size === 'narrow' && styles.inputNarrow,
      )}
      aria-label={label}
      value={value}
      data-blank={value === '' ? '' : undefined}
      onChange={(event) => onChange(event.target.value, event.target.valueAsNumber)}
    />
  );
}
