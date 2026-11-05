import type { GetFormResult } from '@atrium/shared';
import { Button, Loader } from '@vibe/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { FormSurface } from '../components/board-form/FormSurface';
import { checkAnswers, collectAnswers, type Drafts } from '../components/board-form/form-answers';
import formStyles from '../components/board-form/form.module.css';
import { FullPageLoader, FullPageMessage } from '../components/FullPage';
import { describeCallableError, formCalls } from '../lib/callables';

type Load =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'ready'; form: GetFormResult };

const codeOf = (error: unknown): string => (error as { code?: string } | null)?.code ?? '';
const is = (error: unknown, code: string): boolean =>
  codeOf(error) === code || codeOf(error) === `functions/${code}`;

/**
 * `/forms/:boardId/:viewId` - the public face of a Form view, on a plain page (no app shell). Any
 * signed-in user may fill it in; whether the form exists or is switched on is the server's call.
 */
export function FormPage() {
  const { boardId = '', viewId = '' } = useParams();
  return <FormPageBody key={`${boardId}/${viewId}`} boardId={boardId} viewId={viewId} />;
}

function FormPageBody({ boardId, viewId }: { boardId: string; viewId: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    formCalls.get({ boardId, viewId }).then(
      (form) => !cancelled && setLoad({ status: 'ready', form }),
      (error: unknown) => {
        if (cancelled) return;
        // "No such form", "switched off" and "not a form" all look the same, on purpose.
        setLoad({
          status: is(error, 'not-found') || is(error, 'invalid-argument') ? 'unavailable' : 'error',
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [boardId, viewId, attempt]);

  const questions = useMemo(() => (load.status === 'ready' ? load.form.questions : []), [load]);

  const change = useCallback((columnId: string, value: unknown) => {
    setDrafts((d) => ({ ...d, [columnId]: value }));
    setErrors((e) => {
      if (!e[columnId]) return e;
      const { [columnId]: _removed, ...rest } = e;
      return rest;
    });
  }, []);

  if (load.status === 'loading') return <FullPageLoader label="Loading form…" />;
  if (load.status === 'unavailable') {
    return (
      <FullPageMessage
        title="This form isn't available"
        description="It may have been switched off or removed. Ask whoever sent you the link."
      />
    );
  }
  if (load.status === 'error') {
    return (
      <FullPageMessage
        title="Could not load the form"
        description="Check your connection and try again."
        primary={{
          text: 'Try again',
          onClick: () => {
            setLoad({ status: 'loading' });
            setAttempt((n) => n + 1);
          },
        }}
      />
    );
  }

  const form = load.form;

  const submit = async () => {
    setFormError(null);
    const found = checkAnswers(questions, drafts);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      const result = await formCalls.submit({
        boardId,
        viewId,
        answers: collectAnswers(questions, drafts),
      });
      setThanks(result.thankYou || form.thankYou);
    } catch (error) {
      if (is(error, 'invalid-argument')) {
        const columnId = (error as { details?: { columnId?: unknown } }).details?.columnId;
        const message = describeCallableError(error, 'Check your answers and try again.');
        if (typeof columnId === 'string' && questions.some((q) => q.columnId === columnId)) {
          setErrors({ [columnId]: message });
        } else {
          setFormError(message);
        }
      } else if (is(error, 'resource-exhausted')) {
        setFormError(
          describeCallableError(error, 'You have sent too many responses. Try again later.'),
        );
      } else if (is(error, 'not-found')) {
        setLoad({ status: 'unavailable' });
      } else {
        setFormError('Could not send your response. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={formStyles.page}>
      {thanks !== null ? (
        <FormSurface title="Response sent" description="" questions={[]} emptyTitle="Response sent">
          <div className={formStyles.thanks}>
            <p className={formStyles.thanksText}>{thanks}</p>
            <Button
              kind="secondary"
              onClick={() => {
                setThanks(null);
                setDrafts({});
                setErrors({});
              }}
            >
              Submit another response
            </Button>
          </div>
        </FormSurface>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className={formStyles.formWrap}
        >
          <FormSurface
            title={form.title}
            description={form.description}
            questions={questions}
            drafts={drafts}
            errors={errors}
            onChange={change}
            emptyTitle="Form"
            disabled={submitting}
          >
            {formError ? (
              <p className={formStyles.formError} role="alert">
                {formError}
              </p>
            ) : null}
            <div className={formStyles.submitRow}>
              <Button type="submit" loading={submitting} disabled={submitting}>
                Submit
              </Button>
              {submitting ? <Loader size="xs" /> : null}
            </div>
          </FormSurface>
        </form>
      )}
    </main>
  );
}
