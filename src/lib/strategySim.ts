import type { Candle } from './marketData';

export interface ChartPriceOverlay {
  price: number;
  label: string;
  tone: 'up' | 'down' | 'warn' | 'accent';
}

export interface ChartSimMarker {
  time: number;
  price: number;
  side: 'buy' | 'sell';
  label: string;
}

export interface SpotSimParams {
  templateId: string;
  spotPrice: number;
  thresholdBps: number;
  levels: number;
  slices: number;
  intervalSec: number;
  stopLossBps: number;
  takeProfitBps: number;
  targetUpsideBps: number;
  costBasis: number;
  feeBps: number;
}

export interface PerpsSimParams {
  mode: 'contract' | 'direct';
  templateId: string;
  directKind?: string;
  markPrice: number;
  side: 'LONG' | 'SHORT';
  leverage: number;
  totalMargin: number;
  legMargin: number;
  intervalSec: number;
  tpPct: number;
  slPct: number;
  drawdownPct: number;
  stepPct: number;
  levels: number;
  slices: number;
  triggerDir: 'below' | 'above';
  triggerMovePct: number;
  momentumBps: number;
  liqPrice: number | null;
  limitPrice?: number;
  scaleFrom?: number;
  scaleTo?: number;
  scaleSteps?: number;
  trailPct?: number;
  triggerPrice?: number;
  takerFeeBps?: number;
}

export interface StrategySimResult {
  overlays: ChartPriceOverlay[];
  markers: ChartSimMarker[];
  fillsCount: number;
  estReturnPct: number | null;
  holdReturnPct: number | null;
  maxDrawdownPct: number;
  estGasAse: number;
  candleCount: number;
  summary: string;
}

const GAS_PER_RUN_ASE = 0.0004;

function computeMaxDrawdownPct(equities: number[]): number {
  let peak = 0;
  let maxDd = 0;
  for (const eq of equities) {
    if (eq > peak) peak = eq;
    if (peak > 0) {
      const dd = ((peak - eq) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return Number(maxDd.toFixed(2));
}

function replayHoldReturn(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  if (first <= 0 || last <= 0) return null;
  return Number((((last - first) / first) * 100).toFixed(2));
}

export function simulateSpotStrategy(candles: Candle[], params: SpotSimParams): StrategySimResult {
  const overlays: ChartPriceOverlay[] = [];
  const markers: ChartSimMarker[] = [];
  const refPrice = params.spotPrice > 0 ? params.spotPrice : (candles[candles.length - 1]?.close ?? 0);
  const feeRate = Math.max(0, params.feeBps) / 10_000;

  if (refPrice > 0) {
    const stepFrac = Math.max(0.0005, params.thresholdBps / 10_000);
    if (params.templateId === 'grid') {
      const count = Math.min(6, Math.max(1, params.levels));
      for (let i = 1; i <= count; i += 1) {
        const buyPx = refPrice * (1 - stepFrac * i);
        const sellPx = refPrice * (1 + stepFrac * i);
        if (buyPx > 0) overlays.push({ price: buyPx, label: `Buy L${i}`, tone: 'up' });
        overlays.push({ price: sellPx, label: `Sell L${i}`, tone: 'down' });
      }
    } else if (params.templateId === 'limit-exit') {
      const target = refPrice * (1 + params.targetUpsideBps / 10_000);
      overlays.push({ price: target, label: `Exit +${(params.targetUpsideBps / 100).toFixed(1)}%`, tone: 'down' });
    } else if (params.templateId === 'scale') {
      const count = Math.min(6, Math.max(2, params.levels));
      const maxMove = params.targetUpsideBps / 10_000;
      for (let i = 1; i <= count; i += 1) {
        const lvl = refPrice * (1 + (maxMove * i) / count);
        overlays.push({ price: lvl, label: `Scale ${i}`, tone: 'down' });
      }
    } else if (params.templateId === 'risk-managed') {
      const basis = params.costBasis > 0 ? params.costBasis : refPrice;
      if (params.costBasis > 0) overlays.push({ price: basis, label: 'Cost basis', tone: 'accent' });
      if (params.takeProfitBps > 0) {
        overlays.push({ price: basis * (1 + params.takeProfitBps / 10_000), label: `TP +${(params.takeProfitBps / 100).toFixed(1)}%`, tone: 'up' });
      }
      if (params.stopLossBps > 0) {
        overlays.push({ price: basis * (1 - params.stopLossBps / 10_000), label: `SL -${(params.stopLossBps / 100).toFixed(1)}%`, tone: 'down' });
      }
    }
  }

  if (candles.length < 2) {
    return {
      overlays,
      markers,
      fillsCount: 0,
      estReturnPct: null,
      holdReturnPct: null,
      maxDrawdownPct: 0,
      estGasAse: 0,
      candleCount: candles.length,
      summary: 'Showing live price levels. Historical replay unlocks once indexed candles load.',
    };
  }

  const windowCandles = candles.slice(-168); // up to 7d on 1h candles
  const holdReturnPct = replayHoldReturn(windowCandles);
  const anchor = windowCandles[0].close;
  const equities: number[] = [];

  if (params.templateId === 'grid') {
    const stepFrac = Math.max(0.0005, params.thresholdBps / 10_000);
    const levels = Math.min(10, Math.max(1, params.levels));
    let cashAse = 100;
    let tokens = 100 / Math.max(anchor, 1e-12);
    const initialEq = cashAse + tokens * anchor;
    const bought = new Set<number>();
    const sold = new Set<number>();
    const legAse = cashAse / levels;
    const legTok = tokens / levels;

    for (const c of windowCandles) {
      for (let i = 1; i <= levels; i += 1) {
        const buyPx = anchor * (1 - stepFrac * i);
        const sellPx = anchor * (1 + stepFrac * i);
        if (!bought.has(i) && c.low <= buyPx && cashAse >= legAse * 0.99) {
          bought.add(i);
          cashAse -= legAse;
          tokens += (legAse * (1 - feeRate)) / buyPx;
          markers.push({ time: c.time, price: buyPx, side: 'buy', label: `Buy L${i}` });
        }
        if (!sold.has(i) && c.high >= sellPx && tokens >= legTok * 0.99) {
          sold.add(i);
          tokens -= legTok;
          cashAse += legTok * sellPx * (1 - feeRate);
          markers.push({ time: c.time, price: sellPx, side: 'sell', label: `Sell L${i}` });
        }
      }
      equities.push(cashAse + tokens * c.close);
    }
    const finalEq = equities[equities.length - 1] ?? initialEq;
    return {
      overlays,
      markers,
      fillsCount: markers.length,
      estReturnPct: Number((((finalEq - initialEq) / initialEq) * 100).toFixed(2)),
      holdReturnPct,
      maxDrawdownPct: computeMaxDrawdownPct(equities),
      estGasAse: Number((markers.length * GAS_PER_RUN_ASE).toFixed(4)),
      candleCount: windowCandles.length,
      summary: `Replayed ${windowCandles.length} real candles: ${markers.length} grid level fills around initial anchor.`,
    };
  }

  if (params.templateId === 'dca' || params.templateId === 'twap') {
    const isBuy = params.templateId === 'dca';
    const targetFills = isBuy
      ? Math.min(24, Math.max(2, Math.floor((windowCandles.length * 3600) / Math.max(300, params.intervalSec))))
      : Math.min(windowCandles.length, Math.max(2, params.slices));
    const stride = Math.max(1, Math.floor(windowCandles.length / targetFills));
    let totalCost = 0;
    let totalUnits = 0;
    for (let i = 0; i < windowCandles.length && markers.length < targetFills; i += stride) {
      const c = windowCandles[i];
      totalCost += 1;
      totalUnits += (1 * (1 - feeRate)) / Math.max(c.close, 1e-12);
      markers.push({
        time: c.time,
        price: c.close,
        side: isBuy ? 'buy' : 'sell',
        label: isBuy ? 'DCA buy' : 'TWAP sell',
      });
    }
    const avgEntry = totalUnits > 0 ? totalCost / totalUnits : anchor;
    const lastClose = windowCandles[windowCandles.length - 1].close;
    const estReturnPct = isBuy
      ? Number((((lastClose - avgEntry) / Math.max(avgEntry, 1e-12)) * 100).toFixed(2))
      : Number((((avgEntry - lastClose) / Math.max(lastClose, 1e-12)) * 100).toFixed(2));
    for (const c of windowCandles) equities.push(c.close);
    return {
      overlays,
      markers,
      fillsCount: markers.length,
      estReturnPct,
      holdReturnPct,
      maxDrawdownPct: computeMaxDrawdownPct(equities),
      estGasAse: Number((markers.length * GAS_PER_RUN_ASE).toFixed(4)),
      candleCount: windowCandles.length,
      summary: `Replayed ${windowCandles.length} candles: ${markers.length} scheduled ${isBuy ? 'DCA buys' : 'TWAP slices'} (avg fill vs end price).`,
    };
  }

  if (params.templateId === 'limit-exit' || params.templateId === 'scale') {
    const levels = params.templateId === 'limit-exit' ? 1 : Math.min(10, Math.max(2, params.levels));
    const maxMove = params.targetUpsideBps / 10_000;
    const triggered = new Set<number>();
    let cash = 0;
    let remaining = 1;
    const perLevel = 1 / levels;
    for (const c of windowCandles) {
      for (let i = 1; i <= levels; i += 1) {
        const px = anchor * (1 + (maxMove * i) / levels);
        if (!triggered.has(i) && c.high >= px) {
          triggered.add(i);
          remaining -= perLevel;
          cash += perLevel * px * (1 - feeRate);
          markers.push({ time: c.time, price: px, side: 'sell', label: levels === 1 ? 'Limit exit' : `Scale ${i}` });
        }
      }
      equities.push(cash + remaining * c.close);
    }
    const finalEq = equities[equities.length - 1] ?? anchor;
    return {
      overlays,
      markers,
      fillsCount: markers.length,
      estReturnPct: Number((((finalEq - anchor) / anchor) * 100).toFixed(2)),
      holdReturnPct,
      maxDrawdownPct: computeMaxDrawdownPct(equities),
      estGasAse: Number((markers.length * GAS_PER_RUN_ASE).toFixed(4)),
      candleCount: windowCandles.length,
      summary: `Replayed ${windowCandles.length} candles: ${markers.length}/${levels} target levels reached.`,
    };
  }

  // momentum-signal, momentum-trader, risk-managed
  const stepThresh = Math.max(0.001, params.thresholdBps / 10_000);
  let activePos = params.templateId === 'risk-managed';
  let entryPx = anchor;
  let peakPx = anchor;
  let eq = 100;
  for (let i = 1; i < windowCandles.length; i += 1) {
    const prev = windowCandles[i - 1];
    const curr = windowCandles[i];
    if (params.templateId === 'risk-managed') {
      if (activePos) {
        if (curr.high > peakPx) peakPx = curr.high;
        const tpPx = params.takeProfitBps > 0 ? entryPx * (1 + params.takeProfitBps / 10_000) : Infinity;
        const slPx = params.stopLossBps > 0 ? entryPx * (1 - params.stopLossBps / 10_000) : 0;
        if (curr.high >= tpPx) {
          eq = 100 * (tpPx / entryPx) * (1 - feeRate);
          activePos = false;
          markers.push({ time: curr.time, price: tpPx, side: 'sell', label: 'TP exit' });
        } else if (curr.low <= slPx) {
          eq = 100 * (slPx / entryPx) * (1 - feeRate);
          activePos = false;
          markers.push({ time: curr.time, price: slPx, side: 'sell', label: 'SL exit' });
        } else {
          eq = 100 * (curr.close / entryPx);
        }
      }
    } else {
      const move = (curr.close - prev.close) / Math.max(prev.close, 1e-12);
      if (move >= stepThresh) {
        markers.push({ time: curr.time, price: curr.close, side: 'sell', label: 'Signal' });
      }
      eq = 100 * (curr.close / anchor);
    }
    equities.push(eq);
  }

  const finalEq = equities[equities.length - 1] ?? 100;
  return {
    overlays,
    markers,
    fillsCount: markers.length,
    estReturnPct: Number((finalEq - 100).toFixed(2)),
    holdReturnPct,
    maxDrawdownPct: computeMaxDrawdownPct(equities),
    estGasAse: Number((markers.length * GAS_PER_RUN_ASE).toFixed(4)),
    candleCount: windowCandles.length,
    summary: `Replayed ${windowCandles.length} candles: ${markers.length} trigger events observed.`,
  };
}

export function simulatePerpsStrategy(candles: Candle[], params: PerpsSimParams): StrategySimResult {
  const overlays: ChartPriceOverlay[] = [];
  const markers: ChartSimMarker[] = [];
  const mark = params.markPrice > 0 ? params.markPrice : (candles[candles.length - 1]?.close ?? 0);
  const feeRate = Math.max(0, params.takerFeeBps ?? 10) / 10_000;
  const dirSign = params.side === 'LONG' ? 1 : -1;

  if (mark > 0) {
    let entryRef = mark;
    if (params.mode === 'contract' && params.templateId === 'perp-trigger') {
      const move = Math.max(0.001, params.triggerMovePct / 100);
      entryRef = params.triggerDir === 'below' ? mark * (1 - move) : mark * (1 + move);
      overlays.push({ price: entryRef, label: `Trigger (${params.triggerDir})`, tone: 'accent' });
    } else if (params.mode === 'direct' && params.directKind === 'LIMIT' && (params.limitPrice ?? 0) > 0) {
      entryRef = params.limitPrice!;
      overlays.push({ price: entryRef, label: 'Limit entry', tone: 'accent' });
    } else if (params.mode === 'direct' && params.directKind === 'STOP' && (params.triggerPrice ?? 0) > 0) {
      entryRef = params.triggerPrice!;
      overlays.push({ price: entryRef, label: 'Trigger', tone: 'accent' });
    } else if (params.mode === 'direct' && params.directKind === 'SCALE' && (params.scaleFrom ?? 0) > 0 && (params.scaleTo ?? 0) > 0) {
      const steps = Math.min(6, Math.max(2, params.scaleSteps ?? 4));
      for (let i = 0; i < steps; i += 1) {
        const px = params.scaleFrom! + ((params.scaleTo! - params.scaleFrom!) * i) / (steps - 1);
        overlays.push({ price: px, label: `Scale ${i + 1}`, tone: 'accent' });
      }
    } else if (params.mode === 'contract' && params.templateId === 'perp-grid') {
      const step = Math.max(0.002, params.stepPct / 100);
      const count = Math.min(5, Math.max(1, params.levels));
      for (let i = 1; i <= count; i += 1) {
        const addPx = mark * (1 - dirSign * step * i);
        const tpPx = mark * (1 + dirSign * step * i);
        if (addPx > 0) overlays.push({ price: addPx, label: `Add L${i}`, tone: params.side === 'LONG' ? 'up' : 'down' });
        overlays.push({ price: tpPx, label: `TP L${i}`, tone: 'warn' });
      }
    }

    if (params.tpPct > 0 && (params.templateId === 'perp-dca' || params.templateId === 'perp-trigger' || params.templateId === 'perp-risk')) {
      const tpPx = entryRef * (1 + dirSign * (params.tpPct / 100));
      if (tpPx > 0) overlays.push({ price: tpPx, label: `TP +${params.tpPct}%`, tone: 'up' });
    }
    if (params.slPct > 0 && (params.templateId === 'perp-dca' || params.templateId === 'perp-trigger' || params.templateId === 'perp-risk')) {
      const slPx = entryRef * (1 - dirSign * (params.slPct / 100));
      if (slPx > 0) overlays.push({ price: slPx, label: `SL -${params.slPct}%`, tone: 'down' });
    }
    if (params.liqPrice && params.liqPrice > 0) {
      overlays.push({ price: params.liqPrice, label: `Est. Liq (${params.leverage}x)`, tone: 'warn' });
    }
  }

  if (candles.length < 2) {
    return {
      overlays,
      markers,
      fillsCount: 0,
      estReturnPct: null,
      holdReturnPct: null,
      maxDrawdownPct: 0,
      estGasAse: 0,
      candleCount: candles.length,
      summary: 'Showing live mark, TP/SL and estimated liquidation levels.',
    };
  }

  const windowCandles = candles.slice(-168);
  const holdReturnPct = replayHoldReturn(windowCandles);
  const anchor = windowCandles[0].close;
  const equities: number[] = [];
  let eq = 100;
  let open = false;
  let entryPx = anchor;

  if (params.mode === 'contract' && (params.templateId === 'perp-dca' || params.templateId === 'perp-twap')) {
    const targetLegs = params.templateId === 'perp-twap'
      ? Math.min(20, Math.max(2, params.slices))
      : Math.min(20, Math.max(2, Math.floor((windowCandles.length * 3600) / Math.max(300, params.intervalSec))));
    const stride = Math.max(1, Math.floor(windowCandles.length / targetLegs));
    const entries: number[] = [];
    for (let i = 0; i < windowCandles.length; i += 1) {
      const c = windowCandles[i];
      if (i % stride === 0 && entries.length < targetLegs) {
        entries.push(c.close);
        markers.push({ time: c.time, price: c.close, side: params.side === 'LONG' ? 'buy' : 'sell', label: `Leg ${entries.length}` });
      }
      const avg = entries.length ? entries.reduce((s, p) => s + p, 0) / entries.length : c.close;
      const movePct = dirSign * ((c.close - avg) / Math.max(avg, 1e-12)) * params.leverage;
      eq = Math.max(0, 100 * (1 + movePct - feeRate * params.leverage));
      equities.push(eq);
    }
  } else if (params.mode === 'contract' && params.templateId === 'perp-grid') {
    const step = Math.max(0.002, params.stepPct / 100);
    const maxLevels = Math.min(10, Math.max(1, params.levels));
    let activeLevels = 0;
    let realized = 0;
    for (const c of windowCandles) {
      for (let i = 1; i <= maxLevels; i += 1) {
        const addPx = anchor * (1 - dirSign * step * i);
        const tpPx = addPx * (1 + dirSign * step);
        if (activeLevels < i && ((params.side === 'LONG' && c.low <= addPx) || (params.side === 'SHORT' && c.high >= addPx))) {
          activeLevels = i;
          markers.push({ time: c.time, price: addPx, side: params.side === 'LONG' ? 'buy' : 'sell', label: `Add L${i}` });
        } else if (activeLevels >= i && ((params.side === 'LONG' && c.high >= tpPx) || (params.side === 'SHORT' && c.low <= tpPx))) {
          activeLevels -= 1;
          realized += (step - 2 * feeRate) * params.leverage * (100 / maxLevels);
          markers.push({ time: c.time, price: tpPx, side: params.side === 'LONG' ? 'sell' : 'buy', label: `TP L${i}` });
        }
      }
      equities.push(Math.max(0, 100 + realized));
    }
  } else {
    const moveFrac = Math.max(0.001, params.triggerMovePct / 100);
    const trigPx = params.templateId === 'perp-trigger'
      ? (params.triggerDir === 'below' ? anchor * (1 - moveFrac) : anchor * (1 + moveFrac))
      : anchor;
    if (params.templateId !== 'perp-trigger') {
      open = true;
      entryPx = anchor;
      markers.push({ time: windowCandles[0].time, price: anchor, side: params.side === 'LONG' ? 'buy' : 'sell', label: 'Open' });
    }
    for (const c of windowCandles) {
      if (!open && ((params.triggerDir === 'below' && c.low <= trigPx) || (params.triggerDir === 'above' && c.high >= trigPx))) {
        open = true;
        entryPx = trigPx;
        markers.push({ time: c.time, price: trigPx, side: params.side === 'LONG' ? 'buy' : 'sell', label: 'Trigger' });
      } else if (open) {
        const tpPx = params.tpPct > 0 ? entryPx * (1 + dirSign * (params.tpPct / 100)) : null;
        const slPx = params.slPct > 0 ? entryPx * (1 - dirSign * (params.slPct / 100)) : null;
        const hitTp = tpPx !== null && (params.side === 'LONG' ? c.high >= tpPx : c.low <= tpPx);
        const hitSl = slPx !== null && (params.side === 'LONG' ? c.low <= slPx : c.high >= slPx);
        if (hitSl && slPx !== null) {
          eq = Math.max(0, 100 * (1 - (params.slPct / 100) * params.leverage - 2 * feeRate * params.leverage));
          open = false;
          markers.push({ time: c.time, price: slPx, side: params.side === 'LONG' ? 'sell' : 'buy', label: 'SL exit' });
        } else if (hitTp && tpPx !== null) {
          eq = Math.max(0, 100 * (1 + (params.tpPct / 100) * params.leverage - 2 * feeRate * params.leverage));
          open = false;
          markers.push({ time: c.time, price: tpPx, side: params.side === 'LONG' ? 'sell' : 'buy', label: 'TP exit' });
        } else {
          const pnlFrac = dirSign * ((c.close - entryPx) / Math.max(entryPx, 1e-12)) * params.leverage;
          eq = Math.max(0, 100 * (1 + pnlFrac));
        }
      }
      equities.push(eq);
    }
  }

  const finalEq = equities[equities.length - 1] ?? 100;
  return {
    overlays,
    markers,
    fillsCount: markers.length,
    estReturnPct: Number((finalEq - 100).toFixed(2)),
    holdReturnPct,
    maxDrawdownPct: computeMaxDrawdownPct(equities),
    estGasAse: Number((markers.length * GAS_PER_RUN_ASE * 2).toFixed(4)),
    candleCount: windowCandles.length,
    summary: `Replayed ${windowCandles.length} candles at ${params.leverage}x ${params.side}: ${markers.length} simulated actions.`,
  };
}
