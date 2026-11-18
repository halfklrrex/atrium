import type { WebhookDeliveryRow } from '@atrium/shared';
import {
  Button,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@vibe/core';
import { useCallback, useEffect, useState } from 'react';
import type { WebhookDoc } from '../../data';
import { describeCallableError, webhookCalls } from '../../lib/callables';
import { DELIVERY_STATUS_LABEL, describeTime, eventLabel } from './integrations-model';
import styles from './Integrations.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: WebhookDeliveryRow[] };

/** The recent deliveries of one webhook: status, event, attempt, last answer and a short error. No payloads. */
export function DeliveriesDialog({
  boardId,
  hook,
  onClose,
}: {
  boardId: string;
  hook: WebhookDoc;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const fetchRows = useCallback(
    () =>
      webhookCalls
        .listDeliveries({ boardId, webhookId: hook.id })
        .then((result): State => ({ kind: 'ready', rows: result.deliveries }))
        .catch((e: unknown): State => ({
          kind: 'error',
          message: describeCallableError(e, 'Could not load the deliveries.'),
        })),
    [boardId, hook.id],
  );

  useEffect(() => {
    let live = true;
    void fetchRows().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [fetchRows]);

  const load = () => {
    setState({ kind: 'loading' });
    void fetchRows().then(setState);
  };

  return (
    <Modal id="integrations-deliveries-dialog" show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={`Deliveries: ${hook.name}`} />
        <ModalContent>
          <div className={styles.stack}>
            {state.kind === 'loading' ? <p className={styles.hint}>Loading deliveries…</p> : null}
            {state.kind === 'error' ? (
              <>
                <p className={styles.errorText} role="alert">
                  {state.message}
                </p>
                <div>
                  <Button kind="secondary" size="small" onClick={load}>
                    Try again
                  </Button>
                </div>
              </>
            ) : null}
            {state.kind === 'ready' && state.rows.length === 0 ? (
              <p className={styles.hint}>
                No deliveries yet. Use Test to send a ping, or wait for an event.
              </p>
            ) : null}
            {state.kind === 'ready' && state.rows.length > 0 ? (
              <ul className={styles.list} aria-label="Recent deliveries">
                {state.rows.map((row) => (
                  <li key={row.id} className={styles.deliveryRow}>
                    <span className={styles.deliveryHead}>
                      <span>{DELIVERY_STATUS_LABEL[row.status]}</span>
                      <span>{eventLabel(row.eventType)}</span>
                    </span>
                    <span className={styles.rowMeta}>
                      Attempt {row.attempt}
                      {row.lastStatus != null ? ` · answered ${row.lastStatus}` : ''}
                      {` · ${describeTime(row.createdAt)}`}
                    </span>
                    {row.lastError ? <span className={styles.rowMeta}>{row.lastError}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter primaryButton={{ text: 'Close', onClick: onClose }} />
    </Modal>
  );
}
