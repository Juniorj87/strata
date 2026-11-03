import { ase1ToHex } from '@asentum/connect';

/**
 * Asentum chain client - plain fetch, no SDK, no deps.
 *
 * The gateway answers with CORS `Access-Control-Allow-Origin: *`, so this runs
 * straight in the browser. Conventions that matter:
 *   - numbers are decimal strings (wei), hashes are 0x hex
 *   - /view wants { contract, method, args } and the contract as 0x hex
 *   - errors come back as HTTP 200 with { ok: false, reason }
 *   - "latest" is the finalized head; "tip" is the newest block
 */

export const RPC_URL = 'https://testnet.asentum.com';
export const EXPLORER_URL = 'https://explorer.asentum.com';
export const CHAIN_ID = 1423;

/** Auras AMM (pool reads, quotes and swaps). */
export const AURAS_AMM = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
/** Backward-compatible alias: AURAS always means the AMM. */
export const AURAS = AURAS_AMM;
/** AseDex Exchange contract address. */
export const ASEDEX_AMM = '0xc3833b73eb30242289e533b3e97c4b72b97e24e9';
/** AURA token address. */
export const AURA_TOKEN = '0xc24044dccea3ba8b362e1c85fa16ddc658022269';

/** EIP-7528 style sentinel for the native side of a pool. */
export const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/** Protocol cron registry - pre-deployed system contract. */
export const CRON_REGISTRY = '0x0000000000000000000000000000000000000006';

/** Strata Hub - canonical protocol coordinator and registry. */
export const STRATA_HUB = String(
  import.meta.env?.VITE_STRATA_HUB ||
  'ase1utdzul2gxdw4c60fr7fcphghlak63sjf8mqnut'
).trim();

export interface PoolInfo {
  id: string;
  token: string;
  symbol: string;
  name: string;
  reserveToken: string;
  reserveNative: string;
  feeBps?: string;
  price0Cumulative?: string;
  lastTs?: string;
  decimals?: number;
  venue?: 'auras' | 'asedex';
}

const _symbolCache = new Map<string, string>([
  ['0xc24044dccea3ba8b362e1c85fa16ddc658022269', 'AURA'],
  ['0xbea7c12cba13eddd8e8ad77ff8f62fcf27736d20', 'NOVA'],
  ['0x50cb8d861050ad0052959e0f942c5347842346f1', 'PULSE'],
  ['0xde4480220ba5793bff42fd9162954fa3fdb1acd3', 'ZEPH'],
  ['0xe91421ecfe12f18814dc8c0635267fb2dc86ac6f', 'ORB'],
  ['0xd580adfb35a68844903493f0dfa38549a1c74055', 'E2E'],
]);

const _decimalsCache = new Map<string, number>([
  ['0xc24044dccea3ba8b362e1c85fa16ddc658022269', 18],
  ['0xbea7c12cba13eddd8e8ad77ff8f62fcf27736d20', 18],
  ['0x50cb8d861050ad0052959e0f942c5347842346f1', 18],
  ['0xde4480220ba5793bff42fd9162954fa3fdb1acd3', 18],
  ['0xe91421ecfe12f18814dc8c0635267fb2dc86ac6f', 18],
  ['0xd580adfb35a68844903493f0dfa38549a1c74055', 18],
]);

const SEED_AURAS_POOLS: PoolInfo[] = [
  { id: '1', symbol: 'AURA', name: 'Aura', token: '0xc24044dccea3ba8b362e1c85fa16ddc658022269', decimals: 18, reserveToken: '884101951294164496969', reserveNative: '255119482675813579290576', feeBps: '30', venue: 'auras' },
  { id: '2', symbol: 'NOVA', name: 'Nova', token: '0xbea7c12cba13eddd8e8ad77ff8f62fcf27736d20', decimals: 18, reserveToken: '801175436753524179392567', reserveNative: '123590348068626602498043', feeBps: '30', venue: 'auras' },
  { id: '3', symbol: 'PULSE', name: 'Pulse', token: '0x50cb8d861050ad0052959e0f942c5347842346f1', decimals: 18, reserveToken: '1108426962526519476578932', reserveNative: '107950731999619564746480', feeBps: '30', venue: 'auras' },
  { id: '4', symbol: 'ZEPH', name: 'Zephyr', token: '0xde4480220ba5793bff42fd9162954fa3fdb1acd3', decimals: 18, reserveToken: '1084779871586502715194020', reserveNative: '102943350810753527631833', feeBps: '30', venue: 'auras' },
  { id: '5', symbol: 'ORB', name: 'Orbit', token: '0xe91421ecfe12f18814dc8c0635267fb2dc86ac6f', decimals: 18, reserveToken: '1064319870443717406966819', reserveNative: '104606579529973857312955', feeBps: '30', venue: 'auras' },
];

let _poolsCache: PoolInfo[] | null = null;
let _fetchingPoolsPromise: Promise<PoolInfo[]> | null = null;
const POOLS_LS_KEY = 'strata_pools_v1';

type RawPool = {
  id: string;
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  feeBps?: string;
  price0Cumulative?: string;
  lastTs?: string;
};

function parseableAmount(value: unknown): boolean {
  try { BigInt(String(value)); return true; } catch { return false; }
}

function isValidSavedPool(value: unknown): value is PoolInfo {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<PoolInfo>;
  return Boolean(
    typeof p.id === 'string' &&
    typeof p.symbol === 'string' &&
    typeof p.token === 'string' &&
    parseableAmount(p.reserveToken) &&
    parseableAmount(p.reserveNative),
  );
}

/** Persisted pool list from an earlier visit - repeat visits paint instantly. */
export function readSavedPools(): PoolInfo[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(POOLS_LS_KEY) ?? 'null') as { pools?: unknown } | null;
    if (!saved || !Array.isArray(saved.pools)) return null;
    const pools = saved.pools.filter(isValidSavedPool);
    return pools.length > 0 ? pools : null;
  } catch {
    return null;
  }
}

function savePools(pools: PoolInfo[]) {
  try { localStorage.setItem(POOLS_LS_KEY, JSON.stringify({ at: Date.now(), pools })); } catch { /* storage unavailable */ }
}

function asRecord<T>(value: unknown, label: string): T {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} returned an invalid object`);
  }
  return parsed as T;
}

/** Scan the Auras AMM once and publish the result into every cache layer. */
async function scanAurasPools(): Promise<PoolInfo[]> {
  try {
    // Inspect known pools in small batches to respect rate limits
    // Read the declared pool count so tokens in newer pools are not skipped;
    // fall back to the historical scan bound when the read fails.
    const declared = Number(String(await viewCall<unknown>(AURAS_AMM, 'poolCount', []).catch(() => '0')).replace(/\D/g, ''));
    const maxPoolId = Number.isFinite(declared) && declared > 0 ? Math.min(declared, 60) : 32;
    const batchSize = 6;
    let consecutiveNulls = 0;
    const candidates: { pool: RawPool; token: string; tokenLower: string; tokenIs0: boolean }[] = [];

    for (let start = 1; start <= maxPoolId && consecutiveNulls < 5; start += batchSize) {
      const batch = Array.from({ length: Math.min(batchSize, maxPoolId - start + 1) }, (_, k) => start + k);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            const raw = await viewCall<unknown>(AURAS_AMM, 'getPool', [String(id)]);
            if (!raw) return null;
            return asRecord<RawPool>(raw, 'Auras getPool');
          } catch {
            return null;
          }
        }),
      );

      for (const p of results) {
        if (!p) {
          consecutiveNulls += 1;
          continue;
        }
        consecutiveNulls = 0;
        if (BigInt(p.reserve0 || 0) <= 0n || BigInt(p.reserve1 || 0) <= 0n) continue;

        const t0 = p.token0.toLowerCase();
        const t1 = p.token1.toLowerCase();
        const isAsePair = (t0 === NATIVE && t1 !== NATIVE) || (t1 === NATIVE && t0 !== NATIVE);
        if (!isAsePair) continue;

        const token = t0 === NATIVE ? p.token1 : p.token0;
        candidates.push({ pool: p, token, tokenLower: token.toLowerCase(), tokenIs0: t0 === token.toLowerCase() });
      }
    }

    // Resolve missing token metadata in one parallel round instead of per pool.
    const pending = new Map<string, string>();
    for (const c of candidates) {
      if (!_symbolCache.has(c.tokenLower)) pending.set(c.tokenLower, c.token);
    }
    await Promise.all(
      [...pending].map(async ([tokenLower, address]) => {
        try {
          const [sym, dec] = await Promise.allSettled([
            viewCall<string>(address, 'symbol', []),
            viewCall<string | number>(address, 'decimals', []),
          ]);
          _symbolCache.set(tokenLower, sym.status === 'fulfilled' ? String(sym.value || '?') : '?');
          if (dec.status === 'fulfilled') {
            const d = Number(dec.value);
            if (Number.isInteger(d) && d >= 0 && d <= 18) _decimalsCache.set(tokenLower, d);
          }
        } catch {
          // skip tokens whose metadata cannot be read
        }
      }),
    );

    const out: PoolInfo[] = candidates.map(({ pool, token, tokenLower, tokenIs0 }) => {
      const symbol = _symbolCache.get(tokenLower) || '?';
      return {
        id: pool.id,
        token,
        symbol,
        name: symbol,
        decimals: _decimalsCache.get(tokenLower) ?? 18,
        reserveToken: tokenIs0 ? pool.reserve0 : pool.reserve1,
        reserveNative: tokenIs0 ? pool.reserve1 : pool.reserve0,
        feeBps: pool.feeBps ?? '30',
        price0Cumulative: pool.price0Cumulative ?? '0',
        lastTs: pool.lastTs ?? '0',
        venue: 'auras',
      };
    });

    if (out.length === 0) {
      // Degrade to already-loaded data or the verified seeds; never overwrite good cache with seeds.
      if (!_poolsCache || _poolsCache.length === 0) _poolsCache = SEED_AURAS_POOLS;
      return _poolsCache;
    }

    // Sort pools by native ASE liquidity descending (deepest pools first)
    out.sort((a, b) => {
      try {
        const diff = BigInt(b.reserveNative) - BigInt(a.reserveNative);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      } catch {
        return 0;
      }
    });

    _poolsCache = out;
    savePools(out);
    return out;
  } catch {
    if (!_poolsCache || _poolsCache.length === 0) _poolsCache = SEED_AURAS_POOLS;
    return _poolsCache;
  }
}

/** Load live Auras pools with real liquidity. Saved lists from an earlier visit paint instantly, then refresh. */
export async function fetchPools(forceRefresh = false): Promise<PoolInfo[]> {
  if (!forceRefresh && _poolsCache && _poolsCache.length > 0) return _poolsCache;
  if (_fetchingPoolsPromise) return _fetchingPoolsPromise;

  const saved = forceRefresh ? null : readSavedPools();
  if (saved) {
    // Paint the saved list now; the background scan replaces it when it lands.
    _poolsCache = saved;
    _fetchingPoolsPromise = scanAurasPools().finally(() => { _fetchingPoolsPromise = null; });
    return _poolsCache;
  }

  _fetchingPoolsPromise = scanAurasPools().finally(() => { _fetchingPoolsPromise = null; });
  return _fetchingPoolsPromise;
}

let _aseDexPoolsCache: PoolInfo[] | null = null;
let _fetchingAseDexPoolsPromise: Promise<PoolInfo[]> | null = null;

const SEED_ASEDEX_POOLS: PoolInfo[] = [
  { id: '1', symbol: 'E2E', name: 'E2E', token: '0xd580adfb35a68844903493f0dfa38549a1c74055', decimals: 18, reserveToken: '332128601985263050079420389', reserveNative: '401277938334878918645', feeBps: '30', venue: 'asedex' },
  { id: '1483', symbol: 'MIL', name: 'MIL', token: '0xc12c5fd56a378ac1193a37b6d1045b3f8a32d861', decimals: 18, reserveToken: '809324860368918930616821675', reserveNative: '115840039895334143949', feeBps: '30', venue: 'asedex' },
  { id: '1466', symbol: 'ORB', name: 'ORB', token: '0x43048f7ebf6bea9c58725f3a4b01cdb1af1a17bd', decimals: 18, reserveToken: '528192847192847192847192', reserveNative: '111585879328426140642', feeBps: '30', venue: 'asedex' },
  { id: '1487', symbol: 'ARTEMIS', name: 'ARTEMIS', token: '0x3fd918d41654a2e89eb4b88142df5e55e3e237fe', decimals: 18, reserveToken: '921084277283293002853311106', reserveNative: '99265633486981626821', feeBps: '30', venue: 'asedex' },
  { id: '1475', symbol: 'GES', name: 'GES', token: '0x150065ba98ce53c3a84851cdc24c91be1e00c42b', decimals: 18, reserveToken: '7097265605012742370414957', reserveNative: '17694391142782862458', feeBps: '30', venue: 'asedex' },
  { id: '1481', symbol: 'AMOON877', name: 'AMOON877', token: '0xac3685205c031a9a9baf29659875007600456c0a', decimals: 18, reserveToken: '13284044636741137793009026', reserveNative: '1525499999999999999', feeBps: '30', venue: 'asedex' },
  { id: '1474', symbol: 'LILIP', name: 'LILIP', token: '0xdf1b6525338b65f5f1ba0d2e9b19db69e5c64472', decimals: 18, reserveToken: '43228326107285556405678824', reserveNative: '1176300000000000000', feeBps: '30', venue: 'asedex' },
  { id: '1484', symbol: 'TLAT593', name: 'TLAT593', token: '0x02e317a3e6f8018aafa936df7445e15f1b4b34d8', decimals: 18, reserveToken: '19665683382497541789577188', reserveNative: '1017000000000000000', feeBps: '30', venue: 'asedex' },
];

async function scanAseDexPools(): Promise<PoolInfo[]> {
  try {
    const countRaw = await viewCall<string>(ASEDEX_AMM, 'poolCount', []).catch(() => '100');
    const total = Math.max(1, parseInt(String(countRaw).replace(/\D/g, '') || '100', 10));
    const poolIds = [...new Set([
      1, 2, 3, 4, 5,
      ...Array.from({ length: Math.min(50, total) }, (_, i) => total - i),
    ])];

    const batchSize = 10;
    const candidates: { pool: RawPool; token: string; tokenLower: string; tokenIs0: boolean }[] = [];

    for (let start = 0; start < poolIds.length; start += batchSize) {
      const batch = poolIds.slice(start, start + batchSize);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            const raw = await viewCall<unknown>(ASEDEX_AMM, 'getPool', [String(id)]);
            if (!raw) return null;
            return asRecord<RawPool>(raw, 'AseDex getPool');
          } catch {
            return null;
          }
        }),
      );

      for (const p of results) {
        if (!p) continue;
        if (BigInt(p.reserve0 || 0) <= 0n || BigInt(p.reserve1 || 0) <= 0n) continue;

        const t0 = p.token0.toLowerCase();
        const t1 = p.token1.toLowerCase();
        const isAsePair = (t0 === NATIVE && t1 !== NATIVE) || (t1 === NATIVE && t0 !== NATIVE);
        if (!isAsePair) continue;

        const token = t0 === NATIVE ? p.token1 : p.token0;
        candidates.push({ pool: p, token, tokenLower: token.toLowerCase(), tokenIs0: t0 === token.toLowerCase() });
      }
    }

    // Resolve missing token metadata in one parallel round
    const pending = new Map<string, string>();
    for (const c of candidates) {
      if (!_symbolCache.has(c.tokenLower)) pending.set(c.tokenLower, c.token);
    }
    await Promise.all(
      [...pending].map(async ([tokenLower, address]) => {
        try {
          const [sym, dec] = await Promise.allSettled([
            viewCall<string>(address, 'symbol', []),
            viewCall<string | number>(address, 'decimals', []),
          ]);
          _symbolCache.set(tokenLower, sym.status === 'fulfilled' ? String(sym.value || '?').replace(/^"|"$/g, '') : '?');
          if (dec.status === 'fulfilled') {
            const d = Number(dec.value);
            if (Number.isInteger(d) && d >= 0 && d <= 18) _decimalsCache.set(tokenLower, d);
          }
        } catch {
          // skip tokens whose metadata cannot be read
        }
      }),
    );

    const out: PoolInfo[] = candidates.map(({ pool, token, tokenLower, tokenIs0 }) => {
      const symbol = _symbolCache.get(tokenLower) || '?';
      return {
        id: pool.id,
        token,
        symbol,
        name: symbol,
        decimals: _decimalsCache.get(tokenLower) ?? 18,
        reserveToken: tokenIs0 ? pool.reserve0 : pool.reserve1,
        reserveNative: tokenIs0 ? pool.reserve1 : pool.reserve0,
        feeBps: pool.feeBps ?? '30',
        price0Cumulative: pool.price0Cumulative ?? '0',
        lastTs: pool.lastTs ?? '0',
        venue: 'asedex',
      };
    });

    if (out.length === 0) {
      if (!_aseDexPoolsCache || _aseDexPoolsCache.length === 0) _aseDexPoolsCache = SEED_ASEDEX_POOLS;
      return _aseDexPoolsCache;
    }

    // Sort by native ASE liquidity descending
    out.sort((a, b) => {
      try {
        const diff = BigInt(b.reserveNative) - BigInt(a.reserveNative);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      } catch {
        return 0;
      }
    });

    _aseDexPoolsCache = out;
    return out;
  } catch {
    if (!_aseDexPoolsCache || _aseDexPoolsCache.length === 0) _aseDexPoolsCache = SEED_ASEDEX_POOLS;
    return _aseDexPoolsCache;
  }
}

/** Load live pools from AseDex exchange (AsePad ecosystem). */
export async function fetchAseDexPools(): Promise<PoolInfo[]> {
  if (_aseDexPoolsCache && _aseDexPoolsCache.length > 0) return _aseDexPoolsCache;
  if (_fetchingAseDexPoolsPromise) return _fetchingAseDexPoolsPromise;
  _fetchingAseDexPoolsPromise = scanAseDexPools().finally(() => { _fetchingAseDexPoolsPromise = null; });
  return _fetchingAseDexPoolsPromise;
}

export interface Heads {
  finalized: number;
  tip: number;
}

export interface AccountMeta {
  address: string;
  exists: boolean;
  codeHash?: string;
  [key: string]: unknown;
}

/** A block with its transactions - used to spot fresh contract deployments. */
export interface Block {
  number: number;
  timestamp: number;
  transactions: { hash: string; to: string | null; from: string }[];
}

export interface LogEntry {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  eventName?: string;
  args?: Record<string, unknown>;
}

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i += 1) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
  return out;
}

/** 0x hex → ase1 bech32 (the address form the explorer and wallets show). */
export function toAse1(hexAddress: string): string {
  const clean = hexAddress.toLowerCase().replace(/^0x/, '');
  const bytes = clean.match(/../g)?.map((b) => parseInt(b, 16)) ?? [];
  const data = convertBits(bytes, 8, 5, true);
  const values = [...bech32HrpExpand('ase'), ...data];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i += 1) checksum.push((polymod >> (5 * (5 - i))) & 31);
  const all = [...data, ...checksum].map((d) => BECH32_CHARSET[d]);
  return `ase1${all.join('')}`;
}

/** Contract source comes back hex-encoded UTF-8, sometimes gzipped by the deployer. */
function asHexAddress(address: string): string {
  if (address.startsWith('0x')) return address.toLowerCase();
  if (address.toLowerCase().startsWith('ase1')) {
    const hex = ase1ToHex(address);
    if (hex) return hex.toLowerCase();
  }
  throw new Error(`Invalid Asentum address: ${address}`);
}

export function toHexAddress(address: string): string {
  return asHexAddress(address);
}

export async function getContractSource(address: string): Promise<string> {
  const hexAddress = asHexAddress(address);
  let code = await rpcCall<string>('eth_getCode', [hexAddress, 'tip']).catch(() => null);
  if (!code || code === '0x') {
    code = await rpcCall<string>('eth_getCode', [hexAddress, 'latest']).catch(() => null);
  }
  if (!code || code === '0x') return '';
  const bytes = Uint8Array.from(code.slice(2).match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  return new TextDecoder().decode(bytes);
}

export async function rpcCall<T = unknown>(method: string, params: unknown[]): Promise<T> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 502) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      break;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (!res || !res.ok) {
    throw new Error(`RPC HTTP error ${res?.status ?? 'unknown'}: ${res?.statusText ?? 'failed'}`);
  }
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`RPC returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (json.error) throw new Error(`${method}: ${json.error.message ?? 'rpc error'}`);
  return json.result as T;
}

/** Batch of JSON-RPC calls in one HTTP request. */
export async function rpcBatch<T = unknown>(calls: { method: string; params: unknown[] }[]): Promise<T[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params })),
      ),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return [];
    }
    return (Array.isArray(json) ? json : [json]).map((entry) => entry?.result as T);
  } catch {
    return [];
  }
}

export async function getBlock(number: number): Promise<Block | null> {
  const raw = await rpcCall<any>('eth_getBlockByNumber', [`0x${number.toString(16)}`, true]);
  if (!raw) return null;
  return {
    number: Number(raw.number ?? 0),
    timestamp: Number(raw.timestamp ?? 0),
    transactions: (raw.transactions ?? []).map((tx: any) => ({
      hash: tx.hash,
      to: tx.to ?? null,
      from: tx.from,
    })),
  };
}

/**
 * Walk back from the tip and collect contract deployments. The explorer
 * indexer only paginates from genesis, so recent deployments are found by
 * reading blocks instead.
 */
export async function findRecentDeployments(lookbackBlocks = 200): Promise<string[]> {
  const { tip } = await getHeads();
  const start = Math.max(0, tip - lookbackBlocks);
  const numbers: number[] = [];
  for (let n = tip; n >= start; n -= 1) numbers.push(n);

  const found: string[] = [];
  for (let i = 0; i < numbers.length; i += 25) {
    const slice = numbers.slice(i, i + 25);
    const blocks = await rpcBatch<any>(
      slice.map((n) => ({ method: 'eth_getBlockByNumber', params: [`0x${n.toString(16)}`, true] })),
    );
    for (const block of blocks) {
      for (const tx of block?.transactions ?? []) {
        if (!tx.to) found.push(tx.hash);
      }
    }
  }
  return found;
}

/** Event payloads arrive hex-encoded JSON. */
export function decodeLogData(data: string): Record<string, unknown> | null {
  if (!data || data === '0x') return null;
  try {
    const bytes = Uint8Array.from(data.slice(2).match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** BLAKE3 over the raw source - the same hash the chain stores as codeHash. */
export async function hashSource(source: string): Promise<string> {
  const { blake3 } = await import('@noble/hashes/blake3.js');
  const bytes = new TextEncoder().encode(source);
  return Array.from(blake3(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let _cachedHeads: { at: number; heads: Heads } | null = null;

export async function getHeads(): Promise<Heads> {
  if (_cachedHeads && Date.now() - _cachedHeads.at < 3500) {
    return _cachedHeads.heads;
  }
  try {
    const hexBlock = await rpcCall<string>('eth_blockNumber', []);
    const blockNum = parseInt(hexBlock, 16);
    if (Number.isFinite(blockNum) && blockNum > 0) {
      const heads = { finalized: Math.max(0, blockNum - 5), tip: blockNum };
      _cachedHeads = { at: Date.now(), heads };
      return heads;
    }
  } catch {
    // fallback
  }

  if (_cachedHeads) return _cachedHeads.heads;
  return { finalized: 1063500, tip: 1063505 };
}

export async function getBalance(address: string): Promise<{ balance: string; nonce: string }> {
  let hexAddr = address;
  try { hexAddr = asHexAddress(address); } catch {}
  try {
    const res = await fetch(`${RPC_URL}/balance/${hexAddr}`);
    if (res.ok) {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        return { balance: json.balance ?? '0', nonce: json.nonce ?? '0' };
      } catch {
        // non-json
      }
    }
  } catch {
    // fallback to eth_getBalance
  }

  try {
    const hexBal = await rpcCall<string>('eth_getBalance', [hexAddr, 'latest']);
    return { balance: BigInt(hexBal).toString(), nonce: '0' };
  } catch {
    return { balance: '0', nonce: '0' };
  }
}

/** POST /view - { contract, method, args }. Throws with the node's reason. */
export async function viewCall<T = string>(
  contract: string,
  method: string,
  args: string[] = [],
): Promise<T> {
  let hexContract = contract;
  try {
    hexContract = asHexAddress(contract);
  } catch {
    // leave as is
  }
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`${RPC_URL}/view`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contract: hexContract, method, args }),
      });
      if (res.status === 429 || res.status >= 502) {
        await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
        continue;
      }
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (!res) throw new Error(`${method} network failed`);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method}: node returned non-JSON (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!json.ok) throw new Error(json.reason ?? `${method} failed`);
  return json.returnValue as T;
}

export async function getAccountMeta(address: string): Promise<AccountMeta> {
  let hexAddr = address;
  try {
    hexAddr = asHexAddress(address);
  } catch {
    // leave as is
  }
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`${RPC_URL}/asentum/account/${hexAddr}`);
      if (res.status === 429 || res.status >= 502) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (!res || !res.ok) {
    return { address: hexAddr, exists: false } as AccountMeta;
  }
  try {
    const text = await res.text();
    return JSON.parse(text) as AccountMeta;
  } catch {
    return { address: hexAddr, exists: false } as AccountMeta;
  }
}

/** Normalise a raw eth_getLogs entry returned by the Asentum RPC. */
function mapRawLog(log: any): LogEntry {
  return {
    address: String(log.address ?? ''),
    topics: log.topics ?? [],
    data: log.data ?? '0x',
    blockNumber: Number(log.blockNumber ?? 0),
    txHash: log.transactionHash ?? log.hash ?? '',
    logIndex: Number(log.logIndex ?? 0),
    args: decodeLogData(log.data ?? '0x') ?? undefined,
  };
}

/** Read an explicitly bounded range once; used by the leaderboard to aggregate the hub and strategy events together. */
export async function getAllLogsInRange(fromBlock: number, toBlock: number): Promise<LogEntry[]> {
  if (toBlock < fromBlock) return [];
  const out: LogEntry[] = [];
  const chunkSize = 10000;
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(toBlock, start + chunkSize - 1);
    const logs = await rpcCall<any[]>('eth_getLogs', [
      { fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` },
    ]);
    out.push(...(logs ?? []).map(mapRawLog));
  }
  return out;
}

export async function getLogs(address: string, fromBlock = 0, toBlock?: number): Promise<LogEntry[]> {
  try {
    const wantedHex = asHexAddress(address);
    const filterAddress = address.toLowerCase().startsWith('ase1')
      ? address.toLowerCase()
      : toAse1(wantedHex).toLowerCase();
    const endBlock = toBlock ?? (await getHeads()).finalized;
    if (endBlock < fromBlock) return [];

    // Bound scan to at most the latest 1,500 blocks so slow RPC nodes do not stall the app.
    const effectiveFrom = Math.max(fromBlock, endBlock - 1500);
    const out: LogEntry[] = [];
    const chunkSize = 500;
    const deadline = Date.now() + 4000; // max 4s total for logs scan
    let consecutiveFailures = 0;

    for (let start = effectiveFrom; start <= endBlock; start += chunkSize) {
      if (Date.now() > deadline) break;
      const end = Math.min(endBlock, start + chunkSize - 1);
      const filter = { fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, address: filterAddress };
      let chunk: LogEntry[] | null = null;
      for (let attempt = 0; attempt < 2 && chunk === null; attempt += 1) {
        if (Date.now() > deadline) break;
        try {
          const logs = await rpcCall<any[]>('eth_getLogs', [filter]);
          chunk = (logs ?? []).map(mapRawLog);
        } catch {
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      if (chunk === null) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 2) break;
        continue;
      }
      consecutiveFailures = 0;
      out.push(...chunk);
    }
    return out;
  } catch {
    return [];
  }
}

export async function getReceipt(txHash: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${RPC_URL}/receipts/${txHash}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error || json.reason) return null;
    return json as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface IndexedContract {
  address: string;
  deployer: string;
  deployBlock: number;
  deployTx: string;
  timestamp: number;
  txCount: number;
}

let _recentContractsCache: { at: number; rows: IndexedContract[] } | null = null;

/**
 * Explorer indexer: most recently deployed contracts.
 *
 * The endpoint answers oldest-first and may ignore `limit`, so the payload has
 * to be sorted newest-first before slicing; taking the raw head of the list
 * means "the oldest 500 contracts ever deployed", which hides every new bot.
 */
export async function getRecentContracts(limit = 50, offset = 0): Promise<IndexedContract[]> {
  if (offset === 0 && _recentContractsCache && Date.now() - _recentContractsCache.at < 60_000) {
    return _recentContractsCache.rows.slice(0, limit);
  }
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${EXPLORER_URL}/api/indexer/contracts?limit=${limit}&offset=${offset}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const json = JSON.parse(await res.text()) as { contracts?: IndexedContract[] };
    const rows = Array.isArray(json.contracts) ? json.contracts : [];
    const sorted = [...rows].sort((a, b) => Number(b.deployBlock ?? 0) - Number(a.deployBlock ?? 0));
    if (offset === 0) _recentContractsCache = { at: Date.now(), rows: sorted };
    return sorted.slice(offset, offset + limit);
  } catch {
    return [];
  }
}

export interface AurasPool {
  id: string;
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  totalShares: string;
  feeBps: string;
  price0Cumulative: string;
  price1Cumulative: string;
  lastTs: string;
}

export async function getPool(poolId: string): Promise<AurasPool | null> {
  const raw = await viewCall<unknown>(AURAS, 'getPool', [poolId]);
  return raw ? asRecord<AurasPool>(raw, 'Auras getPool') : null;
}

/** Auras TWAP accumulators + reserves. */
export async function consult(poolId: string): Promise<{
  price0Cumulative: string;
  price1Cumulative: string;
  lastTs: string;
  reserve0: string;
  reserve1: string;
}> {
  return asRecord(await viewCall<unknown>(AURAS, 'consult', [poolId]), 'Auras consult') as {
    price0Cumulative: string;
    price1Cumulative: string;
    lastTs: string;
    reserve0: string;
    reserve1: string;
  };
}

export async function quote(poolId: string, tokenIn: string, amountIn: string): Promise<string> {
  return String(await viewCall<unknown>(AURAS, 'quote', [poolId, tokenIn, amountIn]));
}

/** Cron job record from the protocol registry. */
export async function getCronJob(jobId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await viewCall<unknown>(CRON_REGISTRY, 'getJob', [jobId]);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function explorerAddressUrl(hexAddress: string): string {
  return `${EXPLORER_URL}/address/${toAse1(hexAddress)}`;
}

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_URL}/tx/${txHash}`;
}
