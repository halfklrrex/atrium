import {
  INCOMING_HOOK_BODY_MAX_BYTES,
  INCOMING_HOOK_CALLS_PER_MINUTE,
  INCOMING_HOOK_DAILY_CALLS,
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_RETRY_DELAYS_MS,
} from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { RequireAuth } from '../../auth/RequireAuth';
import {
  API_BASE_URL,
  API_CALLS_PER_MINUTE,
  API_DAILY_CALLS,
  API_DAILY_WRITES,
  API_ERROR_CODES,
  API_ROUTES,
  CURL_INCOMING_HOOK,
  CURL_READ,
  INCOMING_HOOK_FACTS,
  INCOMING_HOOK_PATH,
  INCOMING_HOOK_RESPONSES,
  OPENAPI_PATH,
  VERIFY_NODE,
  VERIFY_PYTHON,
  VERIFY_SHELL,
  WEBHOOK_RETRY_LABELS,
} from './developers-content';
import { DevelopersPage } from './DevelopersPage';

const signedOut = {
  status: 'signedOut',
  user: null,
  lastWorkspaceId: null,
  accountStatus: null,
  error: null,
  redirectError: null,
} as unknown as AuthContextValue;

/** The same shape as App.tsx: `/developers` sits outside `RequireAuth`. */
function renderSignedOut() {
  return render(
    <AuthContext.Provider value={signedOut}>
      <MemoryRouter initialEntries={['/developers']}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/developers" element={<DevelopersPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<div>home page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('DevelopersPage', () => {
  it('renders without a session and sets the title', () => {
    renderSignedOut();
    expect(screen.getByRole('heading', { level: 1, name: 'Developers' })).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
    expect(document.title).toBe('Developers · Atrium');
  });

  it('has a heading and an anchor link for every section', () => {
    renderSignedOut();
    for (const name of [
      'Authentication',
      'Quick start',
      'Routes',
      'Errors',
      'Limits',
      'Idempotency',
      'Webhooks',
      'Incoming webhooks',
      'OpenAPI',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'On this page' })).toHaveTextContent(name);
    }
  });

  it('lists every route and every error code', () => {
    renderSignedOut();
    const routes = screen.getByRole('region', { name: 'Route table' });
    for (const route of API_ROUTES) {
      expect(routes).toHaveTextContent(route.path);
    }
    expect(API_ROUTES).toHaveLength(14);
    const errors = screen.getByRole('region', { name: 'Error code table' });
    for (const { code } of API_ERROR_CODES) expect(errors).toHaveTextContent(code);
  });

  it('shows the limits and pins them to the source values', () => {
    renderSignedOut();
    expect([API_CALLS_PER_MINUTE, API_DAILY_CALLS, API_DAILY_WRITES]).toEqual([120, 5000, 1000]);
    expect(screen.getByText(/120 calls a minute per token/)).toBeInTheDocument();
    expect(screen.getByText(/5,000 calls and 1,000 writes a day/)).toBeInTheDocument();
  });

  it('shows copy-ready snippets', () => {
    renderSignedOut();
    expect(CURL_READ).toContain(`${API_BASE_URL}/workspaces`);
    expect(CURL_READ).toContain('Authorization: Bearer');
    expect(screen.getByLabelText('curl: write')).toHaveTextContent('Idempotency-Key');
    expect(VERIFY_NODE).toContain('createHmac');
    expect(VERIFY_PYTHON).toContain('hmac.compare_digest');
    expect(VERIFY_SHELL).toContain('openssl dgst -sha256');
    for (const snippet of [VERIFY_NODE, VERIFY_PYTHON, VERIFY_SHELL]) {
      expect(snippet).toContain('v1=');
    }
    expect(screen.getByLabelText('verify in Node')).toBeInTheDocument();
    expect(screen.getByLabelText('verify in Python')).toBeInTheDocument();
    expect(screen.getByLabelText('verify in a shell')).toBeInTheDocument();
  });

  it('states the webhook retry schedule and the disable threshold from the source', () => {
    renderSignedOut();
    expect(WEBHOOK_RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000, 10_800_000]);
    expect(WEBHOOK_RETRY_LABELS).toEqual(['1 min', '5 min', '30 min', '3 h']);
    expect(screen.getByText(/after 1 min, 5 min, 30 min, 3 h/)).toBeInTheDocument();
    expect(WEBHOOK_DISABLE_AFTER_FAILURES).toBe(20);
    expect(screen.getByText(/After 20 failed deliveries in a row/)).toBeInTheDocument();
    expect(screen.getByText(/must start with https:\/\//)).toBeInTheDocument();
    expect(screen.getByText(/more than 5 minutes old/)).toBeInTheDocument();
  });

  it('documents the incoming webhook route and pins its limits to the source', () => {
    renderSignedOut();
    expect([
      INCOMING_HOOK_CALLS_PER_MINUTE,
      INCOMING_HOOK_DAILY_CALLS,
      INCOMING_HOOK_BODY_MAX_BYTES,
    ]).toEqual([60, 1000, 64 * 1024]);
    expect(INCOMING_HOOK_FACTS).toEqual({ callsPerMinute: 60, dailyCalls: 1000, bodyMaxKb: 64 });
    expect(INCOMING_HOOK_PATH).toBe('/api/hooks/{token}');
    expect(screen.getByText(/60 calls a minute and 1,000 a day per hook/)).toBeInTheDocument();
    expect(screen.getByText(/The body can be 64 KB at most/)).toBeInTheDocument();
    expect(screen.getByText(/Webhook: <name>/)).toBeInTheDocument();
    expect(CURL_INCOMING_HOOK).toContain('/api/hooks/HOOK_ID.SECRET');
    expect(CURL_INCOMING_HOOK).toContain('Idempotency-Key');
    expect(screen.getByLabelText('curl: incoming webhook')).toBeInTheDocument();
    const answers = screen.getByRole('region', { name: 'Incoming webhook answers' });
    for (const { status } of INCOMING_HOOK_RESPONSES) expect(answers).toHaveTextContent(status);
    expect(answers).toHaveTextContent('Unknown, disabled or wrong URL');
    expect(answers).toHaveTextContent('64 KB');
    expect(screen.getAllByText(/Board menu > Integrations/)).toHaveLength(2);
  });

  it('links to the OpenAPI document and back to the app', () => {
    renderSignedOut();
    expect(screen.getByRole('link', { name: OPENAPI_PATH })).toHaveAttribute('href', OPENAPI_PATH);
    expect(screen.getByRole('link', { name: 'Back to Atrium' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /API tokens/ })).toHaveAttribute(
      'href',
      '/settings/account',
    );
  });

  it('names no person and no email', () => {
    const { container } = renderSignedOut();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/halfklrrex|gmail|lepetitchat/i);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
  });
});
