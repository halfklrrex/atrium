import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
  it('explains the miss and links back to Home', async () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <Routes>
          <Route path="/" element={<p>Home page</p>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: "We couldn't find that page" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Go to Home' }));
    expect(screen.getByText('Home page')).toBeInTheDocument();
  });
});
