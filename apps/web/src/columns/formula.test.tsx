import {
  FORMULA_ERRORS,
  type ColumnDef,
  type FormulaSettings,
  type FormulaValue,
} from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { formulaUi } from './formula';
import type { CellProps } from './types';

const col: ColumnDef = {
  id: 'c_formula',
  type: 'formula',
  title: 'Formula',
  position: 'a0',
  settings: { expression: '{A} + {B}', outputType: 'number' },
};

function renderFormulaCell(
  value: FormulaValue,
  settings: Partial<FormulaSettings> = {},
  highlight = '',
) {
  const fullSettings: FormulaSettings = {
    expression: '{A} + {B}',
    outputType: 'text',
    ...settings,
  };
  const props: CellProps<FormulaValue, FormulaSettings> = {
    value,
    settings: fullSettings,
    column: { ...col, settings: fullSettings },
    ctx: { highlight, rowDone: false, canEdit: false },
    onChange: vi.fn(),
  };
  const Cell = formulaUi.Cell as unknown as ComponentType<CellProps<FormulaValue, FormulaSettings>>;
  return render(<Cell {...props} />);
}

describe('formula column cell', () => {
  it('renders an empty cell when value is null, undefined, or empty string', () => {
    const { container, rerender } = renderFormulaCell(null);
    expect(container.textContent).toBe('');

    const Cell = formulaUi.Cell;
    rerender(
      <Cell
        value={''}
        settings={{ expression: '', outputType: 'text' }}
        column={col}
        ctx={{ highlight: '', rowDone: false, canEdit: false }}
        onChange={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('formats number output with decimalPlaces and currencySymbol', () => {
    renderFormulaCell(123.456, {
      outputType: 'number',
      decimalPlaces: 2,
      currencySymbol: '$',
    });
    expect(screen.getByText('$123.46')).toBeInTheDocument();
  });

  it('renders text and boolean output and supports search highlight', () => {
    const { unmount } = renderFormulaCell('Shipped on time', { outputType: 'text' }, 'Shipped');
    expect(screen.getByText('Shipped').tagName).toBe('MARK');
    unmount();

    renderFormulaCell(true, { outputType: 'boolean' });
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('renders a red "!" indicator with tooltip on formula evaluation errors', () => {
    for (const err of [FORMULA_ERRORS.DIV_ZERO, FORMULA_ERRORS.ERROR, FORMULA_ERRORS.CIRCULAR]) {
      const { unmount } = renderFormulaCell(err);
      const badge = screen.getByRole('img', { name: `Formula error: ${err}` });
      expect(badge).toHaveTextContent('!');
      expect(badge).toHaveAttribute('title', err);
      unmount();
    }
  });
});
