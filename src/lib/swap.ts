import type { AsentumClient } from '@asentum/connect';
import type { LivePool } from './registry';
import { NATIVE, viewCall } from './rpc';

/**
 * Swap plumbing for the existing Asentum AMMs.
 *
 * Both Auras and AseDex expose the same surface that the strategy contracts
 * already use:
 *   quote(poolId, tokenIn, amountIn)
 *   swapExactIn(poolId, tokenIn, amountIn, minOut)   [msg.value = amountIn when tokenIn is native ASE]
 *   approve(amm, amount) on the ARC-20 token before a token -> ASE swap
 * This module never deploys a router and never signs anything itself.
 */

export interface SwapToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isNative: boolean;
  venue: 'auras' | 'asedex';
  poolId: string;
  reserveToken: string;
  reserveNative: string;
  feeBps: number;
  /** ASE value of one whole token at the current reserve ratio, as a float for display. */
  spotAse: number;
}

export const ASE_TOKEN: SwapToken = {
  address: NATIVE,
  symbol: 'ASE',
  name: 'Asentum native',
  decimals: 18,
  isNative: true,
  venue: 'auras',
  poolId: '',
  reserveToken: '0',
  reserveNative: '0',
  feeBps: 0,
  spotAse: 1,
};

export const AMM_BY_VENUE = {
  auras: '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd',
  asedex: '0xc3833b73eb30242289e533b3e97c4b72b97e24e9',
} as const;

function toNumber(value: string, decimals: number): number {
  try {
    const raw = BigInt(value);
    const scale = 10n ** BigInt(decimals);
    return Number(raw / scale) + Number(raw % scale) / Number(scale);
  } catch {
    return 0;
  }
}

/**
 * Token list derived from live pools only. A token appears once per venue;
 * its deepest pool is used for quoting.
 */
export function swapTokens(pools: LivePool[], asedexPools: LivePool[]): { ase: SwapToken[]; tokens: SwapToken[] } {
  const byKey = new Map<string, SwapToken>();
  // A pool holding a single wei of native reserve cannot price a trade; listing
  // it would offer a pair the AMM will always reject.
  const MIN_NATIVE_RESERVE = 1_000_000_000_000_000n; // 0.001 ASE
  const add = (pool: LivePool) => {
    if (!pool.token || pool.token.toLowerCase() === NATIVE) return;
    try {
      if (BigInt(pool.reserveNative || '0') < MIN_NATIVE_RESERVE) return;
      if (BigInt(pool.reserveToken || '0') <= 0n) return;
    } catch {
      return;
    }
    const venue = pool.venue ?? 'auras';
    const key = `${venue}:${pool.token.toLowerCase()}`;
    const candidate: SwapToken = {
      address: pool.token,
      symbol: pool.symbol || 'TOKEN',
      name: pool.name || pool.symbol || 'Token',
      decimals: pool.decimals ?? 18,
      isNative: false,
      venue,
      poolId: pool.id,
      reserveToken: pool.reserveToken,
      reserveNative: pool.reserveNative,
      feeBps: Number(pool.feeBps || 30),
      spotAse: toNumber(pool.spot, 18),
    };
    const previous = byKey.get(key);
    if (!previous || BigInt(candidate.reserveNative) > BigInt(previous.reserveNative)) {
      byKey.set(key, candidate);
    }
  };
  pools.forEach(add);
  asedexPools.forEach(add);
  const tokens = [...byKey.values()].sort((a, b) => {
    const diff = BigInt(b.reserveNative) - BigInt(a.reserveNative);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  });
  return { ase: [ASE_TOKEN], tokens };
}

export function ammFor(venue: SwapToken['venue']): string {
  return AMM_BY_VENUE[venue];
}

export interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  /** Output units per one input unit, as a float for display only. */
  rate: number;
  priceImpactPct: number;
  feeAmount: bigint;
  feeBps: number;
  poolId: string;
}

export interface QuoteInput {
  tokenIn: SwapToken;
  tokenOut: SwapToken;
  amountIn: bigint;
  pool: SwapToken;
  slippageBps: number;
}

/** Live quote from the AMM contract; throws when the pool cannot price the trade. */
export async function quoteSwap({ tokenIn, tokenOut, amountIn, pool, slippageBps }: QuoteInput): Promise<SwapQuote> {
  if (amountIn <= 0n) throw new Error('Enter an amount to swap.');
  if (pool.reserveToken === '0' || pool.reserveNative === '0') throw new Error('This pool reports no liquidity.');
  const amm = ammFor(pool.venue);
  const raw = await viewCall<unknown>(amm, 'quote', [pool.poolId, tokenIn.address, amountIn.toString()]);
  let amountOut: bigint;
  try {
    amountOut = BigInt(String(raw).replace(/"/g, ''));
  } catch {
    throw new Error('The AMM returned an unreadable quote.');
  }
  if (amountOut <= 0n) throw new Error('This amount is too small for the pool to price.');

  const feeBps = Number(pool.feeBps) || 30;
  const feeAmount = (amountIn * BigInt(feeBps)) / 10000n;

  const reserveIn = tokenIn.isNative ? BigInt(pool.reserveNative) : BigInt(pool.reserveToken);
  const reserveOut = tokenIn.isNative ? BigInt(pool.reserveToken) : BigInt(pool.reserveNative);
  const afterFee = amountIn - feeAmount > 0n ? amountIn - feeAmount : 0n;
  const noImpact = reserveIn > 0n ? (afterFee * reserveOut) / reserveIn : 0n;
  const impactPpm = noImpact > 0n && noImpact > amountOut
    ? Number(((noImpact - amountOut) * 1_000_000n) / noImpact)
    : 0;

  const inDecimals = tokenIn.decimals;
  const outDecimals = tokenOut.decimals;
  const inUnits = toNumber(amountIn.toString(), inDecimals);
  const outUnits = toNumber(amountOut.toString(), outDecimals);

  return {
    amountIn,
    amountOut,
    minOut: (amountOut * BigInt(10_000 - Math.min(9_900, Math.max(0, slippageBps)))) / 10_000n,
    rate: inUnits > 0 ? outUnits / inUnits : 0,
    priceImpactPct: impactPpm / 10_000,
    feeAmount,
    feeBps,
    poolId: pool.poolId,
  };
}

export interface ExecuteSwapParams {
  client: AsentumClient;
  ownerHex: string;
  tokenIn: SwapToken;
  pool: SwapToken;
  amountIn: bigint;
  minOut: bigint;
  onStage?: (stage: string) => void;
}

export interface ExecuteSwapResult {
  hash: string;
  approvalHash?: string;
}

/**
 * Approve (only when required) and submit the swap. The wallet shows its own
 * confirmation for every transaction; nothing is sent silently.
 */
export async function executeSwap({
  client,
  ownerHex,
  tokenIn,
  pool,
  amountIn,
  minOut,
  onStage,
}: ExecuteSwapParams): Promise<ExecuteSwapResult> {
  const amm = ammFor(pool.venue);
  let approvalHash: string | undefined;

  if (!tokenIn.isNative) {
    onStage?.('Checking token allowance…');
    let allowance = 0n;
    try {
      const raw = await client.view<unknown>(tokenIn.address, 'allowance', [ownerHex, amm]);
      allowance = BigInt(String(raw).replace(/"/g, '') || '0');
    } catch {
      allowance = 0n;
    }
    if (allowance < amountIn) {
      onStage?.(`Approve ${tokenIn.symbol} for the ${pool.venue === 'asedex' ? 'AseDex' : 'Auras'} AMM`);
      approvalHash = await client.call(tokenIn.address, 'approve', [amm, amountIn.toString()]);
      onStage?.('Waiting for the approval to confirm…');
      const approvalReceipt = await client.waitReceipt(approvalHash, 120_000);
      if (!approvalReceipt.success) {
        throw new Error('The token approval reverted. Nothing was swapped.');
      }
    }
  }

  onStage?.('Confirm the swap in your wallet');
  const value = tokenIn.isNative ? amountIn : undefined;
  const hash = await client.call(
    amm,
    'swapExactIn',
    [pool.poolId, tokenIn.address, amountIn.toString(), minOut.toString()],
    value,
  );
  return { hash, approvalHash };
}

/** Output amount actually received, read from the confirmed receipt. */
export async function readSwappedAmount(receipt: Record<string, unknown> | null): Promise<bigint | null> {
  if (!receipt || !Array.isArray((receipt as { events?: unknown }).events)) return null;
  const events = (receipt as { events: { name?: string; data?: Record<string, unknown> }[] }).events;
  const swap = events.find((event) => event?.name === 'Swap')?.data;
  if (!swap) return null;
  try {
    return BigInt(String(swap.amountOut ?? '0'));
  } catch {
    return null;
  }
}
