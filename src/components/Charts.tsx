import { useEffect, useMemo, useRef, useState } from 'react';

/* ============================================================
   Charts — no chart library, pure SVG, measured to the container
   so lines stay crisp at every breakpoint.
   ============================================================ */

function useMeasuredWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && Math.abs(next - width) > 1) setWidth(next);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width || fallback);
    return () => observer.disconnect();
    // width is intentionally read, not tracked, to avoid a feedback loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);

  return { ref, width };
}

function niceTicks(min: number, max: number, count = 3): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
}

export function Sparkline({
  data,
  width = 120,
  height = 28,
  color = 'var(--accent)',
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points = data
    .map((value, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface SeriesChartProps {
  data: number[];
  height?: number;
  /** Formatter for the y-axis and hover readout. */
  format?: (value: number) => string;
  startLabel?: string;
  endLabel?: string;
  ariaLabel: string;
  accent?: string;
  /** Show the left value axis. */
  axis?: boolean;
}

/**
 * Area chart with four horizontal rules, a value axis and a hover crosshair.
 * Values are whatever the caller passes — Strata never invents a history.
 */
export function SeriesChart({
  data,
  height = 220,
  format = (value) => value.toFixed(2),
  startLabel,
  endLabel,
  ariaLabel,
  accent = 'var(--accent)',
  axis = true,
}: SeriesChartProps) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<number | null>(null);

  const padLeft = axis ? 52 : 8;
  const padRight = 10;
  const padTop = 12;
  const padBottom = 24;
  const innerW = Math.max(10, width - padLeft - padRight);
  const innerH = Math.max(10, height - padTop - padBottom);

  const { min, max, ticks } = useMemo(() => {
    const lo = Math.min(...data);
    const hi = Math.max(...data);
    const span = hi - lo || Math.abs(hi) || 1;
    const paddedMin = lo - span * 0.12;
    const paddedMax = hi + span * 0.12;
    return { min: paddedMin, max: paddedMax, ticks: niceTicks(paddedMin, paddedMax, 3) };
  }, [data]);

  const span = max - min || 1;
  const x = (index: number) => padLeft + (data.length <= 1 ? innerW / 2 : (index / (data.length - 1)) * innerW);
  const y = (value: number) => padTop + innerH - ((value - min) / span) * innerH;

  const line = data.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const area = `M ${padLeft},${padTop + innerH} L ${line.replace(/ /g, ' L ')} L ${padLeft + innerW},${padTop + innerH} Z`;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left - padLeft;
    const ratio = Math.min(1, Math.max(0, offset / innerW));
    setHover(Math.round(ratio * (data.length - 1)));
  };

  return (
    <div ref={ref} style={{ width: '100%', position: 'relative' }}>
      <svg
        width="100%"
        height={height}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id="series-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={padLeft + innerW}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--line-soft)"
              strokeWidth="1"
            />
            {axis && (
              <text x={padLeft - 10} y={y(tick) + 3.5} textAnchor="end" fill="var(--dim)" fontSize="9.5" fontFamily="var(--font-mono)">
                {format(tick)}
              </text>
            )}
          </g>
        ))}

        <path d={area} fill="url(#series-fill)" />
        <polyline points={line} fill="none" stroke={accent} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />

        {hover !== null && data[hover] !== undefined && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padTop} y2={padTop + innerH} stroke="var(--accent-line)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(data[hover])} r="3" fill={accent} stroke="var(--surface)" strokeWidth="1.5" />
          </g>
        )}

        {(startLabel || endLabel) && (
          <>
            <text x={padLeft} y={height - 6} fill="var(--dim)" fontSize="9.5" fontFamily="var(--font-mono)">
              {startLabel}
            </text>
            <text x={padLeft + innerW} y={height - 6} textAnchor="end" fill="var(--dim)" fontSize="9.5" fontFamily="var(--font-mono)">
              {endLabel}
            </text>
          </>
        )}
      </svg>

      {hover !== null && data[hover] !== undefined && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(x(hover) - 44, 0), Math.max(0, width - 96)),
            top: 0,
            padding: '5px 9px',
            border: '1px solid var(--line)',
            borderRadius: 3,
            background: 'var(--surface)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {format(data[hover])}
        </div>
      )}
    </div>
  );
}

export function EquityChart({ data, height = 240 }: { data: number[]; height?: number }) {
  return (
    <SeriesChart
      data={data}
      height={height}
      ariaLabel="Equity curve"
      format={(value) => value.toFixed(0)}
      startLabel="deployed"
      endLabel="now"
    />
  );
}

export interface ColumnPoint {
  label: string;
  value: number;
}

/**
 * Column chart for indexed event counts and volumes.
 * Values are supplied by the caller; empty buckets stay empty.
 */
export function ColumnChart({
  points,
  height = 178,
  format = (value) => String(value),
  ariaLabel,
  accent = 'var(--accent)',
}: {
  points: ColumnPoint[];
  height?: number;
  format?: (value: number) => string;
  ariaLabel: string;
  accent?: string;
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>(480);
  const [hover, setHover] = useState<number | null>(null);
  const padLeft = 42;
  const padRight = 6;
  const padTop = 12;
  const padBottom = 26;
  const innerW = Math.max(10, width - padLeft - padRight);
  const innerH = Math.max(10, height - padTop - padBottom);
  const max = Math.max(...points.map((point) => point.value), 0);
  const scaleMax = max > 0 ? max : 1;
  const slot = points.length > 0 ? innerW / points.length : innerW;
  const barWidth = Math.max(2, Math.min(26, slot * 0.58));
  const baseline = padTop + innerH;
  const labelEvery = points.length > 8 ? Math.ceil(points.length / 6) : 1;

  if (points.length === 0) return null;

  return (
    <div ref={ref} style={{ width: '100%', position: 'relative' }}>
      <svg width="100%" height={height} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
        {[0, 0.5, 1].map((fraction) => {
          const y = padTop + innerH * fraction;
          const value = scaleMax * (1 - fraction);
          return (
            <g key={fraction}>
              <line x1={padLeft} x2={padLeft + innerW} y1={y} y2={y} stroke="var(--line-soft)" strokeWidth="1" />
              <text x={padLeft - 8} y={y + 3.5} textAnchor="end" fill="var(--dim)" fontSize="9" fontFamily="var(--font-mono)">
                {format(value)}
              </text>
            </g>
          );
        })}

        {points.map((point, index) => {
          const valueHeight = (point.value / scaleMax) * innerH;
          const x = padLeft + index * slot + (slot - barWidth) / 2;
          const y = baseline - valueHeight;
          const isHover = hover === index;
          return (
            <g key={`${point.label}-${index}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(0, valueHeight)}
                fill={isHover ? accent : 'var(--accent-soft)'}
                stroke={accent}
                strokeOpacity={isHover ? 0.9 : 0.35}
                strokeWidth="1"
              />
              <rect
                x={padLeft + index * slot}
                y={padTop}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${point.label}: ${format(point.value)}`}</title>
              </rect>
              {index % labelEvery === 0 && (
                <text
                  x={padLeft + index * slot + slot / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fill="var(--dim)"
                  fontSize="8.5"
                  fontFamily="var(--font-mono)"
                >
                  {point.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padLeft} x2={padLeft + innerW} y1={baseline} y2={baseline} stroke="var(--line)" strokeWidth="1" />
      </svg>
      {hover !== null && points[hover] && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(padLeft + hover * slot - 30, 0), Math.max(0, width - 110)),
            top: 2,
            padding: '4px 8px',
            border: '1px solid var(--line)',
            borderRadius: 3,
            background: 'var(--surface)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--text)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {points[hover].label} · {format(points[hover].value)}
        </div>
      )}
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  meta?: string;
  href?: string;
}

/** Horizontal bar list — used for execution counts per strategy. */
export function BarList({ data, format = (value) => String(value) }: { data: BarDatum[]; format?: (value: number) => string }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="bar-list">
      {data.map((item, index) => (
        // Strategy names are not unique on chain, so the label alone is not a
        // safe React key.
        <div className="bar-row" key={`${item.label}-${index}`}>
          <div className="bar-row-head">
            <span className="bar-label">{item.label}</span>
            {item.meta && <span className="bar-meta">{item.meta}</span>}
            <span className="bar-value mono">{format(item.value)}</span>
          </div>
          <div className="bar-track">
            <span style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
