import { loadStrategies, type LiveStrategy } from './registry';
import { getAddressTxs, getHeads, NATIVE, STRATA_HUB, toHexAddress } from './rpc';

/**
 * One snapshot of protocol state, shared by every page.
 *
 * Home, Analytics, Activity, Leaderboard and the strategy pages all read the
 * same derived numbers from here, so the counts cannot disagree between views.
 */

export type FillSide = 'buy' | 'sell';

export interface ProtocolFill {
  key: string;
  txHash: string;
  block: number;
  timestamp: number | null;
  side: FillSide;
  /** Raw ARC-20 units of the strategy's token. */
  tokenAmount: string;
  tokenDecimals: number | null;
  symbol: string | null;
  /** ASE side of the swap, in wei. */
  aseAmount: string;
  strategyName: string;
  strategyAddress: string;
  strategyAse1: string;
  owner: string | null;
  template: string;
  verified: boolean;
}

export interface ProtocolStats {
  totalStrategies: number;
  verifiedStrategies: number;
  activeStrategies: number;
  executedFills: number;
  indexedFills: number;
  buyFills: number;
  sellFills: number;
  grossAseWei: string;
  spentAseWei: string;
  inventoryAseWei: string;
  /** Pairs covered by verified strategies, whether or not they have filled. */
  tokenSymbols: string[];
  /** Subset that actually appears in an indexed fill. */
  tradedSymbols: string[];
  lastFillAt: number | null;
  lastBlock: number;
}

export interface ProtocolSnapshot {
  at: number;
  head: number;
  strategies: LiveStrategy[];
  fills: ProtocolFill[];
  stats: ProtocolStats;
  /** True when at least one strategy's history was truncated by the index cap. */
  capped: boolean;
}

function asBig(value: string | undefined | null): bigint {
  try { return BigInt(String(value ?? '0')); } catch { return 0n; }
}

/** Derive the ASE / token pair of one fill event without mixing units. */
function fillFromEvent(strategy: LiveStrategy): ProtocolFill[] {
  const token = (strategy.token ?? '').toLowerCase();
  if (!token) return [];
  const out: ProtocolFill[] = [];
  for (const event of strategy.fillEvents) {
    const tokenIn = String(event.args.tokenIn ?? '').toLowerCase();
    const tokenOut = String(event.args.tokenOut ?? '').toLowerCase();
    const amountIn = asBig(String(event.args.amountIn ?? '0'));
    const amountOut = asBig(String(event.args.amountOut ?? '0'));
    if (amountIn <= 0n || amountOut <= 0n) continue;

    let side: FillSide;
    let tokenAmount: bigint;
    let aseAmount: bigint;
    if (tokenIn === token) {
      side = 'sell';
      tokenAmount = amountIn;
      aseAmount = amountOut;
    } else if (tokenOut === token) {
      side = 'buy';
      tokenAmount = amountOut;
      aseAmount = amountIn;
    } else {
      // Not this strategy's pair (for example a mixed grid asset): skip rather
      // than label it with the wrong token.
      continue;
    }

    out.push({
      key: `${event.txHash}-${event.block}-${side}`,
      txHash: event.txHash,
      block: event.block,
      timestamp: event.timestamp ?? null,
      side,
      tokenAmount: tokenAmount.toString(),
      tokenDecimals: strategy.tokenDecimals,
      symbol: strategy.symbol,
      aseAmount: aseAmount.toString(),
      strategyName: strategy.name,
      strategyAddress: strategy.address,
      strategyAse1: strategy.ase1,
      owner: strategy.owner,
      template: strategy.template,
      verified: strategy.verified,
    });
  }
  return out;
}

export function buildStats(strategies: LiveStrategy[], fills: ProtocolFill[]): ProtocolStats {
  const verified = strategies.filter((item) => item.verified);
  const tokens = new Set<string>();
  let gross = 0n;
  let spent = 0n;
  let inventory = 0n;
  let executed = 0;
  let lastBlock = 0;

  for (const strategy of verified) {
    gross += asBig(strategy.realisedWei);
    spent += asBig(strategy.spentAseWei);
    inventory += asBig(strategy.markValueAseWei ?? '0');
    executed += Math.max(0, strategy.trades);
    lastBlock = Math.max(lastBlock, strategy.deployBlock, strategy.fillEvents.at(-1)?.block ?? 0);
    if (strategy.symbol) tokens.add(strategy.symbol);
  }

  const lastFillAt = fills.reduce<number | null>(
    (latest, fill) => (fill.timestamp ? Math.max(latest ?? 0, fill.timestamp) : latest),
    null,
  );

  return {
    totalStrategies: strategies.length,
    verifiedStrategies: verified.length,
    activeStrategies: verified.filter((item) => item.cron !== null && item.stopped !== true).length,
    executedFills: executed,
    indexedFills: fills.length,
    buyFills: fills.filter((fill) => fill.side === 'buy').length,
    sellFills: fills.filter((fill) => fill.side === 'sell').length,
    grossAseWei: gross.toString(),
    spentAseWei: spent.toString(),
    inventoryAseWei: inventory.toString(),
    tokenSymbols: [...tokens].sort(),
    tradedSymbols: [...new Set(
      fills.filter((fill) => fill.verified && fill.symbol).map((fill) => fill.symbol as string),
    )].sort(),
    lastFillAt,
    lastBlock,
  };
}

const SNAPSHOT_KEY = 'strata:protocol:v1';
let cached: { at: number; snapshot: ProtocolSnapshot } | null = null;
let inflight: Promise<ProtocolSnapshot> | null = null;
let seededFromDisk = false;

function readStoredSnapshot(): ProtocolSnapshot | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProtocolSnapshot;
    if (!parsed || typeof parsed.at !== 'number' || !Array.isArray(parsed.strategies) || !parsed.stats) return null;
    // Older than ten minutes is no longer a useful first paint.
    if (Date.now() - parsed.at > 10 * 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeSnapshot(snapshot: ProtocolSnapshot) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // A full quota must never break the live read.
  }
}

/**
 * Load the whole protocol once, from the shared discovery + accounting layer.
 *
 * A snapshot is reused for 10 seconds and the last one is cached in local
 * storage, so navigating between pages (or reloading during a slow node
 * window) paints immediately instead of showing empty placeholders.
 */
export async function loadProtocol(owner?: string): Promise<ProtocolSnapshot> {
  if (cached && Date.now() - cached.at < 10_000) return cached.snapshot;

  if (!seededFromDisk) {
    seededFromDisk = true;
    const stored = readStoredSnapshot();
    if (stored) {
      cached = { at: Date.now(), snapshot: stored };
      // Refresh behind the first paint; the page keeps the saved values if the
      // node is still busy.
      void refreshProtocol(owner).catch(() => null);
      return stored;
    }
  }

  return refreshProtocol(owner);
}

function refreshProtocol(owner?: string): Promise<ProtocolSnapshot> {
  if (inflight) return inflight;
  inflight = buildSnapshot(owner)
    .then((snapshot) => {
      cached = { at: Date.now(), snapshot };
      storeSnapshot(snapshot);
      return snapshot;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function buildSnapshot(owner?: string): Promise<ProtocolSnapshot> {
  const [strategies, heads] = await Promise.all([
    loadStrategies(owner),
    getHeads().catch(() => ({ finalized: 0, tip: 0 })),
  ]);

  // An empty result can mean "nothing registered yet" or "the explorer index
  // never answered". The hub always has transactions, so an empty hub read
  // proves the index is unreachable and the pages must show a connection
  // error instead of a confident zero.
  if (strategies.length === 0) {
    const hubHex = toHexAddress(STRATA_HUB).toLowerCase();
    const probe = await getAddressTxs(hubHex, 1);
    if (probe.length === 0) {
      throw new Error('The Asentum explorer index is unreachable, so no contract data could be read.');
    }
  }

  const fills = strategies
    .flatMap((strategy) => fillFromEvent(strategy))
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0) || b.block - a.block);

  const snapshot: ProtocolSnapshot = {
    at: Date.now(),
    head: heads.finalized,
    strategies,
    fills,
    stats: buildStats(strategies, fills),
    capped: strategies.some((strategy) => strategy.fillsCapped),
  };
  return snapshot;
}

export type RangeKey = '24H' | '7D' | '30D' | 'ALL';

export const RANGES: { key: RangeKey; label: string; ms: number | null }[] = [
  { key: '24H', label: '24H', ms: 24 * 60 * 60 * 1000 },
  { key: '7D', label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30D', label: '30D', ms: 30 * 24 * 60 * 60 * 1000 },
  { key: 'ALL', label: 'ALL', ms: null },
];

export function fillsInRange(fills: ProtocolFill[], range: RangeKey, now = Date.now()): ProtocolFill[] {
  const spec = RANGES.find((item) => item.key === range);
  if (!spec || spec.ms === null) return fills;
  const from = now - spec.ms;
  return fills.filter((fill) => fill.timestamp !== null && fill.timestamp >= from);
}

export interface SeriesPoint {
  label: string;
  value: number;
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function hourLabel(ms: number): string {
  return `${String(new Date(ms).getUTCHours()).padStart(2, '0')}:00`;
}

function dayLabel(ms: number): string {
  const date = new Date(ms);
  return `${MONTH[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Bucket indexed fills into a real time series.
 *
 * Only fills that carry an indexed timestamp are plotted; no bucket is ever
 * filled with a synthetic value.
 */
export function buildSeries(
  fills: ProtocolFill[],
  range: RangeKey,
  metric: 'executions' | 'ase',
  now = Date.now(),
): { points: SeriesPoint[]; bucketCount: number; filled: number } {
  const spec = RANGES.find((item) => item.key === range);
  const stamped = fills.filter((fill): fill is ProtocolFill & { timestamp: number } => fill.timestamp !== null);
  const bucketCount = range === '24H' ? 12 : range === '7D' ? 7 : range === '30D' ? 15 : 12;
  const points: SeriesPoint[] = [];

  if (spec?.ms) {
    const start = now - spec.ms;
    const width = spec.ms / bucketCount;
    for (let index = 0; index < bucketCount; index += 1) {
      const from = start + index * width;
      const to = from + width;
      const slice = stamped.filter((fill) => fill.timestamp >= from && fill.timestamp < to);
      points.push({
        label: range === '24H' ? hourLabel(from) : range === '7D' ? dayLabel(from) : dayLabel(from),
        value: metric === 'executions'
          ? slice.length
          : slice.reduce((sum, fill) => sum + Number(fill.aseAmount) / 1e18, 0),
      });
    }
    return { points, bucketCount, filled: stamped.filter((fill) => fill.timestamp >= start).length };
  }

  if (stamped.length === 0) return { points: [], bucketCount, filled: 0 };
  const sorted = [...stamped].sort((a, b) => a.timestamp - b.timestamp);
  const start = sorted[0].timestamp;
  const end = Math.max(sorted[sorted.length - 1].timestamp, start + 1);
  const width = (end - start) / bucketCount;
  for (let index = 0; index < bucketCount; index += 1) {
    const from = start + index * width;
    const to = from + width;
    const slice = sorted.filter((fill) => fill.timestamp >= from && fill.timestamp < to);
    points.push({
      label: dayLabel(from),
      value: metric === 'executions'
        ? slice.length
        : slice.reduce((sum, fill) => sum + Number(fill.aseAmount) / 1e18, 0),
    });
  }
  return { points, bucketCount, filled: sorted.length };
}

export interface PairActivity {
  symbol: string;
  fills: number;
  buys: number;
  sells: number;
  aseWei: string;
  tokenVolumeRaw: string;
}

/** Trading activity grouped by token pair, never summing across assets. */
export function pairActivity(fills: ProtocolFill[]): PairActivity[] {
  const map = new Map<string, PairActivity>();
  for (const fill of fills) {
    const symbol = fill.symbol ?? 'UNKNOWN';
    const row = map.get(symbol) ?? { symbol, fills: 0, buys: 0, sells: 0, aseWei: '0', tokenVolumeRaw: '0' };
    row.fills += 1;
    if (fill.side === 'buy') row.buys += 1;
    else row.sells += 1;
    row.aseWei = (asBig(row.aseWei) + asBig(fill.aseAmount)).toString();
    row.tokenVolumeRaw = (asBig(row.tokenVolumeRaw) + asBig(fill.tokenAmount)).toString();
    map.set(symbol, row);
  }
  return [...map.values()].sort((a, b) => b.fills - a.fills);
}

export interface StrategyRow {
  strategy: LiveStrategy;
  fills: number;
  buyFills: number;
  sellFills: number;
  grossAseWei: string;
  inventoryAseWei: string;
  soldTokenRaw: string;
  lastFillAt: number | null;
}

export function strategyRows(snapshot: ProtocolSnapshot): StrategyRow[] {
  return snapshot.strategies
    .filter((strategy) => strategy.template !== 'strata-hub')
    .map((strategy) => {
      const own = snapshot.fills.filter((fill) => fill.strategyAddress === strategy.address);
      return {
        strategy,
        fills: Math.max(strategy.fillEvents.length, strategy.trades),
        buyFills: own.filter((fill) => fill.side === 'buy').length,
        sellFills: own.filter((fill) => fill.side === 'sell').length,
        grossAseWei: strategy.realisedWei,
        inventoryAseWei: strategy.markValueAseWei ?? '0',
        soldTokenRaw: strategy.volumeWei,
        lastFillAt: strategy.lastFillAt,
      };
    })
    .sort((a, b) => b.fills - a.fills);
}

export interface WalletRow {
  wallet: string;
  strategies: number;
  fills: number;
  grossAseWei: string;
  spentAseWei: string;
  inventoryAseWei: string;
  tokens: string[];
  lastFillAt: number | null;
}

/** Wallets aggregated from the same strategy snapshot, for the secondary ranking. */
export function walletRows(snapshot: ProtocolSnapshot): WalletRow[] {
  const map = new Map<string, WalletRow>();
  for (const strategy of snapshot.strategies.filter((item) => item.verified)) {
    const wallet = (strategy.owner ?? '').toLowerCase();
    if (!wallet) continue;
    const row = map.get(wallet) ?? {
      wallet,
      strategies: 0,
      fills: 0,
      grossAseWei: '0',
      spentAseWei: '0',
      inventoryAseWei: '0',
      tokens: [],
      lastFillAt: null,
    };
    row.strategies += 1;
    row.fills += Math.max(strategy.fillEvents.length, strategy.trades);
    row.grossAseWei = (asBig(row.grossAseWei) + asBig(strategy.realisedWei)).toString();
    row.spentAseWei = (asBig(row.spentAseWei) + asBig(strategy.spentAseWei)).toString();
    row.inventoryAseWei = (asBig(row.inventoryAseWei) + asBig(strategy.markValueAseWei ?? '0')).toString();
    if (strategy.symbol && !row.tokens.includes(strategy.symbol)) row.tokens.push(strategy.symbol);
    if (strategy.lastFillAt) row.lastFillAt = Math.max(row.lastFillAt ?? 0, strategy.lastFillAt);
    map.set(wallet, row);
  }
  return [...map.values()].sort((a, b) => {
    const diff = asBig(b.grossAseWei) - asBig(a.grossAseWei);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
    return b.fills - a.fills;
  });
}

/** True when a fill is a native ASE purchase rather than a token sale. */
export function isNativeSide(token: string | null): boolean {
  return (token ?? '').toLowerCase() === NATIVE;
}
