import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PRINT_PAGE_WIDTH, PRINT_SCALE_VAR, printScale, usePrinting } from './use-printing';

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

describe('printScale', () => {
  it('leaves a table that fits alone, and shrinks a wide one between 0.5 and 1', () => {
    expect(printScale(PRINT_PAGE_WIDTH - 1)).toBe(1);
    expect(printScale(0)).toBe(1);
    expect(printScale(PRINT_PAGE_WIDTH * 2)).toBe(0.5);
    expect(printScale(PRINT_PAGE_WIDTH * 1.25)).toBe(0.8);
    expect(printScale(PRINT_PAGE_WIDTH * 10)).toBe(0.5);
  });
});

describe('print scale variable', () => {
  it('is set while printing from the widest group and cleared afterwards', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-print-page="board"><section id="wide"></section></div>',
    );
    const section = document.getElementById('wide') as HTMLElement;
    Object.defineProperty(section, 'offsetWidth', { value: 1800 - 64 });
    render(<Probe />);
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(document.documentElement.style.getPropertyValue(PRINT_SCALE_VAR)).toBe('0.52');
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(document.documentElement.style.getPropertyValue(PRINT_SCALE_VAR)).toBe('');
    section.parentElement?.remove();
  });
});
