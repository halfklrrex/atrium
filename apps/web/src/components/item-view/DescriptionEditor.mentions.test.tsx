import type { Editor } from '@tiptap/react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDoc, MemberDoc, WorkspaceDoc } from '../../data/model';
import { resetMembersStore, useMembersStore } from '../../data/members-store';
import { makeBoard, makeWorkspace, ts } from '../../test/fixtures';
import DescriptionEditor from './DescriptionEditor';
import { filterSlashItems } from './slash-menu/slash-controller';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data/members-source', () => ({ subscribeToMembers: () => () => undefined }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com' } }),
}));
vi.mock('../../data', () => ({
  useBoard: () => ({ data: mockBoard, loading: false, error: null }),
  useWorkspace: () => ({ data: mockWorkspace, loading: false, error: null }),
}));

const member = (id: string, displayName: string): MemberDoc => ({
  id,
  displayName,
  photoURL: null,
  email: `${id}@example.com`,
  role: 'member',
  joinedAt: ts(),
  updatedAt: ts(),
});

let mockBoard: BoardDoc;
let mockWorkspace: WorkspaceDoc;

beforeEach(() => {
  mockBoard = makeBoard({ id: 'b1', workspaceId: 'w1' });
  // u5 left the workspace: still a member doc, but without a role they cannot read the board.
  mockWorkspace = makeWorkspace({
    id: 'w1',
    roles: { u1: 'owner', u2: 'member', u3: 'member', u4: 'viewer' },
  });
  useMembersStore.setState({
    activeWorkspaceId: 'w1',
    byWorkspace: {
      w1: {
        loaded: true,
        error: null,
        members: [
          member('u1', 'Avery Quinn'),
          member('u2', 'Jamie Rowe'),
          member('u3', 'Jade Okafor'),
          member('u4', 'Sam Rivera'),
          member('u5', 'Jules Former'),
        ],
      },
    },
  });
});

afterEach(() => resetMembersStore());

const text = (t: string) => ({ type: 'text', text: t });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const chip = (id: string, label: string) => ({ type: 'mention', attrs: { id, label } });

const mount = (initial: Record<string, unknown> | null = null, readOnly = false) =>
  render(
    <DescriptionEditor
      boardId="b1"
      itemId="i1"
      initial={initial}
      readOnly={readOnly}
      onSave={vi.fn().mockResolvedValue(undefined)}
    />,
  );

const editorOf = (): Editor => {
  const dom = document.querySelector('.ProseMirror') as (HTMLElement & { editor: Editor }) | null;
  if (!dom) throw new Error('no editor');
  return dom.editor;
};
const pm = () => document.querySelector('.ProseMirror') as HTMLElement;

const typeInto = (editor: Editor, value: string) =>
  act(() => {
    editor.commands.focus();
    editor.commands.insertContent(value);
  });

const mentionsIn = (editor: Editor) => {
  const found: unknown[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'mention') found.push(node.attrs);
  });
  return found;
};

describe('@mentions in the description', () => {
  it('lists matching members for "@ja", leaving out people who cannot read the board', async () => {
    mount();
    typeInto(editorOf(), '@ja');
    const list = await screen.findByRole('listbox', { name: 'People' });
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Jade Okafor');
    expect(options[1]).toHaveTextContent('Jamie Rowe');
    expect(list).not.toHaveTextContent('Jules Former');
  });

  it('matches the email local part and shows every readable member for a bare "@"', async () => {
    mount();
    typeInto(editorOf(), '@u3');
    const list = await screen.findByRole('listbox', { name: 'People' });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(list).toHaveTextContent('Jade Okafor');
  });

  it('inserts the chip with the uid and label on Enter', async () => {
    mount();
    const editor = editorOf();
    typeInto(editor, 'Ask @ja');
    await screen.findByRole('listbox', { name: 'People' });
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' });
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    expect(mentionsIn(editor)).toEqual([
      expect.objectContaining({ id: 'u2', label: 'Jamie Rowe' }),
    ]);
    expect(pm().querySelector('span[data-type="mention"]')).toHaveTextContent('@Jamie Rowe');
    expect(pm().querySelector('span[data-type="mention"]')).toHaveAttribute('data-id', 'u2');
    expect(editor.getText()).toBe('Ask @Jamie Rowe ');
    expect(screen.queryByRole('listbox', { name: 'People' })).toBeNull();
    // Only the uid and the label are stored.
    expect(Object.keys(mentionsIn(editor)[0] as object).sort()).toEqual(['id', 'label']);
  });

  it('inserts on Tab and on a click', async () => {
    mount();
    const editor = editorOf();
    typeInto(editor, '@jad');
    await screen.findByRole('listbox', { name: 'People' });
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    expect(mentionsIn(editor)).toEqual([expect.objectContaining({ id: 'u3' })]);

    typeInto(editor, '@sam');
    fireEvent.click(await screen.findByRole('option', { name: /Sam Rivera/ }));
    expect(mentionsIn(editor)).toHaveLength(2);
  });

  it('closes on Escape without inserting', async () => {
    mount();
    const editor = editorOf();
    typeInto(editor, '@ja');
    await screen.findByRole('listbox', { name: 'People' });
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'People' })).toBeNull();
    expect(mentionsIn(editor)).toEqual([]);
  });

  it('says so when nobody matches, and Enter then inserts nothing', async () => {
    mount();
    const editor = editorOf();
    typeInto(editor, '@zzz');
    expect(await screen.findByText('No members found')).toBeInTheDocument();
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    expect(mentionsIn(editor)).toEqual([]);
  });

  it('does not open for an @ inside a word', () => {
    mount();
    typeInto(editorOf(), 'mail avery@ja');
    expect(screen.queryByRole('listbox', { name: 'People' })).toBeNull();
  });

  it('is atomic: one backspace removes the whole chip', () => {
    mount(doc(para(text('Hi '), chip('u2', 'Jamie Rowe'))));
    const editor = editorOf();
    act(() => {
      editor.commands.focus('end');
      editor.commands.keyboardShortcut('Backspace');
    });
    expect(mentionsIn(editor)).toEqual([]);
    expect(editor.getText()).toBe('Hi ');
  });

  it('keeps the attributes of a chip pasted from Atrium', () => {
    mount();
    const editor = editorOf();
    act(() => {
      editor.commands.insertContent(
        '<p><span data-type="mention" data-id="u2" data-label="Jamie Rowe">@Jamie Rowe</span></p>',
      );
    });
    expect(mentionsIn(editor)).toEqual([
      expect.objectContaining({ id: 'u2', label: 'Jamie Rowe' }),
    ]);
  });

  it('never creates a chip from foreign HTML without a data-id', () => {
    mount();
    const editor = editorOf();
    act(() => {
      editor.commands.insertContent('<p><span data-type="mention">@Ghost</span></p>');
      editor.commands.insertContent(
        '<p><span data-type="mention" data-id="">@Empty</span> <span class="tag">@Plain</span></p>',
      );
    });
    expect(mentionsIn(editor)).toEqual([]);
    expect(JSON.stringify(editor.getJSON())).not.toContain('"mention"');
  });

  it('shows chips to a read-only viewer, with no list', () => {
    mount(doc(para(text('Ask '), chip('u2', 'Jamie Rowe'))), true);
    expect(pm().querySelector('span[data-type="mention"]')).toHaveTextContent('@Jamie Rowe');
    typeInto(editorOf(), '@ja');
    expect(screen.queryByRole('listbox', { name: 'People' })).toBeNull();
  });

  it('offers a "Mention" entry in the "/" menu that opens the list', async () => {
    expect(filterSlashItems('mention').map((i) => i.id)).toContain('mention');
    mount();
    const editor = editorOf();
    typeInto(editor, '/ment');
    await screen.findByRole('listbox', { name: 'Blocks' });
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    expect(editor.state.doc.textContent).toBe('@');
    expect(await screen.findByRole('listbox', { name: 'People' })).toBeInTheDocument();
  });
});
