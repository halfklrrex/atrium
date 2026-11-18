import { INCOMING_HOOK_MAX_PER_BOARD, WEBHOOK_MAX_PER_BOARD } from '@atrium/shared';
import {
  Button,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Toggle,
} from '@vibe/core';
import { useState } from 'react';
import { useBoard, useBoardIncomingHooks, useBoardWebhooks } from '../../data';
import type { IncomingHookDoc, WebhookDoc } from '../../data';
import { describeCallableError, incomingHookCalls, webhookCalls } from '../../lib/callables';
import { ConfirmDialog } from '../board-table/ConfirmDialog';
import { showToast } from '../toast-store';
import { DeliveriesDialog } from './DeliveriesDialog';
import { IncomingHookFormDialog } from './IncomingHookFormDialog';
import { SecretRevealDialog, type Reveal } from './SecretRevealDialog';
import { WebhookFormDialog } from './WebhookFormDialog';
import {
  WEBHOOKS_OFF_NOTICE,
  describeTime,
  describeWebhookStatus,
  isWebhooksOff,
  shortId,
  summarizeEvents,
  urlHost,
} from './integrations-model';
import styles from './Integrations.module.css';

type Overlay =
  | { type: 'addWebhook' }
  | { type: 'editWebhook'; hook: WebhookDoc }
  | { type: 'deliveries'; hook: WebhookDoc }
  | { type: 'confirmWebhook'; action: 'rotate' | 'delete'; hook: WebhookDoc }
  | { type: 'addIncoming' }
  | { type: 'editIncoming'; hook: IncomingHookDoc }
  | { type: 'confirmIncoming'; action: 'rotate' | 'delete'; hook: IncomingHookDoc }
  | { type: 'reveal'; reveal: Reveal };

const CURL_EXAMPLE = `curl -X POST "https://…/api/hooks/YOUR-HOOK-URL" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "New lead", "values": { "Status": "Working on it" } }'`;

/**
 * Board owners' "Integrations" dialog: outgoing webhooks (Atrium sends events to your address) and
 * incoming webhooks (a secret URL that creates an item). Secrets are shown once and never kept.
 */
export function IntegrationsDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const { data: board } = useBoard(boardId);
  const hooks = useBoardWebhooks(boardId);
  const incoming = useBoardIncomingHooks(boardId);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [featureOff, setFeatureOff] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const closeOverlay = () => setOverlay(null);

  /** Shows what went wrong; the "switched off" refusal gets the banner instead of a raw error. */
  const fail = (e: unknown, fallback: string) => {
    if (isWebhooksOff(e)) {
      setFeatureOff(true);
      setFailure(null);
    } else {
      setFailure(describeCallableError(e, fallback));
    }
  };

  const setWebhookEnabled = async (hook: WebhookDoc, enabled: boolean) => {
    setFailure(null);
    try {
      await webhookCalls.update({ boardId, webhookId: hook.id, enabled });
    } catch (e) {
      fail(e, `Could not ${enabled ? 'enable' : 'disable'} ${hook.name}.`);
    }
  };

  const testWebhook = async (hook: WebhookDoc) => {
    setFailure(null);
    try {
      await webhookCalls.test({ boardId, webhookId: hook.id });
      showToast(`Test ping queued for ${hook.name}. It's sent within a minute; check Deliveries.`, {
        type: 'positive',
      });
    } catch (e) {
      fail(e, `Could not send a test to ${hook.name}.`);
    }
  };

  const rotateWebhook = async (hook: WebhookDoc) => {
    setFailure(null);
    try {
      const result = await webhookCalls.rotateSecret({ boardId, webhookId: hook.id });
      setOverlay({
        type: 'reveal',
        reveal: {
          title: `New signing secret for ${hook.name}`,
          noun: 'secret',
          value: result.secret,
        },
      });
    } catch (e) {
      fail(e, `Could not rotate the secret of ${hook.name}.`);
    }
  };

  const deleteWebhook = async (hook: WebhookDoc) => {
    setFailure(null);
    try {
      await webhookCalls.remove({ boardId, webhookId: hook.id });
    } catch (e) {
      fail(e, `Could not delete ${hook.name}.`);
    }
  };

  const setIncomingEnabled = async (hook: IncomingHookDoc, enabled: boolean) => {
    setFailure(null);
    try {
      await incomingHookCalls.update({ boardId, hookId: hook.id, enabled });
    } catch (e) {
      fail(e, `Could not ${enabled ? 'enable' : 'disable'} ${hook.name}.`);
    }
  };

  const rotateIncoming = async (hook: IncomingHookDoc) => {
    setFailure(null);
    try {
      const result = await incomingHookCalls.rotateSecret({ boardId, hookId: hook.id });
      setOverlay({
        type: 'reveal',
        reveal: { title: `New URL for ${hook.name}`, noun: 'URL', value: result.url },
      });
    } catch (e) {
      fail(e, `Could not rotate the URL of ${hook.name}.`);
    }
  };

  const deleteIncoming = async (hook: IncomingHookDoc) => {
    setFailure(null);
    try {
      await incomingHookCalls.remove({ boardId, hookId: hook.id });
    } catch (e) {
      fail(e, `Could not delete ${hook.name}.`);
    }
  };

  const groupTitle = (id: string | null | undefined): string => {
    const found = id ? board?.groups.find((g) => g.id === id) : undefined;
    return found ? found.title : 'First group';
  };

  const webhookAtLimit = hooks.data.length >= WEBHOOK_MAX_PER_BOARD;
  const incomingAtLimit = incoming.data.length >= INCOMING_HOOK_MAX_PER_BOARD;

  return (
    <>
      {overlay === null ? (
        <Modal
          id="integrations-dialog"
          show
          size="large"
          aria-label="Integrations"
          closeButtonAriaLabel="Close"
          onClose={onClose}
        >
          <ModalBasicLayout>
            <ModalHeader title="Integrations" />
            <ModalContent>
              <div className={styles.body}>
                {featureOff ? (
                  <p className={styles.notice} role="status">
                    {WEBHOOKS_OFF_NOTICE} The owner of this site can switch them on. Nothing here
                    works until then.
                  </p>
                ) : null}
                {failure ? (
                  <p className={styles.errorText} role="alert">
                    {failure}
                  </p>
                ) : null}

                <section className={styles.section} aria-labelledby="integrations-outgoing">
                  <div className={styles.sectionHeader}>
                    <h3 id="integrations-outgoing" className={styles.sectionTitle}>
                      Outgoing webhooks
                    </h3>
                    <Button
                      kind="secondary"
                      size="small"
                      disabled={webhookAtLimit}
                      onClick={() => setOverlay({ type: 'addWebhook' })}
                    >
                      Add webhook
                    </Button>
                  </div>
                  <p className={styles.hint}>
                    Atrium sends a signed message to your address when something happens on this
                    board.{' '}
                    {webhookAtLimit
                      ? `A board can have ${WEBHOOK_MAX_PER_BOARD} webhooks. Delete one to add another.`
                      : null}
                  </p>
                  {hooks.loading ? (
                    <p className={styles.hint}>Loading webhooks…</p>
                  ) : hooks.error ? (
                    <p className={styles.errorText} role="alert">
                      Could not load the webhooks.
                    </p>
                  ) : hooks.data.length === 0 ? (
                    <p className={styles.hint}>
                      No webhooks yet. Add one to send this board&apos;s events to your own address.
                    </p>
                  ) : (
                    <ul className={styles.list} aria-label="Outgoing webhooks">
                      {hooks.data.map((hook) => (
                        <li key={hook.id} className={styles.row}>
                          <span className={styles.rowText}>
                            <span className={styles.rowTitle}>{hook.name}</span>
                            <span className={styles.rowMeta}>
                              {urlHost(hook.url)} · {summarizeEvents(hook.events)}
                            </span>
                            <span
                              className={
                                hook.enabled
                                  ? styles.rowMeta
                                  : `${styles.rowMeta} ${styles.rowMetaWarn}`
                              }
                            >
                              {describeWebhookStatus(hook)} · {hook.consecutiveFailures}{' '}
                              {hook.consecutiveFailures === 1 ? 'failure' : 'failures'} in a row ·
                              last delivery {describeTime(hook.lastDeliveryAt?.toMillis())}
                            </span>
                          </span>
                          <span className={styles.rowActions}>
                            <span className={styles.switchLabel}>
                              <Toggle
                                isSelected={hook.enabled}
                                onChange={() => void setWebhookEnabled(hook, !hook.enabled)}
                                aria-label={`Enable ${hook.name}`}
                                areLabelsHidden
                              />
                            </span>
                            <Button
                              kind="tertiary"
                              size="small"
                              onClick={() => void testWebhook(hook)}
                              aria-label={`Test ${hook.name}`}
                            >
                              Test
                            </Button>
                            <Button
                              kind="tertiary"
                              size="small"
                              onClick={() => setOverlay({ type: 'deliveries', hook })}
                              aria-label={`Deliveries of ${hook.name}`}
                            >
                              Deliveries
                            </Button>
                            <Button
                              kind="tertiary"
                              size="small"
                              onClick={() => setOverlay({ type: 'editWebhook', hook })}
                              aria-label={`Edit ${hook.name}`}
                            >
                              Edit
                            </Button>
                            <Button
                              kind="tertiary"
                              size="small"
                              onClick={() =>
                                setOverlay({ type: 'confirmWebhook', action: 'rotate', hook })
                              }
                              aria-label={`Rotate secret of ${hook.name}`}
                            >
                              Rotate secret
                            </Button>
                            <Button
                              kind="tertiary"
                              size="small"
                              onClick={() =>
                                setOverlay({ type: 'confirmWebhook', action: 'delete', hook })
                              }
                              aria-label={`Delete ${hook.name}`}
                            >
                              Delete
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className={styles.section} aria-labelledby="integrations-incoming">
                  <div className={styles.sectionHeader}>
                    <h3 id="integrations-incoming" className={styles.sectionTitle}>
                      Incoming webhooks
                    </h3>
                    <Button
                      kind="secondary"
                      size="small"
                      disabled={incomingAtLimit}
                      onClick={() => setOverlay({ type: 'addIncoming' })}
                    >
                      Add incoming webhook
                    </Button>
                  </div>
                  <p className={styles.hint}>
                    Anything that can send a web request can add an item to this board. Treat the
                    URL like a password.{' '}
                    {incomingAtLimit
                      ? `A board can have ${INCOMING_HOOK_MAX_PER_BOARD} incoming webhooks. Delete one to add another.`
                      : null}
                  </p>
                  {incoming.loading ? (
                    <p className={styles.hint}>Loading webhooks…</p>
                  ) : incoming.error ? (
                    <p className={styles.errorText} role="alert">
                      Could not load the incoming webhooks.
                    </p>
                  ) : incoming.data.length === 0 ? (
                    <p className={styles.hint}>
                      No incoming webhooks yet. Add one to create items from other tools.
                    </p>
                  ) : (
                    <ul className={styles.list} aria-label="Incoming webhooks">
                      {incoming.data.map((hook) => (
                        <li key={hook.id} className={styles.row}>
                          <span className={styles.rowText}>
                            <span className={styles.rowTitle}>
                              {hook.name}{' '}
                              <span className={styles.rowMeta}>(…{shortId(hook.id)})</span>
                            </span>
                            <span className={styles.rowMeta}>
                              {hook.enabled ? 'Active' : 'Disabled'} · last used{' '}
                              {describeTime(hook.lastUsedAt?.toMillis())} · adds to{' '}
                              {groupTitle(hook.defaultGroupId)}
                            </span>
                          </span>
                          <span className={styles.rowActions}>
                            <span className={styles.switchLabel}>
                              <Toggle
                                isSelected={hook.enabled}
                                onChange={() => void setIncomingEnabled(hook, !hook.enabled)}
                                aria-label={`Enable ${hook.name}`}
                                areLabelsHidden
                              />
                            </span>
                            <Button
                              kind="tertiary"
                              size="small"
                              onClick={() => setOverlay({ type: 'editIncoming', hook })}
                              aria-label={`Edit ${hook.name}`}
                            >
                              Edit
                            </Button>
                            <Button
                              kind="tertiary"
                              size="small"
                              onClick={() =>
                                setOverlay({ type: 'confirmIncoming', action: 'rotate', hook })
                              }
                              aria-label={`Rotate URL of ${hook.name}`}
                            >
                              Rotate URL
                            </Button>
                            <Button
                              kind="tertiary"
                              size="small"
                              onClick={() =>
                                setOverlay({ type: 'confirmIncoming', action: 'delete', hook })
                              }
                              aria-label={`Delete ${hook.name}`}
                            >
                              Delete
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className={styles.hint}>
                    Send a POST with a JSON body. <code>name</code> is the item name;{' '}
                    <code>values</code> sets columns by name or id; <code>group</code> is optional.
                  </p>
                  <pre className={styles.code} aria-label="Example request">
                    {CURL_EXAMPLE}
                  </pre>
                </section>
              </div>
            </ModalContent>
          </ModalBasicLayout>
          <ModalFooter primaryButton={{ text: 'Done', onClick: onClose }} />
        </Modal>
      ) : null}

      {overlay?.type === 'addWebhook' ? (
        <WebhookFormDialog
          boardId={boardId}
          onFeatureOff={() => setFeatureOff(true)}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.type === 'editWebhook' ? (
        <WebhookFormDialog
          boardId={boardId}
          hook={overlay.hook}
          onFeatureOff={() => setFeatureOff(true)}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.type === 'deliveries' ? (
        <DeliveriesDialog boardId={boardId} hook={overlay.hook} onClose={closeOverlay} />
      ) : null}
      {overlay?.type === 'addIncoming' && board ? (
        <IncomingHookFormDialog
          board={board}
          onFeatureOff={() => setFeatureOff(true)}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.type === 'editIncoming' && board ? (
        <IncomingHookFormDialog
          board={board}
          hook={overlay.hook}
          onFeatureOff={() => setFeatureOff(true)}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.type === 'reveal' ? (
        <SecretRevealDialog reveal={overlay.reveal} onClose={closeOverlay} />
      ) : null}
      {overlay?.type === 'confirmWebhook' ? (
        <ConfirmDialog
          title={
            overlay.action === 'rotate'
              ? `Rotate the secret of ${overlay.hook.name}?`
              : `Delete ${overlay.hook.name}?`
          }
          message={
            overlay.action === 'rotate'
              ? 'The old secret stops working right away. Update your receiver with the new one.'
              : "Atrium stops sending events to this address. This can't be undone."
          }
          confirmLabel={overlay.action === 'rotate' ? 'Rotate secret' : 'Delete'}
          onConfirm={async () => {
            const hook = overlay.hook;
            if (overlay.action === 'rotate') await rotateWebhook(hook);
            else await deleteWebhook(hook);
          }}
          onClose={() => setOverlay((current) => (current?.type === 'reveal' ? current : null))}
        />
      ) : null}
      {overlay?.type === 'confirmIncoming' ? (
        <ConfirmDialog
          title={
            overlay.action === 'rotate'
              ? `Rotate the URL of ${overlay.hook.name}?`
              : `Delete ${overlay.hook.name}?`
          }
          message={
            overlay.action === 'rotate'
              ? 'The old URL stops working right away. Update whatever calls it with the new URL.'
              : "The URL stops working right away. This can't be undone."
          }
          confirmLabel={overlay.action === 'rotate' ? 'Rotate URL' : 'Delete'}
          onConfirm={async () => {
            const hook = overlay.hook;
            if (overlay.action === 'rotate') await rotateIncoming(hook);
            else await deleteIncoming(hook);
          }}
          onClose={() => setOverlay((current) => (current?.type === 'reveal' ? current : null))}
        />
      ) : null}
    </>
  );
}
