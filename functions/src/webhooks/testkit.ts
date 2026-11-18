import type { Transport, TransportRequest, TransportResponse } from './ssrf';
import { fakeWebhookStore, type FakeWebhookStore } from './fake-store';
import type { WebhookRecord } from './store';

/** Shared fixtures for the webhook unit tests. */
export const BOARD = 'b1';
export const OWNER = 'owner1';
export const PUBLIC_RESOLVER = async () => [{ address: '93.184.216.34', family: 4 as const }];

export function seededStore(): FakeWebhookStore {
  const store = fakeWebhookStore();
  store.boards.set(BOARD, {
    board: {
      workspaceId: 'ws1',
      kind: 'private',
      access: { [OWNER]: 'owner', ed: 'editor', vw: 'viewer' },
    },
    roles: { [OWNER]: 'member', ed: 'member', vw: 'viewer', other: 'member' },
    name: 'Roadmap',
    workspaceId: 'ws1',
  });
  return store;
}

export const webhookRecord = (over: Partial<WebhookRecord> = {}): WebhookRecord => ({
  name: 'Hook',
  url: 'https://hooks.example.com/atrium',
  events: ['*'],
  enabled: true,
  createdBy: OWNER,
  createdAt: 1,
  consecutiveFailures: 0,
  disabledReason: null,
  lastDeliveryAt: null,
  ...over,
});

export interface FakeTransport {
  transport: Transport;
  requests: TransportRequest[];
}

/** A transport that answers from a script: a status, a body, or a thrown error per call. */
export function fakeTransport(
  respond: (n: number, request: TransportRequest) => TransportResponse | Error = () => ({
    status: 200,
    bodyText: '',
  }),
): FakeTransport {
  const requests: TransportRequest[] = [];
  return {
    requests,
    transport: async (request) => {
      requests.push(request);
      const out = respond(requests.length, request);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}
