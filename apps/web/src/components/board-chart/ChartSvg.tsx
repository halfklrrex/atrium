import classNames from 'classnames';
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  bandScale,
  charsThatFit,
  linePath,
  linearScale,
  niceTicks,
  pieArcs,
  truncateLabel,
} from './chart-geometry';
import type { ChartModel } from './chart-model';
import type { ChartMetrics } from './chart-metrics';
import styles from './chart.module.css';

interface Hover {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface ChartSvgProps {
  model: ChartModel;
  width: number;
  height: number;
  metrics: ChartMetrics;
  showValues: boolean;
}

const PRIMARY = 'var(--atrium-chart-series-1)';
const colorStyle = (color: string): CSSProperties => ({ '--chart-color': color }) as CSSProperties;
/** Gap between a value label and its mark, and between ticks and their labels (in half a character widths). */
const LABEL_GAP_CHARS = 1;

/** The drawing: bars, stacked bars, a line, a pie or a donut, plus the hover tooltip. */
export function ChartSvg({ model, width, height, metrics, showValues }: ChartSvgProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const markProps = (id: string, text: string) => ({
    onPointerEnter: (event: PointerEvent) => setHover(place(id, text, event)),
    onPointerMove: (event: PointerEvent) => setHover(place(id, text, event)),
    onPointerLeave: () => setHover(null),
  });
  const place = (id: string, text: string, event: PointerEvent): Hover => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return {
      id,
      text,
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };
  const dim = (id: string): string | undefined =>
    hover && hover.id !== id ? styles.dimmed : undefined;

  const pie = model.chartType === 'pie' || model.chartType === 'donut';
  const body = pie ? (
    <PieDrawing {...{ model, width, height, metrics, showValues, markProps, dim }} />
  ) : (
    <AxisDrawing {...{ model, width, height, metrics, showValues, markProps, dim }} />
  );

  return (
    <div ref={wrapRef} className={styles.svgWrap}>
      <svg
        className={styles.svg}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={model.ariaLabel}
      >
        {body}
      </svg>
      {hover ? (
        <div
          className={styles.tooltip}
          role="presentation"
          style={{
            left: Math.min(
              hover.x + metrics.tooltipOffset,
              Math.max(0, width - metrics.marginLeft),
            ),
            top: Math.max(0, hover.y - metrics.tooltipOffset * 2),
          }}
        >
          {hover.text}
        </div>
      ) : null}
    </div>
  );
}

interface DrawingProps extends ChartSvgProps {
  markProps: (id: string, text: string) => Record<string, unknown>;
  dim: (id: string) => string | undefined;
}

function AxisDrawing({ model, width, height, metrics, showValues, markProps, dim }: DrawingProps) {
  const { marginTop, marginRight, marginBottom, marginLeft, charWidth } = metrics;
  const x0 = marginLeft;
  const x1 = Math.max(x0 + 1, width - marginRight);
  const top = marginTop;
  const bottom = Math.max(top + 1, height - marginBottom);
  const stacked = model.chartType === 'stacked_bar';
  const line = model.chartType === 'line';

  let low = 0;
  let high = 0;
  for (const bucket of model.buckets) {
    if (stacked) {
      for (const seg of bucket.segments) {
        low = Math.min(low, seg.from, seg.to);
        high = Math.max(high, seg.from, seg.to);
      }
    } else if (bucket.value !== null) {
      low = Math.min(low, bucket.value);
      high = Math.max(high, bucket.value);
    }
  }
  const { ticks, min, max } = niceTicks(low, high);
  const y = linearScale(min, max, bottom, top);
  const band = bandScale(model.buckets.length, x1 - x0, metrics.barPadding);
  const gap = charWidth * LABEL_GAP_CHARS;

  // Show every k-th X label so they never overlap; each is cut to the room it has.
  const skip = Math.max(1, Math.ceil((charWidth * 6) / band.step));
  const maxChars = charsThatFit(band.step * skip - gap, charWidth);
  const barColor = (color: string) => (model.coloredBuckets ? color : PRIMARY);

  const valueLabel = (text: string, cx: number, ty: number, key: string) =>
    showValues && text.length * charWidth <= band.step * 1.5 ? (
      <text key={key} className={styles.valueText} x={cx} y={ty - gap} textAnchor="middle">
        {text}
      </text>
    ) : null;

  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className={styles.grid} x1={x0} x2={x1} y1={y(tick)} y2={y(tick)} />
          <text
            className={styles.tickText}
            x={x0 - gap}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {model.formatValue(tick)}
          </text>
        </g>
      ))}
      <line className={styles.axis} x1={x0} x2={x1} y1={y(0)} y2={y(0)} />

      {model.buckets.map((bucket, i) => {
        const cx = band.center(i);
        const id = bucket.key;
        return (
          <g key={bucket.key}>
            {i % skip === 0 ? (
              <text
                className={styles.tickText}
                x={x0 + cx}
                y={bottom + gap * 2}
                textAnchor="middle"
                dominantBaseline="hanging"
              >
                {truncateLabel(bucket.axisLabel, maxChars)}
              </text>
            ) : null}
            {stacked ? (
              <>
                {bucket.segments.map((seg) => {
                  const segId = `${id}|${seg.seriesKey}`;
                  const yA = y(seg.from);
                  const yB = y(seg.to);
                  return (
                    <rect
                      key={seg.seriesKey}
                      className={classNames(styles.mark, dim(segId))}
                      style={colorStyle(seg.color)}
                      x={x0 + band.start(i)}
                      y={Math.min(yA, yB)}
                      width={band.bandwidth}
                      height={Math.abs(yA - yB)}
                      {...markProps(segId, seg.tooltip)}
                    />
                  );
                })}
                {bucket.value !== null && bucket.value !== 0
                  ? valueLabel(bucket.text, x0 + cx, y(Math.max(bucket.value, 0)), `${id}-total`)
                  : null}
              </>
            ) : line ? null : bucket.value !== null ? (
              <>
                <rect
                  className={classNames(styles.mark, styles.bar, dim(id))}
                  style={colorStyle(barColor(bucket.color))}
                  x={x0 + band.start(i)}
                  y={Math.min(y(bucket.value), y(0))}
                  width={band.bandwidth}
                  height={Math.abs(y(bucket.value) - y(0))}
                  {...markProps(id, bucket.tooltip)}
                />
                {valueLabel(
                  bucket.text,
                  x0 + cx,
                  bucket.value >= 0 ? y(bucket.value) : y(0),
                  `${id}-value`,
                )}
              </>
            ) : null}
          </g>
        );
      })}

      {line ? (
        <>
          <path
            className={styles.line}
            d={linePath(
              model.buckets.map((b, i) => ({
                x: x0 + band.center(i),
                y: b.value === null ? null : y(b.value),
              })),
            )}
          />
          {model.buckets.map((bucket, i) =>
            bucket.value === null ? null : (
              <g key={bucket.key}>
                <circle
                  className={classNames(styles.point, dim(bucket.key))}
                  cx={x0 + band.center(i)}
                  cy={y(bucket.value)}
                  r={metrics.pointRadius}
                  {...markProps(bucket.key, bucket.tooltip)}
                />
                {valueLabel(bucket.text, x0 + band.center(i), y(bucket.value), `${bucket.key}-v`)}
              </g>
            ),
          )}
        </>
      ) : null}
    </g>
  );
}

function PieDrawing({ model, width, height, metrics, showValues, markProps, dim }: DrawingProps) {
  const donut = model.chartType === 'donut';
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.max(1, Math.min(width, height) / 2 - metrics.piePadding);
  const inner = donut ? outer * metrics.donutRatio : 0;
  const arcs = pieArcs(
    model.buckets.map((b) => b.value ?? 0),
    cx,
    cy,
    outer,
    inner,
  );
  return (
    <g>
      {arcs.map((arc) => {
        const bucket = model.buckets[arc.index]!;
        const label = `${Math.round(arc.share * 100)}%`;
        return (
          <g key={bucket.key}>
            <path
              className={classNames(styles.mark, styles.slice, dim(bucket.key))}
              style={colorStyle(bucket.color)}
              d={arc.path}
              strokeWidth={metrics.sliceGap}
              {...markProps(bucket.key, bucket.tooltip)}
            />
            {showValues && arc.share >= 0.06 ? (
              <text
                className={styles.sliceText}
                x={arc.labelX}
                y={arc.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {label}
              </text>
            ) : null}
          </g>
        );
      })}
      {donut && arcs.length > 0 ? (
        <g>
          <text
            className={styles.totalText}
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="auto"
          >
            {truncateLabel(
              model.totalText,
              Math.max(3, charsThatFit(inner * 2, metrics.charWidth * 2)),
            )}
          </text>
          <text
            className={styles.totalCaption}
            x={cx}
            y={cy + metrics.charWidth * 2}
            textAnchor="middle"
            dominantBaseline="hanging"
          >
            {truncateLabel(model.yLabel, Math.max(3, charsThatFit(inner * 2, metrics.charWidth)))}
          </text>
        </g>
      ) : null}
    </g>
  );
}
