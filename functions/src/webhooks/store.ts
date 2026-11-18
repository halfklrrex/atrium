import type { BoardAccessInput, WebhookDeliveryStatus, WorkspaceRole } from '@atrium/shared';

/**
 * Storage seam for outgoing webhooks (P8 PR 6). The logic (`manage.ts`, `enqueue.ts`, `deliver.ts`)
 * talks to this interface so it is unit tested with the in-memory fake; `admin-store.ts` adapts
 * Firestore (Timestamps there, epoch milliseconds here).
 */

/** `boards/{boardId}/webhooks/{id}`. Never holds the secret. */
export interface WebhookRecord {
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  consecutiveFailures: number;
  disabledReason: string | null;
  lastDeliveryAt: number | null;
}

/** `webhookDeliveries/{webhookId}_{eventId}`. */
export interface DeliveryRecord {
  boardId: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  /** The JSON body, signed and sent as it is. */
  payload: string;
  /** Attempts made so far. */
  attempt: number;
  nextAttemptAt: number;
  status: WebhookDeliveryStatus;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface BoardAccessRecord {
  board: BoardAccessInput & { workspaceId: string };
  /** The workspace's roles map; null when the workspace is gone. */
  roles: Record<string, WorkspaceRole> | null;
}

export interface BoardSummary {
  name: string;
  workspaceId: string;
}

export interface DeliveryFinish {
  status: WebhookDeliveryStatus;
  attempt: number;
  nextAttemptAt: number;
  lastStatus: number | null;
  lastError: string | null;
}

export interface OutcomeInput {
  ok: boolean;
  now: number;
  disableAfter: number;
  disabledReason: string;
}

export interface WebhookStore {
  newId(): string;
  getBoardAccess(boardId: string): Promise<BoardAccessRecord | null>;
  getBoardSummary(boardId: string): Promise<BoardSummary | null>;

  getWebhook(boardId: string, webhookId: string): Promise<WebhookRecord | null>;
  listEnabledWebhooks(boardId: string): Promise<Array<{ id: string; doc: WebhookRecord }>>;
  /**
   * Creates the webhook and its secret in one transaction unless the board already has `max`
   * webhooks. Resolves false (nothing written) when it is full.
   */
  createWebhookIfRoom(args: {
    boardId: string;
    webhookId: string;
    doc: WebhookRecord;
    secret: string;
    now: number;
    max: number;
  }): Promise<boolean>;
  updateWebhook(boardId: string, webhookId: string, patch: Partial<WebhookRecord>): Promise<void>;
  /** Removes the webhook and its secret. Resolves false when there was no such webhook. */
  deleteWebhook(boardId: string, webhookId: string): Promise<boolean>;
  setSecret(boardId: string, webhookId: string, secret: string, now: number): Promise<void>;
  getSecret(boardId: string, webhookId: string): Promise<string | null>;
  /**
   * Records one delivery result on the webhook in a transaction: success resets
   * `consecutiveFailures`, a failure adds one and switches the webhook off when it reaches
   * `disableAfter`. `disabled` is true only for the call that switched it off.
   */
  recordOutcome(
    boardId: string,
    webhookId: string,
    input: OutcomeInput,
  ): Promise<{ disabled: boolean }>;

  /** Create-if-absent: resolves false (no error, nothing changed) when the id already exists. */
  createDelivery(id: string, doc: DeliveryRecord): Promise<boolean>;
  listDueDeliveries(now: number, limit: number): Promise<string[]>;
  /**
   * Transactional claim: when the delivery is still `pending` and due, pushes `nextAttemptAt` to
   * `now + leaseMs` and returns it; otherwise null. Two sweeps never both get one.
   */
  claimDelivery(id: string, now: number, leaseMs: number): Promise<DeliveryRecord | null>;
  finishDelivery(id: string, result: DeliveryFinish): Promise<void>;
  /** The webhook's most recent deliveries, newest first (the owner's delivery log). */
  listDeliveries(
    webhookId: string,
    limit: number,
  ): Promise<Array<{ id: string; doc: DeliveryRecord }>>;
}
