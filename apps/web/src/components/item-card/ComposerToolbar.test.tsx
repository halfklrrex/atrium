import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useEffect, useMemo } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MentionController } from '../item-view/mention/mention-controller';
import { ComposerInsertTools, ComposerToolbar } from './ComposerToolbar';
import { createComposerExtensions } from './composer-extensions';

const holder = { editor: undefined as unknown as Editor };

function Harness() {
  const mentionController = useMemo(() => new MentionController(), []);
  const instance = useEditor({
    extensions: createComposerExtensions({ mentionController, placeholder: 'Write' }),
    content: '<p>Hello world</p>',
    immediatelyRender: true,
  });
  useEffect(() => {
    if (instance) holder.editor = instance;
  });
  if (!instance) return null;
  return (
    <>
      <ComposerToolbar editor={instance} />
      <EditorContent editor={instance} />
      <ComposerInsertTools editor={instance} />
    </>
  );
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Text formatting' });
const tool = (name: string | RegExp) => within(toolbar()).getByRole('button', { name });
const selectAll = () => act(() => void holder.editor.commands.selectAll());
const firstBlock = () => holder.editor.getJSON().content?.[0] as Record<string, unknown>;

/** jsdom has no layout: give every box 30px and the toolbar the given width. */
function stubLayout(toolbarWidth: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(30);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(toolbarWidth);
}

afterEach(() => vi.restoreAllMocks());

describe('ComposerToolbar', () => {
  it('has icon buttons in monday order, and no emoji or mention button', () => {
    render(<Harness />);
    const names = within(toolbar())
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Text style: Normal text',
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Text colour and highlight',
      'Font size',
      'Numbered list',
      'Bulleted list',
      'Table',
      'Link',
      'Alignment',
      'Divider',
      'Text direction',
      'Checklist',
    ]);
    expect(within(toolbar()).queryByRole('button', { name: 'Emoji' })).toBeNull();
    // They live in the bottom row instead.
    expect(screen.getByRole('button', { name: 'Emoji' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mention someone' })).toBeInTheDocument();
  });

  it.each([
    ['Bold', 'bold'],
    ['Italic', 'italic'],
    ['Underline', 'underline'],
    ['Strikethrough', 'strike'],
  ])('%s toggles its mark', async (name, mark) => {
    render(<Harness />);
    selectAll();
    await userEvent.click(tool(name));
    expect(firstBlock().content).toEqual([
      expect.objectContaining({ marks: [expect.objectContaining({ type: mark })] }),
    ]);
    expect(tool(name)).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(tool(name));
    expect(tool(name)).toHaveAttribute('aria-pressed', 'false');
  });

  it.each([
    ['Numbered list', 'orderedList'],
    ['Bulleted list', 'bulletList'],
    ['Checklist', 'taskList'],
    ['Divider', 'horizontalRule'],
  ])('%s inserts a %s', async (name, type) => {
    render(<Harness />);
    await userEvent.click(tool(name));
    expect(holder.editor.getJSON().content?.map((n) => n.type)).toContain(type);
  });

  it('inserts a 3x3 table with a header row', async () => {
    render(<Harness />);
    await userEvent.click(tool('Table'));
    type Node = { type?: string; content?: Node[] };
    const table = (holder.editor.getJSON() as Node).content?.find((n) => n.type === 'table');
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
  });

  it('applies a link from the link popup', async () => {
    render(<Harness />);
    selectAll();
    await userEvent.click(tool('Link'));
    await userEvent.type(
      await screen.findByPlaceholderText('https://example.com'),
      'https://example.com{Enter}',
    );
    expect(JSON.stringify(holder.editor.getJSON())).toContain('"href":"https://example.com/"');
  });

  it('opens the text colour popup', async () => {
    render(<Harness />);
    await userEvent.click(tool('Text colour and highlight'));
    expect(tool('Text colour and highlight')).toHaveAttribute('aria-expanded', 'true');
  });

  it('flips the text direction', async () => {
    render(<Harness />);
    await userEvent.click(tool('Text direction'));
    expect(firstBlock().attrs).toMatchObject({ dir: 'rtl' });
    expect(tool('Text direction')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(tool('Text direction'));
    expect(firstBlock().attrs).toMatchObject({ dir: 'ltr' });
  });

  it('the paragraph menu has Normal text, Quote, Code and Header, and applies them', async () => {
    render(<Harness />);
    await userEvent.click(tool(/^Text style/));
    const menu = await screen.findByRole('menu', { name: 'Text style' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Normal text', 'Quote', 'Code', 'Header']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Header' }));
    expect(firstBlock()).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(tool(/^Text style/)).toHaveAccessibleName('Text style: Header');

    await userEvent.click(tool(/^Text style/));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Quote' }));
    await waitFor(() => expect(holder.editor.isActive('blockquote')).toBe(true));

    await userEvent.click(tool(/^Text style/));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Code' }));
    await waitFor(() => expect(holder.editor.isActive('codeBlock')).toBe(true));
  });

  it('the size menu sets a size key and Normal removes it', async () => {
    render(<Harness />);
    selectAll();
    await userEvent.click(tool('Font size'));
    const menu = await screen.findByRole('menu', { name: 'Font size' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((i) => i.textContent),
    ).toEqual(['Small', 'Normal', 'Large', 'Huge']);
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Large' }));
    expect(JSON.stringify(firstBlock())).toContain('"fontSize":"large"');

    await userEvent.click(tool('Font size'));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Normal' }));
    expect(JSON.stringify(firstBlock())).not.toContain('large');
  });

  it('the alignment menu aligns the block and the same choice clears it', async () => {
    render(<Harness />);
    await userEvent.click(tool('Alignment'));
    const menu = await screen.findByRole('menu', { name: 'Alignment' });
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3);
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Align centre' }));
    expect(firstBlock().attrs).toMatchObject({ align: 'center' });

    await userEvent.click(tool('Alignment'));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Align centre' }));
    expect(firstBlock().attrs).toMatchObject({ align: null });
  });

  it('keeps one tab stop and moves focus with the arrow, Home and End keys', () => {
    render(<Harness />);
    const buttons = within(toolbar()).getAllByRole('button');
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(buttons[0]).toHaveProperty('tabIndex', 0);

    act(() => buttons[0]!.focus());
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowRight' });
    expect(buttons[1]).toHaveFocus();
    // The tab stop follows the focus.
    expect(buttons[1]).toHaveProperty('tabIndex', 0);
    expect(buttons[0]).toHaveProperty('tabIndex', -1);

    fireEvent.keyDown(buttons[1]!, { key: 'End' });
    expect(buttons[buttons.length - 1]).toHaveFocus();
    fireEvent.keyDown(buttons[buttons.length - 1]!, { key: 'ArrowRight' });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowLeft' });
    expect(buttons[buttons.length - 1]).toHaveFocus();
    fireEvent.keyDown(buttons[buttons.length - 1]!, { key: 'Home' });
    expect(buttons[0]).toHaveFocus();
  });

  it('shows every tool and no More button when the row is wide enough', () => {
    stubLayout(2000);
    render(<Harness />);
    expect(within(toolbar()).getByRole('button', { name: 'Text direction' })).toBeInTheDocument();
    expect(within(toolbar()).queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('moves the first tools in the priority order into More when the row is narrow', async () => {
    // 15 tools + More at 30px: a 300px row holds 9 tools plus More.
    stubLayout(300);
    render(<Harness />);
    await waitFor(() =>
      expect(within(toolbar()).queryByRole('button', { name: 'Text direction' })).toBeNull(),
    );
    for (const gone of ['Checklist', 'Divider', 'Alignment']) {
      expect(within(toolbar()).queryByRole('button', { name: gone })).toBeNull();
    }
    for (const kept of ['Bold', 'Italic', 'Bulleted list']) {
      expect(within(toolbar()).getByRole('button', { name: kept })).toBeInTheDocument();
    }
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'More' }));
    for (const title of ['Text direction', 'Checklist', 'Divider', 'Alignment']) {
      expect(await screen.findByRole('menuitem', { name: title })).toBeInTheDocument();
    }
  });

  it('runs a hidden tool from the More menu', async () => {
    stubLayout(300);
    render(<Harness />);
    await waitFor(() =>
      expect(within(toolbar()).queryByRole('button', { name: 'Checklist' })).toBeNull(),
    );
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Checklist' }));
    // Vibe runs a menu item's click two animation frames later.
    await waitFor(() => expect(holder.editor.isActive('taskList')).toBe(true));
  });
});

describe('ComposerInsertTools', () => {
  it('@ types a mention trigger into the editor', async () => {
    render(<Harness />);
    act(() => void holder.editor.commands.focus('end'));
    await userEvent.click(screen.getByRole('button', { name: 'Mention someone' }));
    expect(holder.editor.getText()).toBe('Hello world @');
  });
});
