import { resolveBoardRole } from '@atrium/shared';
import classNames from 'classnames';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type TextareaHTMLAttributes,
} from 'react';
import { useAuth } from '../../auth/auth-context';
import { useBoard, useWorkspace } from '../../data';
import { useWorkspaceMembers } from '../../data/members-store';
import { UserAvatar } from '../UserAvatar';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import {
  activeMentionQuery,
  applyMention,
  type MentionQuery,
  type PickedMention,
} from './mentions';
import styles from './MentionTextarea.module.css';

const MAX_SUGGESTIONS = 8;

type PopupKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;

interface MentionTextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
> {
  /** Board the post is on: only workspace members who can read it are offered. */
  boardId: string;
  value: string;
  onValueChange: (value: string) => void;
  /** A member was picked from the list (the caller keeps these to build `mentions`). */
  onMention: (mention: PickedMention) => void;
  inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
}

/**
 * A textarea where typing "@" opens a list of the people who can read the board. Picking one writes
 * "@Name " into the text; the caller records the uid from `onMention`.
 */
export function MentionTextarea({
  boardId,
  value,
  onValueChange,
  onMention,
  inputRef,
  onKeyDown,
  onSelect,
  ...rest
}: MentionTextareaProps) {
  const [element, setElement] = useState<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  /** The "@" the user closed the list on with Escape; typing a new "@" opens it again. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const popupKeys = useRef<PopupKeys | null>(null);

  const mention = activeMentionQuery(value, caret);
  const open = mention !== null && mention.start !== dismissedAt;

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      setElement(node);
      if (inputRef) inputRef.current = node;
    },
    [inputRef],
  );

  useEffect(() => {
    const at = pendingCaret.current;
    if (at === null || !element) return;
    pendingCaret.current = null;
    element.focus();
    element.setSelectionRange(at, at);
  }, [value, element]);

  const pick = (picked: PickedMention) => {
    if (!mention) return;
    const next = applyMention(value, mention, caret, picked.name);
    pendingCaret.current = next.caret;
    // "@Jordan Lee " still reads as a query for Jordan: keep the list shut for this @.
    setDismissedAt(mention.start);
    setCaret(next.caret);
    onValueChange(next.text);
    onMention(picked);
  };

  return (
    <>
      <textarea
        {...rest}
        ref={setRefs}
        value={value}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        onChange={(event) => {
          setCaret(event.target.selectionStart);
          onValueChange(event.target.value);
        }}
        onSelect={(event) => {
          setCaret(event.currentTarget.selectionStart);
          onSelect?.(event);
        }}
        onKeyDown={(event) => {
          if (open && popupKeys.current?.(event)) {
            event.preventDefault();
            return;
          }
          onKeyDown?.(event);
        }}
      />
      {open && mention ? (
        <MentionPopup
          boardId={boardId}
          anchor={element}
          mention={mention}
          keysRef={popupKeys}
          onPick={pick}
          onClose={() => setDismissedAt(mention.start)}
        />
      ) : null}
    </>
  );
}

interface MentionPopupProps {
  boardId: string;
  anchor: HTMLElement | null;
  mention: MentionQuery;
  keysRef: MutableRefObject<PopupKeys | null>;
  onPick: (mention: PickedMention) => void;
  onClose: () => void;
}

/** Only mounted while a "@query" is open, so the member and board listeners start on demand. */
function MentionPopup({ boardId, anchor, mention, keysRef, onPick, onClose }: MentionPopupProps) {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: board } = useBoard(boardId);
  const { data: workspace } = useWorkspace(board?.workspaceId);
  const { members } = useWorkspaceMembers(board?.workspaceId);
  const [active, setActive] = useState(0);

  const needle = mention.query.trim().toLowerCase();
  const candidates = useMemo(() => {
    if (!board || !workspace) return [];
    return members
      .filter((m) => m.id !== uid && resolveBoardRole(board, m.id, workspace.roles[m.id]) !== null)
      .map((m) => ({ uid: m.id, name: m.displayName || m.email, photoURL: m.photoURL }))
      .filter((m) => m.name && m.name.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [board, workspace, members, uid, needle]);

  // A shorter list must not leave the highlight past its end.
  const current = Math.min(active, Math.max(candidates.length - 1, 0));

  useEffect(() => {
    keysRef.current = (event) => {
      if (candidates.length === 0) return false;
      if (event.key === 'ArrowDown') setActive((current + 1) % candidates.length);
      else if (event.key === 'ArrowUp')
        setActive((current - 1 + candidates.length) % candidates.length);
      else if (event.key === 'Enter' || event.key === 'Tab') {
        const chosen = candidates[current];
        if (chosen) onPick({ uid: chosen.uid, name: chosen.name });
      } else return false;
      return true;
    };
    return () => {
      keysRef.current = null;
    };
  }, [candidates, current, keysRef, onPick]);

  if (candidates.length === 0) return null;
  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label="Mention someone">
      <div
        className={styles.list}
        role="listbox"
        aria-label="People"
        // Keep the focus in the textarea while the list is clicked.
        onMouseDown={(event) => event.preventDefault()}
      >
        {candidates.map((person, index) => (
          <div
            key={person.uid}
            role="option"
            aria-selected={index === current}
            tabIndex={-1}
            className={classNames(styles.option, index === current && styles.active)}
            onMouseEnter={() => setActive(index)}
            onClick={() => onPick({ uid: person.uid, name: person.name })}
          >
            <UserAvatar uid={person.uid} name={person.name} photoURL={person.photoURL} size="xs" />
            <span className={styles.name}>{person.name}</span>
          </div>
        ))}
      </div>
    </AnchoredPopup>
  );
}
