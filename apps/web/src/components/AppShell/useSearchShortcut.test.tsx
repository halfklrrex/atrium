import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSearchShortcut } from './useSearchShortcut';
import { useUiStore } from './ui-store';

function Host() {
  useSearchShortcut();
  return (
    <div>
      <input aria-label="field" />
      <textarea aria-label="area" />
      <div contentEditable suppressContentEditableWarning aria-label="editor">
        <p>text</p>
      </div>
      <button type="button">plain</button>
    </div>
  );
}

const dialogType = () => useUiStore.getState().dialog?.type ?? null;

describe('useSearchShortcut', () => {
  beforeEach(() => useUiStore.setState({ dialog: null }));

  it('opens and closes the search with Ctrl+B, Ctrl+K and Cmd+K, and prevents the default', () => {
    const { getByText } = render(<Host />);
    const target = getByText('plain');
    const press = (init: KeyboardEventInit) =>
      fireEvent.keyDown(target, { bubbles: true, cancelable: true, ...init });
    expect(press({ key: 'b', ctrlKey: true })).toBe(false);
    expect(dialogType()).toBe('search');
    press({ key: 'k', ctrlKey: true });
    expect(dialogType()).toBeNull();
    press({ key: 'K', metaKey: true });
    expect(dialogType()).toBe('search');
  });

  it('is ignored inside inputs, textareas and editors, so Ctrl+B still bolds', () => {
    const { getByLabelText, getByText } = render(<Host />);
    for (const el of [getByLabelText('field'), getByLabelText('area'), getByText('text')]) {
      const notPrevented = fireEvent.keyDown(el, {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      expect(notPrevented).toBe(true);
    }
    expect(dialogType()).toBeNull();
  });

  it('does not replace another open dialog and ignores other keys', () => {
    useUiStore.setState({ dialog: { type: 'about' } });
    const { getByText } = render(<Host />);
    fireEvent.keyDown(getByText('plain'), { key: 'k', ctrlKey: true });
    expect(dialogType()).toBe('about');
    useUiStore.setState({ dialog: null });
    fireEvent.keyDown(getByText('plain'), { key: 'j', ctrlKey: true });
    fireEvent.keyDown(getByText('plain'), { key: 'k' });
    expect(dialogType()).toBeNull();
  });
});
