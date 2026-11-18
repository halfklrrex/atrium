import { WEBHOOK_NAME_MAX } from '@atrium/shared';
import {
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TextField,
} from '@vibe/core';
import { useId, useState } from 'react';
import type { BoardDoc, IncomingHookDoc } from '../../data';
import { describeCallableError, incomingHookCalls } from '../../lib/callables';
import { SecretRevealDialog } from './SecretRevealDialog';
import { isWebhooksOff } from './integrations-model';
import styles from './Integrations.module.css';

/** Add or edit an incoming webhook. A new hook's URL is shown once afterwards. */
export function IncomingHookFormDialog({
  board,
  hook,
  onFeatureOff,
  onClose,
}: {
  board: BoardDoc;
  hook?: IncomingHookDoc;
  onFeatureOff: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(hook?.name ?? '');
  const [groupChoice, setGroupChoice] = useState<string>(hook?.defaultGroupId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const selectId = useId();

  const submit = async () => {
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the webhook a name.');
      return;
    }
    if (trimmed.length > WEBHOOK_NAME_MAX) {
      setError(`Use ${WEBHOOK_NAME_MAX} characters or fewer.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (hook) {
        await incomingHookCalls.update({
          boardId: board.id,
          hookId: hook.id,
          name: trimmed,
          defaultGroupId: groupChoice || null,
        });
        onClose();
      } else {
        const result = await incomingHookCalls.create({
          boardId: board.id,
          name: trimmed,
          ...(groupChoice ? { defaultGroupId: groupChoice } : {}),
        });
        setUrl(result.url);
      }
    } catch (e) {
      if (isWebhooksOff(e)) onFeatureOff();
      setError(describeCallableError(e, 'Could not save the webhook. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (url) {
    return (
      <SecretRevealDialog
        reveal={{ title: 'Your webhook URL', noun: 'URL', value: url }}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal id="integrations-incoming-dialog" show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={hook ? 'Edit incoming webhook' : 'Add incoming webhook'} />
        <ModalContent>
          <form
            className={styles.stack}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <TextField
              title="Name"
              inputAriaLabel="Name"
              placeholder="Contact form"
              value={name}
              onChange={(value: string) => {
                setError(null);
                setName(value);
              }}
              maxLength={WEBHOOK_NAME_MAX}
              required
              autoFocus
              size="medium"
            />
            <div className={styles.field}>
              <label htmlFor={`${selectId}-group`} className={styles.fieldLabel}>
                Default group
              </label>
              <select
                id={`${selectId}-group`}
                className={styles.select}
                value={groupChoice}
                onChange={(e) => setGroupChoice(e.target.value)}
              >
                <option value="">First group of the board</option>
                {board.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.title}
                  </option>
                ))}
              </select>
              <p className={styles.hint}>New items go here unless the request names a group.</p>
            </div>
            {error ? (
              <p className={styles.errorText} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" hidden />
          </form>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: hook ? 'Save' : 'Add webhook',
          onClick: () => void submit(),
          disabled: submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
