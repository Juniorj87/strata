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

/** Auras - the native ASE AMM. Source is on chain, readable with eth_getCode. */
export const AURAS = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';

/** EIP-7528 style sentinel for the native side of a pool. */
export const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/** Protocol cron registry - pre-deployed system contract. */
export const CRON_REGISTRY = '0x0000000000000000000000000000000000000006';

/** Strata Hub - canonical protocol coordinator and registry. */
export const STRATA_HUB = 'ase1utdzul2gxdw4c60fr7fcphghlak63sjf8mqnut';

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
}

const _symbolCache = new Map<string, string>();
let _poolsCache: PoolInfo[] | null = null;
let _fetchingPoolsPromise: Promise<PoolInfo[]> | null = null;

/** Load every Auras pool that currently has liquidity, with token symbols. */
export async function fetchPools(forceRefresh = false): Promise<PoolInfo[]> {
  if (!forceRefresh && _poolsCache) return _poolsCache;
  if (_fetchingPoolsPromise) return _fetchingPoolsPromise;

  _fetchingPoolsPromise = (async () => {
    try {
      const out: PoolInfo[] = [];
      let i = 1;
      let consecutiveNulls = 0;
      while (consecutiveNulls < 12 && i < 1000) {
        const batch = Array.from({ length: 40 }, (_, k) => i + k);
        const results = await Promise.all(
          batch.map(async (id) => {
            try {
              const raw = await viewCall<string>(AURAS, 'getPool', [String(id)]);
              if (!raw) return null;
              const p = JSON.parse(raw) as {
                id: string;
                token0: string;
                token1: string;
                reserve0: string;
                reserve1: string;
                feeBps?: string;
                price0Cumulative?: string;
                lastTs?: string;
              };
              return p;
            } catch {
              return null;
            }
          }),
        );

        const valid: NonNullable<(typeof results)[number]>[] = [];
        for (const p of results) {
          if (!p) {
            consecutiveNulls += 1;
            continue;
          }
          consecutiveNulls = 0;
          if (BigInt(p.reserve0 || 0) <= 0n || BigInt(p.reserve1 || 0) <= 0n) continue;
          valid.push(p);
        }

        // Fetch any un-cached symbols in parallel
        const unknownTokens = [
          ...new Set(valid.map((p) => p.token0.toLowerCase())),
        ].filter((t) => !_symbolCache.has(t));

        if (unknownTokens.length > 0) {
          await Promise.all(
            unknownTokens.map(async (t) => {
              try {
                const sym = await viewCall<string>(t, 'symbol', []);
                _symbolCache.set(t, sym || '?');
              } catch {
                _symbolCache.set(t, '?');
              }
            }),
          );
        }

        for (const p of valid) {
          const symbol = _symbolCache.get(p.token0.toLowerCase()) || '?';
          out.push({
            id: p.id,
            token: p.token0,
            symbol,
            name: symbol,
            reserveToken: p.reserve0,
            reserveNative: p.reserve1,
            feeBps: p.feeBps ?? '30',
            price0Cumulative: p.price0Cumulative ?? '0',
            lastTs: p.lastTs ?? '0',
          });
        }

        i += batch.length;
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
      return out;
    } finally {
      _fetchingPoolsPromise = null;
    }
  })();

  return _fetchingPoolsPromise;
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
export async function getContractSource(hexAddress: string): Promise<string> {
  const code = await rpcCall<string>('eth_getCode', [hexAddress, 'latest']);
  if (!code || code === '0x') return '';
  const bytes = Uint8Array.from(code.slice(2).match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  return new TextDecoder().decode(bytes);
}

export async function rpcCall<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message ?? 'rpc error'}`);
  return json.result as T;
}

/** Batch of JSON-RPC calls in one HTTP request. */
export async function rpcBatch<T = unknown>(calls: { method: string; params: unknown[] }[]): Promise<T[]> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params })),
    ),
  });
  const json = await res.json();
  return (Array.isArray(json) ? json : [json]).map((entry) => entry.result as T);
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

export async function getHeads(): Promise<Heads> {
  const res = await fetch(`${RPC_URL}/v3/heads`);
  const json = await res.json();
  return { finalized: Number(json.finalized), tip: Number(json.tip) };
}

export async function getBalance(address: string): Promise<{ balance: string; nonce: string }> {
  const res = await fetch(`${RPC_URL}/balance/${address}`);
  const json = await res.json();
  return { balance: json.balance ?? '0', nonce: json.nonce ?? '0' };
}

/** POST /view - { contract, method, args }. Throws with the node's reason. */
export async function viewCall<T = string>(
  contract: string,
  method: string,
  args: string[] = [],
): Promise<T> {
  const res = await fetch(`${RPC_URL}/view`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contract, method, args }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.reason ?? `${method} failed`);
  return json.returnValue as T;
}

export async function getAccountMeta(address: string): Promise<AccountMeta> {
  const res = await fetch(`${RPC_URL}/asentum/account/${address}`);
  return (await res.json()) as AccountMeta;
}

/**
 * eth_getLogs on the node ignores a hex address filter and attributes events
 * to the outermost contract, so we always pull without an address filter and
 * narrow client-side.
 */
export async function getLogs(address: string, fromBlock = 0, toBlock?: number): Promise<LogEntry[]> {
  const logs = await rpcCall<any[]>('eth_getLogs', [
    { fromBlock: `0x${fromBlock.toString(16)}`, toBlock: toBlock ? `0x${toBlock.toString(16)}` : 'latest' },
  ]);
  const wanted = address.toLowerCase();
  const ase1 = toAse1(address);
  return (logs ?? [])
    .filter((log) => {
      const addr = String(log.address ?? '').toLowerCase();
      return addr === wanted || addr === ase1;
    })
    .map((log) => ({
      address: log.address,
      topics: log.topics ?? [],
      data: log.data ?? '0x',
      blockNumber: Number(log.blockNumber ?? 0),
      txHash: log.transactionHash ?? log.hash ?? '',
      logIndex: log.logIndex ?? 0,
      args: decodeLogData(log.data ?? '0x') ?? undefined,
    }));
}

export async function getReceipt(txHash: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${RPC_URL}/receipts/${txHash}`);
  const json = await res.json();
  if (json.error || json.reason) return null;
  return json as Record<string, unknown>;
}

/** Explorer indexer: most recently deployed contracts. */
export async function getRecentContracts(limit = 50, offset = 0): Promise<
  { address: string; deployer: string; deployBlock: number; deployTx: string; timestamp: number; txCount: number }[]
> {
  const res = await fetch(`${EXPLORER_URL}/api/indexer/contracts?limit=${limit}&offset=${offset}`);
  const json = await res.json();
  return json.contracts ?? [];
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
  const raw = await viewCall<string>(AURAS, 'getPool', [poolId]);
  return raw ? (JSON.parse(raw) as AurasPool) : null;
}

/** Auras TWAP accumulators + reserves. */
export async function consult(poolId: string): Promise<{
  price0Cumulative: string;
  price1Cumulative: string;
  lastTs: string;
  reserve0: string;
  reserve1: string;
}> {
  return JSON.parse(await viewCall<string>(AURAS, 'consult', [poolId]));
}

export async function quote(poolId: string, tokenIn: string, amountIn: string): Promise<string> {
  return viewCall<string>(AURAS, 'quote', [poolId, tokenIn, amountIn]);
}

/** Cron job record from the protocol registry. */
export async function getCronJob(jobId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await viewCall<string | null>(CRON_REGISTRY, 'getJob', [jobId]);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
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
