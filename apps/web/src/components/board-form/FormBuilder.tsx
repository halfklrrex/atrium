import {
  FORM_LIMITS,
  defaultFormSettings,
  formPublishProblems,
  publicFormQuestions,
  type FormQuestion,
  type FormSettings,
} from '@atrium/shared';
import { Dropdown, Loader } from '@vibe/core';
import { useMemo } from 'react';
import { useAuth } from '../../auth/auth-context';
import { viewWrites, type BoardDoc } from '../../data';
import { EmptyState } from '../EmptyState/EmptyState';
import { useBoardViewsContext } from '../board-views/view-context';
import { showToast } from '../toast-store';
import { CommitField } from './CommitField';
import { formUrl } from './form-model';
import { FormSurface } from './FormSurface';
import { QuestionList } from './QuestionList';
import { SharePanel } from './SharePanel';
import styles from './builder.module.css';

type GroupOption = { value: string; label: string };

/** The Form view: an editor (share, details, questions) beside a live preview of the public form. */
export function FormBuilder({ board }: { board: BoardDoc }) {
  const ctx = useBoardViewsContext();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const view = ctx?.view;
  const form = view?.settings.form;
  // A form view is always shared, so the board edit right is the right to change it.
  const canEdit = Boolean(ctx?.actions.canEdit && view && view.ownerId === null);

  const problems = useMemo(() => (form ? formPublishProblems(form, board) : []), [form, board]);
  const previewQuestions = useMemo(
    () => (form ? publicFormQuestions(form, board.columns) : []),
    [form, board.columns],
  );
  const groups = useMemo<GroupOption[]>(
    () =>
      [...board.groups]
        .sort((a, b) => (a.position < b.position ? -1 : 1))
        .map((g) => ({ value: g.id, label: g.title })),
    [board.groups],
  );

  if (!ctx || !view) return null;
  if (!ctx.ready) {
    return (
      <div className={styles.state} role="status">
        <Loader size="medium" />
      </div>
    );
  }

  const save = (current: FormSettings, patch: Partial<FormSettings>) => {
    viewWrites.saveFormFields(board.id, uid, view.id, current, patch).catch((error: unknown) => {
      console.warn('Could not save the form', error);
      showToast('Could not save the form. Check your connection and try again.', {
        type: 'negative',
      });
    });
  };

  if (!form) {
    const firstGroup = groups[0];
    return (
      <div className={styles.state}>
        <EmptyState
          size="panel"
          title="This form isn't set up yet"
          body={
            canEdit && firstGroup
              ? 'Set it up to start collecting responses as new items.'
              : 'Ask an editor of this board to set it up.'
          }
          primaryAction={
            canEdit && firstGroup
              ? {
                  label: 'Set up form',
                  onClick: () => {
                    viewWrites
                      .saveFormFields(
                        board.id,
                        uid,
                        view.id,
                        defaultFormSettings(firstGroup.value),
                        defaultFormSettings(firstGroup.value),
                      )
                      .catch(() =>
                        showToast('Could not set up the form. Try again.', { type: 'negative' }),
                      );
                  },
                }
              : undefined
          }
        />
      </div>
    );
  }

  const patch = (change: Partial<FormSettings>) => save(form, change);
  const group = groups.find((g) => g.value === form.targetGroupId);

  const preview = (
    <div className={styles.previewPane} aria-label="Form preview" role="region">
      <FormSurface
        title={form.title}
        description={form.description}
        questions={previewQuestions}
        emptyTitle="Untitled form"
        disabled
      />
    </div>
  );

  if (!canEdit) {
    return (
      <div className={styles.root}>
        <p className={styles.readOnly}>Only editors of this board can change the form.</p>
        {preview}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.editor}>
        <SharePanel
          link={formUrl(window.location.origin, board.id, view.id)}
          accepting={form.acceptingResponses}
          problems={problems}
          onAcceptingChange={(acceptingResponses) => patch({ acceptingResponses })}
        />
        <section className={styles.section} aria-label="Form details">
          <h3 className={styles.sectionTitle}>Form details</h3>
          <CommitField
            label="Form title"
            value={form.title}
            maxLength={FORM_LIMITS.titleMax}
            onCommit={(title) => patch({ title })}
          />
          <CommitField
            label="Description"
            multiline
            value={form.description}
            maxLength={FORM_LIMITS.descriptionMax}
            onCommit={(description) => patch({ description })}
          />
          <CommitField
            label="Thank-you message"
            multiline
            value={form.thankYou}
            maxLength={FORM_LIMITS.thankYouMax}
            onCommit={(thankYou) => patch({ thankYou })}
          />
          <div className={styles.field}>
            <span className={styles.fieldLabel} id="form-target-group-label">
              New responses go to
            </span>
            <Dropdown
              inputAriaLabel="Group for new responses"
              options={groups}
              value={group}
              clearable={false}
              placeholder="Choose a group"
              onChange={(next: unknown) => {
                const option = next as GroupOption | null;
                if (option) patch({ targetGroupId: option.value });
              }}
            />
          </div>
        </section>
        <section className={styles.section} aria-label="Form questions">
          <h3 className={styles.sectionTitle}>Questions</h3>
          <QuestionList
            questions={form.questions}
            columns={board.columns}
            onChange={(questions: FormQuestion[]) => patch({ questions })}
          />
        </section>
      </div>
      {preview}
    </div>
  );
}
