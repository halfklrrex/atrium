import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../components/AppShell/ui-store';
import { PrivacyTab } from './PrivacyTab';

describe('PrivacyTab', () => {
  beforeEach(() => useUiStore.setState({ dialog: null }));

  it('links to the source code (AGPL section 13)', () => {
    render(<PrivacyTab />);
    const link = screen.getByRole('link', { name: 'View on GitHub' });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\/.+\/atrium\/tree\//);
  });

  it('opens About Atrium', async () => {
    render(<PrivacyTab />);
    await userEvent.click(screen.getByRole('button', { name: 'About Atrium' }));
    expect(useUiStore.getState().dialog).toEqual({ type: 'about' });
  });

  it('points the data placeholders at the complaint category of Send feedback', async () => {
    render(<PrivacyTab />);
    expect(screen.getAllByText(/Coming soon/)).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Request deletion' }));
    expect(useUiStore.getState().dialog).toEqual({ type: 'feedback', category: 'complaint' });
  });
});
