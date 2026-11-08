import { INBOX_LIMITS, normalizeInboxText, type InboxCategory } from '@atrium/shared';
import {
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  RadioButton,
  TextArea,
  TextField,
} from '@vibe/core';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { inboxCalls } from '../../lib/callables';
import { FEEDBACK_CATEGORIES, describeInboxError } from '../../lib/inbox-sender';
import { showToast } from '../toast-store';
import styles from './dialogs.module.css';

/** "Send feedback" (ADMIN-4 PR6): category, subject and message go to the site administrators. */
export function FeedbackDialog({
  initialCategory = 'idea',
  initialSubject = '',
  onClose,
}: {
  initialCategory?: InboxCategory;
  initialSubject?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [category, setCategory] = useState<InboxCategory>(initialCategory);
  const [subject, setSubject] = useState(initialSubject);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per message: a retry after a failure sends the same id (the server is idempotent).
  const requestId = useRef<string | null>(null);

  const cleanSubject = normalizeInboxText(subject);
  const cleanText = normalizeInboxText(text);
  const subjectOver = subject.length > INBOX_LIMITS.subject;
  const textOver = text.length > INBOX_LIMITS.text;
  const invalid = !cleanSubject || !cleanText || subjectOver || textOver;

  async function submit() {
    if (invalid || submitting) return;
    requestId.current ??= crypto.randomUUID();
    setSubmitting(true);
    setError(null);
    try {
      const { threadId } = await inboxCalls.send({
        action: 'feedback',
        requestId: requestId.current,
        category,
        subject: cleanSubject,
        text: cleanText,
      });
      onClose();
      showToast('Thanks, your feedback was sent.', {
        type: 'positive',
        action: { label: 'View', onClick: () => void navigate(`/feedback/${threadId}`) },
      });
    } catch (e) {
      setError(describeInboxError(e, 'Could not send your feedback. Try again.'));
      setSubmitting(false);
    }
  }

  const edited = <T,>(set: (value: T) => void) => {
    return (value: T) => {
      requestId.current = null;
      set(value);
    };
  };

  return (
    <Modal id="feedback-dialog" show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Send feedback" />
        <ModalContent>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div role="radiogroup" aria-labelledby="feedback-category-label">
              <span id="feedback-category-label" className={styles.fieldLabel}>
                Category
              </span>
              <div className={styles.radioRow}>
                {FEEDBACK_CATEGORIES.map((option) => (
                  <RadioButton
                    key={option.value}
                    name="feedback-category"
                    text={option.label}
                    value={option.value}
                    checked={category === option.value}
                    onSelect={() => setCategory(option.value)}
                  />
                ))}
              </div>
            </div>

            <TextField
              title="Subject"
              inputAriaLabel="Subject"
              value={subject}
              onChange={edited(setSubject)}
              placeholder="A short summary"
              autoFocus
              size="medium"
            />
            {subjectOver ? (
              <p className={`${styles.counter} ${styles.counterOver}`} role="alert">
                {`The subject can have up to ${INBOX_LIMITS.subject} characters.`}
              </p>
            ) : null}

            <div>
              <TextArea
                label="Message"
                aria-label="Message"
                value={text}
                rows={4}
                placeholder="Tell us what happened, or what you would like to see"
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  edited(setText)(e.target.value)
                }
              />
              <p className={textOver ? `${styles.counter} ${styles.counterOver}` : styles.counter}>
                {`${text.length} / ${INBOX_LIMITS.text}`}
              </p>
            </div>

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" hidden />
          </form>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: 'Send',
          onClick: () => void submit(),
          disabled: invalid || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
