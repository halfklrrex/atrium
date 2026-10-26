import classNames from 'classnames';
import { WORKSPACE_COLORS } from '../../theme/palette';
import styles from './dialogs.module.css';

/** The 10-colour palette as a radio group of round swatches. */
export function ColorSwatches({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.swatches}>
      {WORKSPACE_COLORS.map((color) => {
        const selected = color.hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={color.hex}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color.label}
            title={color.label}
            className={classNames(styles.swatch, selected && styles.swatchSelected)}
            style={{ backgroundColor: color.hex }}
            onClick={() => onChange(color.hex)}
          />
        );
      })}
    </div>
  );
}
