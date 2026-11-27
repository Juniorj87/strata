/**
 * Market data adapter for Advanced Trading.
 *
 * Source: Asentum's native Auras public indexer (`https://auras.asentum.com`), the same
 * service that feeds the Auras terminal's pairs, candles and trade tape. It
 * indexes Swap events emitted by the on-chain AMMs, so every candle here is
 * built from real fills - nothing is generated when no trade happened.
 *
 * Coverage is deliberately narrow:
 *   - the API serves 1m, 5m, 15m, 1h, 4h and 1d buckets
 *   - 30m is aggregated from two 15m buckets
 *   - 1w is aggregated from 1d buckets by UTC Monday
 * Aggregation never fills a gap: a bucket with no fills stays absent.
 *
 * No key, no proxy, no backend. Requests are cached briefly so switching
 * timeframes and pairs does not hammer the indexer.
 */

import { NETWORK } from './network';

export const AURAS_API = NETWORK.aurasApiUrl;

/** Bucket sizes the indexer serves directly, in seconds. */
export const NATIVE_INTERVALS = [60, 300, 900, 3600, 14400, 86400] as const;
export type NativeInterval = (typeof NATIVE_INTERVALS)[number];

export interface Timeframe {
  id: string;
  label: string;
  seconds: number;
  /** Bucket size actually requested from the indexer. */
  sourceSeconds: NativeInterval;
}

export const TIMEFRAMES: Timeframe[] = [
  { id: '1m', label: '1m', seconds: 60, sourceSeconds: 60 },
  { id: '5m', label: '5m', seconds: 300, sourceSeconds: 300 },
  { id: '15m', label: '15m', seconds: 900, sourceSeconds: 900 },
  { id: '30m', label: '30m', seconds: 1800, sourceSeconds: 900 },
  { id: '1h', label: '1h', seconds: 3600, sourceSeconds: 3600 },
  { id: '4h', label: '4h', seconds: 14400, sourceSeconds: 14400 },
  { id: '1d', label: '1d', seconds: 86400, sourceSeconds: 86400 },
  { id: '1w', label: '1w', seconds: 604800, sourceSeconds: 86400 },
];

export function timeframeById(id: string): Timeframe {
  return TIMEFRAMES.find((item) => item.id === id) ?? TIMEFRAMES[3];
}

export interface MarketPair {
  /** Indexer key, e.g. `auras2-1`. */
  poolKey: string;
  /** Pool id inside the AMM contract. */
  chainPoolId: string;
  amm: string;
  dex: 'auras' | 'asedex';
  version?: number;
  base: string;
  quote: string;
  token0: string;
  token1: string;
  feeBps: number;
  price: number | null;
  change24: number | null;
  volume24: number | null;
  trades24: number | null;
  tvlQuote: number | null;
  lastTradeAt: string | null;
}

/** Everything the UI needs, normalised to "token priced in ASE". */
export interface TradingMarket {
  pair: MarketPair;
  tokenAddress: string;
  symbol: string;
  /** ASE per whole token. */
  priceAse: number | null;
  change24: number | null;
  /** 24h volume in ASE. */
  volume24Ase: number | null;
  /** Auras indexer quotes the base asset in the quote asset. */
  inverted: boolean;
}

const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/** Normalise a pool so the ARC-20 leg is always the base and ASE the quote. */
export function marketFor(pair: MarketPair): TradingMarket | null {
  if (pair.token0 === NATIVE) {
    const priceAse = pair.price && pair.price > 0 ? 1 / pair.price : null;
    const change = pair.change24 === null || pair.change24 === undefined
      ? null
      : pair.change24 <= -1 ? null : -pair.change24 / (1 + pair.change24);
    return {
      pair,
      tokenAddress: pair.token1,
      symbol: pair.quote,
      priceAse,
      change24: change,
      volume24Ase: pair.volume24 !== null && priceAse !== null ? pair.volume24 * priceAse : null,
      inverted: true,
    };
  }
  if (pair.token1 === NATIVE) {
    return {
      pair,
      tokenAddress: pair.token0,
      symbol: pair.base,
      priceAse: pair.price,
      change24: pair.change24,
      volume24Ase: pair.volume24,
      inverted: false,
    };
  }
  return null;
}

export interface Candle {
  /** Bucket start, Unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume in the quote asset (ASE). */
  volume: number;
  trades: number;
}

export interface MarketTrade {
  txHash: string;
  block: number;
  timestamp: number;
  trader: string;
  side: 'buy' | 'sell';
  price: number;
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
  sizeQuote: number;
}

interface CacheEntry<T> {
  at: number;
  value: T;
}

let pairsCache: CacheEntry<MarketPair[]> | null = null;
const candleCache = new Map<string, CacheEntry<Candle[]>>();
const tradeCache = new Map<string, CacheEntry<MarketTrade[]>>();

async function getJson<T>(path: string, timeoutMs = 12_000): Promise<T> {
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${AURAS_API}${path}`, { signal: ctrl.signal });
      } finally {
        // Do not leave an abort timer running after a rejected fetch.
        clearTimeout(timer);
      }
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (!res.ok) {
        const detail = json && typeof json === 'object' && 'error' in json
          ? String((json as { error?: unknown }).error ?? '')
          : '';
        throw new Error(`Market data: HTTP ${res.status}${detail ? ` · ${detail}` : ''}`);
      }
      if (json && typeof json === 'object') {
        const payload = json as { error?: string };
        if (payload.error) throw new Error(`Market data: ${payload.error}`);
        return json as T;
      }
      lastError = `the Auras indexer returned an invalid response (HTTP ${res.status})`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/^Market data:/.test(lastError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw new Error(lastError || 'the Auras indexer did not answer');
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Every indexed pool, both AMMs. Cached for 30 seconds. */
export async function getMarketPairs(): Promise<MarketPair[]> {
  if (pairsCache && Date.now() - pairsCache.at < 30_000) return pairsCache.value;
  const json = await getJson<{ pairs?: Record<string, unknown>[] }>('/api/pairs');
  const rows = Array.isArray(json.pairs) ? json.pairs : [];
  const pairs: MarketPair[] = [];
  for (const row of rows) {
    const amm = String(row.amm ?? '');
    const dex = row.dex === 'asedex' ? 'asedex' : 'auras';
    if (!/^0x[0-9a-fA-F]{40}$/.test(amm)) continue;
    const token0 = String(row.token0 ?? '').toLowerCase();
    const token1 = String(row.token1 ?? '').toLowerCase();
    if (!token0 || !token1) continue;
    pairs.push({
      poolKey: String(row.poolId ?? ''),
      chainPoolId: String(row.chainPoolId ?? ''),
      amm,
      dex,
      version: row.version === undefined ? undefined : Number(row.version),
      base: String(row.base ?? '').toUpperCase(),
      quote: String(row.quote ?? '').toUpperCase(),
      token0,
      token1,
      feeBps: Number(row.feeBps ?? 30) || 30,
      price: num(row.price),
      change24: num(row.change24),
      volume24: num(row.volume24),
      trades24: num(row.trades24),
      tvlQuote: num(row.tvlQuote),
      lastTradeAt: typeof row.lastTradeAt === 'string' ? row.lastTradeAt : null,
    });
  }
  pairsCache = { at: Date.now(), value: pairs };
  return pairs;
}

export function isAsePair(pair: MarketPair): boolean {
  return pair.token0 === NATIVE || pair.token1 === NATIVE;
}

/** The ARC-20 leg of an ASE pair, or null when the pair is token/token. */
export function pairToken(pair: MarketPair): { address: string; symbol: string } | null {
  if (pair.token0 === NATIVE) return { address: pair.token1, symbol: pair.quote };
  if (pair.token1 === NATIVE) return { address: pair.token0, symbol: pair.base };
  return null;
}

function utcDayStart(seconds: number): number {
  return Math.floor(seconds / 86400) * 86400;
}

/** Monday 00:00 UTC of the week containing `seconds`. */
function utcWeekStart(seconds: number): number {
  const date = new Date(seconds * 1000);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  return utcDayStart(seconds - day * 86400);
}

function aggregate(candles: Candle[], bucketSeconds: number, startOf: (time: number) => number): Candle[] {
  if (bucketSeconds <= 0) return candles;
  const out: Candle[] = [];
  for (const candle of candles) {
    const start = startOf(candle.time);
    const current = out[out.length - 1];
    if (!current || current.time !== start) {
      out.push({ ...candle, time: start });
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
    current.trades += candle.trades;
  }
  return out;
}

function invertCandle(candle: Candle): Candle {
  return {
    time: candle.time,
    open: candle.open > 0 ? 1 / candle.open : 0,
    high: candle.low > 0 ? 1 / candle.low : 0,
    low: candle.high > 0 ? 1 / candle.high : 0,
    close: candle.close > 0 ? 1 / candle.close : 0,
    // The indexer reports volume in the pool's quote asset. For native-first
    // pools that is the token, so convert to ASE at this bucket's close.
    volume: candle.volume * (candle.close > 0 ? 1 / candle.close : 0),
    trades: candle.trades,
  };
}

/**
 * OHLCV for one pool and timeframe, always quoted as ASE per token. Buckets
 * without fills are not invented: the chart positions candles by timestamp, so
 * gaps stay visible.
 */
export async function getCandles(pair: MarketPair, tf: Timeframe): Promise<Candle[]> {
  const poolKey = pair.poolKey;
  const inverted = pair.token0 === NATIVE;
  const key = `${poolKey}|${tf.seconds}|${inverted ? 'i' : 'n'}`;
  const cached = candleCache.get(key);
  const ttl = tf.seconds <= 300 ? 8_000 : 30_000;
  if (cached && Date.now() - cached.at < ttl) return cached.value;

  // The indexer returns its whole history by default (tens of thousands of
  // 1m buckets). A bounded window keeps the response small; the chart shows at
  // most 400 candles at once. 1w asks for two years of daily buckets because
  // one weekly bucket needs seven of them.
  const lookback = tf.seconds === 604800 ? 730 * 86400 : 260 * tf.seconds;
  const from = Math.floor(Date.now() / 1000) - lookback;
  const json = await getJson<{ candles?: Record<string, unknown>[] }>(
    `/api/candles?pool=${encodeURIComponent(poolKey)}&interval=${tf.sourceSeconds}&from=${from}`,
  );
  const rows = Array.isArray(json.candles) ? json.candles : [];
  let candles: Candle[] = rows
    .map((row) => ({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume ?? 0),
      trades: Number(row.trades ?? 0),
    }))
    .filter((row) =>
      Number.isFinite(row.time)
      && Number.isFinite(row.open)
      && Number.isFinite(row.high)
      && Number.isFinite(row.low)
      && Number.isFinite(row.close))
    .sort((a, b) => a.time - b.time);

  if (tf.seconds === 1800) candles = aggregate(candles, 1800, (time) => Math.floor(time / 1800) * 1800);
  if (tf.seconds === 604800) candles = aggregate(candles, 604800, utcWeekStart);
  if (inverted) candles = candles.map(invertCandle);

  candleCache.set(key, { at: Date.now(), value: candles });
  return candles;
}

/** Recent fills for one pool, newest first, priced in ASE per token. */
export async function getMarketTrades(pair: MarketPair, limit = 25): Promise<MarketTrade[]> {
  const poolKey = pair.poolKey;
  const inverted = pair.token0 === NATIVE;
  const key = `${poolKey}|${limit}|${inverted ? 'i' : 'n'}`;
  const cached = tradeCache.get(key);
  if (cached && Date.now() - cached.at < 10_000) return cached.value;

  const json = await getJson<{ trades?: Record<string, unknown>[] }>(
    `/api/trades?pool=${encodeURIComponent(poolKey)}&limit=${Math.min(100, Math.max(1, limit))}`,
  );
  const rows = Array.isArray(json.trades) ? json.trades : [];
  const trades: MarketTrade[] = rows
    .map((row) => {
      const timestamp = Date.parse(String(row.ts ?? ''));
      return {
        txHash: String(row.txHash ?? ''),
        block: Number(row.block ?? 0),
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
        trader: String(row.trader ?? ''),
        side: row.side === 'sell' ? 'sell' : 'buy',
        price: Number(row.price ?? 0),
        amountIn: String(row.amountIn ?? '0'),
        amountOut: String(row.amountOut ?? '0'),
        tokenIn: String(row.tokenIn ?? ''),
        tokenOut: String(row.tokenOut ?? ''),
        sizeQuote: Number(row.sizeQuote ?? 0),
      } satisfies MarketTrade;
    })
    .filter((row) => row.txHash && row.price > 0)
    .map((row) => inverted
      ? {
        ...row,
        side: row.side === 'buy' ? 'sell' : 'buy',
        price: 1 / row.price,
        sizeQuote: row.sizeQuote * (1 / row.price),
      }
      : row);
  tradeCache.set(key, { at: Date.now(), value: trades });
  return trades;
}

/** ASE-denominated pairs, deepest/most active first. */
export function tradablePairs(pairs: MarketPair[]): MarketPair[] {
  return pairs
    .filter((pair) => isAsePair(pair) && pair.chainPoolId && pair.poolKey)
    .sort((a, b) => {
      const av = a.volume24 ?? a.tvlQuote ?? 0;
      const bv = b.volume24 ?? b.tvlQuote ?? 0;
      if (bv !== av) return bv - av;
      return (b.tvlQuote ?? 0) - (a.tvlQuote ?? 0);
    });
}
