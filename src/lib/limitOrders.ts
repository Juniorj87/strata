import type { AsentumClient } from '@asentum/connect';
import { AURAS_AMM, NATIVE, viewCall } from './rpc';

/**
 * Auras v2 limit orders.
 *
 * These are real on-chain orders, not a UI label for a swap: the input is
 * escrowed in the AMM contract, the order sits in an open-order set, and the
 * chain's cron calls `sweepOrders` so an order fills when the pool output
 * clears its minimum. They are still AMM-filled - there is no matching engine
 * or bid/ask book on Asentum - so the UI calls them "escrowed limit orders".
 *
 * Contract rules (read live from `config()`):
 *   - minimum order value: 0.1 ASE
 *   - at most 10 open orders per wallet
 *   - TTL: default 30 days, maximum 90 days
 */

export interface LimitOrder {
  id: string;
  owner: string;
  poolId: string;
  tokenIn: string;
  amountIn: string;
  minOut: string;
  status: 'open' | 'filled' | 'cancelled' | string;
  createdAt: string;
  expiresAt: string;
  filledOut?: string;
  filledAt?: string;
}

export interface LimitOrderConfig {
  minOrderAse: bigint;
  maxOpenPerWallet: number;
  defaultTtlSec: number;
  maxTtlSec: number;
}

const FALLBACK_CONFIG: LimitOrderConfig = {
  minOrderAse: 100_000_000_000_000_000n,
  maxOpenPerWallet: 10,
  defaultTtlSec: 2_592_000,
  maxTtlSec: 7_776_000,
};

function parseJson<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

export async function readLimitOrderConfig(): Promise<LimitOrderConfig> {
  const raw = await viewCall<unknown>(AURAS_AMM, 'config', []).catch(() => null);
  const parsed = parseJson<Record<string, unknown>>(raw);
  if (!parsed) return FALLBACK_CONFIG;
  try {
    return {
      minOrderAse: BigInt(String(parsed.minOrderAse ?? FALLBACK_CONFIG.minOrderAse)),
      maxOpenPerWallet: Number(parsed.maxOpenPerWallet ?? FALLBACK_CONFIG.maxOpenPerWallet),
      defaultTtlSec: Number(parsed.defaultTtlSec ?? FALLBACK_CONFIG.defaultTtlSec),
      maxTtlSec: Number(parsed.maxTtlSec ?? FALLBACK_CONFIG.maxTtlSec),
    };
  } catch {
    return FALLBACK_CONFIG;
  }
}

async function readOrder(id: string): Promise<LimitOrder | null> {
  const raw = await viewCall<unknown>(AURAS_AMM, 'getOrder', [id]).catch(() => null);
  const order = parseJson<LimitOrder>(raw);
  return order && order.id ? order : null;
}

/** Open order ids for one wallet. */
export async function readOwnerOrderIds(ownerHex: string): Promise<string[]> {
  const raw = await viewCall<unknown>(AURAS_AMM, 'ordersOf', [ownerHex.toLowerCase()]).catch(() => null);
  const ids = parseJson<string[]>(raw);
  return Array.isArray(ids) ? ids.map(String) : [];
}

export async function readOwnerLimitOrders(ownerHex: string): Promise<LimitOrder[]> {
  const ids = await readOwnerOrderIds(ownerHex);
  const orders: LimitOrder[] = [];
  for (let i = 0; i < ids.length; i += 6) {
    const batch = await Promise.all(ids.slice(i, i + 6).map((id) => readOrder(id)));
    for (const order of batch) if (order) orders.push(order);
  }
  return orders.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

/**
 * Open orders resting on one pool, across all wallets. `openOrdersPage` is
 * capped at 100 ids per call, so the book shown here is the first page the
 * contract exposes - not a number Strata invents.
 */
export async function readPoolLimitOrders(poolId: string, tokenAddress: string): Promise<{
  orders: LimitOrder[];
  total: number;
  truncated: boolean;
}> {
  const raw = await viewCall<unknown>(AURAS_AMM, 'openOrdersPage', ['0', '100']).catch(() => null);
  const page = parseJson<{ total?: number; ids?: string[] }>(raw);
  const ids = Array.isArray(page?.ids) ? page!.ids.map(String) : [];
  const total = Number(page?.total ?? ids.length);
  const wantedPool = String(poolId);
  const token = tokenAddress.toLowerCase();
  const matched: LimitOrder[] = [];
  for (let i = 0; i < ids.length; i += 6) {
    const batch = await Promise.all(ids.slice(i, i + 6).map((id) => readOrder(id)));
    for (const order of batch) {
      if (!order || order.status !== 'open') continue;
      if (String(order.poolId) !== wantedPool) continue;
      if (order.tokenIn.toLowerCase() !== token && order.tokenIn.toLowerCase() !== NATIVE) continue;
      matched.push(order);
    }
  }
  return {
    orders: matched.sort((a, b) => Number(a.createdAt) - Number(b.createdAt)),
    total,
    truncated: total > ids.length,
  };
}

export interface CreateLimitOrderParams {
  client: AsentumClient;
  ownerHex: string;
  poolId: string;
  /** NATIVE for a buy, the ARC-20 address for a sell. */
  tokenIn: string;
  amountIn: bigint;
  minOut: bigint;
  ttlSec?: number;
  onStage?: (stage: string) => void;
}

/** Approve if needed, then post the order. The wallet signs both calls. */
export async function createLimitOrder({
  client,
  ownerHex,
  poolId,
  tokenIn,
  amountIn,
  minOut,
  ttlSec,
  onStage,
}: CreateLimitOrderParams): Promise<{ hash: string; approvalHash?: string }> {
  if (amountIn <= 0n) throw new Error('Enter an amount.');
  if (minOut <= 0n) throw new Error('Enter a target price that produces a positive minimum output.');

  let approvalHash: string | undefined;
  if (tokenIn.toLowerCase() !== NATIVE) {
    onStage?.('Checking token allowance…');
    let allowance = 0n;
    try {
      const raw = await client.view<unknown>(tokenIn, 'allowance', [ownerHex, AURAS_AMM]);
      allowance = BigInt(String(raw).replace(/"/g, '') || '0');
    } catch {
      allowance = 0n;
    }
    if (allowance < amountIn) {
      onStage?.('Approve the token for the Auras AMM');
      approvalHash = await client.call(tokenIn, 'approve', [AURAS_AMM, amountIn.toString()]);
      onStage?.('Waiting for the approval to confirm…');
      const receipt = await client.waitReceipt(approvalHash, 120_000);
      if (!receipt.success) throw new Error('The token approval reverted. No limit order was created.');
    }
  }

  onStage?.('Confirm the limit order in your wallet');
  const args = ttlSec
    ? [poolId, tokenIn, amountIn.toString(), minOut.toString(), String(ttlSec)]
    : [poolId, tokenIn, amountIn.toString(), minOut.toString()];
  const hash = await client.call(
    AURAS_AMM,
    'createLimitOrder',
    args,
    tokenIn.toLowerCase() === NATIVE ? amountIn : undefined,
  );
  return { hash, approvalHash };
}

export async function cancelLimitOrder(client: AsentumClient, orderId: string): Promise<string> {
  return client.call(AURAS_AMM, 'cancelLimitOrder', [String(orderId)]);
}

/** Contract revert reasons, turned into something a trader can act on. */
export function limitOrderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/reject|denied|cancel|declin/i.test(raw)) return 'The wallet rejected the transaction. Nothing was sent.';
  if (/minimum size/i.test(raw)) return 'This order is below the AMM minimum of 0.1 ASE. Increase the size.';
  if (/too many open orders/i.test(raw)) return 'This wallet already has the maximum of 10 open limit orders. Cancel one first.';
  if (/ttlSec out of range/i.test(raw)) return 'That expiry is outside the contract range (1 day to 90 days).';
  if (/insufficient/i.test(raw)) return 'The wallet does not hold enough of the input token for this order.';
  if (/non-JSON|busy|502|504|timed out|network|fetch|no response/i.test(raw)) {
    return 'The Asentum node did not answer. Nothing was signed — try again in a moment.';
  }
  return raw;
}
