import { DEFAULT_PUSH_PREFS } from '@atrium/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '../../components/toast-store';
import { NotificationsTab } from './NotificationsTab';

const mockSetPrefs = vi.fn();
let mockPrefs: Record<string, unknown> = {
  assigned: true,
  reply: false,
  mention: true,
  button: true,
};

/** The browser and Firebase pieces behind the device chip and its button. */
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

vi.mock('../../components/toast-store', () => ({ showToast: vi.fn() }));
vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data/notifications', () => ({
  useNotificationPrefs: () => ({ prefs: mockPrefs, loading: false }),
  notificationWrites: { setPrefs: (...args: unknown[]) => mockSetPrefs(...args) },
}));

describe('NotificationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrefs = { assigned: true, reply: false, mention: true, button: true };
    mockDeps.state.vapidKey = '';
    mockDeps.state.marker = null;
    mockDeps.state.exists = false;
    setEnv();
    mockSetPrefs.mockResolvedValue(undefined);
  });

  it('has a table with seven rows in order', () => {
    render(<NotificationsTab />);
    expect(screen.getByRole('table', { name: 'Notification settings' })).toBeInTheDocument();
    const rows = screen.getAllByRole('rowheader').map((h) => h.textContent);
    expect(rows).toEqual([
      expect.stringContaining('Assigned to me'),
      expect.stringContaining('Replies'),
      expect.stringContaining('Mentions'),
      expect.stringContaining('Button clicks'),
      expect.stringContaining('Automations'),
      expect.stringContaining('Account requests and approvals'),
      expect.stringContaining('Inbox messages'),
    ]);
    expect(screen.getByRole('columnheader', { name: 'In the bell' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Push' })).toBeInTheDocument();
  });

  it('shows five bell switches with the saved state and "Always" for the other two', () => {
    render(<NotificationsTab />);
    expect(screen.getByRole('switch', { name: 'In the bell: Assigned to me' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'In the bell: Replies' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'In the bell: Mentions' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'In the bell: Button clicks' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'In the bell: Automations' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /In the bell: Account/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /In the bell: Inbox/ })).toBeNull();
    expect(screen.getAllByText('Always')).toHaveLength(2);
    expect(screen.getAllByRole('switch', { name: /^In the bell:/ })).toHaveLength(5);
  });

  it('saves a bell change straight away, keeping the others', async () => {
    render(<NotificationsTab />);
    await userEvent.click(screen.getByRole('switch', { name: 'In the bell: Replies' }));
    expect(mockSetPrefs).toHaveBeenCalledWith('u1', {
      assigned: true,
      reply: true,
      mention: true,
      button: true,
    });
  });

  it('shows a toast when a write fails', async () => {
    mockSetPrefs.mockRejectedValue(new Error('nope'));
    render(<NotificationsTab />);
    await userEvent.click(screen.getByRole('switch', { name: 'Push: Replies' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not save your notification settings.', {
        type: 'negative',
      }),
    );
  });

  describe('Push switches', () => {
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
      render(<NotificationsTab />);
      for (const [kind, name] of SEVEN) {
        const sw = screen.getByRole('switch', { name });
        if (DEFAULT_PUSH_PREFS[kind]) expect(sw).toBeChecked();
        else expect(sw).not.toBeChecked();
      }
    });

    it.each(SEVEN)('turning %s on or off writes the whole push map', async (kind, name) => {
      mockPrefs = { ...mockPrefs, push: { ...DEFAULT_PUSH_PREFS, [kind]: false, mention: false } };
      render(<NotificationsTab />);
      await userEvent.click(screen.getByRole('switch', { name }));
      const written = mockSetPrefs.mock.calls[0]?.[1] as { push: Record<string, boolean> };
      expect(Object.keys(written.push).sort()).toEqual(Object.keys(DEFAULT_PUSH_PREFS).sort());
      const before = { ...DEFAULT_PUSH_PREFS, [kind]: false, mention: false };
      expect(written.push).toEqual({ ...before, [kind]: true });
    });

    it('starts from the defaults when no push map is stored', async () => {
      render(<NotificationsTab />);
      await userEvent.click(screen.getByRole('switch', { name: 'Push: Automations' }));
      expect(mockSetPrefs.mock.calls[0]?.[1]).toMatchObject({
        push: { ...DEFAULT_PUSH_PREFS, automation: !DEFAULT_PUSH_PREFS.automation },
      });
    });

    it('keeps the push map when a bell switch changes', async () => {
      mockPrefs = { ...mockPrefs, push: { ...DEFAULT_PUSH_PREFS, automation: true } };
      render(<NotificationsTab />);
      await userEvent.click(screen.getByRole('switch', { name: 'In the bell: Replies' }));
      expect(mockSetPrefs.mock.calls[0]?.[1]).toMatchObject({
        reply: true,
        push: { ...DEFAULT_PUSH_PREFS, automation: true },
      });
    });

    it('stays enabled whatever this device can do', async () => {
      render(<NotificationsTab />); // VAPID key empty: push is not set up
      expect(await screen.findByText('Push notifications are not set up yet.')).toBeVisible();
      for (const [, name] of SEVEN) expect(screen.getByRole('switch', { name })).toBeEnabled();
    });
  });

  describe('This device', () => {
    it('shows nothing in the header while the state loads', () => {
      render(<NotificationsTab />);
      expect(screen.queryByText(/This device:|No push here|Push not set up/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    });

    it('says push is not set up yet while the VAPID key is empty, and has no Enable button', async () => {
      render(<NotificationsTab />);
      expect(await screen.findByText('Push not set up')).toBeVisible();
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
      render(<NotificationsTab />);
      expect(await screen.findByText('Install first')).toBeVisible();
      expect(await screen.findByText(/tap Share, then Add to Home Screen/)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    });

    it('says when the browser has no push support', async () => {
      setEnv({ hasPushManager: false });
      render(<NotificationsTab />);
      expect(await screen.findByText('No push here')).toBeVisible();
      expect(
        await screen.findByText("This browser can't receive push notifications."),
      ).toBeVisible();
    });

    it('explains a blocked browser', async () => {
      mockDeps.state.vapidKey = 'key';
      setEnv({ permission: 'denied' });
      render(<NotificationsTab />);
      expect(await screen.findByText('Push blocked')).toBeVisible();
      expect(await screen.findByText(/blocked for Atrium in this browser/)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    });

    it('offers Enable when off; the click asks for permission and writes defaults', async () => {
      mockDeps.state.vapidKey = 'key';
      render(<NotificationsTab />);
      expect(await screen.findByText('This device: push off')).toBeVisible();
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

    it('disables the button while busy', async () => {
      mockDeps.state.vapidKey = 'key';
      let release: () => void = () => {};
      mockDeps.deps.requestPermission.mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve('granted'))),
      );
      render(<NotificationsTab />);
      await userEvent.click(await screen.findByRole('button', { name: 'Enable' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Enable' })).toHaveAttribute(
          'aria-disabled',
          'true',
        ),
      );
      release();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Enable' })).toHaveAttribute(
          'aria-disabled',
          'false',
        ),
      );
    });

    it('shows Disable when on; the click removes the device', async () => {
      mockDeps.state.vapidKey = 'key';
      setEnv({ permission: 'granted' });
      mockDeps.state.marker = { uid: 'u1', id: 'e'.repeat(64), seenAt: 1 };
      mockDeps.state.exists = true;
      render(<NotificationsTab />);
      expect(await screen.findByText('This device: push on')).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
      await waitFor(() =>
        expect(mockDeps.deps.store.remove).toHaveBeenCalledWith('u1', 'e'.repeat(64)),
      );
      expect(mockDeps.deps.deleteToken).toHaveBeenCalled();
    });
  });
});
