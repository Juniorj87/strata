import {
  AURAS,
  ASEDEX_AMM,
  fetchAseDexPools,
  fetchPools,
  findRecentDeployments,
  getAccountMeta,
  getAddressTransfers,
  getAddressTxs,
  getBalance,
  getContractSource,
  getCronJob,
  getPool,
  getReceipt,
  getRecentNetworkTxs,
  hashSource,
  readSavedPools,
  NATIVE,
  STRATA_HUB,
  toAse1,
  toHexAddress,
  viewCall,
} from './rpc';
import { getUserStrategies } from './userStrategies';
import configured from '../config/strategies.json';

const CONFIGURED = configured as unknown as { address: string; template?: string; pool?: string }[];

export interface StrategyEvent {
  block: number;
  name: string;
  args: Record<string, unknown>;
  txHash: string;
  /** Wall-clock milliseconds when the indexer or AMM event supplied one. */
  timestamp?: number;
}

export interface LiveStrategy {
  address: string;
  ase1: string;
  name: string;
  template: string;
  source: string;
  codeHash: string;
  localHash: string;
  verified: boolean;
  deployBlock: number;
  poolId: string | null;
  token: string | null;
  symbol: string | null;
  intervalSec: number | null;
  jobId: string | null;
  cron: {
    nextRunAt: string;
    intervalSec: string;
    gasEscrow: string;
    runsLeft: string;
  } | null;
  balanceAse: string;
  tokenBalance: string;
  markValueAseWei: string | null;
  tokenDecimals: number | null;
  events: StrategyEvent[];
  fillEvents: StrategyEvent[];
  tokenTransfers: StrategyEvent[];
  transferHistoryComplete: boolean;
  accountingTxHashes: string[];
  trades: number;
  /** Token units sent into the AMM by this strategy (token sold). */
  volumeWei: string;
  /** ASE received from token -> ASE fills. Never net profit. */
  realisedWei: string;
  /** Token units bought from the AMM. */
  boughtTokenWei: string;
  /** ASE spent on ASE -> token fills. */
  spentAseWei: string;
  owner: string | null;
  stopped: boolean | null;
  lastSignal: string | null;
  lastSignalBlock: number | null;
  lastFillAt: number | null;
  fillsCapped: boolean;
  discovery: 'configured' | 'scan' | 'user';
  historyComplete: boolean;
}

const TEMPLATE_RE = /Strata template:\s*([a-z-]+)/i;

function parseTemplate(source: string): { name: string; template: string } {
  const match = source.match(TEMPLATE_RE);
  let template = match ? match[1].toLowerCase() : 'custom';
  if (template === 'custom') {
    if (source.includes("return 'dca'") || source.includes("template:'dca'") || source.includes("template: 'dca'")) template = 'dca';
    else if (source.includes("return 'grid'") || source.includes("template:'grid'") || source.includes("template: 'grid'")) template = 'grid';
    else if (source.includes("return 'twap'") || source.includes("template:'twap'") || source.includes("template: 'twap'")) template = 'twap';
    else if (source.includes('risk-managed')) template = 'risk-managed';
    else if (source.includes('limit-exit') || source.includes('limit sell')) template = 'limit-exit';
    else if (source.includes('scale order') || source.includes("template:'scale'") || source.includes("template: 'scale'")) template = 'scale';
    else if (source.includes('momentum-signal')) template = 'momentum-signal';
    else if (source.includes('momentum-trader')) template = 'momentum-trader';
  }
  const title = source.split('\n')[0].replace(/^\/\/\s*/, '').trim();
  return { name: title.length > 0 && title.length < 60 ? title : `${template} strategy`, template };
}

function classify(args: Record<string, unknown>): string {
  if ('template' in args && 'gasEscrowWei' in args) return 'StrataDeploy';
  if ('jobId' in args && 'intervalSec' in args) return 'Armed';
  if ('signal' in args) return 'Signal';
  if ('tokenIn' in args && 'amountOut' in args) return 'Fill';
  if ('payer' in args && 'tokenIn' in args) return 'Swap';
  if ('poolId' in args && 'reserve0' in args && 'reserve1' in args) return 'Sync';
  if ('from' in args && 'to' in args && 'value' in args) return 'Transfer';
  return 'Event';
}

interface ReceiptEvent {
  name?: string;
  data?: Record<string, unknown>;
}

function receiptEvents(receipt: Record<string, unknown> | null): ReceiptEvent[] {
  if (!receipt || !Array.isArray((receipt as { events?: unknown }).events)) return [];
  return (receipt as { events: ReceiptEvent[] }).events.filter((event) => event && typeof event === 'object');
}

interface AccountingResult {
  fills: StrategyEvent[];
  tokenTransfers: StrategyEvent[];
  lifecycle: StrategyEvent[];
  deployBlock: number | null;
  transferTotal: number;
  indexedFrom: number;
  capped: boolean;
  receiptsResolved: boolean;
}

const AMM_ADDRESSES = new Set([AURAS.toLowerCase(), ASEDEX_AMM.toLowerCase()]);

/**
 * Indexed accounting for one strategy contract.
 *
 * Scheduled executions are internal Cron calls, so they never appear as
 * top-level transactions of the strategy. They do move tokens through the AMM,
 * and the explorer indexes those transfers with timestamps. Each candidate
 * trade transaction is then read once from the RPC receipt, which carries the
 * exact Fill amountIn / amountOut pair.
 */
async function fetchStrategyAccounting(hex: string): Promise<AccountingResult> {
  const empty: AccountingResult = {
    fills: [],
    tokenTransfers: [],
    lifecycle: [],
    deployBlock: null,
    transferTotal: 0,
    indexedFrom: 0,
    capped: false,
    receiptsResolved: false,
  };

  const [transfers, txs] = await Promise.all([
    getAddressTransfers(hex, 100).catch(() => ({ rows: [], total: 0, indexedFrom: 0 })),
    getAddressTxs(hex, 25).catch(() => []),
  ]);

  const lifecycle: StrategyEvent[] = txs.map((row) => ({
    block: Number(row.block_number ?? 0),
    name: row.method ? row.method.charAt(0).toUpperCase() + row.method.slice(1) : 'Transaction',
    args: {
      method: String(row.method ?? 'call'),
      status: row.status === 0 ? 'reverted' : 'confirmed',
      valueWei: String(row.value ?? '0'),
    },
    txHash: String(row.hash ?? ''),
    timestamp: Number(row.timestamp) || undefined,
  }));

  const deployRow = txs.find((row) => row.method === 'deploy') ?? txs[txs.length - 1];
  const deployBlock = deployRow && Number.isFinite(Number(deployRow.block_number))
    ? Number(deployRow.block_number)
    : null;

  const rows = [...transfers.rows].sort((a, b) => Number(b.block_number) - Number(a.block_number));
  const tokenTransfers: StrategyEvent[] = rows
    .filter((row) => row.kind === 'token' && typeof row.token === 'string')
    .map((row) => ({
      block: Number(row.block_number ?? 0),
      name: 'Transfer',
      args: {
        from: String(row.from_addr ?? '').toLowerCase(),
        to: String(row.to_addr ?? '').toLowerCase(),
        value: String(row.value ?? '0'),
        token: String(row.token ?? '').toLowerCase(),
      },
      txHash: String(row.tx_hash ?? ''),
      timestamp: Number(row.timestamp) || undefined,
    }));

  const tradeTxs = new Map<string, { block: number; timestamp: number }>();
  for (const row of rows) {
    if (row.kind !== 'token') continue;
    const from = String(row.from_addr ?? '').toLowerCase();
    const to = String(row.to_addr ?? '').toLowerCase();
    if (!AMM_ADDRESSES.has(from) && !AMM_ADDRESSES.has(to)) continue;
    if (!row.tx_hash || tradeTxs.has(row.tx_hash)) continue;
    tradeTxs.set(row.tx_hash, { block: Number(row.block_number ?? 0), timestamp: Number(row.timestamp) || 0 });
  }
  if (tradeTxs.size === 0) {
    return {
      ...empty,
      lifecycle,
      tokenTransfers,
      deployBlock,
      transferTotal: transfers.total,
      indexedFrom: transfers.indexedFrom,
      receiptsResolved: true,
    };
  }

  const candidates = [...tradeTxs.entries()].slice(0, 24);
  const fills: StrategyEvent[] = [];
  let receiptsResolved = true;

  for (let offset = 0; offset < candidates.length; offset += 5) {
    const batch = candidates.slice(offset, offset + 5);
    const receipts = await Promise.all(batch.map(([hash]) => getReceipt(hash).catch(() => null)));
    receipts.forEach((receipt, index) => {
      const [hash, fallback] = batch[index];
      if (!receipt) {
        receiptsResolved = false;
        return;
      }
      const events = receiptEvents(receipt);
      const swap = events.find(
        (event) => event.name === 'Swap' && String(event.data?.payer ?? '').toLowerCase() === hex,
      )?.data;
      const fill = events.find((event) => event.name === 'Fill')?.data;
      const touchesStrategy = events.some((event) => {
        if (event.name !== 'Transfer' || !event.data) return false;
        const from = String(event.data.from ?? '').toLowerCase();
        const to = String(event.data.to ?? '').toLowerCase();
        return from === hex || to === hex;
      });
      if (!swap && !(fill && touchesStrategy)) return;
      const data = fill && fill.tokenIn !== undefined ? fill : swap;
      if (!data || data.tokenIn === undefined) return;
      const block = Number(receipt.blockNumber ?? 0) || fallback.block;
      const timestamp = Number(swap?.blockTimestamp ?? data.blockTimestamp ?? 0) || fallback.timestamp;
      fills.push({
        block,
        name: 'Fill',
        args: { ...swap, ...data },
        txHash: hash,
        timestamp: timestamp || undefined,
      });
    });
  }

  fills.sort((a, b) => b.block - a.block);

  return {
    fills,
    tokenTransfers,
    lifecycle,
    deployBlock,
    transferTotal: transfers.total,
    indexedFrom: transfers.indexedFrom,
    capped: tradeTxs.size > candidates.length,
    receiptsResolved,
  };
}

const toUnits = (value: unknown): bigint => {
  try { return BigInt(String(value ?? '0').replace(/\D/g, '') || '0'); } catch { return 0n; }
};

/** Build one strategy record from chain state. */
export async function loadStrategy(address: string, discovery: 'configured' | 'scan' | 'user' = 'configured'): Promise<LiveStrategy | null> {
  let hex: string;
  try { hex = toHexAddress(address).toLowerCase(); }
  catch { return null; }
  const [source, meta, balance] = await Promise.all([
    getContractSource(hex),
    getAccountMeta(hex).catch(() => ({ address: hex, exists: false }) as { codeHash?: string }),
    getBalance(hex).catch(() => ({ balance: '0', nonce: '0' })),
  ]);

  if (!source) return null;

  const localHash = await hashSource(source);
  const codeHash = String(meta.codeHash ?? '').replace(/^0x/, '').toLowerCase();
  const { name, template } = parseTemplate(source);

  // Deploy block comes from the address transaction index, which is a tiny
  // response. The old code pulled the 500-contract index (~35 MB) for every
  // strategy, which is what made Activity and Leaderboard stall on a busy
  // gateway.
  const [ownerResult, statusResult] = await Promise.all([
    viewCall<unknown>(hex, 'getOwner', []).catch(() => ''),
    viewCall<unknown>(hex, 'getStatus', []).catch(() => ''),
  ]);

  let status: Record<string, unknown> = {};
  try {
    const decoded = typeof statusResult === 'string' ? JSON.parse(statusResult) as unknown : statusResult;
    status = decoded && typeof decoded === 'object' ? decoded as Record<string, unknown> : {};
  } catch { status = {}; }

  let token = status.token ? String(status.token) : null;
  const poolId = status.poolId ? String(status.poolId) : null;
  const intervalSec = status.intervalSec !== undefined && status.intervalSec !== null && Number.isFinite(Number(status.intervalSec))
    ? Number(status.intervalSec)
    : null;
  const jobId = status.jobId ? String(status.jobId) : null;

  const accounting = await fetchStrategyAccounting(hex);
  const tokenTransfers = token
    ? accounting.tokenTransfers.filter((event) => String(event.args.token ?? '') === token!.toLowerCase())
    : accounting.tokenTransfers;

  const cronJob = jobId ? await getCronJob(jobId).catch(() => null) : null;
  let poolSymbol: string | null = null;
  let tokenDecimals: number | null = null;

  if (poolId) {
    const cachedPools = typeof window !== 'undefined' ? (readSavedPools() ?? []) : [];
    const matched = cachedPools.find((p) => String(p.id) === String(poolId) && (!token || p.token.toLowerCase() === token.toLowerCase()))
      ?? cachedPools.find((p) => String(p.id) === String(poolId));
    if (matched) {
      poolSymbol = matched.symbol;
      tokenDecimals = matched.decimals ?? null;
      if (!token) token = matched.token;
    } else {
      try {
        const poolData = await getPool(poolId);
        if (poolData) {
          const t0 = poolData.token0?.toLowerCase();
          const t1 = poolData.token1?.toLowerCase();
          const chosen = t0 === token?.toLowerCase() ? poolData.token0
            : t1 === token?.toLowerCase() ? poolData.token1
              : (t0 !== NATIVE ? poolData.token0 : poolData.token1);
          if (chosen && chosen.toLowerCase() !== NATIVE) {
            token = chosen;
            const [sym, dec] = await Promise.all([
              viewCall<string>(chosen, 'symbol', []).catch(() => null),
              viewCall<string | number>(chosen, 'decimals', []).catch(() => 18),
            ]);
            poolSymbol = sym || (poolId === '1' ? 'AURA' : `POOL#${poolId}`);
            tokenDecimals = Number(dec) || 18;
          }
        }
      } catch { /* pool metadata unavailable */ }
    }
  }

  let tokenBalance = '0';
  let markValueAseWei: string | null = null;
  if (token) {
    tokenBalance = String(await viewCall<unknown>(token, 'balanceOf', [hex]).catch(() => '0')).replace(/"/g, '');
    if (poolId && BigInt(tokenBalance || '0') > 0n) {
      const quote = await viewCall<unknown>(AURAS, 'quote', [poolId, token, tokenBalance]).catch(() => null);
      if (quote !== null && quote !== undefined) markValueAseWei = String(quote);
    } else if (BigInt(tokenBalance || '0') === 0n) {
      markValueAseWei = '0';
    }
  }

  const fills = accounting.fills;
  const tokenLower = (token ?? '').toLowerCase();
  const sold = tokenLower
    ? fills.filter((event) => String(event.args.tokenIn ?? '').toLowerCase() === tokenLower)
    : [];
  const bought = tokenLower
    ? fills.filter((event) => String(event.args.tokenOut ?? '').toLowerCase() === tokenLower)
    : [];
  let receivedAseWei = sold.reduce((sum, event) => sum + toUnits(event.args.amountOut), 0n);
  let spentAseWei = bought.reduce((sum, event) => sum + toUnits(event.args.amountIn), 0n);
  let soldTokenWei = sold.reduce((sum, event) => sum + toUnits(event.args.amountIn), 0n);
  let boughtTokenWei = bought.reduce((sum, event) => sum + toUnits(event.args.amountOut), 0n);

  const asCount = (value: unknown) => {
    const count = Number(value ?? 0);
    return Number.isFinite(count) ? count : 0;
  };
  // `ticks` counts scheduled runs, not filled orders, so it is never used here.
  const contractTrades = asCount(status.legs ?? status.legsDone)
    || asCount(status.buyLevel) + asCount(status.sellLevel);
  const trades = Math.max(fills.length, contractTrades);

  // When the transfer index shows no swaps, fall back to the contract's own
  // cumulative counters, which are still chain state - never to a guess.
  if (fills.length === 0) {
    receivedAseWei = toUnits(status.earned ?? status.realisedAseWei ?? 0);
    spentAseWei = toUnits(status.spentAseWei ?? status.buySpentAseWei ?? 0);
    soldTokenWei = 0n;
    boughtTokenWei = 0n;
  }

  const lifecycleEvents = accounting.lifecycle.filter((event) => event.txHash);
  const events: StrategyEvent[] = [...fills, ...lifecycleEvents].sort((a, b) => b.block - a.block);
  const deployBlock = accounting.deployBlock ?? 0;
  const lastFillAt = fills.reduce<number | null>(
    (latest, event) => (event.timestamp ? Math.max(latest ?? 0, event.timestamp) : latest),
    null,
  );

  const rawOwner = (ownerResult || status.owner || '').toString().trim();
  let owner: string | null = null;
  if (rawOwner) {
    try { owner = toHexAddress(rawOwner).toLowerCase(); } catch { owner = rawOwner.toLowerCase(); }
  }

  const stopped = typeof status.stopped === 'string'
    ? status.stopped === 'true'
    : typeof status.stopped === 'boolean'
      ? status.stopped
      : null;

  // Transfer history is complete only when the indexer covered the whole life
  // of the contract and returned every row it holds.
  const transferHistoryComplete = Boolean(
    token
    && accounting.transferTotal <= accounting.tokenTransfers.length
    && accounting.indexedFrom > 0
    && deployBlock >= accounting.indexedFrom,
  );

  const txHashes = [
    ...accounting.lifecycle.map((event) => event.txHash),
    ...fills.map((event) => event.txHash),
    ...tokenTransfers.map((event) => event.txHash),
  ].filter((hash) => /^0x[0-9a-fA-F]{64}$/.test(hash));

  return {
    address: hex,
    ase1: toAse1(hex),
    name,
    template,
    source,
    codeHash,
    localHash,
    verified: codeHash.length > 0 && codeHash === localHash,
    deployBlock,
    poolId,
    token,
    symbol: poolSymbol,
    intervalSec,
    jobId,
    cron: cronJob
      ? {
          nextRunAt: String(cronJob.nextRunAt ?? ''),
          intervalSec: String(cronJob.intervalSec ?? ''),
          gasEscrow: String(cronJob.gasEscrow ?? ''),
          runsLeft: String(cronJob.runsLeft ?? ''),
        }
      : null,
    balanceAse: balance.balance,
    tokenBalance,
    markValueAseWei,
    tokenDecimals,
    events: events.slice(0, 60),
    fillEvents: [...fills].sort((a, b) => a.block - b.block),
    tokenTransfers: tokenTransfers.slice(-5000),
    transferHistoryComplete,
    accountingTxHashes: [...new Set(txHashes)],
    trades,
    volumeWei: soldTokenWei.toString(),
    realisedWei: receivedAseWei.toString(),
    boughtTokenWei: boughtTokenWei.toString(),
    spentAseWei: spentAseWei.toString(),
    owner,
    stopped,
    lastSignal: null,
    lastSignalBlock: null,
    lastFillAt,
    fillsCapped: accounting.capped,
    discovery,
    historyComplete: Boolean(
      accounting.receiptsResolved
      && !accounting.capped
      && fills.length >= contractTrades
      && transferHistoryComplete,
    ),
  };
}

/**
 * Strategy contracts registered in Strata Hub.
 *
 * The indexer lists the Hub's own transactions, and each registration receipt
 * carries the registered strategy address in its events. That needs neither a
 * log scan nor a block batch — both of which the gateway often rejects — so a
 * bot deployed from another browser or origin still appears here.
 */
async function fetchHubRegistrations(): Promise<string[]> {
  let hubHex: string;
  try { hubHex = toHexAddress(STRATA_HUB).toLowerCase(); } catch { return []; }
  const rows = (await getAddressTxs(hubHex, 50).catch(() => [])).filter(
    (row) => row.method === 'registerStrategy' && row.status !== 0,
  );
  const strategies = await Promise.all(rows.slice(0, 24).map(async (row) => {
    const receipt = await getReceipt(row.hash).catch(() => null);
    const events = receiptEvents(receipt);
    const raw = events.find((event) => event?.name === 'StrategyRegistered')?.data?.strategy;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try { return toHexAddress(raw).toLowerCase(); } catch { return null; }
  }));
  return strategies.filter((value): value is string => Boolean(value));
}

/** Contracts this wallet deployed that are Strata templates. */
async function fetchOwnerDeployments(owner: string): Promise<string[]> {
  let ownerHex: string;
  try { ownerHex = toHexAddress(owner).toLowerCase(); } catch { return []; }
  const rows = (await getAddressTxs(ownerHex, 50).catch(() => [])).filter(
    (row) => typeof row.contract_created === 'string' && /^0x[0-9a-fA-F]{40}$/.test(row.contract_created),
  );
  const checked = await Promise.all(rows.slice(0, 12).map(async (row) => {
    const address = String(row.contract_created).toLowerCase();
    const source = await getContractSource(address).catch(() => '');
    return source.includes('Strata template:') && !source.includes('Strata template: strata-hub')
      ? address
      : null;
  }));
  return checked.filter((value): value is string => Boolean(value));
}

/** Configured strategies plus user-deployed strategies plus anything registered in the Hub. */
async function fetchRegisteredStrategies(owner?: string): Promise<string[]> {
  const [hub, own] = await Promise.all([
    fetchHubRegistrations(),
    owner ? fetchOwnerDeployments(owner) : Promise.resolve<string[]>([]),
  ]);
  const addresses: string[] = [];
  for (const address of [...hub, ...own]) {
    if (address && !addresses.includes(address)) addresses.push(address);
  }
  return addresses;
}

export async function loadStrategies(owner?: string): Promise<LiveStrategy[]> {
  const out: LiveStrategy[] = [];

  const configuredLoaded = await Promise.all(
    CONFIGURED
      .filter((entry) => entry.template !== 'strata-hub')
      .map((entry) => loadStrategy(entry.address, 'configured').catch(() => null)),
  );
  for (const strategy of configuredLoaded) {
    if (strategy && strategy.template !== 'strata-hub') out.push(strategy);
  }

  // Include user strategies deployed in this browser (in parallel)
  try {
    const userRecords = getUserStrategies();
    const missing = userRecords.filter((rec) => !out.some((s) => s.address.toLowerCase() === rec.address.toLowerCase()));
    const userLoaded = await Promise.all(
      missing.map((rec) => loadStrategy(rec.address, 'user').catch(() => null)),
    );
    for (const strategy of userLoaded) {
      if (strategy && strategy.template !== 'strata-hub') out.push(strategy);
    }
  } catch {
    // non-blocking
  }

  // Canonical discovery: read the Hub registry so bots deployed from another
  // browser, another origin or the Telegram client still appear here.
  try {
    const registered = (await fetchRegisteredStrategies(owner)).slice(0, 24);
    const missing = registered.filter((address) => !out.some((s) => s.address.toLowerCase() === address));
    const loaded = await Promise.all(missing.map((address) => loadStrategy(address, 'scan').catch(() => null)));
    for (const strategy of loaded) {
      if (strategy && strategy.template !== 'strata-hub') out.push(strategy);
    }
  } catch {
    // Hub discovery can fail while the explorer is unhealthy; other paths still run.
  }

  // Fallback: catch unregistered contracts deployed in the last few minutes.
  try {
    const recent = await fetchRecentDeployments(60);
    for (const address of recent) {
      if (out.some((s) => s.address.toLowerCase() === address.toLowerCase())) continue;
      const source = await getContractSource(address).catch(() => '');
      if (!source.includes('Strata template:') || source.includes('Strata template: strata-hub')) continue;
      const strategy = await loadStrategy(address, 'scan');
      if (strategy && strategy.template !== 'strata-hub') out.push(strategy);
    }
  } catch {
    // discovery is a bonus - configured strategies still load without it
  }

  return out;
}

async function fetchRecentDeployments(lookback: number): Promise<string[]> {
  const txHashes = await findRecentDeployments(lookback);
  const addresses: string[] = [];
  for (const hash of txHashes.slice(0, 20)) {
    const receipt = (await getReceipt(hash).catch(() => null)) as { contractAddress?: string } | null;
    const contractAddress = receipt?.contractAddress;
    if (typeof contractAddress === 'string' && contractAddress.startsWith('0x')) {
      addresses.push(contractAddress.toLowerCase());
    }
  }
  return addresses;
}

/**
 * Live swap tape across the Auras pools.
 *
 * Reads the indexer's network-wide transaction feed (which does have
 * timestamps) and resolves the swap amounts from each receipt.
 */
export interface TapeRow {
  block: number;
  pool: string;
  symbol: string;
  tokenIn: string;
  amountIn: string;
  amountOut: string;
  txHash: string;
  timestamp?: number;
}

export async function loadTape(limit = 12): Promise<TapeRow[]> {
  const [txs, pools] = await Promise.all([
    getRecentNetworkTxs(40).catch(() => []),
    fetchPools().catch(() => []),
  ]);
  const swaps = txs.filter((row) => row.method === 'swapExactIn' && row.status !== 0).slice(0, limit);
  const receipts = await Promise.all(swaps.map((row) => getReceipt(row.hash).catch(() => null)));
  const rows: TapeRow[] = [];
  receipts.forEach((receipt, index) => {
    const row = swaps[index];
    const swap = receiptEvents(receipt).find((event) => event.name === 'Swap')?.data;
    if (!swap) return;
    const poolId = String(swap.poolId ?? '');
    const tokenOut = String(swap.tokenOut ?? '');
    const known = pools.find((pool) => pool.id === poolId)
      ?? pools.find((pool) => pool.token.toLowerCase() === tokenOut.toLowerCase());
    rows.push({
      block: Number(row.block_number ?? 0),
      pool: poolId,
      symbol: known?.symbol ?? 'TOKEN',
      tokenIn: String(swap.tokenIn ?? ''),
      amountIn: String(swap.amountIn ?? '0'),
      amountOut: String(swap.amountOut ?? '0'),
      txHash: row.hash,
      timestamp: Number(row.timestamp) || Number(swap.blockTimestamp) || undefined,
    });
  });
  return rows;
}

/** Live pool state: reserves, TWAP and spot quote. */
export interface LivePool {
  id: string;
  symbol: string;
  name: string;
  token: string;
  decimals?: number;
  reserveToken: string;
  reserveNative: string;
  spot: string;
  feeBps: string;
  twapTs: string;
  venue?: 'auras' | 'asedex';
}

/** Calculate spot quote in ASE for 1 token (1e18) using Auras constant product math */
export function computeSpot(reserveToken: string, reserveNative: string, feeBps = '30', tokenDecimals = 18): string {
  try {
    const r0 = BigInt(reserveToken);
    const r1 = BigInt(reserveNative);
    if (r0 <= 0n || r1 <= 0n) return '0';
    const fee = BigInt(feeBps);
    if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) return '0';
    const amt = 10n ** BigInt(tokenDecimals); // one whole ARC-20 token
    const amtWithFee = amt * (10000n - fee);
    return ((amtWithFee * r1) / (r0 * 10000n + amtWithFee)).toString();
  } catch {
    return '0';
  }
}

export async function loadPools(): Promise<LivePool[]> {
  const pools = await fetchPools();
  return pools.map((pool) => ({
    id: pool.id,
    symbol: pool.symbol,
    name: pool.name,
    token: pool.token,
    decimals: pool.decimals,
    reserveToken: pool.reserveToken,
    reserveNative: pool.reserveNative,
    spot: computeSpot(pool.reserveToken, pool.reserveNative, pool.feeBps ?? '30', pool.decimals ?? 18),
    feeBps: pool.feeBps ?? '30',
    twapTs: pool.price0Cumulative ?? pool.lastTs ?? '',
    venue: 'auras',
  }));
}

export async function loadAseDexPools(): Promise<LivePool[]> {
  const pools = await fetchAseDexPools();
  return pools.map((pool) => ({
    id: pool.id,
    symbol: pool.symbol,
    name: pool.name,
    token: pool.token,
    decimals: pool.decimals,
    reserveToken: pool.reserveToken,
    reserveNative: pool.reserveNative,
    spot: computeSpot(pool.reserveToken, pool.reserveNative, pool.feeBps ?? '30', pool.decimals ?? 18),
    feeBps: pool.feeBps ?? '30',
    twapTs: pool.price0Cumulative ?? pool.lastTs ?? '',
    venue: 'asedex',
  }));
}

export { classify };
