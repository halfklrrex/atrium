import type { ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { autoNumberUi } from './auto-number';
import { colorUi } from './color';
import { countryFlag, countryUi } from './country';
import { creationLogUi } from './creation-log';
import { emailUi } from './email';
import { itemIdUi } from './item-id';
import { lastUpdatedUi } from './last-updated';
import { phoneUi } from './phone';
import { progressUi } from './progress';
import { ratingUi } from './rating';
import { getColumnUi } from './registry';
import { tagsUi } from './tags';
import type { CellContext } from './types';
import { voteUi } from './vote';

// Mock auth so useAuth returns a known user
vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    user: {
      uid: 'user-1',
      displayName: 'Test User',
      email: 'test@example.com',
      photoURL: null,
    },
  }),
}));

vi.mock('../lib/firebase', () => ({
  auth: { currentUser: { uid: 'user-1' } },
  db: {},
}));

const dummyColumn: ColumnDef = {
  id: 'c1',
  type: 'text',
  title: 'Test Column',
  position: 'a0',
  settings: {},
};

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: true,
};

describe('P2 Column UIs', () => {
  describe('registry', () => {
    it('registers all 12 new column UIs in the registry', () => {
      const types = [
        'rating',
        'vote',
        'color_picker',
        'country',
        'email',
        'phone',
        'tags',
        'progress',
        'auto_number',
        'item_id',
        'creation_log',
        'last_updated',
      ];
      for (const type of types) {
        const ui = getColumnUi(type);
        expect(ui).toBeDefined();
        expect(ui?.type).toBe(type);
      }
    });
  });

  describe('rating column', () => {
    it('renders stars according to limit and highlights active ones', () => {
      const { container } = render(
        <ratingUi.Cell
          value={{ rating: 3 }}
          settings={{ limit: 5, symbol: 'stars' }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      const buttons = container.querySelectorAll('button[role="radio"]');
      expect(buttons).toHaveLength(5);
      expect(buttons[2]).toHaveAttribute('aria-checked', 'true');
    });

    it('clicks a star to update rating or toggle off', () => {
      const onChange = vi.fn();
      const { container } = render(
        <ratingUi.Cell
          value={{ rating: 3 }}
          settings={{ limit: 5, symbol: 'stars' }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );
      const buttons = container.querySelectorAll('button[role="radio"]');
      // Clicking star 4 updates rating to 4
      fireEvent.click(buttons[3]!);
      expect(onChange).toHaveBeenCalledWith({ rating: 4 });

      // Clicking star 3 toggles it off to null
      fireEvent.click(buttons[2]!);
      expect(onChange).toHaveBeenCalledWith(null);
    });

    it('supports keyboard navigation in RatingEditor', async () => {
      const onChange = vi.fn();
      const onClose = vi.fn();
      const Editor = ratingUi.Editor!;
      const { container } = render(
        <Editor
          value={{ rating: 2 }}
          settings={{ limit: 5, symbol: 'stars' }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={null}
          saveSettings={vi.fn()}
        />,
      );

      const root = container.firstChild as HTMLElement;
      fireEvent.keyDown(root, { key: 'ArrowRight' });
      expect(onChange).toHaveBeenCalledWith({ rating: 3 });

      fireEvent.keyDown(root, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('vote column', () => {
    it('renders voter count and toggles user vote', () => {
      const onChange = vi.fn();
      render(
        <voteUi.Cell
          value={{ votersIds: ['other-user'] }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );
      expect(screen.getByText('1')).toBeInTheDocument();
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(button);
      expect(onChange).toHaveBeenCalledWith({ votersIds: ['other-user', 'user-1'] });
    });

    it('untoggles existing vote', () => {
      const onChange = vi.fn();
      render(
        <voteUi.Cell
          value={{ votersIds: ['user-1'] }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
        />,
      );
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(button);
      expect(onChange).toHaveBeenCalledWith({ votersIds: [] });
    });

    it('toggle helper updates current voters list', () => {
      expect(voteUi.toggle?.(null)).toEqual({ votersIds: ['user-1'] });
      expect(voteUi.toggle?.({ votersIds: ['user-1'] })).toEqual({ votersIds: [] });
      expect(voteUi.toggle?.({ votersIds: ['u2'] })).toEqual({ votersIds: ['u2', 'user-1'] });
    });
  });

  describe('color_picker column', () => {
    it('renders swatch hex and swatch dot', () => {
      render(
        <colorUi.Cell
          value={{ color: { hex: '#00C875' } }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('#00C875')).toBeInTheDocument();
    });

    it('selects color from palette and clears', () => {
      const onChange = vi.fn();
      const onClose = vi.fn();
      const Editor = colorUi.Editor!;
      render(
        <Editor
          value={{ color: { hex: '#00C875' } }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );
      const clearBtn = screen.getByRole('button', { name: 'Clear' });
      fireEvent.click(clearBtn);
      expect(onChange).toHaveBeenCalledWith(null);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('country column', () => {
    it('renders flag and country name', () => {
      render(
        <countryUi.Cell
          value={{ countryCode: 'US', countryName: 'United States' }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('United States')).toBeInTheDocument();
      expect(countryFlag('US')).toBe('🇺🇸');
    });

    it('filters and selects a country in CountryEditor', async () => {
      const onChange = vi.fn();
      const onClose = vi.fn();
      const Editor = countryUi.Editor!;
      render(
        <Editor
          value={null}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      const input = screen.getByPlaceholderText('Search country');
      await userEvent.type(input, 'Japan');
      const option = screen.getByRole('option', { name: /Japan/ });
      fireEvent.click(option);
      expect(onChange).toHaveBeenCalledWith({ countryCode: 'JP', countryName: 'Japan' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('email column', () => {
    it('renders mailto link with email', () => {
      render(
        <emailUi.Cell
          value={{ email: 'hello@example.com', text: 'Contact Us' }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      const link = screen.getByRole('link', { name: 'Contact Us' });
      expect(link).toHaveAttribute('href', 'mailto:hello@example.com');
    });

    it('edits email and text in EmailEditor', async () => {
      const onChange = vi.fn();
      const onClose = vi.fn();
      const Editor = emailUi.Editor!;
      render(
        <Editor
          value={null}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      const emailInput = screen.getByPlaceholderText('name@example.com');
      const textInput = screen.getByPlaceholderText('Optional name');
      await userEvent.type(emailInput, 'ada@example.com');
      await userEvent.type(textInput, 'Ada Lovelace');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onChange).toHaveBeenCalledWith({ email: 'ada@example.com', text: 'Ada Lovelace' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('phone column', () => {
    it('renders tel link with phone number', () => {
      render(
        <phoneUi.Cell
          value={{ phone: '+1234567890' }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      const link = screen.getByRole('link', { name: '+1234567890' });
      expect(link).toHaveAttribute('href', 'tel:+1234567890');
    });

    it('commits phone number with InlineInput in PhoneEditor', () => {
      const onChange = vi.fn();
      const onClose = vi.fn();
      const Editor = phoneUi.Editor!;
      render(
        <Editor
          value={{ phone: '+1234567890' }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={null}
          saveSettings={vi.fn()}
        />,
      );

      const input = screen.getByLabelText(dummyColumn.title);
      fireEvent.change(input, { target: { value: '+9876543210' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith({ phone: '+9876543210' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('tags column', () => {
    const settings = {
      tags: [
        { id: 1, name: 'Frontend' },
        { id: 2, name: 'Backend' },
      ],
    };

    it('renders tag pills by name', () => {
      render(
        <tagsUi.Cell
          value={{ tag_ids: [1, 2] }}
          settings={settings}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('Frontend')).toBeInTheDocument();
      expect(screen.getByText('Backend')).toBeInTheDocument();
    });

    it('toggles existing tags in TagsEditor', () => {
      const onChange = vi.fn();
      const Editor = tagsUi.Editor!;
      render(
        <Editor
          value={{ tag_ids: [1] }}
          settings={settings}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={vi.fn()}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      const backendOption = screen.getByRole('option', { name: 'Backend' });
      fireEvent.click(backendOption);
      expect(onChange).toHaveBeenCalledWith({ tag_ids: [1, 2] });
    });

    it('creates new tag on Enter in TagsEditor', async () => {
      const onChange = vi.fn();
      const saveSettings = vi.fn();
      const Editor = tagsUi.Editor!;
      render(
        <Editor
          value={{ tag_ids: [1] }}
          settings={settings}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={vi.fn()}
          anchor={document.body}
          saveSettings={saveSettings}
        />,
      );

      const input = screen.getByPlaceholderText('Search or add a tag');
      await userEvent.type(input, 'DevOps{enter}');
      expect(saveSettings).toHaveBeenCalledWith({
        tags: [...settings.tags, { id: 3, name: 'DevOps' }],
      });
      expect(onChange).toHaveBeenCalledWith({ tag_ids: [1, 3] });
    });
  });

  describe('progress column', () => {
    it('renders progress bar with percentage', () => {
      render(
        <progressUi.Cell
          value={{ progress: 65 }}
          settings={{ related_columns: { isNormalized: true, columns: {} } }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '65');
      expect(screen.getByText('65%')).toBeInTheDocument();
    });

    it('has editor: "none"', () => {
      expect(progressUi.editor).toBe('none');
      expect(progressUi.Editor).toBeUndefined();
    });
  });

  describe('auto_number column', () => {
    it('renders formatted auto number with optional prefix', () => {
      render(
        <autoNumberUi.Cell
          value={{ auto_number: 42 }}
          settings={{ scope: 'board', prefix: 'TASK-', order: 'ascending' }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('TASK-42')).toBeInTheDocument();
    });

    it('has editor: "none"', () => {
      expect(autoNumberUi.editor).toBe('none');
    });
  });

  describe('item_id column', () => {
    it('renders formatted item ID badge', () => {
      render(
        <itemIdUi.Cell
          value="item-999"
          settings={{ displayType: 'customKey', customKeySettings: { prefix: 'PULSE-' } }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText('PULSE-item-999')).toBeInTheDocument();
    });

    it('has editor: "none"', () => {
      expect(itemIdUi.editor).toBe('none');
    });
  });

  describe('creation_log column', () => {
    it('renders creator avatar and date according to mode', () => {
      render(
        <creationLogUi.Cell
          value={{ created_at: '2026-10-24T12:00:00.000Z', creator_id: 'user-1' }}
          settings={{ mode: 'personAndDate' }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText(/24.*Oct|Oct.*24/)).toBeInTheDocument();
      expect(screen.getByText('TU')).toBeInTheDocument();
    });

    it('has editor: "none"', () => {
      expect(creationLogUi.editor).toBe('none');
    });
  });

  describe('last_updated column', () => {
    it('renders updater avatar and date according to mode', () => {
      render(
        <lastUpdatedUi.Cell
          value={{ updated_at: '2026-10-24T14:30:00.000Z', updater_id: 'user-1' }}
          settings={{ mode: 'personAndDate' }}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText(/24.*Oct|Oct.*24/)).toBeInTheDocument();
      expect(screen.getByText('TU')).toBeInTheDocument();
    });

    it('has editor: "none"', () => {
      expect(lastUpdatedUi.editor).toBe('none');
    });
  });
});
