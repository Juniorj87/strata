import {
  AURAS,
  POOLS,
  consult,
  findRecentDeployments,
  getAccountMeta,
  getBalance,
  getContractSource,
  getCronJob,
  getHeads,
  getLogs,
  getPool,
  getReceipt,
  hashSource,
  quote,
  toAse1,
} from './rpc';
import configured from '../config/strategies.json';

const CONFIGURED = configured as unknown as { address: string; template?: string; pool?: string }[];

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
  events: StrategyEvent[];
  trades: number;
  volumeWei: string;
  realisedWei: string;
  lastSignal: string | null;
  lastSignalBlock: number | null;
  discovery: 'configured' | 'scan';
}

const TEMPLATE_RE = /Strata template:\s*([a-z-]+)/i;

function parseTemplate(source: string): { name: string; template: string } {
  const match = source.match(TEMPLATE_RE);
  const template = match ? match[1].toLowerCase() : 'custom';
  const title = source.split('\n')[0].replace(/^\/\/\s*/, '').trim();
  return { name: title.length > 0 && title.length < 60 ? title : `${template} strategy`, template };
}

function classify(args: Record<string, unknown>): string {
  if ('payer' in args && 'tokenIn' in args) return 'Swap';
  if ('tokenIn' in args && 'amountOut' in args) return 'Fill';
  if ('poolId' in args && 'reserve0' in args && 'reserve1' in args) return 'Sync';
  if ('from' in args && 'to' in args && 'value' in args) return 'Transfer';
  return 'Event';
}

/** Build one strategy record from chain state. */
export async function loadStrategy(address: string, discovery: 'configured' | 'scan' = 'configured'): Promise<LiveStrategy | null> {
  const hex = address.toLowerCase();
  const [source, meta, balance] = await Promise.all([
    getContractSource(hex),
    getAccountMeta(hex).catch(() => ({ address: hex, exists: false }) as { codeHash?: string }),
    getBalance(hex).catch(() => ({ balance: '0', nonce: '0' })),
  ]);

  if (!source) return null;

  const localHash = await hashSource(source);
  const codeHash = String(meta.codeHash ?? '').replace(/^0x/, '').toLowerCase();
  const { name, template } = parseTemplate(source);

  const logs = await getLogs(hex, 0).catch(() => []);
  const events: StrategyEvent[] = logs.map((log) => ({
    block: log.blockNumber,
    name: classify(log.args ?? {}),
    args: log.args ?? {},
    txHash: log.txHash,
  }));
  const ordered = [...events].sort((a, b) => a.block - b.block);
  const deployBlock = ordered[0]?.block ?? 0;

  const armed = ordered.find((e) => 'intervalSec' in e.args);
  const poolId = armed?.args.poolId ? String(armed.args.poolId) : null;
  const token = armed?.args.token ? String(armed.args.token) : null;
  const intervalSec = armed?.args.intervalSec ? Number(armed.args.intervalSec) : null;
  const jobId = armed?.args.jobId ? String(armed.args.jobId) : null;

  const cronJob = jobId ? await getCronJob(jobId) : null;

  const fills = ordered.filter((e) => e.name === 'Fill');
  const volumeWei = fills.reduce((sum, e) => sum + BigInt(String(e.args.amountIn ?? '0')), 0n).toString();
  const realisedWei = fills.reduce((sum, e) => sum + BigInt(String(e.args.amountOut ?? '0')), 0n).toString();
  const lastSignalEvent = [...ordered].reverse().find((e) => 'signal' in e.args || 'action' in e.args);

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
    symbol: poolId ? (POOLS.find((p) => p.id === poolId)?.symbol ?? null) : null,
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
    events: ordered.slice(-60).reverse(),
    trades: fills.length,
    volumeWei,
    realisedWei,
    lastSignal: lastSignalEvent ? String(lastSignalEvent.args.signal ?? lastSignalEvent.args.action ?? '') : null,
    lastSignalBlock: lastSignalEvent?.block ?? null,
    discovery,
  };
}

/** Configured strategies plus anything deployed recently that says "Strata". */
export async function loadStrategies(): Promise<LiveStrategy[]> {
  const out: LiveStrategy[] = [];

  for (const entry of CONFIGURED) {
    const strategy = await loadStrategy(entry.address, 'configured');
    if (strategy) out.push(strategy);
  }

  try {
    const recent = await fetchRecentDeployments(120);
    for (const address of recent) {
      if (out.some((s) => s.address === address)) continue;
      const source = await getContractSource(address).catch(() => '');
      if (!source.includes('Strata template')) continue;
      const strategy = await loadStrategy(address, 'scan');
      if (strategy) out.push(strategy);
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
  const rows: TapeRow[] = [];

  for (const log of logs) {
    const args = log.args ?? {};
    if (!('payer' in args) || !('tokenIn' in args)) continue;
    const poolId = String(args.poolId ?? '');
    rows.push({
      block: log.blockNumber,
      pool: poolId,
      symbol: POOLS.find((p) => p.id === poolId)?.symbol ?? '?',
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
  reserveToken: string;
  reserveNative: string;
  spot: string;
  feeBps: string;
  twapTs: string;
}

export async function loadPools(): Promise<LivePool[]> {
  const out: LivePool[] = [];
  for (const pool of POOLS) {
    const [onChain, twap, spot] = await Promise.all([
      getPool(pool.id),
      consult(pool.id).catch(() => null),
      quote(pool.id, pool.token, '1000000000000000000').catch(() => '0'),
    ]);
    out.push({
      id: pool.id,
      symbol: pool.symbol,
      name: pool.name,
      token: pool.token,
      reserveToken: onChain?.reserve0 ?? '0',
      reserveNative: onChain?.reserve1 ?? '0',
      spot,
      feeBps: onChain?.feeBps ?? '30',
      twapTs: twap?.lastTs ?? '',
    });
  }
  return out;
}
