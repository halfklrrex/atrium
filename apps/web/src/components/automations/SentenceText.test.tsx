import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttentionChip, RunStatusChip } from './RunStatusChip';
import { boldNames, sentenceNames } from './SentenceText';

const board = {
  columns: [
    { id: 'status', type: 'status', title: 'Status', settings: {} },
    { id: 'p', type: 'people', title: 'Owner', settings: {} },
  ],
  groups: [{ id: 'g', title: 'Done items' }],
} as const;

describe('boldNames', () => {
  it('wraps whole-word names, longest first, and leaves the rest', () => {
    render(
      <p data-testid="s">
        {boldNames('When Status changes, move the item to Done items', [
          'Done',
          'Done items',
          'Status',
        ])}
      </p>,
    );
    const bold = screen.getByTestId('s').querySelectorAll('strong');
    expect([...bold].map((b) => b.textContent)).toEqual(['Status', 'Done items']);
    expect(screen.getByTestId('s')).toHaveTextContent(
      'When Status changes, move the item to Done items',
    );
  });

  it('does not bold inside other words and escapes regex characters', () => {
    render(<p data-testid="s">{boldNames('Statuses and Cost (USD)', ['Status', 'Cost (USD)'])}</p>);
    const bold = screen.getByTestId('s').querySelectorAll('strong');
    expect([...bold].map((b) => b.textContent)).toEqual(['Cost (USD)']);
  });

  it('returns the text as is when there are no names', () => {
    expect(boldNames('Plain', [])).toEqual(['Plain']);
  });
});

describe('sentenceNames', () => {
  it('collects columns, groups and the people it notifies', () => {
    const names = sentenceNames(
      { actions: [{ type: 'notify', uids: ['u2', 'u9'] }] },
      board as never,
      { personName: (uid) => (uid === 'u2' ? 'Avery Quinn' : null) },
    );
    expect(names).toEqual(['Status', 'Owner', 'Done items', 'Avery Quinn']);
  });
});

describe('chips', () => {
  it('shows the result word for each status', () => {
    render(
      <>
        <RunStatusChip status="ok" />
        <RunStatusChip status="failed" />
        <RunStatusChip status="skipped" />
        <AttentionChip />
      </>,
    );
    for (const text of ['OK', 'Failed', 'Skipped', 'Needs attention']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});
