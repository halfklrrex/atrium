import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { getReadableTextColor, hexToHsv, hsvToHex, normalizeHex, type Hsv } from './label-color';
import popups from './popups.module.css';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A small inline color picker (no popup, so it works on phones): a saturation/brightness square,
 * a hue slider, a hex field and a live preview, with Cancel and Use.
 */
export function ColorPicker({
  value,
  onUse,
  onCancel,
}: {
  value: string;
  onUse: (hex: string) => void;
  onCancel: () => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hex, setHex] = useState(() => normalizeHex(value) ?? '#000000');
  const [text, setText] = useState(hex);
  const squareRef = useRef<HTMLDivElement>(null);
  const invalid = normalizeHex(text) === null;

  const setFromHsv = (next: Hsv) => {
    const nextHex = hsvToHex(next);
    setHsv(next);
    setHex(nextHex);
    setText(nextHex);
  };

  const onText = (raw: string) => {
    setText(raw);
    const parsed = normalizeHex(raw);
    if (parsed) {
      setHex(parsed);
      setHsv(hexToHsv(parsed));
    }
  };

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const s = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
    const v = clamp(100 - ((event.clientY - rect.top) / rect.height) * 100, 0, 100);
    setFromHsv({ ...hsv, s, v });
  };

  const onSquareKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const delta: Partial<Record<string, [number, number]>> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const change = delta[event.key];
    if (!change) return;
    event.preventDefault();
    setFromHsv({
      ...hsv,
      s: clamp(Math.round(hsv.s) + change[0], 0, 100),
      v: clamp(Math.round(hsv.v) + change[1], 0, 100),
    });
  };

  const applyColor = () => {
    if (!invalid) onUse(hex);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
      event.preventDefault();
      applyColor();
    }
  };

  return (
    <div className={popups.picker} role="group" aria-label="Custom color" onKeyDown={onKeyDown}>
      <div
        ref={squareRef}
        className={popups.pickerSquare}
        style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 100, v: 100 }) }}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s)}
        aria-valuetext={`Saturation ${Math.round(hsv.s)} percent, brightness ${Math.round(hsv.v)} percent`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) pick(event);
        }}
        onKeyDown={onSquareKey}
      >
        <span
          className={popups.pickerHandle}
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
          aria-hidden="true"
        />
      </div>
      <input
        type="range"
        className={popups.pickerHue}
        min={0}
        max={360}
        step={1}
        value={Math.round(hsv.h)}
        aria-label="Hue"
        onChange={(event) => setFromHsv({ ...hsv, h: Number(event.target.value) })}
      />
      <div className={popups.pickerFields}>
        <span
          className={popups.pickerPreview}
          data-testid="color-preview"
          style={{ backgroundColor: hex, color: getReadableTextColor(hex) }}
        >
          Aa
        </span>
        <input
          className={popups.input}
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-label="Hex color"
          aria-invalid={invalid}
          onChange={(event) => onText(event.target.value)}
        />
      </div>
      {invalid ? (
        <p className={popups.error} role="alert">
          Enter a color like #1a2b3c.
        </p>
      ) : null}
      <div className={popups.footer}>
        <button type="button" className={popups.linkButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={popups.linkButton} disabled={invalid} onClick={applyColor}>
          Use
        </button>
      </div>
    </div>
  );
}
