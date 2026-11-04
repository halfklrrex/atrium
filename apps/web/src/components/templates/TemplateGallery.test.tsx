import { BUILT_IN_TEMPLATES } from '@atrium/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ts } from '../../test/fixtures';
import { TemplateGallery } from './TemplateGallery';
import type { TemplateChoice } from './template-choice';

const mocks = vi.hoisted(() => ({
  templates: { data: [] as unknown[], loading: false, error: null as unknown },
  role: 'owner' as string,
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../toast-store', () => ({ showToast: mocks.showToast }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useTemplates: () => mocks.templates,
  useWorkspace: () => ({
    data: { roles: { u1: mocks.role } },
    loading: false,
    error: null,
  }),
  writes: { updateTemplate: mocks.updateTemplate, deleteTemplate: mocks.deleteTemplate },
}));

const structure = BUILT_IN_TEMPLATES[0]!.structure;
const saved = (id: string, name: string, createdBy: string) => ({
  id,
  name,
  description: `${name} description`,
  structure,
  sampleItems: [],
  itemCount: 3,
  createdBy,
  createdAt: ts(),
  updatedAt: ts(),
});

function Harness({ onPick }: { onPick?: (c: TemplateChoice | null) => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [include, setInclude] = useState(true);
  return (
    <MemoryRouter>
      <TemplateGallery
        workspaceId="w1"
        selectedKey={key}
        onSelect={(c) => {
          setKey(c?.key ?? null);
          onPick?.(c);
        }}
        includeSampleItems={include}
        onIncludeSampleItemsChange={setInclude}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mocks.templates = { data: [], loading: false, error: null };
  mocks.role = 'owner';
  mocks.updateTemplate.mockReset().mockResolvedValue(undefined);
  mocks.deleteTemplate.mockReset().mockResolvedValue(undefined);
  mocks.showToast.mockReset();
});

describe('TemplateGallery', () => {
  it('lists the built-in templates with sample counts and column chips', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Built-in' })).toBeInTheDocument();
    for (const t of BUILT_IN_TEMPLATES) {
      expect(screen.getByRole('radio', { name: new RegExp(t.name) })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/^Includes \d+ sample items?$/).length).toBeGreaterThan(0);
    expect(screen.getByText('No saved templates yet')).toBeInTheDocument();
  });

  it('selects a card on click and moves the selection with the arrow keys', async () => {
    render(<Harness />);
    const [first, second] = BUILT_IN_TEMPLATES;
    const firstCard = screen.getByRole('radio', { name: new RegExp(first!.name) });
    expect(firstCard).toHaveAttribute('tabindex', '0');
    await userEvent.click(firstCard);
    expect(firstCard).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowRight}');
    const secondCard = screen.getByRole('radio', { name: new RegExp(second!.name) });
    await waitFor(() => expect(secondCard).toHaveFocus());
    expect(secondCard).toHaveAttribute('aria-checked', 'true');
    expect(firstCard).toHaveAttribute('tabindex', '-1');
  });

  it('shows saved templates, loading and error states', () => {
    mocks.templates = { data: [], loading: true, error: null };
    const first = render(<Harness />);
    expect(screen.getByText('Loading saved templates…')).toBeInTheDocument();
    first.unmount();
    mocks.templates = { data: [], loading: false, error: new Error('x') };
    const second = render(<Harness />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the saved templates');
    // Built-ins still work.
    expect(screen.getAllByRole('radio').length).toBe(BUILT_IN_TEMPLATES.length);
    second.unmount();
    mocks.templates = { data: [saved('s1', 'Weekly review', 'u1')], loading: false, error: null };
    render(<Harness />);
    expect(screen.getByRole('radio', { name: /Weekly review/ })).toBeInTheDocument();
  });

  it('adds a search box above six templates and filters by name', async () => {
    mocks.templates = {
      data: [saved('s1', 'Weekly review', 'u1'), saved('s2', 'Sprint plan', 'u1')],
      loading: false,
      error: null,
    };
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Search templates'), 'sprint');
    expect(screen.getByRole('radio', { name: /Sprint plan/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Weekly review/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search templates'));
    await userEvent.type(screen.getByLabelText('Search templates'), 'zzzz');
    expect(screen.getByText('No templates match your search')).toBeInTheDocument();
  });

  it('lets the creator rename and delete (with a confirm) but not other members', async () => {
    mocks.role = 'member';
    mocks.templates = {
      data: [saved('s1', 'Mine', 'u1'), saved('s2', 'Theirs', 'u2')],
      loading: false,
      error: null,
    };
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Rename Theirs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Theirs' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Rename Mine' }));
    const input = screen.getAllByLabelText('Template name').find((e) => e.tagName === 'INPUT')!;
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.updateTemplate).toHaveBeenCalledWith('w1', 's1', {
        name: 'Renamed',
        description: 'Mine description',
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete Mine' }));
    expect(mocks.deleteTemplate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete template' }));
    await waitFor(() => expect(mocks.deleteTemplate).toHaveBeenCalledWith('w1', 's1'));
  });

  it('lets a workspace admin manage other members templates', () => {
    mocks.role = 'admin';
    mocks.templates = { data: [saved('s2', 'Theirs', 'u2')], loading: false, error: null };
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Rename Theirs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Theirs' })).toBeInTheDocument();
  });

  it('toasts when deleting fails', async () => {
    mocks.deleteTemplate.mockRejectedValue({ code: 'permission-denied' });
    mocks.templates = { data: [saved('s1', 'Mine', 'u1')], loading: false, error: null };
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Mine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete template' }));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith("You don't have permission to do that.", {
        type: 'negative',
      }),
    );
  });
});
