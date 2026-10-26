import type { ColorSettings, ColorValue } from '@atrium/shared';
import { HighlightColorBucket } from '@vibe/icons';
import classNames from 'classnames';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { STATUS_LABEL_COLORS } from '../theme/palette';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function ColorCell({ value }: CellProps<ColorValue, ColorSettings>) {
  const hex = value?.color?.hex;
  if (!hex) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <HighlightColorBucket aria-hidden="true" />
        </span>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <span className={styles.colorChip}>
        <span className={styles.swatchDot} style={{ backgroundColor: hex }} />
        <span className={styles.colorHex}>{hex.toUpperCase()}</span>
      </span>
    </div>
  );
}

function ColorEditor({
  value,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<ColorValue, ColorSettings>) {
  const currentHex = value?.color?.hex?.toUpperCase();

  const handleSelect = (hex: string) => {
    onChange({ color: { hex } });
    onClose();
  };

  const handleClear = () => {
    onChange(null);
    onClose();
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        <div className={popups.palette} role="listbox" aria-label="Palette">
          {STATUS_LABEL_COLORS.map((c) => {
            const isSelected = currentHex === c.hex.toUpperCase();
            return (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-label={c.label}
                title={c.label}
                className={classNames(popups.paletteSwatch, isSelected && popups.paletteSelected)}
                style={{ backgroundColor: c.hex }}
                onClick={() => handleSelect(c.hex)}
              />
            );
          })}
        </div>
        <div className={popups.footer}>
          <button type="button" className={popups.linkButton} onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const colorUi = defineColumnUi<ColorValue, ColorSettings>({
  type: 'color_picker',
  icon: HighlightColorBucket,
  tone: 'purple',
  editor: 'popover',
  Cell: ColorCell,
  Editor: ColorEditor,
});
