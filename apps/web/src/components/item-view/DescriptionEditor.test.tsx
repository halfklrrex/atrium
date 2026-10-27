import { Editor } from '@tiptap/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DescriptionEditor from './DescriptionEditor';
import { createEditorExtensions } from './editor-extensions';
import { SlashController } from './slash-menu/slash-controller';

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../toast-store', () => ({ showToast: mocks.showToast }));

const text = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const DOC = doc({
  type: 'taskList',
  content: [
    { type: 'taskItem', attrs: { checked: true }, content: [text('Done')] },
    { type: 'taskItem', attrs: { checked: false }, content: [text('To do')] },
  ],
});
const save = () => vi.fn().mockResolvedValue(undefined);

/** The TipTap editor behind a rendered DescriptionEditor (ProseMirror's element carries it). */
const editorOf = (): Editor => {
  const dom = document.querySelector('.ProseMirror') as (HTMLElement & { editor: Editor }) | null;
  if (!dom) throw new Error('no editor');
  return dom.editor;
};
const pm = () => document.querySelector('.ProseMirror') as HTMLElement;

/** Types characters through ProseMirror's text-input handlers, so input rules run like real typing. */
function typeText(editor: Editor, value: string) {
  for (const ch of value) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

const typed = (value: string) => {
  const editor = new Editor({ extensions: createEditorExtensions(new SlashController()) });
  typeText(editor, value);
  return editor.getJSON();
};

describe('DescriptionEditor checklist', () => {
  it('renders checked and unchecked task items with data-checked', async () => {
    const { container } = render(
      <DescriptionEditor boardId="b1" itemId="i1" initial={DOC} readOnly onSave={save()} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll('ul[data-type="taskList"] > li')).toHaveLength(2);
    });
    const items = container.querySelectorAll('ul[data-type="taskList"] > li');
    expect(items[0]?.getAttribute('data-checked')).toBe('true');
    expect(items[1]?.getAttribute('data-checked')).toBe('false');
  });
});

describe('markdown shortcuts', () => {
  it('turns # ## ### + space into headings', () => {
    expect(typed('# ').content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(typed('## ').content?.[0]?.attrs?.level).toBe(2);
    expect(typed('### ').content?.[0]?.attrs?.level).toBe(3);
  });

  it('starts bulleted, numbered and checklists, quotes, code blocks and dividers', () => {
    expect(typed('- ').content?.[0]?.type).toBe('bulletList');
    expect(typed('* ').content?.[0]?.type).toBe('bulletList');
    expect(typed('1. ').content?.[0]?.type).toBe('orderedList');
    expect(typed('> ').content?.[0]?.type).toBe('blockquote');
    expect(typed('``` ').content?.[0]?.type).toBe('codeBlock');
    expect(typed('---').content?.some((n) => n.type === 'horizontalRule')).toBe(true);
    expect(typed('[ ] ').content?.[0]?.type).toBe('taskList');
    expect(typed('[x] ').content?.[0]?.content?.[0]).toMatchObject({ attrs: { checked: true } });
  });

  it('applies inline marks when the closing mark is typed', () => {
    const marks = (value: string) =>
      typed(value).content?.[0]?.content?.flatMap((n) => n.marks ?? []);
    expect(marks('**bold**')).toEqual([{ type: 'bold' }]);
    expect(marks('*italic*')).toEqual([{ type: 'italic' }]);
    expect(marks('~~gone~~')).toEqual([{ type: 'strike' }]);
    expect(marks('`code`')).toEqual([{ type: 'code' }]);
  });
});

describe('toolbar', () => {
  const hello = doc(text('Hello'));
  const mount = () =>
    render(
      <DescriptionEditor
        boardId="b1"
        itemId="i1"
        initial={hello}
        readOnly={false}
        onSave={save()}
      />,
    );

  it('applies each mark to the selection', async () => {
    const user = userEvent.setup();
    mount();
    const toolbar = screen.getByRole('toolbar', { name: 'Description formatting' });
    for (const [name, tag] of [
      ['Bold', 'strong'],
      ['Italic', 'em'],
      ['Underline', 'u'],
      ['Strikethrough', 's'],
    ] as const) {
      act(() => {
        editorOf().commands.selectAll();
      });
      await user.click(within(toolbar).getByRole('button', { name }));
      expect(pm().querySelector(tag)).not.toBeNull();
    }
  });

  it('applies each list type', async () => {
    const user = userEvent.setup();
    mount();
    for (const [name, selector] of [
      ['Bulleted list', 'ul:not([data-type])'],
      ['Numbered list', 'ol'],
      ['Checklist', 'ul[data-type="taskList"]'],
    ] as const) {
      act(() => {
        editorOf().commands.selectAll();
      });
      await user.click(screen.getByRole('button', { name }));
      expect(pm().querySelector(selector)).not.toBeNull();
      await user.click(screen.getByRole('button', { name }));
    }
  });

  it('disables undo and redo until there is something to undo or redo', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
    act(() => {
      editorOf().commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('sets Heading 1-3 and Normal text from the text-style dropdown', async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole('button', { name: 'Text style' });
    expect(trigger).toHaveTextContent('Normal text');
    for (const level of [1, 2, 3]) {
      await user.click(trigger);
      await user.click(await screen.findByRole('menuitem', { name: `Heading ${level}` }));
      // Vibe runs a menu item's click two animation frames later.
      await waitFor(() => expect(pm().querySelector(`h${level}`)).not.toBeNull());
      expect(trigger).toHaveTextContent(`Heading ${level}`);
    }
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Normal text' }));
    await waitFor(() => expect(pm().querySelector('h3')).toBeNull());
    expect(trigger).toHaveTextContent('Normal text');
  });

  it('offers quote, divider and table in the More menu', async () => {
    const user = userEvent.setup();
    mount();
    const more = async (title: string) => {
      await user.click(screen.getByRole('button', { name: 'More' }));
      await user.click(await screen.findByRole('menuitem', { name: title }));
    };
    await more('Quote');
    await waitFor(() => expect(pm().querySelector('blockquote')).not.toBeNull());
    await more('Divider');
    await waitFor(() => expect(pm().querySelector('hr')).not.toBeNull());
    await more('Table');
    await waitFor(() => expect(pm().querySelectorAll('table tr')).toHaveLength(3));
    expect(pm().querySelectorAll('table th')).toHaveLength(3);
    // Table controls float over the table while the caret is in it.
    expect(screen.getByRole('toolbar', { name: 'Table' })).toBeInTheDocument();
  });

  it('clears marks and blocks with Clear formatting', async () => {
    const user = userEvent.setup();
    render(
      <DescriptionEditor
        boardId="b1"
        itemId="i1"
        initial={doc({
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Big', marks: [{ type: 'bold' }] }],
        })}
        readOnly={false}
        onSave={save()}
      />,
    );
    act(() => {
      editorOf().commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Clear formatting' }));
    await waitFor(() => expect(pm().querySelector('h1')).toBeNull());
    expect(pm().querySelector('strong')).toBeNull();
    expect(pm()).toHaveTextContent('Big');
  });
});

describe('slash menu', () => {
  const open = (query = '') => {
    render(
      <DescriptionEditor
        boardId="b1"
        itemId="i1"
        initial={null}
        readOnly={false}
        onSave={save()}
      />,
    );
    const editor = editorOf();
    act(() => {
      editor.commands.focus();
      editor.commands.insertContent(`/${query}`);
    });
    return editor;
  };

  it('opens on "/", filters, inserts a heading and removes the query', async () => {
    const editor = open('head');
    const list = await screen.findByRole('listbox', { name: 'Blocks' });
    const names = within(list)
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    expect(names).toHaveLength(3);
    expect(names[0]).toContain('Heading 1');
    fireEvent.click(within(list).getByText('Heading 2'));
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(editor.state.doc.textContent).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('inserts a 3x3 table with Enter', async () => {
    const editor = open('tab');
    const list = await screen.findByRole('listbox', { name: 'Blocks' });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    expect(pm().querySelectorAll('table tr')).toHaveLength(3);
    expect(pm().querySelectorAll('table th')).toHaveLength(3);
  });

  it('moves with the arrow keys', async () => {
    const editor = open('head');
    await screen.findByRole('listbox', { name: 'Blocks' });
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });

  it('closes on Escape and leaves the slash in the text', async () => {
    const editor = open('he');
    await screen.findByRole('listbox', { name: 'Blocks' });
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(editor.getText()).toBe('/he');
  });

  it('shows nothing when no block matches', async () => {
    open('zzz');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});

describe('saving', () => {
  it('keeps the content over the size limit, and saves again once it fits', async () => {
    mocks.showToast.mockClear();
    const onSave = save();
    render(
      <DescriptionEditor
        boardId="b1"
        itemId="i1"
        initial={null}
        readOnly={false}
        onSave={onSave}
      />,
    );
    const editor = editorOf();
    const big = Array.from({ length: 300 }, () => `<p>${'x'.repeat(1000)}</p>`).join('');
    act(() => {
      editor.commands.insertContent(big);
    });
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalled(), { timeout: 3000 });
    expect(onSave).not.toHaveBeenCalled();
    expect(editor.getText().length).toBeGreaterThan(200_000);
    act(() => {
      editor.commands.setContent('<p>short again</p>', { emitUpdate: true });
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onSave.mock.calls[0]?.[0]?.text).toBe('short again');
  });
});

describe('expand', () => {
  it('moves the same editor into a dialog and back, with the same document', async () => {
    const user = userEvent.setup();
    const onSave = save();
    render(
      <DescriptionEditor
        boardId="b1"
        itemId="i1"
        initial={doc(text('Hello'))}
        readOnly={false}
        onSave={onSave}
      />,
    );
    const editor = editorOf();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    const dialog = await screen.findByRole('dialog', { name: 'Description' });
    expect(within(dialog).getByText('Hello')).toBeInTheDocument();
    expect(editorOf()).toBe(editor);
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' world');
    });
    expect(within(dialog).getByText('Hello world')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Description' })).toBeNull());
    expect(editorOf()).toBe(editor);
    expect(editor.getText()).toBe('Hello world');
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    // Collapsing flushes the pending edit through the one onSave.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]?.text).toBe('Hello world');
  });
});

describe('read-only rendering', () => {
  it('renders headings, tables and dividers without a toolbar', async () => {
    const cell = (type: string, t: string) => ({ type, content: [text(t)] });
    const { container } = render(
      <DescriptionEditor
        boardId="b1"
        itemId="i1"
        readOnly
        onSave={save()}
        initial={doc(
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [cell('tableHeader', 'Item'), cell('tableHeader', 'Qty')],
              },
              { type: 'tableRow', content: [cell('tableCell', 'Tea'), cell('tableCell', '2')] },
            ],
          },
          { type: 'horizontalRule' },
        )}
      />,
    );
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(2);
    expect(container.querySelector('hr')).not.toBeNull();
    expect(container.querySelector('h1')).toHaveTextContent('Title');
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
