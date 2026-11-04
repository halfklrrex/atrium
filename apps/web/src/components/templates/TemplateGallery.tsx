import { TEMPLATE_LIMITS } from '@atrium/shared';
import { Button, Checkbox, IconButton, TextField } from '@vibe/core';
import { Delete, Edit } from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '../../auth/auth-context';
import { useTemplates, useWorkspace } from '../../data';
import { EmptyState } from '../EmptyState/EmptyState';
import styles from './TemplateGallery.module.css';
import {
  builtInChoices,
  columnTypeLabels,
  savedChoices,
  type TemplateChoice,
} from './template-choice';
import { templateActions } from './template-actions';
import { TemplateIcon } from './template-icons';

/** Show the search box above this many templates. */
const SEARCH_THRESHOLD = 6;
/** Column-type chips shown on a card before "+N". */
const MAX_CHIPS = 4;

interface TemplateGalleryProps {
  workspaceId: string;
  selectedKey: string | null;
  onSelect: (choice: TemplateChoice | null) => void;
  includeSampleItems: boolean;
  onIncludeSampleItemsChange: (value: boolean) => void;
}

/** Built-in templates, then the workspace's own. A radio group of cards with one tab stop (arrow keys move). */
export function TemplateGallery({
  workspaceId,
  selectedKey,
  onSelect,
  includeSampleItems,
  onIncludeSampleItemsChange,
}: TemplateGalleryProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: saved, loading, error } = useTemplates(workspaceId);
  const [term, setTerm] = useState('');
  const groupRef = useRef<HTMLDivElement>(null);

  const role = workspace?.roles[uid];
  const isAdmin = role === 'owner' || role === 'admin';

  const builtIns = useMemo(() => builtInChoices(), []);
  const savedList = useMemo(() => savedChoices(saved), [saved]);
  const total = builtIns.length + savedList.length;
  const query = term.trim().toLowerCase();
  const matches = (c: TemplateChoice) =>
    !query || `${c.name} ${c.description}`.toLowerCase().includes(query);
  const shownBuiltIns = builtIns.filter(matches);
  const shownSaved = savedList.filter(matches);
  const visible = [...shownBuiltIns, ...shownSaved];
  const selectedVisible = visible.some((c) => c.key === selectedKey);
  // One tab stop: the selected card, or the first one when nothing is selected.
  const tabKey = selectedVisible ? selectedKey : (visible[0]?.key ?? null);

  function moveFocus(event: KeyboardEvent<HTMLElement>, key: string) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = visible.findIndex((c) => c.key === key);
    const next = visible[(index + step + visible.length) % visible.length];
    if (!next) return;
    onSelect(next);
    // Focus follows selection once React has re-rendered the roving tab stop.
    requestAnimationFrame(() => {
      groupRef.current?.querySelector<HTMLElement>(`[data-template-key="${next.key}"]`)?.focus();
    });
  }

  function renderCard(choice: TemplateChoice) {
    // Rules: the creator (who can still create boards) or a workspace owner/admin.
    const canManage =
      choice.source === 'saved' &&
      (isAdmin || (choice.createdBy === uid && role !== undefined && role !== 'viewer'));
    return (
      <TemplateCard
        key={choice.key}
        choice={choice}
        workspaceId={workspaceId}
        selected={choice.key === selectedKey}
        tabbable={choice.key === tabKey}
        canManage={canManage}
        onSelect={() => onSelect(choice)}
        onKeyDown={(e) => moveFocus(e, choice.key)}
        onDeleted={() => {
          if (choice.key === selectedKey) onSelect(null);
        }}
      />
    );
  }

  return (
    <div className={styles.gallery}>
      {total > SEARCH_THRESHOLD ? (
        <TextField
          id="template-search"
          title="Search templates"
          inputAriaLabel="Search templates"
          placeholder="Search templates"
          value={term}
          onChange={(value: string) => setTerm(value)}
          size="small"
        />
      ) : null}

      <div className={styles.scroll}>
        <div role="radiogroup" aria-label="Templates" ref={groupRef}>
          {shownBuiltIns.length > 0 ? (
            <section aria-labelledby="template-section-builtin">
              <h3 id="template-section-builtin" className={styles.sectionTitle}>
                Built-in
              </h3>
              <div className={styles.grid}>{shownBuiltIns.map(renderCard)}</div>
            </section>
          ) : null}

          <section aria-labelledby="template-section-saved">
            <h3 id="template-section-saved" className={styles.sectionTitle}>
              Saved in this workspace
            </h3>
            {loading ? (
              <p className={styles.status} role="status">
                Loading saved templates…
              </p>
            ) : error ? (
              <p className={styles.error} role="alert">
                Could not load the saved templates. The built-in ones still work.
              </p>
            ) : savedList.length === 0 ? (
              <EmptyState
                size="inline"
                title="No saved templates yet"
                body="Open a board's menu and choose Save as template to reuse its setup."
              />
            ) : shownSaved.length > 0 ? (
              <div className={styles.grid}>{shownSaved.map(renderCard)}</div>
            ) : null}
          </section>
        </div>
        {query && visible.length === 0 ? (
          <EmptyState
            size="inline"
            title="No templates match your search"
            secondaryAction={{ label: 'Clear search', onClick: () => setTerm('') }}
          />
        ) : null}
      </div>

      <Checkbox
        label="Include sample items"
        checked={includeSampleItems}
        onChange={(event) => onIncludeSampleItemsChange(event.target.checked)}
      />
    </div>
  );
}

function TemplateCard({
  choice,
  workspaceId,
  selected,
  tabbable,
  canManage,
  onSelect,
  onKeyDown,
  onDeleted,
}: {
  choice: TemplateChoice;
  workspaceId: string;
  selected: boolean;
  tabbable: boolean;
  canManage: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [name, setName] = useState(choice.name);
  const [busy, setBusy] = useState(false);
  const labels = columnTypeLabels(choice.structure);
  const chips = labels.slice(0, MAX_CHIPS);
  const extra = labels.length - chips.length;
  const nameValid = name.trim().length > 0 && name.trim().length <= TEMPLATE_LIMITS.name;

  async function saveName() {
    if (!nameValid || busy) return;
    setBusy(true);
    const ok = await templateActions.rename(
      workspaceId,
      choice.id,
      name.trim(),
      choice.description,
    );
    setBusy(false);
    if (ok) setMode('view');
  }

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    const ok = await templateActions.remove(workspaceId, choice.id, choice.name);
    if (ok) onDeleted();
    else setBusy(false);
  }

  if (mode === 'rename') {
    return (
      <div className={classNames(styles.card, styles.cardEditing)}>
        <TextField
          id={`rename-${choice.key}`}
          title="Template name"
          inputAriaLabel="Template name"
          value={name}
          onChange={(value: string) => setName(value)}
          maxLength={TEMPLATE_LIMITS.name}
          size="small"
          autoFocus
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void saveName();
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setMode('view');
            }
          }}
        />
        <div className={styles.cardActions}>
          <Button
            size="xs"
            kind="primary"
            disabled={!nameValid || busy}
            onClick={() => void saveName()}
          >
            Save
          </Button>
          <Button size="xs" kind="tertiary" disabled={busy} onClick={() => setMode('view')}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'delete') {
    return (
      <div
        className={classNames(styles.card, styles.cardEditing)}
        role="group"
        aria-label={`Delete ${choice.name}`}
      >
        <p className={styles.confirmText}>
          Delete the template &ldquo;{choice.name}&rdquo;? Boards made from it are not affected.
        </p>
        <div className={styles.cardActions}>
          <Button
            size="xs"
            kind="primary"
            color="negative"
            disabled={busy}
            loading={busy}
            onClick={() => void confirmDelete()}
          >
            Delete template
          </Button>
          <Button size="xs" kind="tertiary" disabled={busy} onClick={() => setMode('view')}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={classNames(styles.card, selected && styles.cardSelected)}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        tabIndex={tabbable ? 0 : -1}
        data-template-key={choice.key}
        className={styles.cardButton}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <span className={styles.iconTile} aria-hidden="true">
          <TemplateIcon name={choice.icon} />
        </span>
        <span className={styles.cardName}>{choice.name}</span>
        {choice.description ? (
          <span className={styles.cardDescription}>{choice.description}</span>
        ) : null}
        <span className={styles.chips}>
          {chips.map((label) => (
            <span key={label} className={styles.chip}>
              {label}
            </span>
          ))}
          {extra > 0 ? <span className={styles.chip}>+{extra}</span> : null}
        </span>
        <span className={styles.meta}>
          {choice.itemCount > 0
            ? `Includes ${choice.itemCount} sample ${choice.itemCount === 1 ? 'item' : 'items'}`
            : 'Structure only'}
        </span>
      </button>
      {canManage ? (
        <div className={styles.manage}>
          <IconButton
            icon={Edit}
            size="xxs"
            kind="tertiary"
            aria-label={`Rename ${choice.name}`}
            onClick={() => {
              setName(choice.name);
              setMode('rename');
            }}
          />
          <IconButton
            icon={Delete}
            size="xxs"
            kind="tertiary"
            aria-label={`Delete ${choice.name}`}
            onClick={() => setMode('delete')}
          />
        </div>
      ) : null}
    </div>
  );
}
