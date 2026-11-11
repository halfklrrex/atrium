import type { McpAuthRequestInfoResult } from '@atrium/shared';
import type * as Callables from '../../lib/callables';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectPage } from './ConnectPage';

const mocks = vi.hoisted(() => ({ authRequestInfo: vi.fn(), authorize: vi.fn() }));

vi.mock('../../lib/callables', async (importOriginal) => ({
  ...(await importOriginal<typeof Callables>()),
  mcpCalls: { authRequestInfo: mocks.authRequestInfo, authorize: mocks.authorize },
}));

const info: McpAuthRequestInfoResult = {
  clientName: 'Claude',
  redirectHost: 'claude.ai',
  loopback: false,
  requestedScopes: ['atrium:read', 'atrium:write'],
  expiresAt: 0,
};

const assign = vi.fn();

function renderPage(path = '/connect?request=req1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ConnectPage />
    </MemoryRouter>,
  );
}

describe('ConnectPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('location', { ...window.location, assign });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the loader while the request loads', () => {
    mocks.authRequestInfo.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(mocks.authRequestInfo).toHaveBeenCalledWith({ requestId: 'req1' });
  });

  it('says to start again when there is no request id', () => {
    renderPage('/connect');
    expect(screen.getByText(/Start again from Claude/)).toBeVisible();
    expect(mocks.authRequestInfo).not.toHaveBeenCalled();
  });

  it('says to start again when the request is not found or expired', async () => {
    mocks.authRequestInfo.mockRejectedValue({ code: 'functions/not-found', message: 'gone' });
    renderPage();
    expect(await screen.findByText(/Start again from Claude/)).toBeVisible();
  });

  it('shows an error with a retry for other failures', async () => {
    mocks.authRequestInfo.mockRejectedValueOnce({
      code: 'functions/internal',
      message: 'INTERNAL',
    });
    renderPage();
    expect(await screen.findByText('Could not load this request.')).toBeVisible();
    mocks.authRequestInfo.mockResolvedValueOnce(info);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Allow' })).toBeVisible();
  });

  it('shows the client name as text, the host and the scopes', async () => {
    mocks.authRequestInfo.mockResolvedValue({
      ...info,
      clientName: '<img src=x onerror=alert(1)>',
    });
    renderPage();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('claude.ai')).toBeVisible();
    expect(screen.queryByText(/program on this computer/)).toBeNull();
    const read = screen.getByRole('checkbox', { name: 'Read' });
    const write = screen.getByRole('checkbox', { name: 'Write' });
    expect(read).toBeChecked();
    expect(read).toBeDisabled();
    expect(write).toBeChecked();
    expect(write).toBeEnabled();
  });

  it('warns when the code goes to this computer', async () => {
    mocks.authRequestInfo.mockResolvedValue({
      ...info,
      redirectHost: 'localhost',
      loopback: true,
    });
    renderPage();
    expect(
      await screen.findByText(/The code will be sent to a program on this computer/),
    ).toBeVisible();
  });

  it('allows with the chosen scopes and returns to the client', async () => {
    mocks.authRequestInfo.mockResolvedValue(info);
    mocks.authorize.mockResolvedValue({ redirectUrl: 'https://claude.ai/cb?code=abc' });
    renderPage();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Write' }));
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(mocks.authorize).toHaveBeenCalledWith({
        requestId: 'req1',
        decision: 'allow',
        scopes: ['atrium:read'],
      }),
    );
    expect(await screen.findByText('Returning to Claude…')).toBeVisible();
    expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?code=abc');
  });

  it('denies and returns to the client', async () => {
    mocks.authRequestInfo.mockResolvedValue(info);
    mocks.authorize.mockResolvedValue({ redirectUrl: 'https://claude.ai/cb?error=access_denied' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() =>
      expect(mocks.authorize).toHaveBeenCalledWith({ requestId: 'req1', decision: 'deny' }),
    );
    expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied');
  });

  it('keeps the consent screen and shows the error when authorising fails', async () => {
    mocks.authRequestInfo.mockResolvedValue(info);
    mocks.authorize.mockRejectedValue({
      code: 'functions/failed-precondition',
      message: 'This request has expired.',
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This request has expired.');
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  });
});
