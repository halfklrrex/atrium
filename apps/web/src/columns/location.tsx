import { locationValueSchema, type LocationSettings, type LocationValue } from '@atrium/shared';
import { Pin } from '@vibe/icons';
import { useState, type KeyboardEvent } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function LocationCell({ value, ctx }: CellProps<LocationValue, LocationSettings>) {
  if (!value) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Pin aria-hidden="true" />
        </span>
      </div>
    );
  }

  const label = value.address?.trim() ? value.address : `${value.lat}, ${value.lng}`;
  const href = `https://www.openstreetmap.org/?mlat=${value.lat}&mlon=${value.lng}#map=15/${value.lat}/${value.lng}`;

  return (
    <div className={styles.root}>
      <div className={styles.locationCell}>
        <a
          className={styles.locationPin}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${label} in OpenStreetMap`}
          onClick={(e) => e.stopPropagation()}
        >
          <Pin aria-hidden="true" />
        </a>
        <span className={styles.text}>
          <Highlight text={label} term={ctx.highlight} />
        </span>
      </div>
    </div>
  );
}

function LocationEditor({
  value,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<LocationValue, LocationSettings>) {
  const [address, setAddress] = useState(value?.address ?? '');
  const [latText, setLatText] = useState(value ? String(value.lat) : '');
  const [lngText, setLngText] = useState(value ? String(value.lng) : '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const trimmedAddress = address.trim();
    const trimmedLat = latText.trim();
    const trimmedLng = lngText.trim();

    if (!trimmedAddress && !trimmedLat && !trimmedLng) {
      onChange(null);
      onClose();
      return;
    }

    // The schema needs both coordinates and there is no geocoding: never invent 0, 0.
    if (!trimmedLat || !trimmedLng) {
      setError('Enter both latitude and longitude');
      return;
    }

    const latNum = Number(trimmedLat);
    const lngNum = Number(trimmedLng);

    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      setError('Latitude must be between -90 and 90, and longitude between -180 and 180');
      return;
    }

    const candidate: LocationValue = {
      lat: latNum,
      lng: lngNum,
      ...(trimmedAddress ? { address: trimmedAddress } : {}),
    };

    const parsed = locationValueSchema.safeParse(candidate);
    if (!parsed.success) {
      setError('Latitude must be between -90 and 90, and longitude between -180 and 180');
      return;
    }

    onChange(parsed.data);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body} onKeyDown={onKeyDown}>
        <label className={popups.field}>
          <span className={popups.fieldLabel}>Address</span>
          <input
            className={popups.input}
            value={address}
            placeholder="City or street address"
            maxLength={500}
            autoFocus
            onChange={(e) => {
              setAddress(e.target.value);
              setError(null);
            }}
          />
        </label>
        <label className={popups.field}>
          <span className={popups.fieldLabel}>Latitude</span>
          <input
            className={popups.input}
            value={latText}
            placeholder="-90 to 90"
            inputMode="decimal"
            onChange={(e) => {
              setLatText(e.target.value);
              setError(null);
            }}
          />
        </label>
        <label className={popups.field}>
          <span className={popups.fieldLabel}>Longitude</span>
          <input
            className={popups.input}
            value={lngText}
            placeholder="-180 to 180"
            inputMode="decimal"
            onChange={(e) => {
              setLngText(e.target.value);
              setError(null);
            }}
          />
        </label>
        {error ? <p className={popups.error}>{error}</p> : null}
        <div className={popups.footer}>
          <button
            type="button"
            className={popups.linkButton}
            onClick={() => {
              onChange(null);
              onClose();
            }}
          >
            Clear
          </button>
          <button type="button" className={popups.linkButton} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const locationUi = defineColumnUi<LocationValue, LocationSettings>({
  type: 'location',
  icon: Pin,
  tone: 'teal',
  editor: 'popover',
  Cell: LocationCell,
  Editor: LocationEditor,
});
