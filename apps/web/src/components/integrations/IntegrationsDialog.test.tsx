import type * as Callables from '../../lib/callables';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../../test/fixtures';
import { useToastStore } from '../toast-store';
import { IntegrationsDialog } from './IntegrationsDialog';

const mocks = vi.hoisted(() => ({
  webhooks: { data: [] as unknown[], loading: false, error: null as Error | null },
  incoming: { data: [] as unknown[], loading: false, error: null as Error | null },
  wh: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    rotateSecret: vi.fn(),
    test: vi.fn(),
    listDeliveries: vi.fn(),
  },
  inc: { create: vi.fn(), update: vi.fn(), rotateSecret: vi.fn(), remove: vi.fn() },
}));

const board = makeBoard({
  id: 'b1',
  name: 'Plans',
  groups: [
    { id: 'g1', title: 'Backlog', color: '#579bfc', position: 'a0' },
    { id: 'g2', title: 'Doing', color: '#579bfc', position: 'a1' },
  ],
});

vi.mock('../../data', () => ({
  useBoard: () => ({ data: board, loading: false, error: null }),
  useBoardWebhooks: () => mocks.webhooks,
  useBoardIncomingHooks: () => mocks.incoming,
}));
vi.mock('../../lib/callables', async (importOriginal) => ({
  ...(await importOriginal<typeof Callables>()),
  webhookCalls: mocks.wh,
  incomingHookCalls: mocks.inc,
}));

const at = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

const webhook = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  name: 'Chat relay',
  url: 'https://hooks.example.com/very/secret/path',
  events: ['*'],
  enabled: true,
  createdBy: 'u1',
  createdAt: at(1),
  consecutiveFailures: 0,
  disabledReason: null,
  lastDeliveryAt: null,
  ...over,
});
const incomingHook = (over: Record<string, unknown> = {}) => ({
  id: 'hook-abcd1234',
  name: 'Contact form',
  enabled: true,
  createdBy: 'u1',
  createdAt: at(1),
  lastUsedAt: null,
  defaultGroupId: 'g2',
  ...over,
});

const offError = Object.assign(new Error('Webhooks are not switched on for this site yet.'), {
  code: 'functions/failed-precondition',
});

function setup() {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<IntegrationsDialog boardId="b1" onClose={onClose} />);
  return { user, onClose };
}

describe('IntegrationsDialog', () => {
  beforeEach(() => {
    mocks.webhooks = { data: [], loading: false, error: null };
    mocks.incoming = { data: [], loading: false, error: null };
    for (const fn of [...Object.values(mocks.wh), ...Object.values(mocks.inc)]) {
      fn.mockReset();
    }
    useToastStore.setState({ toasts: [] });
  });

  it('shows empty states for both sections', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Integrations' })).toBeInTheDocument();
    expect(screen.getByText(/No webhooks yet\. Add one to send/)).toBeInTheDocument();
    expect(screen.getByText(/No incoming webhooks yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add webhook' })).toBeEnabled();
  });

  it('shows loading and error states', () => {
    mocks.webhooks = { data: [], loading: true, error: null };
    mocks.incoming = { data: [], loading: false, error: new Error('nope') };
    setup();
    expect(screen.getByText('Loading webhooks…')).toBeInTheDocument();
    expect(screen.getByText('Could not load the incoming webhooks.')).toBeInTheDocument();
  });

  it('lists webhooks with the host only, status and failures', () => {
    mocks.webhooks.data = [
      webhook(),
      webhook({
        id: 'w2',
        name: 'Broken',
        enabled: false,
        disabledReason: 'Turned off after 20 failures in a row',
        consecutiveFailures: 20,
      }),
    ];
    setup();
    const list = screen.getByRole('list', { name: 'Outgoing webhooks' });
    expect(within(list).getAllByText(/hooks\.example\.com · All events/)).toHaveLength(2);
    expect(within(list).queryByText(/secret\/path/)).not.toBeInTheDocument();
    expect(within(list).getByText(/Active · 0 failures in a row/)).toBeInTheDocument();
    expect(
      within(list).getByText(/Disabled: Turned off after 20 failures in a row · 20 failures/),
    ).toBeInTheDocument();
  });

  it('creates a webhook, shows the secret once and clears it on close', async () => {
    mocks.wh.create.mockResolvedValue({ webhookId: 'w9', secret: 'whsec_abc123' });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add webhook' }));
    await user.type(await screen.findByLabelText('Name'), 'Chat');
    await user.type(screen.getByLabelText('Address'), 'https://example.com/hook');
    await user.click(screen.getByRole('button', { name: 'Add webhook', hidden: false }));
    expect(mocks.wh.create).toHaveBeenCalledWith({
      boardId: 'b1',
      name: 'Chat',
      url: 'https://example.com/hook',
      events: ['*'],
    });
    expect(await screen.findByDisplayValue('whsec_abc123')).toBeInTheDocument();
    expect(
      screen.getByText("Copy this secret now. You won't be able to see it again."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe('whsec_abc123');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByDisplayValue('whsec_abc123')).not.toBeInTheDocument());
    expect(screen.queryByText('whsec_abc123')).not.toBeInTheDocument();
  });

  it('refuses a non-https address before calling the server', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add webhook' }));
    await user.type(await screen.findByLabelText('Name'), 'Chat');
    await user.type(screen.getByLabelText('Address'), 'http://example.com');
    await user.click(screen.getByRole('button', { name: 'Add webhook', hidden: false }));
    expect(await screen.findByText('Use a full https:// address.')).toBeInTheDocument();
    expect(mocks.wh.create).not.toHaveBeenCalled();
  });

  it('sends only the picked events', async () => {
    mocks.wh.create.mockResolvedValue({ webhookId: 'w9', secret: 'whsec_x' });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add webhook' }));
    await user.type(await screen.findByLabelText('Name'), 'Chat');
    await user.type(screen.getByLabelText('Address'), 'https://example.com/hook');
    await user.click(screen.getByRole('radio', { name: 'Only some events' }));
    await user.click(screen.getByRole('checkbox', { name: 'Item created' }));
    await user.click(screen.getByRole('button', { name: 'Add webhook', hidden: false }));
    expect(mocks.wh.create).toHaveBeenCalledWith(
      expect.objectContaining({ events: ['item_created'] }),
    );
  });

  it('disables Add at the limit with a hint', () => {
    mocks.webhooks.data = [1, 2, 3, 4, 5].map((n) => webhook({ id: `w${n}`, name: `Hook ${n}` }));
    mocks.incoming.data = [1, 2, 3, 4, 5].map((n) =>
      incomingHook({ id: `hook-${n}`, name: `In ${n}` }),
    );
    setup();
    expect(screen.getByRole('button', { name: 'Add webhook' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Add incoming webhook' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText(/A board can have 5 webhooks/)).toBeInTheDocument();
    expect(screen.getByText(/A board can have 5 incoming webhooks/)).toBeInTheDocument();
  });

  it('keeps the entry usable and explains when the feature is off', async () => {
    mocks.webhooks.data = [webhook()];
    mocks.wh.test.mockRejectedValue(offError);
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Test Chat relay' }));
    expect(await screen.findByText(/Webhooks aren't switched on yet\./)).toBeInTheDocument();
  });

  it('shows the server message for other refusals', async () => {
    mocks.webhooks.data = [webhook()];
    mocks.wh.update.mockRejectedValue(
      Object.assign(new Error('That address is not allowed.'), {
        code: 'functions/invalid-argument',
      }),
    );
    const { user } = setup();
    await user.click(screen.getByRole('switch', { name: 'Enable Chat relay' }));
    expect(mocks.wh.update).toHaveBeenCalledWith({
      boardId: 'b1',
      webhookId: 'w1',
      enabled: false,
    });
    expect(await screen.findByText('That address is not allowed.')).toBeInTheDocument();
  });

  it('sends a test ping and toasts', async () => {
    mocks.webhooks.data = [webhook()];
    mocks.wh.test.mockResolvedValue({ webhookId: 'w1', deliveryId: 'd1' });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Test Chat relay' }));
    await waitFor(() =>
      expect(mocks.wh.test).toHaveBeenCalledWith({ boardId: 'b1', webhookId: 'w1' }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]?.text).toMatch(/Test ping queued for Chat relay/),
    );
  });

  it('confirms before rotating a secret, then shows the new one once', async () => {
    mocks.webhooks.data = [webhook()];
    mocks.wh.rotateSecret.mockResolvedValue({ webhookId: 'w1', secret: 'whsec_new' });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Rotate secret of Chat relay' }));
    expect(mocks.wh.rotateSecret).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Rotate secret' }));
    expect(await screen.findByDisplayValue('whsec_new')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByDisplayValue('whsec_new')).not.toBeInTheDocument());
  });

  it('confirms before deleting a webhook', async () => {
    mocks.webhooks.data = [webhook()];
    mocks.wh.remove.mockResolvedValue({ webhookId: 'w1', deleted: true });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Delete Chat relay' }));
    expect(mocks.wh.remove).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mocks.wh.remove).toHaveBeenCalledWith({ boardId: 'b1', webhookId: 'w1' }),
    );
  });

  it('lists deliveries without payloads, with empty, error and ready states', async () => {
    mocks.webhooks.data = [webhook()];
    mocks.wh.listDeliveries.mockResolvedValueOnce({ deliveries: [] });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Deliveries of Chat relay' }));
    expect(await screen.findByText(/No deliveries yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));

    mocks.wh.listDeliveries.mockRejectedValueOnce(new Error('boom'));
    await user.click(await screen.findByRole('button', { name: 'Deliveries of Chat relay' }));
    expect(await screen.findByText('Could not load the deliveries.')).toBeInTheDocument();

    mocks.wh.listDeliveries.mockResolvedValueOnce({
      deliveries: [
        {
          id: 'd1',
          eventType: 'item_created',
          status: 'failed',
          attempt: 2,
          lastStatus: 500,
          lastError: 'Receiver answered 500',
          createdAt: 1_700_000_000_000,
          nextAttemptAt: 1_700_000_300_000,
        },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const list = await screen.findByRole('list', { name: 'Recent deliveries' });
    expect(within(list).getByText('Retrying')).toBeInTheDocument();
    expect(within(list).getByText('Item created')).toBeInTheDocument();
    expect(within(list).getByText(/Attempt 2 · answered 500/)).toBeInTheDocument();
    expect(within(list).getByText('Receiver answered 500')).toBeInTheDocument();
  });

  it('lists incoming hooks by name and short id only', () => {
    mocks.incoming.data = [incomingHook()];
    setup();
    const list = screen.getByRole('list', { name: 'Incoming webhooks' });
    expect(within(list).getByText(/Contact form/)).toBeInTheDocument();
    expect(within(list).getByText(/…1234/)).toBeInTheDocument();
    expect(within(list).getByText(/adds to Doing/)).toBeInTheDocument();
    expect(within(list).queryByText(/hook-abcd1234/)).not.toBeInTheDocument();
  });

  it('creates an incoming hook with a default group and shows its URL once', async () => {
    mocks.inc.create.mockResolvedValue({
      hookId: 'h9',
      url: 'https://atrium-workboards.web.app/api/hooks/h9.secret',
    });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add incoming webhook' }));
    await user.type(await screen.findByLabelText('Name'), 'Form');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default group' }), 'g2');
    await user.click(screen.getByRole('button', { name: 'Add webhook' }));
    expect(mocks.inc.create).toHaveBeenCalledWith({
      boardId: 'b1',
      name: 'Form',
      defaultGroupId: 'g2',
    });
    expect(
      await screen.findByDisplayValue('https://atrium-workboards.web.app/api/hooks/h9.secret'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Copy this URL now. You won't be able to see it again."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(screen.queryByDisplayValue(/api\/hooks\/h9/)).not.toBeInTheDocument(),
    );
  });

  it('rotates and deletes an incoming hook after confirming', async () => {
    mocks.incoming.data = [incomingHook()];
    mocks.inc.rotateSecret.mockResolvedValue({
      hookId: 'hook-abcd1234',
      url: 'https://atrium-workboards.web.app/api/hooks/hook-abcd1234.new',
    });
    mocks.inc.remove.mockResolvedValue({ hookId: 'hook-abcd1234', deleted: true });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Rotate URL of Contact form' }));
    await user.click(await screen.findByRole('button', { name: 'Rotate URL' }));
    expect(await screen.findByDisplayValue(/hook-abcd1234\.new/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(await screen.findByRole('button', { name: 'Delete Contact form' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mocks.inc.remove).toHaveBeenCalledWith({ boardId: 'b1', hookId: 'hook-abcd1234' }),
    );
  });

  it('includes a curl example with a placeholder URL', () => {
    setup();
    const example = screen.getByLabelText('Example request');
    expect(example.textContent).toContain('curl -X POST');
    expect(example.textContent).toContain('"values"');
    expect(example.textContent).not.toMatch(/atrium-workboards/);
  });
});
