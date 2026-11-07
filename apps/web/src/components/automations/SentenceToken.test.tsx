import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../data/members-store', () => ({
  UNKNOWN_PERSON_NAME: 'Board member',
  useUserLookup: () => () => undefined,
}));

import { SentenceMultiToken, SentenceToken, TokenInput, type TokenOption } from './SentenceToken';

const options: TokenOption[] = [
  { value: 'a', label: 'Working on it', chip: '#fdab3d' },
  { value: 'b', label: 'Done', chip: '#00c875' },
  { value: 'c', label: 'Stuck', disabled: true, badge: 'Soon' },
  { value: 'd', label: 'Later', hint: '(no Date column)' },
];

function Single({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <SentenceToken
        label="Status"
        placeholder="a status"
        value={value}
        options={options}
        onChange={setValue}
      />
      <span data-testid="value">{String(value)}</span>
    </>
  );
}

describe('SentenceToken', () => {
  it('shows the placeholder as a blank, and the chosen option once filled', () => {
    render(<Single />);
    const token = screen.getByRole('button', { name: 'Status: a status' });
    expect(token).toHaveAttribute('data-blank');
    expect(token).toHaveAttribute('aria-haspopup', 'listbox');
    expect(token).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(token);
    fireEvent.click(screen.getByRole('option', { name: 'Done' }));
    const filled = screen.getByRole('button', { name: 'Status: Done' });
    expect(filled).not.toHaveAttribute('data-blank');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('value')).toHaveTextContent('b');
  });

  it('draws chips in their own colour, and disabled rows with a badge or hint', () => {
    render(<Single initial="a" />);
    fireEvent.click(screen.getByRole('button', { name: /^Status:/ }));
    const list = screen.getByRole('listbox', { name: 'Status' });
    expect(within(list).getByText('Done')).toHaveStyle({ backgroundColor: 'rgb(0, 200, 117)' });
    expect(within(list).getByRole('option', { name: 'Working on it' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const stuck = within(list).getByRole('option', { name: /Stuck/ });
    expect(stuck).toBeDisabled();
    expect(stuck).toHaveTextContent('Soon');
    expect(within(list).getByRole('option', { name: /Later/ })).toHaveTextContent(
      '(no Date column)',
    );
    fireEvent.click(stuck);
    expect(screen.getByTestId('value')).toHaveTextContent('a');
  });

  it('opens on the selected row; arrows skip disabled rows; Escape closes and refocuses the token', () => {
    const onKeyDown = vi.fn();
    document.addEventListener('keydown', onKeyDown);
    render(<Single initial="b" />);
    const token = screen.getByRole('button', { name: /^Status:/ });
    fireEvent.click(token);
    const list = screen.getByRole('listbox');
    expect(within(list).getByRole('option', { name: 'Done' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    // "Stuck" is disabled, so the next row is "Later".
    expect(within(list).getByRole('option', { name: /Later/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(within(list).getByRole('option', { name: 'Working on it' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(within(list).getByRole('option', { name: /Later/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(within(list).getByRole('option', { name: 'Working on it' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(token).toHaveFocus();
    // The Escape belongs to the list: the modal behind it must not see it.
    expect(onKeyDown).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    document.removeEventListener('keydown', onKeyDown);
  });

  it('closes on a press outside and on Tab', () => {
    render(
      <>
        <Single />
        <button type="button">elsewhere</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Status:/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Status:/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('can read as a link, and uses `display` once filled', () => {
    render(
      <SentenceToken
        variant="link"
        label="Change trigger"
        placeholder="Change trigger"
        value="a"
        options={options}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Change trigger' })).not.toHaveAttribute(
      'data-blank',
    );
    render(
      <SentenceToken
        label="Group"
        placeholder="a group"
        value="gone"
        display="a deleted group"
        options={options}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Group: a deleted group' })).toBeInTheDocument();
  });
});

describe('SentenceMultiToken', () => {
  const people: TokenOption[] = [
    { value: 'u1', label: 'Avery Quinn', uid: 'u1' },
    { value: 'u2', label: 'Sam Rivera', uid: 'u2' },
    { value: 'u3', label: 'Kit Lane', uid: 'u3' },
  ];

  it('ticks several rows and keeps the list open', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SentenceMultiToken
        label="People"
        placeholder="someone"
        values={[]}
        options={people}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'People: someone' })).toHaveAttribute('data-blank');
    fireEvent.click(screen.getByRole('button', { name: /^People:/ }));
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    fireEvent.click(screen.getByRole('option', { name: 'Avery Quinn' }));
    expect(onChange).toHaveBeenLastCalledWith(['u1']);
    rerender(
      <SentenceMultiToken
        label="People"
        placeholder="someone"
        values={['u1']}
        display="Avery Quinn"
        options={people}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Avery Quinn' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('option', { name: 'Avery Quinn' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole('option', { name: 'Sam Rivera' }));
    expect(onChange).toHaveBeenLastCalledWith(['u1', 'u2']);
  });

  it('stops at the maximum', () => {
    render(
      <SentenceMultiToken
        label="People"
        placeholder="someone"
        values={['u1', 'u2']}
        max={2}
        options={people}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^People:/ }));
    expect(screen.getByRole('option', { name: 'Kit Lane' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Avery Quinn' })).toBeEnabled();
  });

  it('says so when there is no one to choose', () => {
    render(
      <SentenceMultiToken
        label="People"
        placeholder="someone"
        values={[]}
        options={[]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^People:/ }));
    expect(screen.getByText('No one found')).toBeInTheDocument();
  });
});

describe('TokenInput', () => {
  it('is a blank while empty and reports typing', () => {
    const onChange = vi.fn();
    render(<TokenInput label="New name" placeholder="a name" value="" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'New name' });
    expect(input).toHaveAttribute('data-blank');
    fireEvent.change(input, { target: { value: 'WR' } });
    expect(onChange).toHaveBeenCalledWith('WR', expect.anything());
  });
});
