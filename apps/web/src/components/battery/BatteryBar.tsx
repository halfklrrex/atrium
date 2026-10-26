import type { DistributionSegment } from '@atrium/shared';
import { Tooltip } from '@vibe/core';
import { formatBatteryTooltip } from './battery-format';
import styles from './battery.module.css';

/**
 * The status "battery": segments sized by count, in the label colours. Each segment pops out on
 * hover or focus (a transform, never a layout property) and shows a tooltip. The caller supplies
 * the container's size and position through `className`.
 */
export function BatteryBar({
  segments,
  total,
  label,
  className,
}: {
  segments: readonly DistributionSegment[];
  total: number;
  label: string;
  className?: string;
}) {
  return (
    <div className={`${styles.battery} ${className ?? ''}`} role="group" aria-label={label}>
      {segments.map((segment) => {
        const text = formatBatteryTooltip(segment.label, segment.count, total);
        return (
          <Tooltip key={segment.key} content={text} position="top">
            <div
              className={styles.segment}
              style={{ flexGrow: segment.count, backgroundColor: segment.color }}
              tabIndex={0}
              aria-label={text}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}
