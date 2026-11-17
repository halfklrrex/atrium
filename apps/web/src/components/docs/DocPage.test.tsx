import type { Editor } from '@tiptap/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc, makeWorkspace } from '../../test/fixtures';
import { DocPage } from './DocPage';

const mocks = vi.hoisted(() => ({
  doc: null as unknown,
  loading: false,
  role: 'owner' as string,
  body: null as unknown,
  saveBody: vi.fn(),
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
vi.mock('../../data/docs', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useDocMeta: () => ({ data: mocks.doc, loading: mocks.loading, error: null }),
  useDocBodySnapshot: () => ({ data: mocks.body, loading: false, error: null }),
  docWrites: {
    saveBody: (...args: unknown[]) => mocks.saveBody(...args),
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

function renderPage(path = '/docs/packing-list-doc1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs/:docId" element={<DocPage />} />
        <Route path="*" element={<p>other page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.doc = makeDoc({ id: 'doc1', name: 'Packing list' });
  mocks.loading = false;
  mocks.role = 'owner';
  mocks.body = null;
  mocks.saveBody.mockReset().mockResolvedValue(1);
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
      editorOf().commands.insertContent(' two');
    });
    await waitFor(() => expect(mocks.saveBody).toHaveBeenCalled(), { timeout: 3000 });
    expect(mocks.saveBody.mock.calls[0]?.[2]).toBe(4);
  });

  it('tells the user to reload when the rules refuse a stale save, and stops saving', async () => {
    mocks.body = body(4, 'One');
    mocks.saveBody.mockRejectedValue({ code: 'permission-denied' });
    renderPage();
    await waitFor(() => expect(screen.getByText('One')).toBeInTheDocument());
    act(() => {
      editorOf().commands.insertContent(' two');
    });
    await waitFor(
      () =>
        expect(mocks.showToast).toHaveBeenCalledWith(
          'This doc changed. Reload to see the latest version.',
          { type: 'negative' },
        ),
      { timeout: 3000 },
    );
    act(() => {
      editorOf().commands.insertContent(' three');
    });
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(mocks.saveBody).toHaveBeenCalledTimes(1);
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
