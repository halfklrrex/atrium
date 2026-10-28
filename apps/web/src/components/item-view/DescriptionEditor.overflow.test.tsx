import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DescriptionEditor from './DescriptionEditor';

vi.mock('../toast-store', () => ({ showToast: vi.fn() }));

const doc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
};
const pm = () => document.querySelector('.ProseMirror') as HTMLElement;

/** jsdom has no layout: give every box 30px and the toolbar the given width. */
function stubLayout(toolbarWidth: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(30);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(toolbarWidth);
}

const mount = () =>
  render(
    <DescriptionEditor
      boardId="b1"
      itemId="i1"
      initial={doc}
      readOnly={false}
      onSave={vi.fn().mockResolvedValue(undefined)}
    />,
  );

afterEach(() => vi.restoreAllMocks());

describe('toolbar overflow', () => {
  it('shows every tool when the row is wide enough', async () => {
    stubLayout(2000);
    mount();
    const bar = await screen.findByRole('toolbar', { name: 'Description formatting' });
    expect(within(bar).getByRole('button', { name: 'Image' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Bold' })).toBeInTheDocument();
  });

  it('moves the first tools in the priority order into More when the row is narrow', async () => {
    // 15 tools + More + Expand + 4 separators at 30px: a 400px row holds 7 of the 15 tools.
    stubLayout(400);
    const user = userEvent.setup();
    mount();
    const bar = await screen.findByRole('toolbar', { name: 'Description formatting' });
    await waitFor(() =>
      expect(within(bar).queryByRole('button', { name: 'Image' })).not.toBeInTheDocument(),
    );
    for (const gone of ['Emoji', 'Link', 'Undo', 'Redo', 'Checklist']) {
      expect(within(bar).queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
    for (const kept of ['Bold', 'Italic', 'Underline', 'Bulleted list']) {
      expect(within(bar).getByRole('button', { name: kept })).toBeInTheDocument();
    }
    expect(within(bar).getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Expand' })).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'More' }));
    for (const title of ['Image', 'Emoji', 'Link', 'Undo', 'Redo', 'Checklist', 'Font']) {
      expect(await screen.findByRole('menuitem', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('menuitem', { name: 'Table' })).toBeInTheDocument();
  });

  it('runs a hidden tool from the More menu', async () => {
    stubLayout(400);
    const user = userEvent.setup();
    mount();
    const bar = await screen.findByRole('toolbar', { name: 'Description formatting' });
    await waitFor(() =>
      expect(within(bar).queryByRole('button', { name: 'Checklist' })).not.toBeInTheDocument(),
    );
    await user.click(within(bar).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Checklist' }));
    // Vibe runs a menu item's click two animation frames later.
    await waitFor(() => expect(pm().querySelector('ul[data-type="taskList"]')).not.toBeNull());
  });

  it('opens the font menu from More for a hidden Font tool', async () => {
    stubLayout(400);
    const user = userEvent.setup();
    mount();
    const bar = await screen.findByRole('toolbar', { name: 'Description formatting' });
    await waitFor(() =>
      expect(within(bar).queryByRole('button', { name: /^Font/ })).not.toBeInTheDocument(),
    );
    await user.click(within(bar).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Font' }));
    expect(await screen.findByRole('menuitemradio', { name: 'Lora' })).toBeInTheDocument();
  });
});
