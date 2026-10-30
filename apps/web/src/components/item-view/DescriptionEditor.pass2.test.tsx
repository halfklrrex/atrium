import { Editor } from '@tiptap/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DescriptionEditor from './DescriptionEditor';
import { clearDescriptionImageUrlCache } from './description-image-url';
import { stripTransientNodes, docToText } from './description';
import { collectFontKeys, ensureFontLoaded, fontStylesheetUrl } from './editor-fonts';
import { createEditorExtensions } from './editor-extensions';
import { loadRecentEmoji, RECENT_EMOJI_KEY, searchEmojis } from './emoji-data';
import { filterSlashItems, SlashController } from './slash-menu/slash-controller';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  getUrl: vi.fn(),
  requestUpload: vi.fn(),
  finalize: vi.fn(),
  uploadImages: vi.fn(),
  putWithProgress: vi.fn(),
}));
vi.mock('../toast-store', () => ({ showToast: mocks.showToast }));
vi.mock('../../lib/callables', () => ({
  descriptionImageCalls: {
    getUrl: mocks.getUrl,
    requestUpload: mocks.requestUpload,
    finalize: mocks.finalize,
  },
  describeCallableError: (_error: unknown, fallback: string) => fallback,
}));
vi.mock('./description-image-upload', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    uploadDescriptionImages: mocks.uploadImages,
    putWithProgress: mocks.putWithProgress,
  };
});

const text = (t: string, marks?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const save = () => vi.fn().mockResolvedValue(undefined);

const editorOf = (): Editor => {
  const dom = document.querySelector('.ProseMirror') as (HTMLElement & { editor: Editor }) | null;
  if (!dom) throw new Error('no editor');
  return dom.editor;
};
const pm = () => document.querySelector('.ProseMirror') as HTMLElement;

function typeText(editor: Editor, value: string) {
  for (const ch of value) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

const mount = (
  initial: Record<string, unknown> | null = doc(para(text('Hello'))),
  readOnly = false,
) =>
  render(
    <DescriptionEditor
      boardId="b1"
      itemId="i1"
      initial={initial}
      readOnly={readOnly}
      onSave={save()}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  clearDescriptionImageUrlCache();
  document.head.querySelectorAll('link[data-atrium-font]').forEach((l) => l.remove());
  window.localStorage.clear();
});

describe('text colour and highlight', () => {
  it('sets a palette key and renders data-color and data-highlight, never a style', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      editorOf().commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: 'Text colour and highlight' }));
    const popup = await screen.findByRole('dialog', { name: 'Colours' });
    await user.click(
      within(within(popup).getByRole('group', { name: 'Text colour' })).getByRole('button', {
        name: 'Red',
      }),
    );
    const colored = pm().querySelector('span[data-color]');
    expect(colored).toHaveAttribute('data-color', 'red');
    expect(colored).toHaveClass('atrium-text-red');
    expect(colored?.getAttribute('style')).toBeNull();

    act(() => {
      editorOf().commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: 'Text colour and highlight' }));
    const second = await screen.findByRole('dialog', { name: 'Colours' });
    // The current text colour is marked.
    expect(
      within(within(second).getByRole('group', { name: 'Text colour' })).getByRole('button', {
        name: 'Red',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(
      within(within(second).getByRole('group', { name: 'Highlight' })).getByRole('button', {
        name: 'Blue',
      }),
    );
    const mark = pm().querySelector('mark');
    expect(mark).toHaveAttribute('data-highlight', 'blue');
    expect(mark).toHaveClass('atrium-highlight-blue');
    expect(mark?.getAttribute('style')).toBeNull();
    expect(JSON.stringify(editorOf().getJSON())).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|"style"/i);
  });

  it('Default removes the colour and leaves no empty text-style mark', async () => {
    const user = userEvent.setup();
    mount(doc(para(text('Hi', [{ type: 'textStyle', attrs: { color: 'green' } }]))));
    act(() => {
      editorOf().commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: 'Text colour and highlight' }));
    const popup = await screen.findByRole('dialog', { name: 'Colours' });
    await user.click(
      within(within(popup).getByRole('group', { name: 'Text colour' })).getByRole('button', {
        name: 'Default',
      }),
    );
    expect(pm().querySelector('span[data-color]')).toBeNull();
    expect(JSON.stringify(editorOf().getJSON())).not.toContain('textStyle');
  });

  it('keeps the text and drops the colour of pasted inline styles', () => {
    mount();
    const editor = editorOf();
    const paste = Object.assign(new Event('paste'), {
      clipboardData: { getData: () => '', files: [] },
    });
    act(() => {
      editor.view.pasteHTML(
        '<p><span style="color:#f00;font-family:Comic Sans MS">Pasted</span> <mark style="background:#0f0">marked</mark></p>',
        paste as never,
      );
    });
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('Pasted');
    expect(json).not.toContain('textStyle');
    expect(json).not.toMatch(/#f00|#0f0|Comic/i);
    // A foreign <mark> becomes a keyed highlight with the default key.
    expect(
      editor
        .getJSON()
        .content?.[0]?.content?.some((n) =>
          n.marks?.some((m) => m.type === 'highlight' && m.attrs?.color === 'yellow'),
        ),
    ).toBe(true);
  });

  it('clears colour, highlight and font with Clear formatting', async () => {
    const user = userEvent.setup();
    mount(
      doc(
        para(
          text('Styled', [
            { type: 'textStyle', attrs: { color: 'red', fontFamily: 'lora' } },
            { type: 'highlight', attrs: { color: 'blue' } },
          ]),
        ),
      ),
    );
    act(() => {
      editorOf().commands.selectAll();
    });
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Clear formatting' }));
    await waitFor(() =>
      expect(JSON.stringify(editorOf().getJSON())).not.toMatch(/textStyle|highlight/),
    );
    expect(pm()).toHaveTextContent('Styled');
  });
});

describe('font picker', () => {
  it('sets the font key, shows it, and loads its stylesheet once per family', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      editorOf().commands.selectAll();
    });
    const trigger = screen.getByRole('button', { name: /^Font/ });
    expect(trigger).toHaveAccessibleName('Font: Default');
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitemradio', { name: 'Lora' }));
    const span = pm().querySelector('span[data-font]');
    expect(span).toHaveAttribute('data-font', 'lora');
    expect(span).toHaveClass('atrium-font-lora');
    expect(trigger).toHaveAccessibleName('Font: Lora');
    expect(document.head.querySelectorAll('link[data-atrium-font="lora"]')).toHaveLength(1);

    act(() => {
      editorOf().commands.selectAll();
    });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitemradio', { name: 'Default' }));
    expect(pm().querySelector('span[data-font]')).toBeNull();
    expect(JSON.stringify(editorOf().getJSON())).not.toContain('textStyle');
  });

  it('ensureFontLoaded injects one link per family and skips the preloaded Figtree', () => {
    ensureFontLoaded('caveat');
    ensureFontLoaded('caveat');
    ensureFontLoaded('figtree');
    ensureFontLoaded('default');
    const links = document.head.querySelectorAll('link[data-atrium-font]');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('fonts.googleapis.com'));
    expect(fontStylesheetUrl('figtree')).toBeNull();
    expect(fontStylesheetUrl('lora')).toContain('family=Lora:ital,wght@0,400;0,700;1,400;1,700');
  });

  it('loads the fonts a doc uses when the editor opens', () => {
    const initial = doc(para(text('Mono', [{ type: 'textStyle', attrs: { fontFamily: 'mono' } }])));
    expect(collectFontKeys(initial)).toEqual(new Set(['mono']));
    mount(initial, true);
    expect(document.head.querySelector('link[data-atrium-font="mono"]')).not.toBeNull();
  });
});

describe('emoji', () => {
  it('inserts an emoji from the picker and remembers it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Emoji' }));
    const picker = await screen.findByRole('dialog', { name: 'Emoji' });
    await user.click(within(picker).getByRole('button', { name: 'grinning' }));
    expect(pm().querySelector('[data-type="emoji"]')).toHaveTextContent('😀');
    expect(JSON.stringify(editorOf().getJSON())).toContain('"name":"grinning"');
    expect(loadRecentEmoji().map((e) => e.name)).toEqual(['grinning']);
    expect(window.localStorage.getItem(RECENT_EMOJI_KEY)).toContain('grinning');
  });

  it('searches in the picker and lists recently used emoji first', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(['rocket']));
    mount();
    await user.click(screen.getByRole('button', { name: 'Emoji' }));
    const picker = await screen.findByRole('dialog', { name: 'Emoji' });
    expect(within(picker).getByRole('group', { name: 'Recently used' })).toBeInTheDocument();
    expect(within(picker).getAllByRole('tab')).toHaveLength(9);
    // One accessible name, and no visible label repeating the placeholder.
    const search = within(picker).getByLabelText('Search emoji');
    expect(search).toHaveAttribute('placeholder', 'Search emoji');
    expect(picker.querySelectorAll('label')).toHaveLength(0);
    expect(within(picker).queryByText('Search emoji')).not.toBeInTheDocument();
    await user.type(search, 'rocket');
    const results = within(picker).getByRole('group', { name: 'Search results' });
    expect(within(results).getByRole('button', { name: 'rocket' })).toBeInTheDocument();
  });

  it('suggests after ":" plus two characters, and inserts the chosen emoji', async () => {
    mount(null);
    const editor = editorOf();
    act(() => {
      editor.commands.focus();
      editor.commands.insertContent(':s');
    });
    expect(screen.queryByRole('listbox', { name: 'Emoji' })).toBeNull();
    act(() => {
      editor.commands.insertContent('mi');
    });
    const list = await screen.findByRole('listbox', { name: 'Emoji' });
    expect(within(list).getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.click(within(list).getByText('smile'));
    expect(JSON.stringify(editor.getJSON())).toContain('"name":"smile"');
    expect(editor.state.doc.textContent).not.toContain(':smi');
  });

  it('opens the picker from the "/" menu', async () => {
    mount(null);
    const editor = editorOf();
    act(() => {
      editor.commands.focus();
      editor.commands.insertContent('/emoj');
    });
    await screen.findByRole('listbox', { name: 'Blocks' });
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Emoji' })).toBeInTheDocument();
    expect(editor.state.doc.textContent).toBe('');
  });

  it('turns :shortcode: into an emoji', () => {
    const editor = new Editor({ extensions: createEditorExtensions(new SlashController()) });
    typeText(editor, ':smile:');
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"emoji"');
    expect(editor.getText()).toContain('😄');
  });

  it('finds emoji by name and tag, and the "/" menu offers Emoji and Image', () => {
    expect(searchEmojis('thumbsup').length).toBeGreaterThan(0);
    expect(filterSlashItems('emoji').map((i) => i.id)).toContain('emoji');
    expect(filterSlashItems('image').map((i) => i.id)).toContain('image');
  });
});

describe('description images', () => {
  const imageDoc = doc({ type: 'image', attrs: { fileId: 'img1', alt: 'A chart', width: 50 } });
  const farFuture = () => Date.now() + 60 * 60 * 1000;

  it('goes from loading to ready, and resolves the URL through the callable', async () => {
    let resolve!: (v: { url: string; expiresAt: number }) => void;
    mocks.getUrl.mockReturnValue(new Promise((r) => (resolve = r)));
    mount(imageDoc, true);
    expect(await screen.findByRole('status', { name: 'Loading image' })).toBeInTheDocument();
    expect(mocks.getUrl).toHaveBeenCalledWith({ boardId: 'b1', itemId: 'i1', fileId: 'img1' });
    await act(async () =>
      resolve({ url: 'https://files.example.com/a.png', expiresAt: farFuture() }),
    );
    const img = await screen.findByRole('img', { name: 'A chart' });
    expect(img).toHaveAttribute('src', 'https://files.example.com/a.png');
    // The doc stores the id, never a src; read-only viewers get no resize handle.
    expect(JSON.stringify(editorOf().getJSON())).not.toContain('files.example.com');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(img.closest('[data-node-view-wrapper]')).toHaveStyle({ width: '50%' });
  });

  it('refreshes once when the image fails to load, then shows it as unavailable', async () => {
    mocks.getUrl
      .mockResolvedValueOnce({ url: 'https://files.example.com/old.png', expiresAt: farFuture() })
      .mockResolvedValueOnce({ url: 'https://files.example.com/new.png', expiresAt: farFuture() })
      .mockResolvedValue({ url: 'https://files.example.com/bad.png', expiresAt: farFuture() });
    mount(imageDoc, true);
    const first = await screen.findByRole('img', { name: 'A chart' });
    expect(first).toHaveAttribute('src', 'https://files.example.com/old.png');
    act(() => {
      first.dispatchEvent(new Event('error'));
    });
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'A chart' })).toHaveAttribute(
        'src',
        'https://files.example.com/new.png',
      ),
    );
    expect(mocks.getUrl).toHaveBeenCalledTimes(2);
    act(() => {
      screen.getByRole('img', { name: 'A chart' }).dispatchEvent(new Event('error'));
    });
    expect(await screen.findByRole('img', { name: 'Image unavailable' })).toBeInTheDocument();
    expect(mocks.getUrl).toHaveBeenCalledTimes(2);
  });

  it('shows "Image unavailable" when the URL cannot be resolved', async () => {
    mocks.getUrl.mockRejectedValue(new Error('not-found'));
    mount(imageDoc, true);
    expect(await screen.findByRole('img', { name: 'Image unavailable' })).toHaveTextContent(
      'Image unavailable',
    );
  });

  it('resizes with the keyboard in an editable editor, within 25 to 100 percent', async () => {
    const user = userEvent.setup();
    mocks.getUrl.mockResolvedValue({
      url: 'https://files.example.com/a.png',
      expiresAt: farFuture(),
    });
    mount(doc({ type: 'image', attrs: { fileId: 'img1', alt: '', width: 30 } }));
    await screen.findByRole('img', { name: 'Image in the description' });
    act(() => {
      editorOf().commands.setNodeSelection(0);
    });
    const handle = await screen.findByRole('slider', { name: 'Resize image' });
    handle.focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(editorOf().getJSON().content?.[0]?.attrs?.width).toBe(25);
    await user.keyboard('{ArrowRight}');
    expect(editorOf().getJSON().content?.[0]?.attrs?.width).toBe(30);
  });

  it('starts an upload when an image file is pasted or picked', async () => {
    const user = userEvent.setup();
    mount();
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const editor = editorOf();
    const preventDefault = vi.fn();
    const handled = editor.view.someProp('handlePaste', (f) =>
      f(editor.view, { clipboardData: { files: [file] }, preventDefault } as never, null as never),
    );
    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(mocks.uploadImages).toHaveBeenCalledWith(expect.anything(), [file], {
      boardId: 'b1',
      itemId: 'i1',
    });

    // A paste without images is left to the editor.
    expect(
      editor.view.someProp('handlePaste', (f) =>
        f(
          editor.view,
          { clipboardData: { files: [], getData: () => '' }, preventDefault: vi.fn() } as never,
          null as never,
        ),
      ),
    ).not.toBe(true);

    await user.upload(screen.getByTestId('description-image-input'), file);
    expect(mocks.uploadImages).toHaveBeenCalledTimes(2);
  });

  it('refuses non-images from the picker with a message', async () => {
    mount();
    const bad = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const input = screen.getByTestId('description-image-input') as HTMLInputElement;
    // userEvent.upload honours accept, so fire the change directly.
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('PNG'), {
      type: 'negative',
    });
    expect(mocks.uploadImages).not.toHaveBeenCalled();
  });

  it('offers the image button in the toolbar after Link and before Emoji', () => {
    mount();
    const names = within(screen.getByRole('toolbar', { name: 'Description formatting' }))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    const at = (n: string) => names.indexOf(n);
    expect(at('Link')).toBeLessThan(at('Image'));
    expect(at('Image')).toBeLessThan(at('Emoji'));
    expect(at('Emoji')).toBeLessThan(at('More'));
    expect(at('Text style: Normal text')).toBeLessThan(at('Font: Default'));
    expect(at('Strikethrough')).toBeLessThan(at('Text colour and highlight'));
    expect(at('Text colour and highlight')).toBeLessThan(at('Bulleted list'));
  });
});

describe('description helpers', () => {
  it('counts image alt text and emoji in the plain text', () => {
    const d = doc(para(text('Hi '), { type: 'emoji', attrs: { name: 'smile' } }), {
      type: 'image',
      attrs: { fileId: 'a', alt: 'Roadmap' },
    });
    const t = docToText(d);
    expect(t).toContain('Hi');
    expect(t).toContain(':smile:');
    expect(t).toContain('Roadmap');
  });

  it('drops upload placeholders before saving', () => {
    const d = doc(para(text('Keep')), { type: 'imageUpload', attrs: { uploadId: 'u1' } });
    expect(JSON.stringify(stripTransientNodes(d))).not.toContain('imageUpload');
    expect(JSON.stringify(stripTransientNodes(d))).toContain('Keep');
  });
});
