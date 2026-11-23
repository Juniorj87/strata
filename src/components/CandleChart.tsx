import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Candle } from '../lib/marketData';
import { fmtNum } from '../lib/format';

/**
 * Candlestick chart for real indexed OHLCV.
 *
 * - X is real time, so buckets with no fills stay as gaps instead of being
 *   squeezed out or invented.
 * - Wheel zooms, drag pans, hover reads out the candle.
 * - Volume is drawn from the same fills, scaled to its own band.
 */

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);
  return { ref, width };
}

function priceFmt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (abs >= 0.01) return value.toFixed(6);
  return value.toPrecision(5);
}

function timeLabel(seconds: number, spanSeconds: number): string {
  const date = new Date(seconds * 1000);
  if (spanSeconds >= 6 * 86400) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  if (spanSeconds >= 86400) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function fullTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function CandleChart({
  candles,
  intervalSec,
  height = 440,
  symbol,
  loading = false,
  error = null,
}: {
  candles: Candle[];
  intervalSec: number;
  height?: number;
  symbol: string;
  loading?: boolean;
  error?: string | null;
}) {
  const { ref, width } = useWidth(760);
  const [visible, setVisible] = useState(90);
  const [pan, setPan] = useState(0); // buckets scrolled back from the newest
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [ema20, setEma20] = useState(true);
  const [ema50, setEma50] = useState(false);
  const [style, setStyle] = useState<'line' | 'candles'>('line');
  const [markMode, setMarkMode] = useState(false);
  const gradientId = `candle-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [priceMarks, setPriceMarks] = useState<number[]>([]);
  const drag = useRef<{ startX: number; startPan: number } | null>(null);

  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  const marksKey = `strata.chart.marks.${symbol}`;
  useEffect(() => {
    try { const raw = window.localStorage.getItem(marksKey); setPriceMarks(raw ? JSON.parse(raw) as number[] : []); } catch { setPriceMarks([]); }
  }, [marksKey]);
  useEffect(() => { try { window.localStorage.setItem(marksKey, JSON.stringify(priceMarks.slice(-30))); } catch { /* storage may be unavailable */ } }, [marksKey, priceMarks]);
  const spanSeconds = Math.max(intervalSec * 4, visible * intervalSec);
  const end = (last?.time ?? Math.floor(Date.now() / 1000)) + intervalSec - pan * intervalSec;
  const start = end - spanSeconds;

  const shown = useMemo(
    () => candles.filter((candle) => candle.time + intervalSec > start && candle.time < end),
    [candles, start, end, intervalSec],
  );

  const padLeft = 56;
  const padRight = 14;
  const padTop = 14;
  const priceHeight = Math.round((height - 54) * 0.76);
  const volTop = padTop + priceHeight + 10;
  const volHeight = Math.max(24, height - volTop - 24);
  const innerW = Math.max(20, width - padLeft - padRight);

  const highs = shown.map((candle) => candle.high);
  const lows = shown.map((candle) => candle.low);
  const rawHigh = highs.length ? Math.max(...highs) : last?.close ?? 1;
  const rawLow = lows.length ? Math.min(...lows) : last?.close ?? 0;
  const priceSpan = rawHigh - rawLow || Math.abs(rawHigh) * 0.01 || 1;
  const high = rawHigh + priceSpan * 0.06;
  const low = Math.max(0, rawLow - priceSpan * 0.06);
  const scale = high - low || 1;

  const xFor = (time: number) => padLeft + ((time - start) / (end - start)) * innerW;
  const yFor = (price: number) => padTop + priceHeight - ((price - low) / scale) * priceHeight;
  const candleWidth = Math.max(1.5, Math.min(18, (intervalSec / (end - start)) * innerW * 0.68));

  const maxVolume = Math.max(...shown.map((candle) => candle.volume), 0) || 1;
  const linePath = shown
    .map((candle, index) => `${index === 0 ? 'M' : 'L'} ${xFor(candle.time + intervalSec / 2)} ${yFor(candle.close)}`)
    .join(' ');
  const areaPath = shown.length > 1
    ? `${linePath} L ${xFor(shown[shown.length - 1].time + intervalSec / 2)} ${padTop + priceHeight} L ${xFor(shown[0].time + intervalSec / 2)} ${padTop + priceHeight} Z`
    : '';
  const emaPath = (period: number) => {
    const alpha = 2 / (period + 1); let value = shown[0]?.close ?? 0;
    return shown.map((candle, index) => { value = index === 0 ? candle.close : candle.close * alpha + value * (1 - alpha); return `${index === 0 ? 'M' : 'L'} ${xFor(candle.time + intervalSec / 2)} ${yFor(value)}`; }).join(' ');
  };

  const ticks = Array.from({ length: 4 }, (_, i) => low + (scale * i) / 3);
  const timeTicks = Array.from({ length: 4 }, (_, i) => start + (spanSeconds * i) / 3);

  // Wheel zoom needs a non-passive listener, so it is attached directly.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      setVisible((current) => {
        const next = event.deltaY < 0 ? current * 0.8 : current * 1.25;
        return Math.round(Math.min(400, Math.max(12, next)));
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [ref]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    drag.current = { startX: event.clientX, startPan: pan };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (drag.current) {
      const dx = event.clientX - drag.current.startX;
      const delta = (dx / innerW) * visible;
      setPan(Math.max(0, drag.current.startPan + delta));
      drag.current.startX = event.clientX;
      drag.current.startPan = Math.max(0, drag.current.startPan + delta);
      return;
    }
    if (shown.length === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left - padLeft) / innerW));
    const target = start + ratio * (end - start);
    let nearest = 0;
    let distance = Infinity;
    shown.forEach((candle, index) => {
      const d = Math.abs(candle.time + intervalSec / 2 - target);
      if (d < distance) {
        distance = d;
        nearest = index;
      }
    });
    const candle = shown[nearest];
    setHover({
      index: nearest,
      x: xFor(candle.time + intervalSec / 2),
      y: yFor(candle.close),
    });
  };
  const stopDrag = () => { drag.current = null; };
  const hovered = hover ? shown[hover.index] : null;

  return (
    <div ref={ref} className="candle-chart" style={{ position: 'relative' }}>
      <div className="candle-chart-head">
        <div>
          <span className="label">{symbol} / ASE</span>
          <strong className="mono candle-chart-price">
            {last ? priceFmt(last.close) : loading ? '…' : '—'}
          </strong>
        </div>
        <div className="candle-chart-tools">
          <span className="mono muted">{shown.length} candles</span>
          <button type="button" className={style === 'line' ? 'chip active' : 'chip'} onClick={() => setStyle('line')}>Line</button>
          <button type="button" className={style === 'candles' ? 'chip active' : 'chip'} onClick={() => setStyle('candles')}>Candles</button>
          <button type="button" className={ema20 ? 'chip active' : 'chip'} onClick={() => setEma20((v) => !v)}>EMA 20</button>
          <button type="button" className={ema50 ? 'chip active' : 'chip'} onClick={() => setEma50((v) => !v)}>EMA 50</button>
          <button type="button" className={markMode ? 'chip active' : 'chip'} onClick={() => setMarkMode((v) => !v)}>＋ Price level</button>
          {priceMarks.length > 0 && <button type="button" className="chip" onClick={() => setPriceMarks([])}>Clear levels</button>}
          {pan > 0 && <button type="button" className="chip" onClick={() => setPan(0)}>Latest</button>}
        </div>
      </div>

      <svg
        width="100%"
        height={height}
        role="img"
        aria-label={`${symbol} price chart, ${shown.length} candles`}
        onPointerDown={(event) => {
          if (markMode && shown.length) {
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientY - bounds.top - padTop) / priceHeight));
            const price = high - ratio * scale;
            setPriceMarks((items) => [...items, Number(price.toPrecision(10))].slice(-30));
            setMarkMode(false);
            return;
          }
          onPointerDown(event);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerLeave={() => { setHover(null); stopDrag(); }}
        style={{ display: 'block', touchAction: 'none', cursor: drag.current ? 'grabbing' : 'crosshair' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padLeft} x2={padLeft + innerW} y1={yFor(tick)} y2={yFor(tick)} stroke="var(--line-soft)" />
            <text x={padLeft - 8} y={yFor(tick) + 3.5} textAnchor="end" fill="var(--dim)" fontSize="12" fontFamily="var(--font-mono)">
              {priceFmt(tick)}
            </text>
          </g>
        ))}

        {style === 'line' && shown.length > 1 && (
          <>
            <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
            <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
        {ema20 && shown.length > 1 && <path d={emaPath(20)} fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity="0.5" />}
        {ema50 && shown.length > 1 && <path d={emaPath(50)} fill="none" stroke="var(--accent-2)" strokeWidth="1.2" opacity="0.6" />}
        {priceMarks.map((price, index) => price >= low && price <= high ? <g key={`${price}-${index}`}><line x1={padLeft} x2={padLeft + innerW} y1={yFor(price)} y2={yFor(price)} stroke="var(--warn)" strokeDasharray="5 4"/><text x={padLeft + innerW - 4} y={yFor(price) - 4} textAnchor="end" fill="var(--warn)" fontSize="11">{priceFmt(price)}</text></g> : null)}
        {shown.map((candle) => {
          const x = xFor(candle.time + intervalSec / 2);
          const up = candle.close >= candle.open;
          const color = up ? 'var(--up)' : 'var(--down)';
          const bodyTop = yFor(Math.max(candle.open, candle.close));
          const bodyBottom = yFor(Math.min(candle.open, candle.close));
          const volH = (candle.volume / maxVolume) * volHeight;
          return (
            <g key={candle.time}>
              {style === 'candles' && (
                <>
                  <line x1={x} x2={x} y1={yFor(candle.high)} y2={yFor(candle.low)} stroke={color} strokeWidth="1" />
                  <rect
                    x={x - candleWidth / 2}
                    y={bodyTop}
                    width={candleWidth}
                    height={Math.max(1, bodyBottom - bodyTop)}
                    fill={up ? 'var(--up-soft)' : 'var(--down-soft)'}
                    stroke={color}
                    strokeWidth="1"
                  />
                </>
              )}
              <rect
                x={x - candleWidth / 2}
                y={volTop + volHeight - volH}
                width={candleWidth}
                height={Math.max(0.5, volH)}
                fill={color}
                opacity="0.35"
              />
            </g>
          );
        })}

        <line x1={padLeft} x2={padLeft + innerW} y1={volTop + volHeight} y2={volTop + volHeight} stroke="var(--line)" />
        <text x={padLeft} y={volTop - 4} fill="var(--dim)" fontSize="12" fontFamily="var(--font-mono)">
          volume · ASE
        </text>

        {timeTicks.map((tick) => (
          <text
            key={tick}
            x={xFor(tick)}
            y={height - 6}
            textAnchor="middle"
            fill="var(--dim)"
            fontSize="12"
            fontFamily="var(--font-mono)"
          >
            {timeLabel(tick, spanSeconds)}
          </text>
        ))}

        {last && !hovered && (
          <g>
            <line
              x1={padLeft}
              x2={padLeft + innerW}
              y1={yFor(last.close)}
              y2={yFor(last.close)}
              stroke="var(--accent-line)"
              strokeDasharray="3 3"
            />
            <rect x={padLeft + innerW - 58} y={yFor(last.close) - 8} width="58" height="16" fill="var(--accent-soft)" stroke="var(--accent-line)" />
            <text x={padLeft + innerW - 29} y={yFor(last.close) + 3.5} textAnchor="middle" fill="var(--text)" fontSize="12" fontFamily="var(--font-mono)">
              {priceFmt(last.close)}
            </text>
          </g>
        )}

        {hovered && hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={padTop} y2={volTop + volHeight} stroke="var(--accent-line)" strokeDasharray="3 3" />
            <line x1={padLeft} x2={padLeft + innerW} y1={hover.y} y2={hover.y} stroke="var(--line)" strokeDasharray="2 3" />
            <circle cx={hover.x} cy={hover.y} r="2.8" fill="var(--accent)" />
          </g>
        )}
      </svg>

      {hovered && (
        <div className="candle-readout mono">
          <span className="muted">{fullTime(hovered.time)}</span>
          <span>O {priceFmt(hovered.open)}</span>
          <span>H {priceFmt(hovered.high)}</span>
          <span>L {priceFmt(hovered.low)}</span>
          <span>C {priceFmt(hovered.close)}</span>
          <span className="muted">V {fmtNum(Number(hovered.volume.toFixed(2)))}</span>
          <span className="muted">{hovered.trades} fills</span>
        </div>
      )}

      {error && <p className="candle-empty down">{error}</p>}
      {!error && shown.length === 0 && !loading && (
        <p className="candle-empty muted">
          No fills in this window. The indexer only returns buckets where a swap actually happened.
        </p>
      )}
      {loading && shown.length === 0 && <p className="candle-empty muted">Reading indexed candles…</p>}
    </div>
  );
}
