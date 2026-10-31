import { describe, expect, it } from 'vitest';
import { isTypingTarget } from './typing-target';

describe('isTypingTarget', () => {
  it('is true for inputs, textareas, selects and editors', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true);
    }
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const inner = document.createElement('p');
    editor.append(inner);
    document.body.append(editor);
    expect(isTypingTarget(inner)).toBe(true);
    editor.remove();
  });

  it('is false for other elements and no target', () => {
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
