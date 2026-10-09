import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@renderer/lib/utils';
import { labelIndexes, niceTicks } from './format';

const CHART_HEIGHT = 240;
const AXIS_WIDTH = 40;
const LABEL_HEIGHT = 24;
/** Room above the plot for the top tick label. */
const TOP_PAD = 8;

/**
 * One measure as columns on one axis (never two scales on one chart): thin columns with rounded tops, a quiet grid, a
 * tooltip per column. `ariaLabel` carries the same numbers for screen readers; the page also offers a table view.
 */
export function ColumnChart({
  values,
  labels,
  tooltips,
  ariaLabel,
  format,
  integer = false,
}: {
  values: number[];
  labels: string[];
  tooltips: string[];
  ariaLabel: string;
  format: (value: number) => string;
  /** The values are counts: the axis steps by whole numbers. */
  integer?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const ticks = niceTicks(Math.max(...values, 0), { integer });
  const top = ticks.at(-1) || 1;
  const plot = Math.max(width - AXIS_WIDTH, 0);
  const band = values.length > 0 ? plot / values.length : 0;
  const barWidth = Math.max(Math.min(24, band - 2), 2);
  const y = (value: number): number => CHART_HEIGHT - (value / top) * CHART_HEIGHT;
  // Label every column when they fit, else every few (always the last one).
  const labelled = new Set(labelIndexes(values.length, Math.ceil(48 / Math.max(band, 1))));

  return (
    // min-w-0 + overflow-hidden: the box follows the card when the window narrows (the drawn SVG must not hold it at
    // its old width).
    <div ref={box} className="relative w-full min-w-0 overflow-hidden" data-testid="stats-chart">
      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT + LABEL_HEIGHT + TOP_PAD}
          viewBox={`0 ${-TOP_PAD} ${width} ${CHART_HEIGHT + LABEL_HEIGHT + TOP_PAD}`}
          role="img"
          aria-label={ariaLabel}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={AXIS_WIDTH} x2={width} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
              <text
                x={AXIS_WIDTH - 8}
                y={y(tick)}
                dominantBaseline="middle"
                textAnchor="end"
                className="fill-muted-foreground font-mono text-[10px]"
              >
                {format(tick)}
              </text>
            </g>
          ))}
          {values.map((value, i) => {
            const x = AXIS_WIDTH + i * band + (band - barWidth) / 2;
            const height = Math.max(CHART_HEIGHT - y(value), value > 0 ? 2 : 0);
            const r = Math.min(4, barWidth / 2, height);
            const topY = CHART_HEIGHT - height;
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                data-testid="stats-column"
              >
                {/* Hit area: the whole band, taller than the column. */}
                <rect x={AXIS_WIDTH + i * band} y={0} width={band} height={CHART_HEIGHT} fill="transparent" />
                {height > 0 && (
                  <path
                    d={`M${x},${CHART_HEIGHT} V${topY + r} Q${x},${topY} ${x + r},${topY} H${x + barWidth - r} Q${x + barWidth},${topY} ${x + barWidth},${topY + r} V${CHART_HEIGHT} Z`}
                    className={cn('fill-primary transition-opacity', hover !== null && hover !== i && 'opacity-50')}
                  />
                )}
                {labelled.has(i) && (
                  <text
                    x={AXIS_WIDTH + i * band + band / 2}
                    y={CHART_HEIGHT + 16}
                    textAnchor="middle"
                    className={cn('fill-muted-foreground text-[10px]', hover === i && 'fill-foreground')}
                  >
                    {labels[i]}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={AXIS_WIDTH} x2={width} y1={CHART_HEIGHT} y2={CHART_HEIGHT} className="stroke-ctp-surface2" />
        </svg>
      )}
      {hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1 text-xs whitespace-nowrap shadow-lg"
          style={{
            left: AXIS_WIDTH + hover * band + band / 2,
            top: Math.max(y(values[hover] ?? 0) + TOP_PAD - 8, 16),
          }}
        >
          {tooltips[hover]}
        </div>
      )}
    </div>
  );
}
