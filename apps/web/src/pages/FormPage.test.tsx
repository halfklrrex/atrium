import type { GetFormResult } from '@atrium/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormPage } from './FormPage';

const calls = vi.hoisted(() => ({ get: vi.fn(), submit: vi.fn() }));

vi.mock('../lib/callables', () => ({
  formCalls: calls,
  describeCallableError: (error: { message?: string }, fallback: string) =>
    error.message ?? fallback,
}));

const form: GetFormResult = {
  title: 'Request',
  description: 'Tell us what you need.',
  thankYou: 'Thanks, we got it.',
  questions: [
    { columnId: 'name', label: 'Your name', required: true, type: 'name', settings: {} },
    { columnId: 'qty', label: 'How many?', required: false, type: 'numbers', settings: {} },
  ],
};

const error = (code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { code: `functions/${code}`, details });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forms/b1/v1']}>
      <Routes>
        <Route path="forms/:boardId/:viewId" element={<FormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  calls.get.mockReset();
  calls.submit.mockReset();
});

describe('public form page', () => {
  it('shows a loader while the form loads, then the questions', async () => {
    calls.get.mockReturnValue(new Promise(() => undefined));
    const { unmount } = renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Loading form');
    unmount();

    calls.get.mockResolvedValue(form);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Request' })).toBeInTheDocument();
    expect(calls.get).toHaveBeenCalledWith({ boardId: 'b1', viewId: 'v1' });
    expect(screen.getByText('Tell us what you need.')).toBeInTheDocument();
  });

  it('shows one neutral page when the form is off or missing', async () => {
    calls.get.mockRejectedValue(error('not-found', 'This form is not available.'));
    renderPage();
    expect(
      await screen.findByRole('heading', { name: "This form isn't available" }),
    ).toBeInTheDocument();
  });

  it('offers a retry when loading fails for another reason', async () => {
    calls.get.mockRejectedValueOnce(error('unavailable', 'offline')).mockResolvedValue(form);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Request' })).toBeInTheDocument();
  });

  it('checks required answers before sending', async () => {
    calls.get.mockResolvedValue(form);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('This question is required.')).toBeInTheDocument();
    expect(calls.submit).not.toHaveBeenCalled();
  });

  it('submits the answers and shows the thank-you, then a fresh form', async () => {
    calls.get.mockResolvedValue(form);
    calls.submit.mockResolvedValue({ ok: true, thankYou: 'Thanks, we got it.' });
    renderPage();
    await userEvent.type(await screen.findByLabelText('Your name'), 'Avery Quinn');
    await userEvent.type(screen.getByLabelText('How many?'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Thanks, we got it.')).toBeInTheDocument();
    expect(calls.submit).toHaveBeenCalledWith({
      boardId: 'b1',
      viewId: 'v1',
      answers: { name: 'Avery Quinn', qty: 3 },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Submit another response' }));
    expect(await screen.findByLabelText('Your name')).toHaveValue('');
  });

  it('shows the server message under the question in error', async () => {
    calls.get.mockResolvedValue(form);
    calls.submit.mockRejectedValue(
      error('invalid-argument', 'Too many decimals.', { columnId: 'qty' }),
    );
    renderPage();
    await userEvent.type(await screen.findByLabelText('Your name'), 'Avery Quinn');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Too many decimals.')).toBeInTheDocument();
    expect(screen.queryByText('Thanks, we got it.')).not.toBeInTheDocument();
  });

  it('shows a rate limit message on the form', async () => {
    calls.get.mockResolvedValue(form);
    calls.submit.mockRejectedValue(
      error('resource-exhausted', 'You have sent too many responses to this form.'),
    );
    renderPage();
    await userEvent.type(await screen.findByLabelText('Your name'), 'Avery Quinn');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You have sent too many responses'),
    );
  });

  it('switches to the unavailable page if the form is switched off while filling it in', async () => {
    calls.get.mockResolvedValue(form);
    calls.submit.mockRejectedValue(error('not-found', 'This form is not available.'));
    renderPage();
    await userEvent.type(await screen.findByLabelText('Your name'), 'Avery Quinn');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(
      await screen.findByRole('heading', { name: "This form isn't available" }),
    ).toBeInTheDocument();
  });
});
