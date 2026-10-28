import type { ColumnDef, LocationSettings, LocationValue } from '@atrium/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { locationUi } from './location';
import type { CellContext, CellProps, EditorProps } from './types';

const Cell = locationUi.Cell as ComponentType<CellProps<LocationValue, LocationSettings>>;
const Editor = locationUi.Editor as ComponentType<EditorProps<LocationValue, LocationSettings>>;

const dummyColumn: ColumnDef = {
  id: 'c-loc',
  type: 'location',
  title: 'Office Location',
  position: 'a0',
  settings: {},
};

const dummyContext: CellContext = {
  highlight: '',
  rowDone: false,
  canEdit: true,
};

describe('location column UI', () => {
  describe('LocationCell', () => {
    it('renders empty state with hint icon when value is null', () => {
      const { container } = render(
        <Cell
          value={null}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('renders filled state with address text and OpenStreetMap pin link that stops propagation', () => {
      const onParentClick = vi.fn();
      render(
        <div onClick={onParentClick}>
          <Cell
            value={{ lat: 51.5074, lng: -0.1278, address: 'London, UK' }}
            settings={{}}
            column={dummyColumn}
            ctx={dummyContext}
            onChange={vi.fn()}
          />
        </div>,
      );

      expect(screen.getByText('London, UK')).toBeInTheDocument();

      const link = screen.getByRole('link', { name: 'Open London, UK in OpenStreetMap' });
      expect(link).toHaveAttribute(
        'href',
        'https://www.openstreetmap.org/?mlat=51.5074&mlon=-0.1278#map=15/51.5074/-0.1278',
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');

      fireEvent.click(link);
      expect(onParentClick).not.toHaveBeenCalled();
    });

    it('falls back to "lat, lng" when address is omitted', () => {
      render(
        <Cell
          value={{ lat: 35.6762, lng: 139.6503 }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('35.6762, 139.6503')).toBeInTheDocument();
      const link = screen.getByRole('link', {
        name: 'Open 35.6762, 139.6503 in OpenStreetMap',
      });
      expect(link).toHaveAttribute(
        'href',
        'https://www.openstreetmap.org/?mlat=35.6762&mlon=139.6503#map=15/35.6762/139.6503',
      );
    });
  });

  describe('LocationEditor', () => {
    it('saves address and lat/lng and closes the popover', async () => {
      const onChange = vi.fn();
      const onClose = vi.fn();

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

      await userEvent.type(screen.getByLabelText('Address'), 'Berlin, Germany');
      await userEvent.type(screen.getByLabelText('Latitude'), '52.52');
      await userEvent.type(screen.getByLabelText('Longitude'), '13.405');

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onChange).toHaveBeenCalledWith({
        lat: 52.52,
        lng: 13.405,
        address: 'Berlin, Germany',
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('shows error and does not call onChange when saving address with blank coordinates', async () => {
      const onChange = vi.fn();
      const onClose = vi.fn();

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

      const addressInput = screen.getByLabelText('Address');
      await userEvent.type(addressInput, 'Lisbon{Enter}');

      expect(screen.getByText('Enter both latitude and longitude')).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('shows error and does not call onChange when saving with only one coordinate', async () => {
      const onChange = vi.fn();
      const onClose = vi.fn();

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

      await userEvent.type(screen.getByLabelText('Address'), 'Porto');
      await userEvent.type(screen.getByLabelText('Latitude'), '41.1579');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(screen.getByText('Enter both latitude and longitude')).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('saves latitude and longitude without address when address is omitted', async () => {
      const onChange = vi.fn();
      const onClose = vi.fn();

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

      await userEvent.type(screen.getByLabelText('Latitude'), '38.7223');
      await userEvent.type(screen.getByLabelText('Longitude'), '-9.1393');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onChange).toHaveBeenCalledWith({
        lat: 38.7223,
        lng: -9.1393,
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('shows a validation error and does not call onChange for out-of-range or non-numeric latitude', async () => {
      const onChange = vi.fn();
      const onClose = vi.fn();

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

      const latInput = screen.getByLabelText('Latitude');
      const lngInput = screen.getByLabelText('Longitude');
      await userEvent.type(latInput, '95');
      await userEvent.type(lngInput, '0');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(screen.getByText(/Latitude must be between -90 and 90/i)).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      await userEvent.clear(latInput);
      await userEvent.type(latInput, 'abc');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(screen.getByText(/Latitude must be between -90 and 90/i)).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('clears the value when Clear button is clicked or when all fields are saved empty', () => {
      const onChange = vi.fn();
      const onClose = vi.fn();

      const { unmount } = render(
        <Editor
          value={{ lat: 48.8566, lng: 2.3522, address: 'Paris, France' }}
          settings={{}}
          column={dummyColumn}
          ctx={dummyContext}
          onChange={onChange}
          onClose={onClose}
          anchor={document.body}
          saveSettings={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(onChange).toHaveBeenCalledWith(null);
      expect(onClose).toHaveBeenCalledTimes(1);

      unmount();

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

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onChange).toHaveBeenLastCalledWith(null);
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});
