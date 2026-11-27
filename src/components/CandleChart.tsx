import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { chainStorageKey } from '../lib/network';
import type { Candle } from '../lib/marketData';
import type { ChartPriceOverlay, ChartSimMarker } from '../lib/strategySim';
import { fmtNum } from '../lib/format';

/**
 * Candlestick / area chart for real indexed OHLCV.
 *
 * - X is real time, so buckets with no fills stay as gaps instead of being
 *   squeezed out or invented.
 * - Wheel zooms, drag pans, hover reads out the candle + Y-axis price pill.
 * - Supports real-candle indicators (SMA 7, EMA 20, EMA 50, BB 20), Log scale,
 *   Volume toggle, and interactive drawing tools (H-Line, Trendline, Measure).
 */

type DrawTool = 'pan' | 'level' | 'trend' | 'measure';

interface ChartPoint {
  time: number;
  price: number;
}

interface TrendDrawing {
  a: ChartPoint;
  b: ChartPoint;
}

interface ChartDrawings {
  levels: number[];
  trends: TrendDrawing[];
  ranges: TrendDrawing[];
}

const EMPTY_DRAWINGS: ChartDrawings = { levels: [], trends: [], ranges: [] };

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
  if (spanSeconds >= 86400) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function fullTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function spanLabel(seconds: number): string {
  const abs = Math.abs(Math.round(seconds));
  if (abs < 3600) return `${Math.max(1, Math.round(abs / 60))}m`;
  if (abs < 86400) return `${(abs / 3600).toFixed(1).replace(/\.0$/, '')}h`;
  return `${(abs / 86400).toFixed(1).replace(/\.0$/, '')}d`;
}

export function CandleChart({
  candles,
  intervalSec,
  height = 440,
  symbol,
  loading = false,
  error = null,
  overlays = [],
  markers = [],
  compact = false,
}: {
  candles: Candle[];
  intervalSec: number;
  height?: number;
  symbol: string;
  loading?: boolean;
  error?: string | null;
  overlays?: ChartPriceOverlay[];
  markers?: ChartSimMarker[];
  compact?: boolean;
}) {
  const { ref, width } = useWidth(760);
  const [visible, setVisible] = useState(90);
  const [pan, setPan] = useState(0); // buckets scrolled back from the newest
  const [hover, setHover] = useState<{ index: number; x: number; y: number; cursorY: number; cursorPrice: number } | null>(null);
  const [sma7, setSma7] = useState(false);
  const [ema20, setEma20] = useState(true);
  const [ema50, setEma50] = useState(false);
  const [bollinger, setBollinger] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [style, setStyle] = useState<'line' | 'candles'>('candles');
  const [tool, setTool] = useState<DrawTool>('pan');
  const [draftStart, setDraftStart] = useState<ChartPoint | null>(null);
  const [draftCursor, setDraftCursor] = useState<ChartPoint | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawings>(EMPTY_DRAWINGS);
  const [drawHistory, setDrawHistory] = useState<Array<'level' | 'trend' | 'measure'>>([]);
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `candle-fill-${rawId}`;
  const clipId = `candle-clip-${rawId}`;
  const drag = useRef<{ startX: number; startPan: number } | null>(null);
  const loadedKeyRef = useRef<string | null>(null);

  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  const drawingsKey = chainStorageKey(`strata.chart.drawings.${symbol}`);
  const legacyMarksKey = chainStorageKey(`strata.chart.marks.${symbol}`);

  useEffect(() => {
    setDraftStart(null);
    setDraftCursor(null);
    loadedKeyRef.current = null;
    try {
      const raw = window.localStorage.getItem(drawingsKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ChartDrawings>;
        setDrawings({
          levels: Array.isArray(parsed.levels) ? parsed.levels.filter(Number.isFinite) : [],
          trends: Array.isArray(parsed.trends) ? parsed.trends : [],
          ranges: Array.isArray(parsed.ranges) ? parsed.ranges : [],
        });
        setDrawHistory([]);
        loadedKeyRef.current = drawingsKey;
        return;
      }
      const legacyRaw = window.localStorage.getItem(legacyMarksKey);
      const legacyLevels = legacyRaw ? (JSON.parse(legacyRaw) as number[]).filter(Number.isFinite) : [];
      setDrawings({ levels: legacyLevels, trends: [], ranges: [] });
      setDrawHistory([]);
      loadedKeyRef.current = drawingsKey;
    } catch {
      setDrawings(EMPTY_DRAWINGS);
      setDrawHistory([]);
      loadedKeyRef.current = drawingsKey;
    }
  }, [drawingsKey, legacyMarksKey]);

  useEffect(() => {
    if (loadedKeyRef.current !== drawingsKey) return;
    try {
      window.localStorage.setItem(
        drawingsKey,
        JSON.stringify({
          levels: drawings.levels.slice(-30),
          trends: drawings.trends.slice(-20),
          ranges: drawings.ranges.slice(-15),
        }),
      );
    } catch {
      /* storage may be unavailable */
    }
  }, [drawingsKey, drawings]);

  useEffect(() => {
    if (tool === 'pan' && !draftStart) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraftStart(null);
        setDraftCursor(null);
        setTool('pan');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool, draftStart]);

  const spanSeconds = Math.max(intervalSec * 4, visible * intervalSec);
  const end = (last?.time ?? Math.floor(Date.now() / 1000)) + intervalSec - pan * intervalSec;
  const start = end - spanSeconds;

  const shown = useMemo(
    () => candles.filter((candle) => candle.time + intervalSec > start && candle.time < end),
    [candles, start, end, intervalSec],
  );

  const bbPoints = useMemo(() => {
    if (!bollinger || shown.length === 0) return [];
    const period = 20;
    return shown.map((candle, idx) => {
      const slice = shown.slice(Math.max(0, idx - period + 1), idx + 1);
      const mean = slice.reduce((acc, item) => acc + item.close, 0) / slice.length;
      const variance = slice.reduce((acc, item) => acc + (item.close - mean) ** 2, 0) / slice.length;
      const std = Math.sqrt(variance);
      return {
        time: candle.time,
        mid: mean,
        upper: mean + 2 * std,
        lower: Math.max(1e-12, mean - 2 * std),
      };
    });
  }, [bollinger, shown]);

  const highs = [
    ...shown.map((candle) => candle.high),
    ...(bollinger ? bbPoints.map((b) => b.upper) : []),
  ];
  const lows = [
    ...shown.map((candle) => candle.low),
    ...(bollinger ? bbPoints.map((b) => b.lower) : []),
  ];
  const baseHigh = highs.length ? Math.max(...highs) : last?.close ?? 1;
  const baseLow = lows.length ? Math.min(...lows) : last?.close ?? 0;
  const reasonableOverlays = overlays
    .map((o) => o.price)
    .filter((p) => Number.isFinite(p) && p > 0 && (highs.length === 0 || (p >= baseLow * 0.45 && p <= baseHigh * 1.8)));
  const rawHigh = Math.max(baseHigh, ...(reasonableOverlays.length ? reasonableOverlays : [baseHigh]));
  const rawLow = Math.min(baseLow, ...(reasonableOverlays.length ? reasonableOverlays : [baseLow]));
  const useLog = logScale && rawLow > 0 && rawHigh > rawLow;
  const priceSpan = rawHigh - rawLow || Math.abs(rawHigh) * 0.01 || 1;
  const high = useLog ? rawHigh * Math.pow(rawHigh / rawLow, 0.06) : rawHigh + priceSpan * 0.06;
  const low = useLog ? rawLow / Math.pow(rawHigh / rawLow, 0.06) : Math.max(0, rawLow - priceSpan * 0.06);
  const scale = high - low || 1;

  const ticks = useLog
    ? Array.from({ length: 4 }, (_, i) => low * Math.pow(high / low, i / 3))
    : Array.from({ length: 4 }, (_, i) => low + (scale * i) / 3);
  const timeTicks = Array.from({ length: 4 }, (_, i) => start + (spanSeconds * i) / 3);
  const maxTickChars = Math.max(6, ...ticks.map((t) => priceFmt(t).length));
  const padLeft = Math.max(72, Math.ceil(maxTickChars * 8 + 16));
  const padRight = 18;
  const padTop = 18;
  const priceHeight = showVolume
    ? Math.round((height - 58) * 0.76)
    : Math.max(80, height - padTop - 26);
  const volTop = padTop + priceHeight + 12;
  const volHeight = showVolume ? Math.max(24, height - volTop - 26) : 0;
  const bottomAxisY = showVolume ? volTop + volHeight : padTop + priceHeight;
  const innerW = Math.max(20, width - padLeft - padRight);
  const lastPriceLabel = last ? priceFmt(last.close) : '';
  const lastBadgeWidth = Math.max(64, Math.ceil(lastPriceLabel.length * 7.8 + 16));

  const xFor = (time: number) => padLeft + ((time - start) / (end - start)) * innerW;
  const yFor = (price: number) => {
    if (useLog) {
      const safe = Math.max(low, price);
      const ratio = Math.log(safe / low) / (Math.log(high / low) || 1);
      return padTop + priceHeight - ratio * priceHeight;
    }
    return padTop + priceHeight - ((price - low) / scale) * priceHeight;
  };
  const priceForY = (clientY: number, boundsTop: number) => {
    const ratio = Math.min(1, Math.max(0, (clientY - boundsTop - padTop) / priceHeight));
    if (useLog) {
      return Number((low * Math.pow(high / low, 1 - ratio)).toPrecision(10));
    }
    return Number((high - ratio * scale).toPrecision(10));
  };
  const timeForX = (clientX: number, boundsLeft: number) => {
    const ratio = Math.min(1, Math.max(0, (clientX - boundsLeft - padLeft) / innerW));
    return Math.round(start + ratio * (end - start));
  };

  const candleWidth = Math.max(1.5, Math.min(18, (intervalSec / (end - start)) * innerW * 0.68));
  const maxVolume = Math.max(...shown.map((candle) => candle.volume), 0) || 1;
  const linePath = shown
    .map((candle, index) => `${index === 0 ? 'M' : 'L'} ${xFor(candle.time + intervalSec / 2)} ${yFor(candle.close)}`)
    .join(' ');
  const areaPath = shown.length > 1
    ? `${linePath} L ${xFor(shown[shown.length - 1].time + intervalSec / 2)} ${padTop + priceHeight} L ${xFor(shown[0].time + intervalSec / 2)} ${padTop + priceHeight} Z`
    : '';
  const emaPath = (period: number) => {
    const alpha = 2 / (period + 1);
    let value = shown[0]?.close ?? 0;
    return shown
      .map((candle, index) => {
        value = index === 0 ? candle.close : candle.close * alpha + value * (1 - alpha);
        return `${index === 0 ? 'M' : 'L'} ${xFor(candle.time + intervalSec / 2)} ${yFor(value)}`;
      })
      .join(' ');
  };
  const smaPath = (period: number) =>
    shown
      .map((_, index) => {
        const slice = shown.slice(Math.max(0, index - period + 1), index + 1);
        const avg = slice.reduce((acc, item) => acc + item.close, 0) / slice.length;
        return `${index === 0 ? 'M' : 'L'} ${xFor(shown[index].time + intervalSec / 2)} ${yFor(avg)}`;
      })
      .join(' ');

  const bbUpperPath = bbPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xFor(pt.time + intervalSec / 2)} ${yFor(pt.upper)}`).join(' ');
  const bbLowerPath = bbPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xFor(pt.time + intervalSec / 2)} ${yFor(pt.lower)}`).join(' ');
  const bbBandPath = bbPoints.length > 1
    ? `${bbUpperPath} ${bbPoints.slice().reverse().map((pt) => `L ${xFor(pt.time + intervalSec / 2)} ${yFor(pt.lower)}`).join(' ')} Z`
    : '';

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
    const bounds = event.currentTarget.getBoundingClientRect();
    const point: ChartPoint = {
      time: timeForX(event.clientX, bounds.left),
      price: priceForY(event.clientY, bounds.top),
    };

    if (tool === 'level' && shown.length) {
      setDrawings((prev) => ({ ...prev, levels: [...prev.levels, point.price].slice(-30) }));
      setDrawHistory((prev) => [...prev, 'level']);
      setTool('pan');
      return;
    }

    if ((tool === 'trend' || tool === 'measure') && shown.length) {
      if (!draftStart) {
        setDraftStart(point);
        setDraftCursor(point);
      } else {
        const item: TrendDrawing = { a: draftStart, b: point };
        if (tool === 'trend') {
          setDrawings((prev) => ({ ...prev, trends: [...prev.trends, item].slice(-20) }));
          setDrawHistory((prev) => [...prev, 'trend']);
        } else {
          setDrawings((prev) => ({ ...prev, ranges: [...prev.ranges, item].slice(-15) }));
          setDrawHistory((prev) => [...prev, 'measure']);
        }
        setDraftStart(null);
        setDraftCursor(null);
        setTool('pan');
      }
      return;
    }

    drag.current = { startX: event.clientX, startPan: pan };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (drag.current) {
      const dx = event.clientX - drag.current.startX;
      const delta = (dx / innerW) * visible;
      const nextPan = Math.max(0, drag.current.startPan + delta);
      setPan(nextPan);
      drag.current.startX = event.clientX;
      drag.current.startPan = nextPan;
      return;
    }

    const cursorPrice = priceForY(event.clientY, bounds.top);
    const cursorTime = timeForX(event.clientX, bounds.left);
    if (draftStart) {
      setDraftCursor({ time: cursorTime, price: cursorPrice });
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
      cursorY: Math.min(padTop + priceHeight, Math.max(padTop, event.clientY - bounds.top)),
      cursorPrice,
    });
  };

  const stopDrag = () => { drag.current = null; };
  const hovered = hover ? shown[hover.index] : null;
  const totalDrawings = drawings.levels.length + drawings.trends.length + drawings.ranges.length;

  const undoLastDrawing = () => {
    const lastKind = drawHistory[drawHistory.length - 1];
    if (lastKind) {
      setDrawHistory((prev) => prev.slice(0, -1));
      setDrawings((prev) => ({
        levels: lastKind === 'level' ? prev.levels.slice(0, -1) : prev.levels,
        trends: lastKind === 'trend' ? prev.trends.slice(0, -1) : prev.trends,
        ranges: lastKind === 'measure' ? prev.ranges.slice(0, -1) : prev.ranges,
      }));
      return;
    }
    if (drawings.ranges.length) {
      setDrawings((prev) => ({ ...prev, ranges: prev.ranges.slice(0, -1) }));
    } else if (drawings.trends.length) {
      setDrawings((prev) => ({ ...prev, trends: prev.trends.slice(0, -1) }));
    } else if (drawings.levels.length) {
      setDrawings((prev) => ({ ...prev, levels: prev.levels.slice(0, -1) }));
    }
  };

  const renderRangeBox = (item: TrendDrawing, key: string, isDraft = false) => {
    const x1 = xFor(item.a.time);
    const x2 = xFor(item.b.time);
    const y1 = yFor(item.a.price);
    const y2 = yFor(item.b.price);
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.max(2, Math.abs(x2 - x1));
    const h = Math.max(2, Math.abs(y2 - y1));
    const pct = item.a.price > 0 ? ((item.b.price - item.a.price) / item.a.price) * 100 : 0;
    const up = item.b.price >= item.a.price;
    const stroke = up ? 'var(--up)' : 'var(--down)';
    const fill = up ? 'var(--up-soft)' : 'var(--down-soft)';
    const label = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% · ${spanLabel(item.b.time - item.a.time)}`;
    const boxW = Math.max(96, label.length * 6.8 + 14);
    const boxX = Math.min(padLeft + innerW - boxW - 4, Math.max(padLeft + 4, left + 4));
    const boxY = Math.max(padTop + 2, top - 20);
    return (
      <g key={key} opacity={isDraft ? 0.85 : 1}>
        <rect x={left} y={top} width={w} height={h} fill={fill} stroke={stroke} strokeWidth="1.2" strokeDasharray={isDraft ? '4 3' : undefined} />
        <rect x={boxX} y={boxY} width={boxW} height="18" rx="4" fill="var(--surface-3)" stroke={stroke} strokeWidth="0.8" />
        <text x={boxX + 6} y={boxY + 12} fill={stroke} fontSize="11" fontFamily="var(--font-mono)">
          {label}
        </text>
      </g>
    );
  };

  const activeCandle = hovered ?? last;
  const candleDeltaPct = activeCandle && activeCandle.open > 0
    ? ((activeCandle.close - activeCandle.open) / activeCandle.open) * 100
    : null;

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
          <div className="seg-tabs" style={{ marginTop: 0 }} role="group" aria-label="Chart mode">
            <button type="button" className={style === 'candles' ? 'seg-tab active' : 'seg-tab'} onClick={() => setStyle('candles')}>Candles</button>
            <button type="button" className={style === 'line' ? 'seg-tab active' : 'seg-tab'} onClick={() => setStyle('line')}>Line</button>
          </div>

          {!compact && (
            <>
              <div className="candle-tool-group" role="group" aria-label="Indicators">
                <button type="button" className={sma7 ? 'chip active' : 'chip'} onClick={() => setSma7((v) => !v)}>SMA 7</button>
                <button type="button" className={ema20 ? 'chip active' : 'chip'} onClick={() => setEma20((v) => !v)}>EMA 20</button>
                <button type="button" className={ema50 ? 'chip active' : 'chip'} onClick={() => setEma50((v) => !v)}>EMA 50</button>
                <button type="button" className={bollinger ? 'chip active' : 'chip'} onClick={() => setBollinger((v) => !v)}>BB 20</button>
                <button type="button" className={showVolume ? 'chip active' : 'chip'} onClick={() => setShowVolume((v) => !v)}>Vol</button>
                <button type="button" className={logScale ? 'chip active' : 'chip'} onClick={() => setLogScale((v) => !v)} title="Logarithmic price scale">Log</button>
              </div>

              <div className="candle-tool-group" role="group" aria-label="Drawing tools">
                <button
                  type="button"
                  className={tool === 'level' ? 'chip active' : 'chip'}
                  onClick={() => { setDraftStart(null); setDraftCursor(null); setTool((t) => (t === 'level' ? 'pan' : 'level')); }}
                  title="Click chart to place horizontal price level"
                >
                  H-Line
                </button>
                <button
                  type="button"
                  className={tool === 'trend' ? 'chip active' : 'chip'}
                  onClick={() => { setDraftStart(null); setDraftCursor(null); setTool((t) => (t === 'trend' ? 'pan' : 'trend')); }}
                  title="Click two points to draw a trendline"
                >
                  Trend
                </button>
                <button
                  type="button"
                  className={tool === 'measure' ? 'chip active' : 'chip'}
                  onClick={() => { setDraftStart(null); setDraftCursor(null); setTool((t) => (t === 'measure' ? 'pan' : 'measure')); }}
                  title="Click two points to measure price & time range"
                >
                  Measure
                </button>
                {totalDrawings > 0 && (
                  <>
                    <button type="button" className="chip" onClick={undoLastDrawing}>Undo</button>
                    <button type="button" className="chip" onClick={() => { setDrawings(EMPTY_DRAWINGS); setDrawHistory([]); setDraftStart(null); setDraftCursor(null); }}>Clear</button>
                  </>
                )}
              </div>

              <div className="candle-tool-group" role="group" aria-label="Zoom and pan">
                <button type="button" className="chip" aria-label="Zoom out" onClick={() => setVisible((v) => Math.round(Math.min(400, v * 1.25)))}>−</button>
                <button type="button" className="chip" aria-label="Zoom in" onClick={() => setVisible((v) => Math.round(Math.max(12, v * 0.8)))}>+</button>
                {(pan > 0 || visible !== 90) && (
                  <button type="button" className="chip" onClick={() => { setPan(0); setVisible(90); }}>Reset</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {!compact && tool !== 'pan' && (
        <div className="candle-draw-hint mono">
          {tool === 'level' && 'Click anywhere on the chart to place a horizontal price level.'}
          {tool === 'trend' && (draftStart ? 'Click end point to lock trendline (click Trend again to cancel).' : 'Click start point on the chart for trendline.')}
          {tool === 'measure' && (draftStart ? 'Click second point to finish measurement.' : 'Click first point on the chart to measure % move and duration.')}
        </div>
      )}

      <div className="candle-readout mono" aria-live="polite">
        {hovered ? (
          <>
            <span className="muted">{fullTime(hovered.time)}</span>
            <span>O <b>{priceFmt(hovered.open)}</b></span>
            <span>H <b>{priceFmt(hovered.high)}</b></span>
            <span>L <b>{priceFmt(hovered.low)}</b></span>
            <span>C <b>{priceFmt(hovered.close)}</b></span>
            {candleDeltaPct !== null && (
              <span className={candleDeltaPct >= 0 ? 'up' : 'down'}>
                {candleDeltaPct >= 0 ? '+' : ''}{candleDeltaPct.toFixed(2)}%
              </span>
            )}
            <span className="muted">Vol {fmtNum(Number(hovered.volume.toFixed(2)))}</span>
          </>
        ) : last ? (
          <>
            <span className="muted">Latest · {fullTime(last.time)}</span>
            <span>O <b>{priceFmt(last.open)}</b></span>
            <span>H <b>{priceFmt(last.high)}</b></span>
            <span>L <b>{priceFmt(last.low)}</b></span>
            <span>C <b>{priceFmt(last.close)}</b></span>
            {candleDeltaPct !== null && (
              <span className={candleDeltaPct >= 0 ? 'up' : 'down'}>
                {candleDeltaPct >= 0 ? '+' : ''}{candleDeltaPct.toFixed(2)}%
              </span>
            )}
            <span className="muted">{shown.length} bars</span>
          </>
        ) : (
          <span className="muted">Hover chart to inspect OHLCV</span>
        )}
      </div>

      <svg
        width="100%"
        height={height}
        role="img"
        aria-label={`${symbol} price chart, ${shown.length} candles`}
        onPointerDown={onPointerDown}
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
          <clipPath id={clipId}>
            <rect x={padLeft} y={padTop} width={innerW} height={priceHeight} />
          </clipPath>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padLeft} x2={padLeft + innerW} y1={yFor(tick)} y2={yFor(tick)} stroke="var(--line-soft)" />
            <text x={padLeft - 10} y={yFor(tick) + 4} textAnchor="end" fill="var(--muted)" fontSize="12.5" fontFamily="var(--font-mono)">
              {priceFmt(tick)}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {bollinger && bbPoints.length > 1 && (
            <>
              <path d={bbBandPath} fill="var(--accent)" opacity="0.07" stroke="none" />
              <path d={bbUpperPath} fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
              <path d={bbLowerPath} fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
            </>
          )}

          {style === 'line' && shown.length > 1 && (
            <>
              <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
              <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
          {sma7 && shown.length > 1 && <path d={smaPath(7)} fill="none" stroke="var(--warn)" strokeWidth="1.15" opacity="0.75" />}
          {ema20 && shown.length > 1 && <path d={emaPath(20)} fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity="0.55" />}
          {ema50 && shown.length > 1 && <path d={emaPath(50)} fill="none" stroke="var(--accent-2)" strokeWidth="1.2" opacity="0.65" />}

          {drawings.levels.map((price, index) => (
            price >= low && price <= high ? (
              <g key={`lvl-${price}-${index}`}>
                <line x1={padLeft} x2={padLeft + innerW} y1={yFor(price)} y2={yFor(price)} stroke="var(--warn)" strokeWidth="1.2" strokeDasharray="5 4" />
                <text x={padLeft + innerW - 6} y={Math.max(padTop + 12, yFor(price) - 4)} textAnchor="end" fill="var(--warn)" fontSize="11" fontFamily="var(--font-mono)">
                  {priceFmt(price)}
                </text>
              </g>
            ) : null
          ))}

          {drawings.trends.map((tr, index) => (
            <line
              key={`tr-${index}`}
              x1={xFor(tr.a.time)}
              y1={yFor(tr.a.price)}
              x2={xFor(tr.b.time)}
              y2={yFor(tr.b.price)}
              stroke="var(--accent)"
              strokeWidth="1.6"
            />
          ))}
          {tool === 'trend' && draftStart && draftCursor && (
            <line
              x1={xFor(draftStart.time)}
              y1={yFor(draftStart.price)}
              x2={xFor(draftCursor.time)}
              y2={yFor(draftCursor.price)}
              stroke="var(--accent)"
              strokeWidth="1.4"
              strokeDasharray="4 3"
            />
          )}

          {drawings.ranges.map((rng, index) => renderRangeBox(rng, `rng-${index}`))}
          {tool === 'measure' && draftStart && draftCursor && renderRangeBox({ a: draftStart, b: draftCursor }, 'rng-draft', true)}

          {overlays.map((overlay, index) => {
            if (!Number.isFinite(overlay.price) || overlay.price < low || overlay.price > high) return null;
            const color = overlay.tone === 'up'
              ? 'var(--up)'
              : overlay.tone === 'down'
                ? 'var(--down)'
                : overlay.tone === 'warn'
                  ? 'var(--warn)'
                  : 'var(--accent)';
            const y = yFor(overlay.price);
            return (
              <g key={`ov-${overlay.label}-${index}`}>
                <line x1={padLeft} x2={padLeft + innerW} y1={y} y2={y} stroke={color} strokeWidth="1.15" strokeDasharray="4 3" opacity="0.85" />
                <text x={padLeft + 4} y={Math.max(padTop + 10, y - 3)} fill={color} fontSize="10.5" fontFamily="var(--font-mono)">
                  {overlay.label} · {priceFmt(overlay.price)}
                </text>
              </g>
            );
          })}

          {shown.map((candle) => {
            const x = xFor(candle.time + intervalSec / 2);
            const up = candle.close >= candle.open;
            const color = up ? 'var(--up)' : 'var(--down)';
            const bodyTop = yFor(Math.max(candle.open, candle.close));
            const bodyBottom = yFor(Math.min(candle.open, candle.close));
            return (
              <g key={candle.time}>
                {style === 'candles' && (
                  <>
                    <line x1={x} x2={x} y1={yFor(candle.high)} y2={yFor(candle.low)} stroke={color} strokeWidth="1" />
                    <rect
                      x={x - candleWidth / 2}
                      y={bodyTop}
                      width={candleWidth}
                      height={Math.max(1.2, bodyBottom - bodyTop)}
                      fill={up ? 'var(--up-soft)' : 'var(--down-soft)'}
                      stroke={color}
                      strokeWidth="1"
                    />
                  </>
                )}
              </g>
            );
          })}

          {markers.map((marker, index) => {
            if (marker.time + intervalSec < start || marker.time > end) return null;
            if (!Number.isFinite(marker.price) || marker.price < low || marker.price > high) return null;
            const x = xFor(marker.time + intervalSec / 2);
            const y = yFor(marker.price);
            const color = marker.side === 'buy' ? 'var(--up)' : 'var(--down)';
            return (
              <g key={`mk-${marker.time}-${index}`}>
                <circle cx={x} cy={y} r="3.6" fill={color} stroke="var(--bg)" strokeWidth="1.2" />
              </g>
            );
          })}
        </g>

        {showVolume && (
          <>
            {shown.map((candle) => {
              const x = xFor(candle.time + intervalSec / 2);
              const up = candle.close >= candle.open;
              const color = up ? 'var(--up)' : 'var(--down)';
              const volH = (candle.volume / maxVolume) * volHeight;
              return (
                <rect
                  key={`vol-${candle.time}`}
                  x={x - candleWidth / 2}
                  y={volTop + volHeight - volH}
                  width={candleWidth}
                  height={Math.max(0.5, volH)}
                  fill={color}
                  opacity="0.35"
                />
              );
            })}
            <text x={padLeft} y={volTop - 4} fill="var(--muted)" fontSize="11.5" fontFamily="var(--font-mono)">
              VOL · ASE
            </text>
          </>
        )}

        <line x1={padLeft} x2={padLeft + innerW} y1={bottomAxisY} y2={bottomAxisY} stroke="var(--line)" />

        {timeTicks.map((tick, idx) => (
          <text
            key={tick}
            x={xFor(tick)}
            y={height - 6}
            textAnchor={idx === 0 ? 'start' : idx === timeTicks.length - 1 ? 'end' : 'middle'}
            fill="var(--muted)"
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
            <rect x={padLeft + innerW - lastBadgeWidth} y={yFor(last.close) - 10} width={lastBadgeWidth} height="20" rx="4" fill="var(--surface-3)" stroke="var(--accent-line)" />
            <text x={padLeft + innerW - lastBadgeWidth / 2} y={yFor(last.close) + 4} textAnchor="middle" fill="var(--text)" fontSize="12" fontFamily="var(--font-mono)">
              {lastPriceLabel}
            </text>
          </g>
        )}

        {hovered && hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={padTop} y2={bottomAxisY} stroke="var(--accent-line)" strokeDasharray="3 3" />
            <line x1={padLeft} x2={padLeft + innerW} y1={hover.cursorY} y2={hover.cursorY} stroke="var(--line)" strokeDasharray="2 3" />
            <circle cx={hover.x} cy={hover.y} r="3" fill="var(--accent)" />
            <rect
              x={padLeft + innerW - Math.max(64, priceFmt(hover.cursorPrice).length * 7.8 + 16)}
              y={hover.cursorY - 10}
              width={Math.max(64, priceFmt(hover.cursorPrice).length * 7.8 + 16)}
              height="20"
              rx="4"
              fill="var(--surface-3)"
              stroke="var(--line)"
            />
            <text
              x={padLeft + innerW - Math.max(64, priceFmt(hover.cursorPrice).length * 7.8 + 16) / 2}
              y={hover.cursorY + 4}
              textAnchor="middle"
              fill="var(--text)"
              fontSize="11.5"
              fontFamily="var(--font-mono)"
            >
              {priceFmt(hover.cursorPrice)}
            </text>
          </g>
        )}
      </svg>

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
