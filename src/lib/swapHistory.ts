import { getReceipt } from './rpc';
import { readSwappedAmount } from './swap';

/** Locally recorded swaps, each backed by a real transaction hash. */

export type SwapStatus = 'pending' | 'confirmed' | 'failed';

export interface SwapHistoryRecord {
  hash: string;
  approvalHash?: string;
  wallet: string;
  timestamp: number;
  poolId: string;
  venue: 'auras' | 'asedex';
  tokenIn: { address: string; symbol: string; decimals: number };
  tokenOut: { address: string; symbol: string; decimals: number };
  amountIn: string;
  /** Quoted output at signing time. */
  quotedOut: string;
  /** Output read from the confirmed receipt, when available. */
  amountOut?: string;
  minOut: string;
  status: SwapStatus;
  error?: string;
}

const KEY = 'strata:swaps:';

function keyFor(wallet: string): string {
  return `${KEY}${wallet.toLowerCase()}`;
}

export function getSwapHistory(wallet?: string): SwapHistoryRecord[] {
  if (typeof window === 'undefined' || !wallet) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(keyFor(wallet)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as SwapHistoryRecord[]).filter((row) => row && typeof row.hash === 'string');
  } catch {
    return [];
  }
}

function write(wallet: string, rows: SwapHistoryRecord[]) {
  try {
    window.localStorage.setItem(keyFor(wallet), JSON.stringify(rows.slice(0, 60)));
  } catch {
    // storage can be unavailable in private mode
  }
}

export function saveSwap(wallet: string, record: SwapHistoryRecord): void {
  if (typeof window === 'undefined' || !wallet) return;
  const rows = getSwapHistory(wallet);
  const index = rows.findIndex((row) => row.hash.toLowerCase() === record.hash.toLowerCase());
  if (index >= 0) rows[index] = { ...rows[index], ...record };
  else rows.unshift(record);
  write(wallet, rows);
}

export function updateSwap(wallet: string, hash: string, patch: Partial<SwapHistoryRecord>): void {
  if (typeof window === 'undefined' || !wallet) return;
  const rows = getSwapHistory(wallet);
  const index = rows.findIndex((row) => row.hash.toLowerCase() === hash.toLowerCase());
  if (index < 0) return;
  rows[index] = { ...rows[index], ...patch };
  write(wallet, rows);
}

/**
 * Resolve pending swaps against the chain and fill in the real output amount.
 * Returns the history with confirmed rows corrected; never invents a result.
 */
export async function reconcileSwaps(wallet: string): Promise<SwapHistoryRecord[]> {
  const rows = getSwapHistory(wallet);
  const pending = rows.filter((row) => row.status === 'pending');
  if (pending.length === 0) return rows;

  await Promise.all(pending.map(async (row) => {
    const receipt = await getReceipt(row.hash).catch(() => null);
    if (!receipt) return;
    const success = (receipt as { success?: boolean }).success !== false;
    const actual = await readSwappedAmount(receipt);
    updateSwap(wallet, row.hash, {
      status: success ? 'confirmed' : 'failed',
      amountOut: actual !== null ? actual.toString() : row.amountOut,
      error: success ? undefined : 'Transaction reverted on chain.',
    });
  }));

  return getSwapHistory(wallet);
}
