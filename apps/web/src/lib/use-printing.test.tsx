import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePrinting } from './use-printing';

function Probe() {
  return <p>{usePrinting() ? 'printing' : 'screen'}</p>;
}

describe('usePrinting', () => {
  it('is on between beforeprint and afterprint', () => {
    render(<Probe />);
    expect(screen.getByText('screen')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(screen.getByText('printing')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(screen.getByText('screen')).toBeInTheDocument();
  });
});
