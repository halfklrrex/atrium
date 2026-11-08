import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CenterHeader } from './CenterHeader';

const base = {
  titleId: 'title',
  boardName: 'Roadmap',
  view: 'create' as const,
  onViewChange: vi.fn(),
  manageCount: 2,
};

describe('CenterHeader', () => {
  it('shows a Give feedback icon button that calls onGiveFeedback', async () => {
    const onGiveFeedback = vi.fn();
    render(<CenterHeader {...base} onGiveFeedback={onGiveFeedback} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Give feedback' }));
    expect(onGiveFeedback).toHaveBeenCalledTimes(1);
  });

  it('leaves the button out when there is no handler', () => {
    render(<CenterHeader {...base} />);
    expect(screen.queryByRole('button', { name: 'Give feedback' })).toBeNull();
  });
});
