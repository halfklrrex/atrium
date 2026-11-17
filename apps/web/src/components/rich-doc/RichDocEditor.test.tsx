import type { Editor } from '@tiptap/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RichDocEditor } from './RichDocEditor';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../toast-store', () => ({ showToast: vi.fn() }));

const text = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const doc = (t: string) => ({ type: 'doc', content: [text(t)] });
const editorOf = (): Editor =>
  (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;

describe('RichDocEditor', () => {
  it('hides the image tool when no image adapter is given, and shows it with one', async () => {
    const view = render(<RichDocEditor initial={null} readOnly={false} onSave={vi.fn()} />);
    await screen.findByRole('toolbar');
    expect(screen.queryByRole('button', { name: 'Image' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add images')).not.toBeInTheDocument();
    view.unmount();
    render(
      <RichDocEditor
        initial={null}
        readOnly={false}
        onSave={vi.fn()}
        images={{ boardId: 'b1', itemId: 'i1' }}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Image' })).toBeInTheDocument();
    expect(screen.getByLabelText('Add images')).toBeInTheDocument();
  });

  it('can hide the expand button', async () => {
    render(<RichDocEditor initial={null} readOnly={false} onSave={vi.fn()} canExpand={false} />);
    await screen.findByRole('toolbar');
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument();
  });

  it('saves with the given builder and tells the host about edits', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onEdit = vi.fn();
    const buildValue = vi.fn((d: Record<string, unknown>) => ({
      ok: true as const,
      value: { doc: d, text: 'built' },
    }));
    render(
      <RichDocEditor
        initial={doc('Hi')}
        readOnly={false}
        onSave={onSave}
        onEdit={onEdit}
        buildValue={buildValue}
      />,
    );
    await screen.findByText('Hi');
    act(() => {
      editorOf().commands.insertContent(' there');
    });
    expect(onEdit).toHaveBeenCalled();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ text: 'built' });
  });

  it('flushes a pending save when the tab is closed or hidden', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RichDocEditor initial={doc('Hi')} readOnly={false} onSave={onSave} />);
    await screen.findByText('Hi');
    act(() => {
      editorOf().commands.insertContent('!');
    });
    expect(onSave).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows external content without saving it', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <RichDocEditor
        initial={doc('Before')}
        readOnly={false}
        onSave={onSave}
        external={{ key: 0, doc: null }}
      />,
    );
    await screen.findByText('Before');
    view.rerender(
      <RichDocEditor
        initial={doc('Before')}
        readOnly={false}
        onSave={onSave}
        external={{ key: 1, doc: doc('After') }}
      />,
    );
    await screen.findByText('After');
    await new Promise((r) => setTimeout(r, 1000));
    expect(onSave).not.toHaveBeenCalled();
  });
});
