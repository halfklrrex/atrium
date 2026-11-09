import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../components/AppShell/ui-store';
import { PrivacyTab } from './PrivacyTab';

function renderTab() {
  return render(
    <MemoryRouter>
      <PrivacyTab />
    </MemoryRouter>,
  );
}

describe('PrivacyTab', () => {
  beforeEach(() => useUiStore.setState({ dialog: null }));

  it('links to the source code (AGPL section 13)', () => {
    renderTab();
    const link = screen.getByRole('link', { name: 'View on GitHub' });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\/.+\/atrium\/tree\//);
  });

  it('links to the public privacy notice', () => {
    renderTab();
    expect(screen.getByRole('link', { name: 'Read the privacy notice' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('opens About Atrium', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'About Atrium' }));
    expect(useUiStore.getState().dialog).toEqual({ type: 'about' });
  });

  it('points the data placeholders at the complaint category of Send feedback', async () => {
    renderTab();
    expect(screen.getAllByText(/Coming soon/)).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Request deletion' }));
    expect(useUiStore.getState().dialog).toEqual({ type: 'feedback', category: 'complaint' });
  });
});
