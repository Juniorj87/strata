import {
  AURAS,
  fetchPools,
  fetchAseDexPools,
  findRecentDeployments,
  getAccountMeta,
  getBalance,
  getContractSource,
  getCronJob,
  getHeads,
  getLogs,
  getPool,
  getReceipt,
  getRecentContracts,
  hashSource,
  readSavedPools,
  toAse1,
  toHexAddress,
  viewCall,
} from './rpc';
import { getUserStrategies } from './userStrategies';
import configured from '../config/strategies.json';

const CONFIGURED = configured as unknown as { address: string; template?: string; pool?: string }[];
let recentContractIndex: Promise<Awaited<ReturnType<typeof getRecentContracts>>> | null = null;

function loadRecentContractIndex() {
  if (!recentContractIndex) recentContractIndex = getRecentContracts(500, 0).catch(() => []);
  return recentContractIndex;
}

export interface StrategyEvent {
  block: number;
  name: string;
  args: Record<string, unknown>;
  txHash: string;
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
  volumeWei: string;
  realisedWei: string;
  owner: string | null;
  stopped: boolean | null;
  lastSignal: string | null;
  lastSignalBlock: number | null;
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

  const [heads, recentContracts] = await Promise.all([
    getHeads().catch(() => ({ finalized: 0, tip: 0 })),
    Promise.race([
      loadRecentContractIndex(),
      new Promise<Awaited<ReturnType<typeof getRecentContracts>>>((r) => setTimeout(() => r([]), 1500)),
    ]),
  ]);
  const indexedDeployment = recentContracts.find((entry) => {
    try { return toHexAddress(entry.address).toLowerCase() === hex; }
    catch { return entry.address.toLowerCase() === hex; }
  });
  // Bound the fallback scan window to 1,500 blocks so eth_getLogs never stalls.
  const scanFrom = Number.isFinite(indexedDeployment?.deployBlock)
    ? Math.max(Number(indexedDeployment?.deployBlock), heads.finalized - 1500)
    : Math.max(0, heads.finalized - 1500);
  const [ownerResult, statusResult] = await Promise.all([
    viewCall<unknown>(hex, 'getOwner', []).catch(() => ''),
    viewCall<unknown>(hex, 'getStatus', []).catch(() => ''),
  ]);
  let status: Record<string, unknown> = {};
  try {
    const decoded = typeof statusResult === 'string' ? JSON.parse(statusResult) as unknown : statusResult;
    status = decoded && typeof decoded === 'object' ? decoded as Record<string, unknown> : {};
  } catch { status = {}; }

  const tokenValueEarly = status.token;
  let token = tokenValueEarly ? String(tokenValueEarly) : null;

  // Fetch strategy logs and token logs concurrently with a strict 2s timeout
  const [logsResult, transferLogsResult] = await Promise.all([
    Promise.race([
      getLogs(hex, scanFrom, heads.finalized || undefined)
        .then((value) => ({ value, complete: true }))
        .catch(() => ({ value: [], complete: false })),
      new Promise<{ value: any[]; complete: boolean }>((r) => setTimeout(() => r({ value: [], complete: false }), 2000)),
    ]),
    token
      ? Promise.race([
          getLogs(token, scanFrom, heads.finalized || undefined)
            .then((value) => ({ value, complete: true }))
            .catch(() => ({ value: [], complete: false })),
          new Promise<{ value: any[]; complete: boolean }>((r) => setTimeout(() => r({ value: [], complete: false }), 2000)),
        ])
      : Promise.resolve({ value: [], complete: false }),
  ]);

  const logs = logsResult.value;
  const events: StrategyEvent[] = logs.map((log) => ({
    block: log.blockNumber,
    name: classify(log.args ?? {}),
    args: log.args ?? {},
    txHash: log.txHash,
  }));
  const ordered = [...events].sort((a, b) => a.block - b.block);
  const deployBlock = ordered[0]?.block ?? (Number.isFinite(indexedDeployment?.deployBlock) ? Number(indexedDeployment?.deployBlock) : 0);

  const armed = ordered.find((e) => e.args.jobId !== undefined) ?? ordered.find((e) => 'intervalSec' in e.args);
  const poolIdValue = armed?.args.poolId ?? status.poolId;
  const tokenValue = armed?.args.token ?? status.token;
  const intervalValue = armed?.args.intervalSec ?? status.intervalSec;
  const jobValue = armed?.args.jobId ?? status.jobId;
  const poolId = poolIdValue ? String(poolIdValue) : null;
  if (tokenValue) token = String(tokenValue);
  const intervalSec = intervalValue !== undefined && intervalValue !== null ? Number(intervalValue) : null;
  const jobId = jobValue ? String(jobValue) : null;
  const normaliseAddress = (value: unknown) => {
    const raw = String(value ?? '').toLowerCase();
    if (!raw) return '';
    try { return toHexAddress(raw).toLowerCase(); } catch { return raw; }
  };
  const tokenTransferLogs = transferLogsResult.value.filter((log) => {
    const args = log.args ?? {};
    return normaliseAddress(args.from) === hex || normaliseAddress(args.to) === hex;
  });
  const tokenTransfers: StrategyEvent[] = tokenTransferLogs.map((log) => ({
    block: log.blockNumber,
    name: 'Transfer',
    args: {
      ...(log.args ?? {}),
      from: normaliseAddress(log.args?.from),
      to: normaliseAddress(log.args?.to),
    },
    txHash: log.txHash,
  }));
  const transferHistoryComplete = Boolean(
    token && transferLogsResult.complete && tokenTransferLogs.length <= 5000 && tokenTransferLogs.every((log) => {
      const args = log.args;
      return Boolean(
        args && /^0x[0-9a-fA-F]{64}$/.test(log.txHash) &&
        'from' in args && 'to' in args &&
        /^\d+$/.test(String(args.value ?? args.amount ?? args.amountWei ?? '')),
      );
    }),
  );

  const cronJob = jobId ? await getCronJob(jobId).catch(() => null) : null;
  let poolSymbol: string | null = null;
  let tokenDecimals: number | null = null;

  if (poolId) {
    const cachedPools = typeof window !== 'undefined' ? (readSavedPools() ?? []) : [];
    const matched = cachedPools.find((p) => String(p.id) === String(poolId));
    if (matched) {
      poolSymbol = matched.symbol;
      tokenDecimals = matched.decimals ?? null;
    } else {
      try {
        const poolData = await getPool(poolId);
        if (poolData && token) {
          const sym = await viewCall<string>(token, 'symbol', []).catch(() => null);
          const dec = await viewCall<string | number>(token, 'decimals', []).catch(() => 18);
          poolSymbol = sym || (poolId === '1' ? 'AURA' : poolId === '2' ? 'NOVA' : poolId === '3' ? 'PULSE' : `POOL#${poolId}`);
          tokenDecimals = Number(dec) || 18;
        }
      } catch {}
    }
  }

  let tokenBalance = '0';
  let markValueAseWei: string | null = null;
  if (token) {
    tokenBalance = String(await viewCall<unknown>(token, 'balanceOf', [hex]).catch(() => '0'));
    if (poolId && BigInt(tokenBalance || '0') > 0n) {
      const quote = await viewCall<unknown>(AURAS, 'quote', [poolId, token, tokenBalance]).catch(() => null);
      if (quote !== null && quote !== undefined) markValueAseWei = String(quote);
    } else if (BigInt(tokenBalance || '0') === 0n) {
      markValueAseWei = '0';
    }
  }

  const fills = ordered.filter((e) => e.name === 'Fill');
  const contractTrades = Number(status.legs ?? status.ticks ?? status.legsDone ?? 0);
  const trades = Math.max(fills.length, contractTrades);
  const volumeWei = fills.length > 0
    ? fills.reduce((sum, e) => sum + BigInt(String(e.args.amountIn ?? '0')), 0n).toString()
    : String(status.spentAseWei ?? status.buySpentAseWei ?? '0');
  const realisedWei = fills.length > 0
    ? fills.reduce((sum, e) => sum + BigInt(String(e.args.amountOut ?? '0')), 0n).toString()
    : String(status.earned ?? '0');
  const lastSignalEvent = [...ordered].reverse().find((e) => 'signal' in e.args || 'action' in e.args);

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
    events: ordered.slice(-60).reverse(),
    fillEvents: fills.slice(-2000),
    tokenTransfers: tokenTransfers.slice(-5000),
    transferHistoryComplete,
    accountingTxHashes: [...new Set([indexedDeployment?.deployTx ?? '', ...ordered.map((event) => event.txHash), ...tokenTransfers.map((event) => event.txHash)].filter((hash) => /^0x[0-9a-fA-F]{64}$/.test(hash)))],
    trades,
    volumeWei,
    realisedWei,
    owner,
    stopped,
    lastSignal: lastSignalEvent ? String(lastSignalEvent.args.signal ?? lastSignalEvent.args.action ?? '') : null,
    lastSignalBlock: lastSignalEvent?.block ?? null,
    discovery,
    // A configured strategy without an indexed deployment block is scanned
    // only over a bounded recent window; never label that history complete.
    historyComplete: Boolean(indexedDeployment && logsResult.complete && transferHistoryComplete),
  };
}

/** Configured strategies plus user-deployed strategies plus anything discovered recently. */
export async function loadStrategies(): Promise<LiveStrategy[]> {
  const out: LiveStrategy[] = [];

  const configuredLoaded = await Promise.all(
    CONFIGURED
      .filter((entry) => entry.template !== 'strata-hub')
      .map((entry) => loadStrategy(entry.address, 'configured').catch(() => null))
  );
  for (const strategy of configuredLoaded) {
    if (strategy && strategy.template !== 'strata-hub') out.push(strategy);
  }

  // Include user strategies deployed in this browser (in parallel)
  try {
    const userRecords = getUserStrategies();
    const missing = userRecords.filter((rec) => !out.some((s) => s.address.toLowerCase() === rec.address.toLowerCase()));
    const userLoaded = await Promise.all(
      missing.map((rec) => loadStrategy(rec.address, 'user').catch(() => null))
    );
    for (const strategy of userLoaded) {
      if (strategy && strategy.template !== 'strata-hub') {
        out.push(strategy);
      }
    }
  } catch {
    // non-blocking
  }

  try {
    const recent = await fetchRecentDeployments(120);
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

/** Live swap tape across the Auras pools - real activity, real blocks. */
export interface TapeRow {
  block: number;
  pool: string;
  symbol: string;
  tokenIn: string;
  amountIn: string;
  amountOut: string;
  txHash: string;
}

export async function loadTape(limit = 12): Promise<TapeRow[]> {
  const { tip } = await getHeads();
  // 60 blocks is roughly two minutes of activity; wider windows pull tens of
  // thousands of logs at full-chain throughput and time out the browser.
  const logs = await getLogs(AURAS, Math.max(0, tip - 60)).catch(() => []);
  const pools = await fetchPools();
  const rows: TapeRow[] = [];

  for (const log of logs) {
    const args = log.args ?? {};
    if (!('payer' in args) || !('tokenIn' in args)) continue;
    const poolId = String(args.poolId ?? '');
    rows.push({
      block: log.blockNumber,
      pool: poolId,
      symbol: pools.find((p) => p.id === poolId)?.symbol ?? '?',
      tokenIn: String(args.tokenIn),
      amountIn: String(args.amountIn ?? '0'),
      amountOut: String(args.amountOut ?? '0'),
      txHash: log.txHash,
    });
  }

  return rows.sort((a, b) => b.block - a.block).slice(0, limit);
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
