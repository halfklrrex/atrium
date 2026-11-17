import { DOC_BODY_MAX_BYTES } from '@atrium/shared';
import type { Editor } from '@tiptap/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc, makeWorkspace } from '../../test/fixtures';
import { useUiStore } from '../AppShell/ui-store';
import { DocPage } from './DocPage';

const mocks = vi.hoisted(() => ({
  doc: null as unknown,
  loading: false,
  role: 'owner' as string,
  body: null as unknown,
  saveBody: vi.fn(),
  readBody: vi.fn(),
  renameDoc: vi.fn(),
  restoreDoc: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, rememberWorkspace: vi.fn() }),
}));
vi.mock('../toast-store', () => ({ showToast: mocks.showToast }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useWorkspace: () => ({
    data: makeWorkspace({ id: 'w1', name: 'Family', roles: { u1: mocks.role as 'owner' } }),
    loading: false,
    error: null,
  }),
  useFolders: () => ({ data: [], loading: false, error: null }),
  useUserLookup: () => (uid: string) => (uid === 'u2' ? { name: 'Jordan Lee' } : undefined),
  useWorkspaceMembers: () => ({ members: [] }),
}));
vi.mock('../../data/presence', () => ({
  useBoardPresence: () => ({ activeViewers: [], loading: false }),
  useDocPresence: () => ({ activeViewers: [], loading: false }),
}));
vi.mock('../../data/docs', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useDocMeta: () => ({ data: mocks.doc, loading: mocks.loading, error: null }),
  useDocBodySnapshot: () => ({ data: mocks.body, loading: false, error: null }),
  docWrites: {
    saveBody: (...args: unknown[]) => mocks.saveBody(...args),
    readBodyFromServer: (...args: unknown[]) => mocks.readBody(...args),
    renameDoc: (...args: unknown[]) => mocks.renameDoc(...args),
    restoreDoc: (...args: unknown[]) => mocks.restoreDoc(...args),
    deleteDoc: vi.fn(),
  },
}));

const text = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const body = (rev: number, t: string, updatedBy = 'u2') => ({
  doc: { type: 'doc', content: [text(t)] },
  text: t,
  rev,
  updatedAt: { toMillis: () => Date.now() - 5 * 60_000 },
  updatedBy,
});

const editorOf = (): Editor =>
  (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;

function pageTree(path = '/docs/packing-list-doc1') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs/:docId" element={<DocPage />} />
        <Route path="*" element={<p>other page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage(path = '/docs/packing-list-doc1') {
  return render(pageTree(path));
}

/** Re-render with the (changed) mocked snapshot, as a live listener would. */
function rerenderPage(view: ReturnType<typeof render>) {
  view.rerender(pageTree());
}

beforeEach(() => {
  mocks.doc = makeDoc({ id: 'doc1', name: 'Packing list' });
  mocks.loading = false;
  mocks.role = 'owner';
  mocks.body = null;
  mocks.saveBody.mockReset().mockResolvedValue(1);
  mocks.readBody.mockReset().mockResolvedValue(null);
  mocks.renameDoc.mockReset().mockResolvedValue(undefined);
  mocks.restoreDoc.mockReset().mockResolvedValue(undefined);
  mocks.showToast.mockReset();
});

describe('DocPage', () => {
  it('shows a spinner while the doc loads', () => {
    mocks.loading = true;
    mocks.doc = null;
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the not-found page for a missing or unreadable doc', () => {
    mocks.doc = null;
    renderPage();
    expect(screen.getByText("We couldn't find that page")).toBeInTheDocument();
  });

  it('shows the not-found page when the user has no role on the doc', () => {
    mocks.doc = makeDoc({
      id: 'doc1',
      kind: 'private',
      access: { u9: 'owner' },
      accessUids: ['u9'],
    });
    renderPage();
    expect(screen.getByText("We couldn't find that page")).toBeInTheDocument();
  });

  it('shows Share to doc owners and opens the doc share dialog', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(useUiStore.getState().dialog).toEqual({ type: 'shareDoc', docId: 'doc1' });
  });

  it('hides Share from editors and from a doc in the trash', () => {
    mocks.doc = makeDoc({ id: 'doc1', name: 'Packing list', access: { u1: 'editor' } });
    const view = renderPage();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    view.unmount();
    mocks.doc = makeDoc({ id: 'doc1', name: 'Packing list', state: 'deleted' });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });

  it('renders the title, who edited last and the saved text', async () => {
    mocks.body = body(3, 'Passports and chargers');
    renderPage();
    expect(screen.getByRole('button', { name: /Doc title: Packing list/ })).toBeInTheDocument();
    expect(screen.getByText(/Last edited by Jordan Lee/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Passports and chargers')).toBeInTheDocument());
  });

  it('autosaves typing as rev 1 when the doc has no body yet', async () => {
    renderPage();
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull());
    act(() => {
      editorOf().commands.insertContent('Sunscreen');
    });
    await waitFor(() => expect(mocks.saveBody).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [docId, content, baseRev] = mocks.saveBody.mock.calls[0] as [
      string,
      { text: string },
      number,
    ];
    expect(docId).toBe('doc1');
    expect(content.text).toBe('Sunscreen');
    expect(baseRev).toBe(0);
  });

  it('saves on top of the stored rev', async () => {
    mocks.body = body(4, 'One');
    renderPage();
    await waitFor(() => expect(screen.getByText('One')).toBeInTheDocument());
    act(() => {
      editorOf().chain().focus('end').insertContent(' two').run();
    });
    await waitFor(() => expect(mocks.saveBody).toHaveBeenCalled(), { timeout: 3000 });
    expect(mocks.saveBody.mock.calls[0]?.[2]).toBe(4);
  });

  it('shows the conflict banner when a refused save finds a newer revision on the server', async () => {
    mocks.body = body(4, 'One');
    mocks.saveBody.mockRejectedValue({ code: 'permission-denied' });
    mocks.readBody.mockResolvedValue(body(5, 'Theirs'));
    renderPage();
    await waitFor(() => expect(screen.getByText('One')).toBeInTheDocument());
    act(() => {
      editorOf().chain().focus('end').insertContent(' two').run();
    });
    await waitFor(() => expect(screen.getByTestId('doc-conflict-banner')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Jordan Lee changed this doc');
    expect(mocks.readBody).toHaveBeenCalledWith('doc1');
    // Nothing is lost and nothing is retried behind the user's back.
    expect(editorOf().getText()).toContain('One two');
    act(() => {
      editorOf().chain().focus('end').insertContent(' three').run();
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(mocks.saveBody).toHaveBeenCalledTimes(1);
  });

  it('does not call a refusal a conflict when the server has no newer revision', async () => {
    mocks.body = body(4, 'One');
    mocks.saveBody.mockRejectedValue({ code: 'permission-denied' });
    mocks.readBody.mockResolvedValue(body(4, 'One'));
    renderPage();
    await waitFor(() => expect(screen.getByText('One')).toBeInTheDocument());
    act(() => {
      editorOf().chain().focus('end').insertContent(' two').run();
    });
    await waitFor(
      () =>
        expect(mocks.showToast).toHaveBeenCalledWith(
          "You can't save changes to this doc anymore. Copy your text if you need it.",
          { type: 'negative' },
        ),
      { timeout: 3000 },
    );
    expect(screen.queryByTestId('doc-conflict-banner')).not.toBeInTheDocument();
  });

  it('keeps the banner away when the server cannot be reached to confirm', async () => {
    mocks.body = body(4, 'One');
    mocks.saveBody.mockRejectedValue({ code: 'permission-denied' });
    mocks.readBody.mockRejectedValue({ code: 'unavailable' });
    renderPage();
    await waitFor(() => expect(screen.getByText('One')).toBeInTheDocument());
    act(() => {
      editorOf().chain().focus('end').insertContent(' two').run();
    });
    await waitFor(
      () =>
        expect(mocks.showToast).toHaveBeenCalledWith('Could not save the doc. Try again.', {
          type: 'negative',
        }),
      { timeout: 3000 },
    );
    expect(screen.queryByTestId('doc-conflict-banner')).not.toBeInTheDocument();
  });

  it('shows the banner when somebody saves while the user has unsaved edits', async () => {
    mocks.body = body(1, 'Before');
    const view = renderPage();
    await waitFor(() => expect(screen.getByText('Before')).toBeInTheDocument());
    act(() => {
      editorOf().chain().focus('end').insertContent(' mine').run();
    });
    mocks.body = body(2, 'Theirs');
    rerenderPage(view);
    await waitFor(() => expect(screen.getByTestId('doc-conflict-banner')).toBeInTheDocument());
    expect(editorOf().getText()).toContain('Before mine');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(mocks.saveBody).not.toHaveBeenCalled();
  });

  it('"Load their version" replaces my edits and saves nothing', async () => {
    mocks.body = body(1, 'Before');
    const view = renderPage();
    await waitFor(() => expect(screen.getByText('Before')).toBeInTheDocument());
    act(() => {
      editorOf().chain().focus('end').insertContent(' mine').run();
    });
    mocks.body = body(2, 'Theirs');
    rerenderPage(view);
    await userEvent.click(await screen.findByRole('button', { name: 'Load their version' }));
    await waitFor(() => expect(editorOf().getText()).toBe('Theirs'));
    expect(screen.queryByTestId('doc-conflict-banner')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(mocks.saveBody).not.toHaveBeenCalled();
    // Editing goes on from their revision.
    act(() => {
      editorOf().chain().focus('end').insertContent(' more').run();
    });
    await waitFor(() => expect(mocks.saveBody).toHaveBeenCalled(), { timeout: 3000 });
    expect(mocks.saveBody.mock.calls[0]?.[2]).toBe(2);
  });

  it('"Keep mine" asks first, then saves my text on top of their revision', async () => {
    mocks.body = body(1, 'Before');
    const view = renderPage();
    await waitFor(() => expect(screen.getByText('Before')).toBeInTheDocument());
    act(() => {
      editorOf().chain().focus('end').insertContent(' mine').run();
    });
    mocks.body = body(7, 'Theirs');
    rerenderPage(view);
    await userEvent.click(await screen.findByRole('button', { name: 'Keep mine' }));
    expect(screen.getByText('Their changes will be lost.')).toBeInTheDocument();
    expect(mocks.saveBody).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Keep mine' });
    await userEvent.click(buttons[buttons.length - 1] as HTMLElement);
    await waitFor(() => expect(mocks.saveBody).toHaveBeenCalledTimes(1));
    const [docId, content, baseRev] = mocks.saveBody.mock.calls[0] as [
      string,
      { text: string },
      number,
    ];
    expect(docId).toBe('doc1');
    expect(content.text).toBe('Before mine');
    expect(baseRev).toBe(7);
    await waitFor(() =>
      expect(screen.queryByTestId('doc-conflict-banner')).not.toBeInTheDocument(),
    );
  });

  it('"Copy my text" puts my text on the clipboard and keeps the banner', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mocks.body = body(1, 'Before');
    const view = renderPage();
    await waitFor(() => expect(screen.getByText('Before')).toBeInTheDocument());
    act(() => {
      editorOf().chain().focus('end').insertContent(' mine').run();
    });
    mocks.body = body(2, 'Theirs');
    rerenderPage(view);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy my text' }));
    expect(writeText).toHaveBeenCalledWith('Before mine');
    expect(screen.getByTestId('doc-conflict-banner')).toBeInTheDocument();
  });

  it('refuses to save a doc over the size cap and keeps the text', async () => {
    renderPage();
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull());
    act(() => {
      editorOf().commands.insertContent('x'.repeat(DOC_BODY_MAX_BYTES + 10));
    });
    await waitFor(
      () =>
        expect(mocks.showToast).toHaveBeenCalledWith(
          'This doc is too long to save. Split it into two docs.',
          { type: 'negative' },
        ),
      { timeout: 3000 },
    );
    expect(mocks.saveBody).not.toHaveBeenCalled();
    expect(editorOf().getText().length).toBeGreaterThan(DOC_BODY_MAX_BYTES);
  });

  it("shows another member's newer save when there are no unsaved edits", async () => {
    mocks.body = body(1, 'Before');
    const view = renderPage();
    await waitFor(() => expect(screen.getByText('Before')).toBeInTheDocument());
    mocks.body = body(2, 'After');
    view.rerender(
      <MemoryRouter initialEntries={['/docs/packing-list-doc1']}>
        <Routes>
          <Route path="/docs/:docId" element={<DocPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('After')).toBeInTheDocument());
    expect(mocks.saveBody).not.toHaveBeenCalled();
  });

  it('renames from the title', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Doc title/ }));
    const input = screen.getByRole('textbox', { name: 'Doc title' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Beach list{Enter}');
    expect(mocks.renameDoc).toHaveBeenCalledWith('doc1', 'Beach list');
  });

  it('is read-only for a viewer: no title button, no toolbar, an uneditable body', async () => {
    mocks.role = 'viewer';
    mocks.doc = makeDoc({ id: 'doc1', name: 'Packing list', access: { u1: 'viewer' } });
    mocks.body = body(1, 'Look only');
    renderPage();
    await waitFor(() => expect(screen.getByText('Look only')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Doc title/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(editorOf().isEditable).toBe(false);
  });

  it('shows the trash banner, a read-only body and Restore for an owner', async () => {
    mocks.doc = makeDoc({ id: 'doc1', name: 'Packing list', state: 'deleted' });
    mocks.body = body(1, 'Gone');
    renderPage();
    expect(screen.getByText('This doc is in the trash')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Gone')).toBeInTheDocument());
    expect(editorOf().isEditable).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(mocks.restoreDoc).toHaveBeenCalledWith('doc1');
  });

  it('hides Restore from an editor', () => {
    mocks.doc = makeDoc({
      id: 'doc1',
      state: 'deleted',
      access: { u1: 'editor' },
    });
    renderPage();
    expect(screen.getByText('This doc is in the trash')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });
});
