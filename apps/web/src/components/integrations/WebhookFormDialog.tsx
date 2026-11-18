import { WEBHOOK_NAME_MAX, WEBHOOK_URL_MAX, type ActivityKind } from '@atrium/shared';
import {
  Checkbox,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  RadioButton,
  TextField,
} from '@vibe/core';
import { useId, useState } from 'react';
import type { WebhookDoc } from '../../data';
import { describeCallableError, webhookCalls } from '../../lib/callables';
import { SecretRevealDialog } from './SecretRevealDialog';
import {
  ALL_EVENT_KINDS,
  EMPTY_WEBHOOK_FORM,
  EVENT_LABELS,
  formFromWebhook,
  isWebhooksOff,
  parseWebhookForm,
  type WebhookForm,
} from './integrations-model';
import styles from './Integrations.module.css';

/** Add or edit an outgoing webhook. A new webhook's signing secret is shown once afterwards. */
export function WebhookFormDialog({
  boardId,
  hook,
  onFeatureOff,
  onClose,
}: {
  boardId: string;
  /** Set to edit that webhook; omitted to add one. */
  hook?: WebhookDoc;
  onFeatureOff: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<WebhookForm>(hook ? formFromWebhook(hook) : EMPTY_WEBHOOK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const groupId = useId();

  const change = (patch: Partial<WebhookForm>) => {
    setError(null);
    setForm((current) => ({ ...current, ...patch }));
  };
  const toggleEvent = (kind: ActivityKind) =>
    change({
      events: form.events.includes(kind)
        ? form.events.filter((k) => k !== kind)
        : [...form.events, kind],
    });

  const submit = async () => {
    if (submitting) return;
    const parsed = parseWebhookForm(form);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (hook) {
        await webhookCalls.update({ boardId, webhookId: hook.id, ...parsed.value });
        onClose();
      } else {
        const result = await webhookCalls.create({ boardId, ...parsed.value });
        setSecret(result.secret);
      }
    } catch (e) {
      if (isWebhooksOff(e)) onFeatureOff();
      setError(
        describeCallableError(
          e,
          hook
            ? 'Could not save the webhook. Try again.'
            : 'Could not create the webhook. Try again.',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (secret) {
    return (
      <SecretRevealDialog
        reveal={{ title: 'Your signing secret', noun: 'secret', value: secret }}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal id="integrations-webhook-dialog" show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={hook ? 'Edit webhook' : 'Add webhook'} />
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
              placeholder="Send to my chat"
              value={form.name}
              onChange={(value: string) => change({ name: value })}
              maxLength={WEBHOOK_NAME_MAX}
              required
              autoFocus
              size="medium"
            />
            <TextField
              title="Address"
              inputAriaLabel="Address"
              placeholder="https://example.com/atrium-events"
              value={form.url}
              onChange={(value: string) => change({ url: value })}
              maxLength={WEBHOOK_URL_MAX}
              required
              size="medium"
            />
            <div role="radiogroup" aria-labelledby={`${groupId}-events`} className={styles.field}>
              <span id={`${groupId}-events`} className={styles.fieldLabel}>
                Events
              </span>
              <div className={styles.radioRow}>
                <RadioButton
                  name={`${groupId}-events`}
                  text="All events"
                  value="all"
                  checked={form.allEvents}
                  onSelect={() => change({ allEvents: true })}
                />
                <RadioButton
                  name={`${groupId}-events`}
                  text="Only some events"
                  value="some"
                  checked={!form.allEvents}
                  onSelect={() => change({ allEvents: false })}
                />
              </div>
              {form.allEvents ? null : (
                <ul className={styles.checkList} aria-label="Events to send">
                  {ALL_EVENT_KINDS.map((kind) => (
                    <li key={kind}>
                      <Checkbox
                        label={EVENT_LABELS[kind]}
                        checked={form.events.includes(kind)}
                        onChange={() => toggleEvent(kind)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className={styles.hint}>
              Atrium sends a signed JSON message to this address when these events happen. Only
              https addresses on the public internet work.
            </p>
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
