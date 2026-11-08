import { DEFAULT_PUSH_PREFS } from '@atrium/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationSettingsDialog } from './NotificationSettingsDialog';

const mockSetPrefs = vi.fn();
let mockPrefs: Record<string, unknown> = {
  assigned: true,
  reply: false,
  mention: true,
  button: true,
};

/** The browser and Firebase pieces behind the "On this device" section. */
const mockDeps = vi.hoisted(() => {
  const state = {
    env: {} as Record<string, unknown>,
    vapidKey: '',
    marker: null as null | { uid: string; id: string; seenAt: number },
    exists: false,
  };
  return {
    state,
    deps: {
      env: () => state.env,
      get vapidKey() {
        return state.vapidKey;
      },
      messagingSupported: async () => true,
      requestPermission: vi.fn(async () => 'granted'),
      getRegistration: vi.fn(async () => ({})),
      getToken: vi.fn(async () => 'fcm-token'),
      deleteToken: vi.fn(async () => true),
      timestamp: () => 'ts',
      store: {
        exists: vi.fn(async () => state.exists),
        create: vi.fn(async () => {}),
        touch: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      marker: {
        read: () => state.marker,
        write: (m: typeof state.marker) => {
          state.marker = m;
        },
      },
      now: () => 1,
    },
  };
});
vi.mock('../../lib/push-runtime', () => ({ pushDeps: mockDeps.deps }));

function setEnv(over: Record<string, unknown> = {}) {
  mockDeps.state.env = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0',
    maxTouchPoints: 0,
    standaloneFlag: undefined,
    displayModeStandalone: false,
    hasNotification: true,
    hasServiceWorker: true,
    hasPushManager: true,
    permission: 'default',
    ...over,
  };
}

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data/notifications', () => ({
  useNotificationPrefs: () => ({ prefs: mockPrefs, loading: false }),
  notificationWrites: { setPrefs: (...args: unknown[]) => mockSetPrefs(...args) },
}));

describe('NotificationSettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrefs = { assigned: true, reply: false, mention: true, button: true };
    mockDeps.state.vapidKey = '';
    mockDeps.state.marker = null;
    mockDeps.state.exists = false;
    setEnv();
    mockSetPrefs.mockResolvedValue(undefined);
  });

  it('shows one switch per kind with the saved state', () => {
    render(<NotificationSettingsDialog onClose={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Assigned to me' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Replies' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Mentions' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Button clicks' })).toBeChecked();
  });

  it('saves a change straight away, keeping the others', async () => {
    render(<NotificationSettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Replies' }));
    expect(mockSetPrefs).toHaveBeenCalledWith('u1', {
      assigned: true,
      reply: true,
      mention: true,
      button: true,
    });
  });

  it('closes from Done', async () => {
    const onClose = vi.fn();
    render(<NotificationSettingsDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  describe('Push notifications switches', () => {
    const SEVEN = [
      ['assigned', 'Push: Assigned to me'],
      ['reply', 'Push: Replies'],
      ['mention', 'Push: Mentions'],
      ['button', 'Push: Button clicks'],
      ['automation', 'Push: Automations'],
      ['account', 'Push: Account requests and approvals'],
      ['inbox', 'Push: Inbox messages'],
    ] as const;

    it('shows seven switches with the defaults when nothing is stored', () => {
      render(<NotificationSettingsDialog onClose={vi.fn()} />);
      for (const [kind, name] of SEVEN) {
        const sw = screen.getByRole('switch', { name });
        if (DEFAULT_PUSH_PREFS[kind]) expect(sw).toBeChecked();
        else expect(sw).not.toBeChecked();
      }
    });

    it.each(SEVEN)('turning %s on or off writes the whole push map', async (kind, name) => {
      mockPrefs = { ...mockPrefs, push: { ...DEFAULT_PUSH_PREFS, [kind]: false, mention: false } };
      render(<NotificationSettingsDialog onClose={vi.fn()} />);
      await userEvent.click(screen.getByRole('switch', { name }));
      const written = mockSetPrefs.mock.calls[0]?.[1] as { push: Record<string, boolean> };
      expect(Object.keys(written.push).sort()).toEqual(Object.keys(DEFAULT_PUSH_PREFS).sort());
      const before = { ...DEFAULT_PUSH_PREFS, [kind]: false, mention: false };
      expect(written.push).toEqual({ ...before, [kind]: true });
    });

    it('keeps the push map when a bell switch changes', async () => {
      mockPrefs = { ...mockPrefs, push: { ...DEFAULT_PUSH_PREFS, automation: true } };
      render(<NotificationSettingsDialog onClose={vi.fn()} />);
      await userEvent.click(screen.getByRole('switch', { name: 'Replies' }));
      expect(mockSetPrefs.mock.calls[0]?.[1]).toMatchObject({
        reply: true,
        push: { ...DEFAULT_PUSH_PREFS, automation: true },
      });
    });
  });

  describe('On this device', () => {
    it('says push is not set up yet while the VAPID key is empty, and has no Enable button', async () => {
      render(<NotificationSettingsDialog onClose={vi.fn()} />);
      expect(await screen.findByText('Push notifications are not set up yet.')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
      expect(mockDeps.deps.requestPermission).not.toHaveBeenCalled();
    });

    it('explains how to install on an iPhone that is not installed', async () => {
      setEnv({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        hasPushManager: false,
      });
      mockDeps.state.vapidKey = 'key';
      render(<NotificationSettingsDialog onClose={vi.fn()} />);
      expect(await screen.findByText(/tap Share, then Add to Home Screen/)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    });

    it('says when the browser has no push support', async () => {
      setEnv({ hasPushManager: false });
      render(<NotificationSettingsDialog onClose={vi.fn()} />);
      expect(
        await screen.findByText("This browser can't receive push notifications."),
      ).toBeVisible();
    });

    it('explains a blocked browser', async () => {
      mockDeps.state.vapidKey = 'key';
      setEnv({ permission: 'denied' });
      render(<NotificationSettingsDialog onClose={vi.fn()} />);
      expect(await screen.findByText(/blocked for Atrium in this browser/)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    });

    it('offers Enable when off; the click asks for permission and writes defaults', async () => {
      mockDeps.state.vapidKey = 'key';
      render(<NotificationSettingsDialog onClose={vi.fn()} />);
      const enable = await screen.findByRole('button', { name: 'Enable' });
      expect(mockDeps.deps.requestPermission).not.toHaveBeenCalled();
      await userEvent.click(enable);
      await waitFor(() => expect(mockDeps.deps.store.create).toHaveBeenCalled());
      expect(mockDeps.deps.requestPermission).toHaveBeenCalledOnce();
      expect(mockSetPrefs).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ push: DEFAULT_PUSH_PREFS }),
      );
    });

    it('shows Disable when on; the click removes the device', async () => {
      mockDeps.state.vapidKey = 'key';
      setEnv({ permission: 'granted' });
      mockDeps.state.marker = { uid: 'u1', id: 'e'.repeat(64), seenAt: 1 };
      mockDeps.state.exists = true;
      render(<NotificationSettingsDialog onClose={vi.fn()} />);
      expect(await screen.findByText('This device receives push notifications.')).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
      await waitFor(() =>
        expect(mockDeps.deps.store.remove).toHaveBeenCalledWith('u1', 'e'.repeat(64)),
      );
      expect(mockDeps.deps.deleteToken).toHaveBeenCalled();
    });
  });
});
