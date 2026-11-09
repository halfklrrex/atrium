import { ACTIVITY_LIMITS, INBOX_LIMITS, NOTIFICATION_LIMITS } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { RequireAuth } from '../../auth/RequireAuth';
import {
  BACKUP_RETENTION_DAYS,
  LOG_RETENTION_DAYS,
  PRIVACY_ABOUT,
  PRIVACY_CHANGES,
  PRIVACY_SECTIONS,
  TRASH_RETENTION_DAYS,
} from './privacy-content';
import { PrivacyPage } from './PrivacyPage';

const signedOut = {
  status: 'signedOut',
  user: null,
  lastWorkspaceId: null,
  accountStatus: null,
  error: null,
  redirectError: null,
} as unknown as AuthContextValue;

/** The same shape as App.tsx: `/privacy` sits outside `RequireAuth`. */
function renderSignedOut() {
  return render(
    <AuthContext.Provider value={signedOut}>
      <MemoryRouter initialEntries={['/privacy']}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<div>home page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const allText = () =>
  [
    PRIVACY_ABOUT,
    PRIVACY_CHANGES,
    ...PRIVACY_SECTIONS.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.items ?? [])]),
  ].join('\n');

describe('PrivacyPage', () => {
  it('renders without a session and sets the title', () => {
    renderSignedOut();
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
    expect(document.title).toBe('Privacy · Atrium');
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  it('has a heading for every section', () => {
    renderSignedOut();
    for (const name of [
      'About Atrium',
      ...PRIVACY_SECTIONS.map((s) => s.heading),
      'Your choices',
      'Changes',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });

  it('links to Settings and to the complaint category', () => {
    renderSignedOut();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings/privacy',
    );
    expect(screen.getByRole('link', { name: /Complaint or data request/ })).toHaveAttribute(
      'href',
      '/feedback?new=complaint',
    );
    expect(screen.getByRole('link', { name: 'Back to Atrium' })).toHaveAttribute('href', '/');
  });

  it('states the retention periods the code enforces', () => {
    const text = allText();
    expect(text).toContain(`deleted after ${ACTIVITY_LIMITS.retentionDays} days`);
    expect(text).toContain(`deleted after ${NOTIFICATION_LIMITS.retentionDays} days`);
    expect(text).toContain(`deleted after ${INBOX_LIMITS.retentionDays} days`);
    expect(text).toContain(`removed after ${TRASH_RETENTION_DAYS} days`);
    expect(text).toContain(`up to ${BACKUP_RETENTION_DAYS} days`);
    expect(text).toContain(`about ${LOG_RETENTION_DAYS} days`);
    expect([
      ACTIVITY_LIMITS.retentionDays,
      NOTIFICATION_LIMITS.retentionDays,
      INBOX_LIMITS.retentionDays,
    ]).toEqual([90, 180, 365]);
  });

  it('names no person and no email, and promises nothing that is not built', () => {
    const { container } = renderSignedOut();
    const text = `${allText()}\n${container.textContent ?? ''}`;
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\b[\w.+-]+\s+at\s+[\w-]+\s+dot\b/i);
    expect(text).not.toMatch(/halfklrrex|gmail|lepetitchat/i);
    expect(text).not.toMatch(/not legal advice/i);
    expect(text).toMatch(/are coming/);
  });
});
