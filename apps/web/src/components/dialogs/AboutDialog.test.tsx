import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { APP_VERSION, SOURCE_REPO_URL, aboutLinks } from '../../lib/about';
import { AboutDialog } from './AboutDialog';

function renderAbout(onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <AboutDialog onClose={onClose} />
    </MemoryRouter>,
  );
}

describe('AboutDialog', () => {
  it('links to the privacy notice and closes itself on the way', async () => {
    const onClose = vi.fn();
    renderAbout(onClose);
    const link = screen.getByRole('link', { name: 'Privacy' });
    expect(link).toHaveAttribute('href', '/privacy');
    await userEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the version, the licence line and the source offer links', () => {
    renderAbout();
    expect(screen.getByRole('heading', { name: 'About Atrium' })).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent(APP_VERSION);
    expect(
      screen.getByText('Atrium is free software licensed under the GNU AGPL v3.'),
    ).toBeInTheDocument();
    const links = aboutLinks();
    expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', links.source);
    expect(screen.getByRole('link', { name: 'Licence' })).toHaveAttribute('href', links.licence);
    expect(screen.getByRole('link', { name: 'Third-party notices' })).toHaveAttribute(
      'href',
      links.notices,
    );
  });

  it('credits Twemoji under CC-BY 4.0', () => {
    renderAbout();
    expect(screen.getByText(/Emoji graphics are Twemoji/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CC-BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );
  });

  it('closes from the Close button', async () => {
    const onClose = vi.fn();
    renderAbout(onClose);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('aboutLinks', () => {
  it('opens the tree and files at the built commit', () => {
    expect(aboutLinks('abc1234def')).toEqual({
      source: `${SOURCE_REPO_URL}/tree/abc1234def`,
      licence: `${SOURCE_REPO_URL}/blob/abc1234def/LICENSE`,
      notices: `${SOURCE_REPO_URL}/blob/abc1234def/THIRD_PARTY_NOTICES.md`,
    });
  });

  it('falls back to main when the build has no commit', () => {
    expect(aboutLinks('dev').source).toBe(`${SOURCE_REPO_URL}/tree/main`);
  });
});
