import type { Editor } from '@tiptap/react';
import { Tooltip } from '@vibe/core';
import classNames from 'classnames';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import { currentColors, marks } from './editor-marks';
import { COLOR_KEYS, COLOR_LABELS, type ColorKey } from './editor-palette';
import styles from './DescriptionEditor.module.css';

interface SwatchProps {
  label: string;
  pressed: boolean;
  className?: string;
  onPick: () => void;
  children?: React.ReactNode;
}

function Swatch({ label, pressed, className, onPick, children }: SwatchProps) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={classNames(styles.swatch, className)}
        aria-label={label}
        aria-pressed={pressed}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Two rows of swatches, "Text colour" and "Highlight", each with a "Default" / "None" swatch.
 * Names are tooltips and aria-labels, and the current colour is marked.
 */
export function ColorPopup({
  anchor,
  editor,
  onClose,
  onTextColor,
}: {
  anchor: HTMLElement | null;
  editor: Editor;
  onClose: () => void;
  /** Called with the chosen text colour, so the toolbar button can show it. */
  onTextColor: (key: ColorKey | null) => void;
}) {
  const current = currentColors(editor);
  const done = (command: () => void) => () => {
    command();
    onClose();
  };
  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label="Colours">
      <div className={styles.swatchPopup}>
        <div className={styles.swatchSection} role="group" aria-label="Text colour">
          <span className={styles.swatchTitle}>Text colour</span>
          <div className={styles.swatchRow}>
            <Swatch
              label="Default"
              pressed={current.text === null}
              onPick={done(() => {
                marks.unsetTextColor(editor);
                onTextColor(null);
              })}
            >
              <span className={styles.swatchText}>A</span>
            </Swatch>
            {COLOR_KEYS.map((key) => (
              <Swatch
                key={key}
                label={COLOR_LABELS[key]}
                pressed={current.text === key}
                onPick={done(() => {
                  marks.setTextColor(editor, key);
                  onTextColor(key);
                })}
              >
                <span className={classNames(styles.swatchText, `atrium-text-${key}`)}>A</span>
              </Swatch>
            ))}
          </div>
        </div>
        <div className={styles.swatchSection} role="group" aria-label="Highlight">
          <span className={styles.swatchTitle}>Highlight</span>
          <div className={styles.swatchRow}>
            <Swatch
              label="None"
              pressed={current.highlight === null}
              className={styles.swatchNone}
              onPick={done(() => marks.unsetHighlight(editor))}
            >
              <span aria-hidden="true">&times;</span>
            </Swatch>
            {COLOR_KEYS.map((key) => (
              <Swatch
                key={key}
                label={COLOR_LABELS[key]}
                pressed={current.highlight === key}
                className={`atrium-highlight-${key}`}
                onPick={done(() => marks.setHighlightColor(editor, key))}
              />
            ))}
          </div>
        </div>
      </div>
    </AnchoredPopup>
  );
}
