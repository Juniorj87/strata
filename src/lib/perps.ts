/**
 * Live AsePad Perps provider adapter (`https://perps.asepad.fun/`).
 *
 * Reads live markets, mark prices, funding indices, open interest, insurance
 * balances, trader collateral/positions and native orders directly from
 * AsePad Perps smart contracts on Asentum (chain ID 1423), and delegates all
 * state-changing actions to the user's connected Asentum wallet.
 *
 * Canonical contract registry (`PERPS_CFG`):
 *   0x37d25f3a292f0642af72d6f161eafb18c76e16a6
 * Active modules are resolved dynamically via `cfg.module(name)` so contract
 * upgrades on AsePad Perps are picked up automatically.
 */

import type { Candle } from './marketData';
import { CHAIN_ID, NETWORK } from './network';
import {
  getAddressTxs,
  getReceipt,
  NATIVE,
  toHexAddress,
  viewCall,
} from './rpc';

export const PERPS_APP_URL = NETWORK.perpsAppUrl;
export const PERPS_CFG = NETWORK.perpsCfg;
export const ASEPAD_API = NETWORK.asepadApiUrl;
const AURAS_API = NETWORK.aurasApiUrl;
const ASEDEX_ADDRESS = NETWORK.asedexAmm;
const AURAS_V1_ADDRESS = NETWORK.aurasAmmV1;
const AURAS_V2_ADDRESS = NETWORK.aurasAmm;

export const PERPS_FALLBACK_MODULES = CHAIN_ID === 1423
  ? {
      cfg: PERPS_CFG,
      engine: '0x36fc2b3b9a705f78cb5a560b057c4daeaa9b3325',
      orders: '0x0952de00a1f2efdedca7b94bfb988455a9090f46',
      liquidation: '0x7e160f6205f04a26ca150e96f13d64342647a539',
      markets: '0x71c380f6e384af3513a194e3fde97a2c9991e77d',
      vault: '0x1449cbdaf9e42f45b7d5c655ad6322b79d02123a',
      oracle: '0xd5267504381a2160ff9a64f2f2b97cb174963e20',
    }
  : {
      cfg: PERPS_CFG,
      engine: '',
      orders: '',
      liquidation: '',
      markets: '',
      vault: '',
      oracle: '',
    };

export interface PerpsModules {
  cfg: string;
  engine: string;
  orders: string;
  liquidation: string;
  markets: string;
  vault: string;
  oracle: string;
}

export type PerpsStatus = 'unavailable' | 'configured' | 'live';

export interface PerpsMarket {
  id: string;
  symbol: string;
  name: string;
  baseToken: string;
  quoteToken: string;
  decimals: number;
  quoteDecimals: number;
  poolId: string;
  dex: string;
  state: 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'CLOSING_OUT' | 'DELISTED' | string;
  markPrice: number;
  markPriceWei: string;
  indexPrice: number;
  oracleHealth: string;
  oracleSource: string;
  fundingRateHourly: number;
  openInterest: number;
  longOIWei: string;
  shortOIWei: string;
  insuranceBalanceWei: string;
  maxLeverage: number;
  initialMarginBps: number;
  maintenanceMarginBps: number;
  takerFeeBps: number;
  keeperFeeBps: number;
  cronDepositWei: string;
  minOrderNotionalWei: string;
  orderExpiryMs: number;
  maxDcaSlices: number;
  minDcaIntervalMs: number;
  maxScaleSteps: number;
  minTrailBps: number;
  maxTrailBps: number;
}

export interface PerpsPosition {
  id: string;
  market: string;
  marketId: string;
  symbol: string;
  side: 'long' | 'short';
  size: string;
  sizeWei: string;
  entryPrice: number;
  entryPriceWei: string;
  markPrice: number;
  leverage: number;
  margin: string;
  collateralWei: string;
  liquidationPrice: number;
  unrealisedPnl: number;
  fundingPaid: number;
  fundingDebtWei: string;
  realizedPnlWei: string;
  feesPaidWei: string;
  openedAt: number;
}

export interface PerpsOrderRecord {
  id: string;
  owner: string;
  marketId: string;
  kind: 'LIMIT' | 'STOP' | 'TP' | 'DCA' | 'TWAP' | 'SCALE' | 'STOPLIM' | 'TPLIM' | 'TRAIL' | string;
  side: 'LONG' | 'SHORT';
  sizeWei: string;
  limitPx: string;
  triggerPx: string;
  slippageBps: string;
  reduceOnly: boolean;
  expiryMs: string;
  state: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'EXPIRED' | string;
  reservedWei: string;
  createdMs: string;
  splits: string;
  dca: string;
  trailBps: string;
  anchorPx: string;
  tpPx: string;
  slPx: string;
  postOnly?: string;
}

export interface PerpsAccountSnapshot {
  marketId: string;
  marginMode: 'i' | 'x';
  collateralWei: string;
  reservedWei: string;
  freeCollateralWei: string;
  position: {
    sizeWei: string;
    entryPrice: string;
    openedMs: string;
    lastMs: string;
    feesPaidWei: string;
    realizedPnlWei: string;
    fundingDebtWei: string;
  };
  orders: PerpsOrderRecord[];
}

export interface PerpsMarketFill {
  txHash: string;
  block: number;
  timestamp: number;
  trader: string;
  side: 'LONG' | 'SHORT';
  sizeDelta: string;
  priceWei: string;
  feeWei: string;
  via: string;
}

export interface OpenPositionRequest {
  market: string;
  side: 'long' | 'short';
  margin: string;
  leverage: number;
  takeProfit?: number;
  stopLoss?: number;
}

export interface PerpsProvider {
  readonly id: string;
  readonly label: string;
  status(): Promise<PerpsStatus>;
  markets(): Promise<PerpsMarket[]>;
  positions(owner: string): Promise<PerpsPosition[]>;
  openPosition(owner: string, request: OpenPositionRequest): Promise<string>;
  closePosition(owner: string, positionId: string): Promise<string>;
  history(owner: string): Promise<PerpsPosition[]>;
}

export class PerpsUnavailableError extends Error {
  constructor(message = 'AsePad Perps is temporarily paused or unreachable.') {
    super(message);
    this.name = 'PerpsUnavailableError';
  }
}

type PerpsWalletClient = {
  call(contract: string, method: string, args?: string[], value?: string | bigint): Promise<string>;
  waitReceipt(hash: string, timeoutMs?: number): Promise<{ success: boolean }>;
};

const SCALE = 10n ** 18n;
let moduleCache: { at: number; modules: PerpsModules } | null = null;
let marketsCache: { at: number; rows: PerpsMarket[] } | null = null;

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function cleanString(raw: unknown, fallback = ''): string {
  if (raw === null || raw === undefined) return fallback;
  return String(raw).replace(/^"|"$/g, '').trim() || fallback;
}

/**
 * Resolve active AsePad Perps module addresses from the root config contract.
 * Falls back to the published deployment addresses if any module read fails.
 */
export async function resolvePerpsModules(): Promise<PerpsModules> {
  if (moduleCache && Date.now() - moduleCache.at < 60_000) return moduleCache.modules;
  if (!PERPS_CFG) {
    throw new PerpsUnavailableError('AsePad Perps registry address (VITE_PERPS_CFG) is not configured for this network.');
  }
  const names = ['engine', 'orders', 'liquidation', 'markets', 'vault', 'oracle'] as const;
  const resolved = await Promise.all(
    names.map((name) =>
      viewCall<string>(PERPS_CFG, 'module', [name])
        .then((val) => cleanString(val).toLowerCase())
        .catch(() => ''),
    ),
  );
  const modules: PerpsModules = {
    cfg: PERPS_CFG,
    engine: /^0x[0-9a-f]{40}$/.test(resolved[0]) ? resolved[0] : PERPS_FALLBACK_MODULES.engine,
    orders: /^0x[0-9a-f]{40}$/.test(resolved[1]) ? resolved[1] : PERPS_FALLBACK_MODULES.orders,
    liquidation: /^0x[0-9a-f]{40}$/.test(resolved[2]) ? resolved[2] : PERPS_FALLBACK_MODULES.liquidation,
    markets: /^0x[0-9a-f]{40}$/.test(resolved[3]) ? resolved[3] : PERPS_FALLBACK_MODULES.markets,
    vault: /^0x[0-9a-f]{40}$/.test(resolved[4]) ? resolved[4] : PERPS_FALLBACK_MODULES.vault,
    oracle: /^0x[0-9a-f]{40}$/.test(resolved[5]) ? resolved[5] : PERPS_FALLBACK_MODULES.oracle,
  };
  moduleCache = { at: Date.now(), modules };
  return modules;
}

/** Convert an on-chain 1e18 per-raw-unit mark price into human quote-per-base price. */
export function perpsPriceToNumber(priceWei: string | bigint, tokenDecimals = 18, quoteDecimals = 18): number {
  try {
    const raw = typeof priceWei === 'bigint' ? priceWei : BigInt(priceWei || '0');
    if (raw <= 0n) return 0;
    const factor = 10 ** (tokenDecimals - quoteDecimals);
    return (Number(raw) / 1e18) * factor;
  } catch {
    return 0;
  }
}

/** Convert a human quote-per-base price string into on-chain 1e18 per-raw-unit mark price. */
export function numberToPerpsPriceWei(priceInput: string, tokenDecimals = 18, quoteDecimals = 18): string {
  const clean = priceInput.trim();
  if (!/^\d+(?:\.\d*)?$/.test(clean)) return '0';
  const num = Number(clean);
  if (!Number.isFinite(num) || num <= 0) return '0';
  const shift = 18 - (tokenDecimals - quoteDecimals);
  if (shift < 0 || shift > 36) return '0';
  // Use string decimal scaling when shift === 18 (standard 18-dec tokens) for full precision.
  if (shift === 18) {
    const [whole = '0', frac = ''] = clean.split('.');
    return (BigInt(whole || '0') * SCALE + BigInt(frac.padEnd(18, '0').slice(0, 18) || '0')).toString();
  }
  return BigInt(Math.round(num * 10 ** shift)).toString();
}

export function calcPerpsSizeWei(notionalQuoteWei: bigint, priceWei: bigint): bigint {
  if (notionalQuoteWei <= 0n || priceWei <= 0n) return 0n;
  return (notionalQuoteWei * SCALE) / priceWei;
}

export function calcPerpsNotionalWei(sizeWei: bigint, priceWei: bigint): bigint {
  const absSize = sizeWei < 0n ? -sizeWei : sizeWei;
  if (absSize <= 0n || priceWei <= 0n) return 0n;
  return (absSize * priceWei) / SCALE;
}

export function calcPerpsLiquidationPrice(
  markPrice: number,
  side: 'long' | 'short',
  leverage: number,
  maintenanceMarginBps = 500,
): number | null {
  if (!Number.isFinite(markPrice) || markPrice <= 0 || !Number.isFinite(leverage) || leverage <= 0) {
    return null;
  }
  const initialFrac = 1 / leverage;
  const maintFrac = maintenanceMarginBps / 10_000;
  const buffer = initialFrac - maintFrac;
  if (side === 'long') return Math.max(0, markPrice * (1 - buffer));
  return Math.max(0, markPrice * (1 + buffer));
}

export async function isPerpsProtocolPaused(): Promise<boolean> {
  try {
    const raw = await viewCall<string>(PERPS_CFG, 'paused', []);
    return cleanString(raw) === '1';
  } catch {
    return false;
  }
}

export async function loadPerpsMarkets(force = false): Promise<PerpsMarket[]> {
  if (!force && marketsCache && Date.now() - marketsCache.at < 15_000) return marketsCache.rows;
  const mods = await resolvePerpsModules();
  const idsRaw = await viewCall<unknown>(mods.markets, 'list', []);
  const ids = parseJson<string[]>(idsRaw, []);
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const globalParamKeys = [
    'initialMarginBps',
    'maintenanceMarginBps',
    'takerFeeBps',
    'keeperFeeBps',
    'cronDepositWei',
    'minOrderNotionalWei',
    'orderExpiryMs',
    'maxDcaSlices',
    'minDcaIntervalMs',
    'maxScaleSteps',
    'minTrailBps',
    'maxTrailBps',
  ] as const;

  const globalResults = await Promise.all(
    globalParamKeys.map((k) => viewCall<string>(mods.cfg, 'param', [k]).catch(() => '')),
  );
  const globalDefaults: Record<string, string> = {};
  globalParamKeys.forEach((k, i) => {
    globalDefaults[k] = cleanString(globalResults[i]);
  });

  const rows = await Promise.all(
    ids.map(async (id): Promise<PerpsMarket | null> => {
      try {
        const [mktRaw, oiRaw, insRaw, obsRaw, healthRaw, mktIm, mktMinNotional, mktMinDca, mktMaxDca, mktExpiry, mktTaker, mktCronDep] =
          await Promise.all([
            viewCall<unknown>(mods.markets, 'get', [String(id)]),
            viewCall<unknown>(mods.markets, 'openInterest', [String(id)]).catch(() => null),
            viewCall<unknown>(mods.markets, 'insurance', [String(id)]).catch(() => null),
            viewCall<unknown>(mods.oracle, 'observation', [String(id)]).catch(() => null),
            viewCall<unknown>(mods.oracle, 'health', [String(id)]).catch(() => 'ok'),
            viewCall<string>(mods.cfg, 'marketParam', [String(id), 'initialMarginBps']).catch(() => globalDefaults.initialMarginBps || '1000'),
            viewCall<string>(mods.cfg, 'marketParam', [String(id), 'minOrderNotionalWei']).catch(() => globalDefaults.minOrderNotionalWei || '500000000000000000'),
            viewCall<string>(mods.cfg, 'marketParam', [String(id), 'minDcaIntervalMs']).catch(() => globalDefaults.minDcaIntervalMs || '3600000'),
            viewCall<string>(mods.cfg, 'marketParam', [String(id), 'maxDcaSlices']).catch(() => globalDefaults.maxDcaSlices || '12'),
            viewCall<string>(mods.cfg, 'marketParam', [String(id), 'orderExpiryMs']).catch(() => globalDefaults.orderExpiryMs || '86400000'),
            viewCall<string>(mods.cfg, 'marketParam', [String(id), 'takerFeeBps']).catch(() => globalDefaults.takerFeeBps || '10'),
            viewCall<string>(mods.cfg, 'marketParam', [String(id), 'cronDepositWei']).catch(() => globalDefaults.cronDepositWei || '0'),
          ]);

        const mkt = parseJson<Record<string, unknown> | null>(mktRaw, null);
        if (!mkt || !mkt.token) return null;

        const tokenAddr = cleanString(mkt.token).toLowerCase();
        const [symRaw, nameRaw] = await Promise.all([
          viewCall<string>(tokenAddr, 'symbol', []).catch(() => ''),
          viewCall<string>(tokenAddr, 'name', []).catch(() => ''),
        ]);

        const oi = parseJson<{ longOI?: string; shortOI?: string }>(oiRaw, {});
        const ins = parseJson<{ balanceWei?: string }>(insRaw, {});
        const obs = parseJson<{ mark?: string; source?: string } | null>(obsRaw, null);

        const dec = Number(mkt.decimals ?? 18) || 18;
        const qDec = Number(mkt.quoteDecimals ?? 18) || 18;
        const markPriceWei = cleanString(obs?.mark, '0');
        const markPrice = perpsPriceToNumber(markPriceWei, dec, qDec);
        const longOIWei = cleanString(oi.longOI, '0');
        const shortOIWei = cleanString(oi.shortOI, '0');
        const oiNotional = Number(
          calcPerpsNotionalWei(BigInt(longOIWei) + BigInt(shortOIWei), BigInt(markPriceWei)),
        ) / 10 ** qDec;

        const imBps = Math.max(100, Number(cleanString(mktIm, '1000')) || 1000);
        const mmBps = Math.max(50, Number(globalDefaults.maintenanceMarginBps || '500') || 500);
        const maxLev = Math.min(10, Math.floor(10_000 / imBps));

        const symbol = cleanString(symRaw, `MKT#${id}`);
        return {
          id: String(id),
          symbol,
          name: cleanString(nameRaw, symbol),
          baseToken: tokenAddr,
          quoteToken: cleanString(mkt.quote, NATIVE).toLowerCase(),
          decimals: dec,
          quoteDecimals: qDec,
          poolId: cleanString(mkt.poolId, String(id)),
          dex: cleanString(mkt.dex, ASEDEX_ADDRESS).toLowerCase(),
          state: cleanString(mkt.state, 'ACTIVE'),
          markPrice,
          markPriceWei,
          indexPrice: markPrice,
          oracleHealth: cleanString(healthRaw, 'ok'),
          oracleSource: cleanString(obs?.source, 'twap'),
          fundingRateHourly: 0,
          openInterest: Number.isFinite(oiNotional) ? oiNotional : 0,
          longOIWei,
          shortOIWei,
          insuranceBalanceWei: cleanString(ins.balanceWei, '0'),
          maxLeverage: maxLev,
          initialMarginBps: imBps,
          maintenanceMarginBps: mmBps,
          takerFeeBps: Number(cleanString(mktTaker, '10')) || 10,
          keeperFeeBps: Number(globalDefaults.keeperFeeBps || '5') || 5,
          cronDepositWei: cleanString(mktCronDep, '0'),
          minOrderNotionalWei: cleanString(mktMinNotional, '500000000000000000'),
          orderExpiryMs: Number(cleanString(mktExpiry, '86400000')) || 86_400_000,
          maxDcaSlices: Number(cleanString(mktMaxDca, '12')) || 12,
          minDcaIntervalMs: Number(cleanString(mktMinDca, '300000')) || 300_000,
          maxScaleSteps: Number(globalDefaults.maxScaleSteps || '16') || 16,
          minTrailBps: Number(globalDefaults.minTrailBps || '10') || 10,
          maxTrailBps: Number(globalDefaults.maxTrailBps || '2000') || 2000,
        };
      } catch {
        return null;
      }
    }),
  );

  const valid = rows.filter((item): item is PerpsMarket => Boolean(item));
  marketsCache = { at: Date.now(), rows: valid };
  return valid;
}

export async function loadPerpsAccount(ownerAddress: string, marketId: string): Promise<PerpsAccountSnapshot> {
  const mods = await resolvePerpsModules();
  const hex = toHexAddress(ownerAddress).toLowerCase();
  const [acctRaw, posRaw, modeRaw, freeRaw, openIdsRaw] = await Promise.all([
    viewCall<unknown>(mods.vault, 'account', [hex, String(marketId)]),
    viewCall<unknown>(mods.vault, 'position', [hex, String(marketId)]),
    viewCall<string>(mods.vault, 'marginMode', [hex]).catch(() => 'i'),
    viewCall<string>(mods.vault, 'freeCollateral', [hex, String(marketId)]).catch(() => '0'),
    viewCall<unknown>(mods.orders, 'ofOwnerOpen', [hex]).catch(() => '[]'),
  ]);

  const acct = parseJson<{ collateralWei?: string; reservedWei?: string }>(acctRaw, {});
  const pos = parseJson<Record<string, string>>(posRaw, {});
  const openIds = parseJson<string[]>(openIdsRaw, []);

  const orders = openIds.length > 0
    ? (await Promise.all(
        openIds.slice(0, 32).map(async (id) => {
          const raw = await viewCall<unknown>(mods.orders, 'get', [String(id)]).catch(() => null);
          const rec = parseJson<PerpsOrderRecord | null>(raw, null);
          return rec ? { ...rec, id: String(id) } : null;
        }),
      )).filter((item): item is PerpsOrderRecord => Boolean(item))
    : [];

  return {
    marketId: String(marketId),
    marginMode: cleanString(modeRaw, 'i') === 'x' ? 'x' : 'i',
    collateralWei: cleanString(acct.collateralWei, '0'),
    reservedWei: cleanString(acct.reservedWei, '0'),
    freeCollateralWei: cleanString(freeRaw, '0'),
    position: {
      sizeWei: cleanString(pos.sizeWei, '0'),
      entryPrice: cleanString(pos.entryPrice, '0'),
      openedMs: cleanString(pos.openedMs, '0'),
      lastMs: cleanString(pos.lastMs, '0'),
      feesPaidWei: cleanString(pos.feesPaidWei, '0'),
      realizedPnlWei: cleanString(pos.realizedPnlWei, '0'),
      fundingDebtWei: cleanString(pos.fundingDebtWei, '0'),
    },
    orders,
  };
}

export async function loadPerpsPositionsForOwner(ownerAddress: string): Promise<PerpsPosition[]> {
  const mkts = await loadPerpsMarkets();
  const hex = toHexAddress(ownerAddress).toLowerCase();
  const mods = await resolvePerpsModules();

  const results = await Promise.all(
    mkts.map(async (m): Promise<PerpsPosition | null> => {
      try {
        const [posRaw, acctRaw] = await Promise.all([
          viewCall<unknown>(mods.vault, 'position', [hex, m.id]),
          viewCall<unknown>(mods.vault, 'account', [hex, m.id]),
        ]);
        const pos = parseJson<Record<string, string>>(posRaw, {});
        const acct = parseJson<{ collateralWei?: string }>(acctRaw, {});
        const sizeWeiBig = BigInt(cleanString(pos.sizeWei, '0'));
        if (sizeWeiBig === 0n) return null;

        const isLong = sizeWeiBig > 0n;
        const absSize = isLong ? sizeWeiBig : -sizeWeiBig;
        const entryPriceWei = cleanString(pos.entryPrice, '0');
        const entryPrice = perpsPriceToNumber(entryPriceWei, m.decimals, m.quoteDecimals);
        const collateralWei = cleanString(acct.collateralWei, '0');
        const collNum = Number(collateralWei) / 10 ** m.quoteDecimals;
        const notional = (Number(absSize) / 10 ** m.decimals) * m.markPrice;
        const effLev = collNum > 0 ? notional / collNum : m.maxLeverage;
        const upnl = (Number(absSize) / 10 ** m.decimals) * (m.markPrice - entryPrice) * (isLong ? 1 : -1);
        const liq = calcPerpsLiquidationPrice(entryPrice, isLong ? 'long' : 'short', effLev, m.maintenanceMarginBps) ?? 0;

        return {
          id: m.id,
          market: `${m.symbol}/ASE`,
          marketId: m.id,
          symbol: m.symbol,
          side: isLong ? 'long' : 'short',
          size: (Number(absSize) / 10 ** m.decimals).toFixed(4),
          sizeWei: sizeWeiBig.toString(),
          entryPrice,
          entryPriceWei,
          markPrice: m.markPrice,
          leverage: Number(effLev.toFixed(2)),
          margin: collNum.toFixed(4),
          collateralWei,
          liquidationPrice: liq,
          unrealisedPnl: upnl,
          fundingPaid: Number(cleanString(pos.fundingDebtWei, '0')) / 10 ** m.quoteDecimals,
          fundingDebtWei: cleanString(pos.fundingDebtWei, '0'),
          realizedPnlWei: cleanString(pos.realizedPnlWei, '0'),
          feesPaidWei: cleanString(pos.feesPaidWei, '0'),
          openedAt: Number(cleanString(pos.openedMs, '0')) || 0,
        };
      } catch {
        return null;
      }
    }),
  );

  return results.filter((item): item is PerpsPosition => Boolean(item));
}

function utcDayStartSec(seconds: number): number {
  return Math.floor(seconds / 86400) * 86400;
}

function utcWeekStartSec(seconds: number): number {
  const date = new Date(seconds * 1000);
  const day = (date.getUTCDay() + 6) % 7;
  return utcDayStartSec(seconds - day * 86400);
}

function aggregatePerpsCandles(candles: Candle[], startOf: (sec: number) => number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const start = startOf(c.time);
    const cur = out[out.length - 1];
    if (!cur || cur.time !== start) {
      out.push({ ...c, time: start });
      continue;
    }
    cur.high = Math.max(cur.high, c.high);
    cur.low = Math.min(cur.low, c.low);
    cur.close = c.close;
    cur.volume += c.volume;
    cur.trades += c.trades;
  }
  return out;
}

export async function loadPerpsMarketCandles(
  market: PerpsMarket,
  intervalSec: number,
  limit = 300,
): Promise<Candle[]> {
  const dex = market.dex.toLowerCase();
  const isAseDex = dex === ASEDEX_ADDRESS;
  const aurasPrefix = dex === AURAS_V1_ADDRESS ? 'auras' : dex === AURAS_V2_ADDRESS ? 'auras2' : 'auras2';
  const sourceInterval = intervalSec === 1800 ? 900 : intervalSec === 604800 ? 86400 : Math.max(60, Math.round(intervalSec));
  const reqLimit = intervalSec === 1800 ? Math.min(1000, limit * 2) : intervalSec === 604800 ? Math.min(1000, limit * 7) : limit;
  const url = isAseDex
    ? `${ASEPAD_API}/api/candles?pool=${ASEDEX_ADDRESS}:${encodeURIComponent(market.poolId)}&interval=${sourceInterval}&limit=${reqLimit}`
    : `${AURAS_API}/api/candles?pool=${aurasPrefix}-${encodeURIComponent(market.poolId)}&interval=${sourceInterval}&limit=${reqLimit}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Candles HTTP ${res.status}`);
  const json = (await res.json()) as { candles?: Array<Record<string, unknown>> };
  const rows = Array.isArray(json.candles) ? json.candles : [];
  let candles = rows
    .filter((c) => Number(c.open) > 0 && Number(c.close) > 0 && Number.isFinite(Number(c.time)))
    .map((c) => ({
      time: Number(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume ?? 0),
      trades: Number(c.trades ?? 0),
    }))
    .sort((a, b) => a.time - b.time);

  if (intervalSec === 1800) candles = aggregatePerpsCandles(candles, (t) => Math.floor(t / 1800) * 1800);
  if (intervalSec === 604800) candles = aggregatePerpsCandles(candles, utcWeekStartSec);
  return candles;
}

export async function loadPerpsOpenOrdersForOwner(ownerAddress: string): Promise<PerpsOrderRecord[]> {
  const mods = await resolvePerpsModules();
  const hex = toHexAddress(ownerAddress).toLowerCase();
  const openIdsRaw = await viewCall<unknown>(mods.orders, 'ofOwnerOpen', [hex]).catch(() => '[]');
  const openIds = parseJson<string[]>(openIdsRaw, []);
  if (!Array.isArray(openIds) || openIds.length === 0) return [];
  const rows = await Promise.all(
    openIds.slice(0, 48).map(async (id) => {
      const raw = await viewCall<unknown>(mods.orders, 'get', [String(id)]).catch(() => null);
      const rec = parseJson<PerpsOrderRecord | null>(raw, null);
      return rec ? { ...rec, id: String(id) } : null;
    }),
  );
  return rows.filter((item): item is PerpsOrderRecord => Boolean(item));
}

export async function loadPerpsMarketFills(marketId: string): Promise<PerpsMarketFill[]> {
  const mods = await resolvePerpsModules();
  const txs = await getAddressTxs(mods.engine, 25).catch(() => []);
  const confirmed = txs.filter((tx) => tx.status !== 0).slice(0, 14);
  const receipts = await Promise.all(confirmed.map((tx) => getReceipt(tx.hash).catch(() => null)));

  const fills: PerpsMarketFill[] = [];
  receipts.forEach((receipt, index) => {
    if (!receipt || !Array.isArray(receipt.events)) return;
    const row = confirmed[index];
    for (const ev of receipt.events as Array<{ name?: string; data?: Record<string, unknown> }>) {
      if (ev?.name !== 'Fill' || !ev.data) continue;
      if (String(ev.data.marketId ?? '') !== String(marketId)) continue;
      const sizeDelta = String(ev.data.sizeDelta ?? '0');
      if (sizeDelta === '0') continue;
      fills.push({
        txHash: row.hash,
        block: Number(row.block_number ?? 0),
        timestamp: Number(ev.data.ts ?? row.timestamp ?? 0),
        trader: String(ev.data.trader ?? row.from_addr ?? ''),
        side: sizeDelta.startsWith('-') ? 'SHORT' : 'LONG',
        sizeDelta,
        priceWei: String(ev.data.price ?? '0'),
        feeWei: String(ev.data.fee ?? '0'),
        via: String(ev.data.via ?? row.method ?? 'MARKET'),
      });
    }
  });
  return fills;
}

export async function depositPerpsCollateral(
  client: PerpsWalletClient,
  marketId: string,
  amountWei: bigint,
  quoteToken: string = NATIVE,
): Promise<string> {
  if (amountWei <= 0n) throw new Error('Enter a collateral amount greater than zero.');
  const mods = await resolvePerpsModules();
  const q = quoteToken.toLowerCase();
  if (q !== NATIVE) {
    const appHash = await client.call(q, 'approve', [mods.vault, amountWei.toString()]);
    const appReceipt = await client.waitReceipt(appHash, 120_000);
    if (!appReceipt.success) throw new Error('Collateral token approval reverted on chain.');
    const depHash = await client.call(mods.vault, 'deposit', [String(marketId), amountWei.toString()]);
    const depReceipt = await client.waitReceipt(depHash, 120_000);
    if (!depReceipt.success) throw new Error('Vault collateral deposit reverted on chain.');
    return depHash;
  }
  const hash = await client.call(mods.vault, 'deposit', [String(marketId), amountWei.toString()], amountWei.toString());
  const receipt = await client.waitReceipt(hash, 120_000);
  if (!receipt.success) throw new Error('Vault collateral deposit reverted on chain.');
  return hash;
}

export async function withdrawPerpsCollateral(
  client: PerpsWalletClient,
  marketId: string,
  amountWei: bigint,
): Promise<string> {
  if (amountWei <= 0n) throw new Error('Enter a withdrawal amount greater than zero.');
  const mods = await resolvePerpsModules();
  const hash = await client.call(mods.vault, 'withdraw', [String(marketId), amountWei.toString()]);
  const receipt = await client.waitReceipt(hash, 120_000);
  if (!receipt.success) throw new Error('Vault withdrawal reverted on chain.');
  return hash;
}

export async function setPerpsMarginMode(client: PerpsWalletClient, mode: 'i' | 'x'): Promise<string> {
  const mods = await resolvePerpsModules();
  const hash = await client.call(mods.vault, 'setMarginMode', [mode]);
  const receipt = await client.waitReceipt(hash, 120_000);
  if (!receipt.success) throw new Error('Switching margin mode reverted (close open positions/orders first).');
  return hash;
}

export async function executePerpsMarketTrade(
  client: PerpsWalletClient,
  params: {
    marketId: string;
    side: 'LONG' | 'SHORT';
    sizeWei: bigint;
    currentSizeWei: bigint;
    markPriceWei: bigint;
    slippageBps?: number;
  },
): Promise<string> {
  const mods = await resolvePerpsModules();
  const slip = BigInt(Math.max(50, params.slippageBps ?? 300));
  const isLong = params.side === 'LONG';
  const worst = isLong
    ? (params.markPriceWei * (10_000n + slip)) / 10_000n
    : (params.markPriceWei * (10_000n - slip)) / 10_000n;

  const cur = params.currentSizeWei;
  let method: 'openMarket' | 'increase' | 'reduce' | 'close';
  let args: string[];

  if (cur === 0n) {
    method = 'openMarket';
    args = [String(params.marketId), params.side, params.sizeWei.toString(), worst.toString(), 'STRATA'];
  } else if ((cur > 0n) === isLong) {
    method = 'increase';
    args = [String(params.marketId), params.sizeWei.toString(), worst.toString()];
  } else {
    const absCur = cur < 0n ? -cur : cur;
    if (params.sizeWei >= absCur) {
      method = 'close';
      args = [String(params.marketId), worst.toString()];
    } else {
      method = 'reduce';
      args = [String(params.marketId), params.sizeWei.toString(), worst.toString()];
    }
  }

  const hash = await client.call(mods.engine, method, args);
  const receipt = await client.waitReceipt(hash, 120_000);
  if (!receipt.success) throw new Error(`AsePad Perps ${method} transaction reverted on chain.`);
  return hash;
}

export async function closePerpsPositionTx(
  client: PerpsWalletClient,
  marketId: string,
  currentSizeWei: bigint,
  markPriceWei: bigint,
  slippageBps = 300,
): Promise<string> {
  if (currentSizeWei === 0n) throw new Error('No open position on this market.');
  const mods = await resolvePerpsModules();
  const slip = BigInt(Math.max(50, slippageBps));
  const isClosingLong = currentSizeWei > 0n;
  const worst = isClosingLong
    ? (markPriceWei * (10_000n - slip)) / 10_000n
    : (markPriceWei * (10_000n + slip)) / 10_000n;
  const hash = await client.call(mods.engine, 'close', [String(marketId), worst.toString()]);
  const receipt = await client.waitReceipt(hash, 120_000);
  if (!receipt.success) throw new Error('Closing perp position reverted on chain.');
  return hash;
}

export interface PlacePerpsOrderPayload {
  marketId: string;
  kind: 'LIMIT' | 'DCA' | 'SCALE' | 'STOP' | 'TP' | 'STOPLIM' | 'TPLIM' | 'TRAIL';
  side: 'LONG' | 'SHORT';
  sizeWei: string;
  limitPx?: string;
  triggerPx?: string;
  slippageBps?: string;
  reduceOnly?: boolean;
  expiryMs: string;
  postOnly?: boolean;
  tpPx?: string;
  slPx?: string;
  dcaSlices?: string;
  dcaIntervalMs?: string;
  scaleFrom?: string;
  scaleTo?: string;
  scaleSteps?: string;
  trailBps?: string;
}

export async function placePerpsNativeOrder(
  client: PerpsWalletClient,
  payload: PlacePerpsOrderPayload,
  cronDepositWei?: string,
): Promise<string> {
  const mods = await resolvePerpsModules();
  let dep = cronDepositWei;
  if (dep === undefined) {
    dep = cleanString(
      await viewCall<string>(mods.cfg, 'marketParam', [String(payload.marketId), 'cronDepositWei']).catch(() => '0'),
      '0',
    );
  }
  const valueStr = /^\d+$/.test(dep) && BigInt(dep) > 0n ? dep : undefined;
  const hash = await client.call(mods.engine, 'placeOrder', [JSON.stringify(payload)], valueStr);
  const receipt = await client.waitReceipt(hash, 120_000);
  if (!receipt.success) throw new Error('AsePad Perps order placement reverted on chain.');
  return hash;
}

export async function cancelPerpsNativeOrder(
  client: PerpsWalletClient,
  orderId: string,
): Promise<string> {
  const mods = await resolvePerpsModules();
  const hash = await client.call(mods.engine, 'cancelOrder', [String(orderId)]);
  const receipt = await client.waitReceipt(hash, 120_000);
  if (!receipt.success) throw new Error('Cancelling order reverted on chain.');
  return hash;
}

/** Live provider backed by AsePad Perps contracts on Asentum testnet. */
class AsePadPerpsProvider implements PerpsProvider {
  readonly id = 'asepad-perps';
  readonly label = 'AsePad Perps';

  async status(): Promise<PerpsStatus> {
    const paused = await isPerpsProtocolPaused();
    return paused ? 'configured' : 'live';
  }

  async markets(): Promise<PerpsMarket[]> {
    return loadPerpsMarkets();
  }

  async positions(owner: string): Promise<PerpsPosition[]> {
    return loadPerpsPositionsForOwner(owner);
  }

  async history(): Promise<PerpsPosition[]> {
    return [];
  }

  async openPosition(): Promise<string> {
    throw new Error('Use executePerpsMarketTrade with the connected wallet client.');
  }

  async closePosition(): Promise<string> {
    throw new Error('Use closePerpsPositionTx with the connected wallet client.');
  }
}

export const PERPS_PROVIDER: PerpsProvider = new AsePadPerpsProvider();

export interface PerpsIntegrationInfo {
  status: PerpsStatus;
  provider: string;
  venue: string;
  reason: string;
  cfgAddress: string;
  appUrl: string;
  requirements: string[];
  notSupported: string[];
}

export function perpsIntegration(): PerpsIntegrationInfo {
  const host = PERPS_APP_URL.replace(/^https?:\/\/|\/+$/g, '') || 'perps.asepad.fun';
  return {
    status: PERPS_CFG ? 'live' : 'unavailable',
    provider: PERPS_PROVIDER.label,
    venue: `AsePad Perps (${NETWORK.name} · ${host})`,
    reason:
      'Connected directly to AsePad Perps on-chain contracts (config, vault, engine, orders, markets and TWAP oracle).',
    cfgAddress: PERPS_CFG,
    appUrl: PERPS_APP_URL,
    requirements: [],
    notSupported: [],
  };
}

export function isPerpsAvailable(info: PerpsIntegrationInfo): boolean {
  return info.status === 'live' || info.status === 'configured';
}
