import type { AsentumClient } from '@asentum/connect';
import {
  ASE_TOKEN,
  executeSwap,
  quoteSwap,
  readSwappedAmount,
  type SwapQuote,
  type SwapToken,
} from './swap';

/**
 * Best-route swap engine.
 *
 * Strata bots trade against two spot AMMs (Auras and AseDex). The swap form
 * used to be pinned to a single selected pool, so a token listed on both
 * venues always used the one the user happened to pick, and token -> token
 * was impossible. This module quotes every live pool for the pair, picks the
 * venue that actually pays more, and builds a token -> ASE -> token route
 * when the two tokens do not share a direct pool.
 *
 * It signs nothing itself: execution goes through `executeSwap`, so the
 * wallet still confirms every leg.
 */

export interface RouteLeg {
  tokenIn: SwapToken;
  tokenOut: SwapToken;
  pool: SwapToken;
  quote: SwapQuote;
}

export interface RouteQuote {
  /** One leg for a direct AMM swap, two for a routed token -> ASE -> token swap. */
  legs: RouteLeg[];
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  priceImpactPct: number;
  /** Venue of every leg, in execution order. */
  venues: SwapToken['venue'][];
  /** The exact pool contract used for each leg. */
  ammAddresses: string[];
  /** How many live pools were compared for this route. */
  compared: number;
  /** Best quote that lost, when a second venue could price the same leg. */
  runnerUp: { venue: SwapToken['venue']; poolId: string; amountOut: bigint } | null;
}

export interface RouteOptions {
  /** Every token entry from the live universe (one per venue). */
  tokens: SwapToken[];
  slippageBps: number;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** All live pool entries for the same token address, across venues. */
function poolCandidates(token: SwapToken, tokens: SwapToken[]): SwapToken[] {
  const matches = tokens.filter((item) => sameAddress(item.address, token.address));
  if (!matches.some((item) => item.venue === token.venue)) matches.unshift(token);
  return matches;
}

interface LegBest {
  quote: SwapQuote;
  pool: SwapToken;
  runnerUp: { venue: SwapToken['venue']; poolId: string; amountOut: bigint } | null;
  compared: number;
}

/**
 * Quote one hop on every live pool that lists the non-native asset and keep
 * the highest output. Failed pools are skipped: a stale pool must not block a
 * trade that another venue can price.
 */
async function bestLeg(
  tokenIn: SwapToken,
  tokenOut: SwapToken,
  amountIn: bigint,
  tokens: SwapToken[],
  slippageBps: number,
): Promise<LegBest | null> {
  const asset = tokenIn.isNative ? tokenOut : tokenIn;
  if (!tokenIn.isNative && !tokenOut.isNative) return null;

  const candidates = poolCandidates(asset, tokens);
  const settled = await Promise.allSettled(
    candidates.map((pool) => quoteSwap({ tokenIn, tokenOut, amountIn, pool, slippageBps })),
  );

  const priced: { quote: SwapQuote; pool: SwapToken }[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') priced.push({ quote: result.value, pool: candidates[index] });
  });
  if (priced.length === 0) {
    // Surface the real pool/RPC error instead of a generic "no pool" message:
    // the swap page keys its automatic retry on network wording.
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure && failure.status === 'rejected') throw failure.reason;
    return null;
  }

  priced.sort((a, b) => (b.quote.amountOut > a.quote.amountOut ? 1 : b.quote.amountOut < a.quote.amountOut ? -1 : 0));
  const winner = priced[0];
  const runnerUp = priced.length > 1
    ? { venue: priced[1].pool.venue, poolId: priced[1].pool.poolId, amountOut: priced[1].quote.amountOut }
    : null;
  return { quote: winner.quote, pool: winner.pool, runnerUp, compared: candidates.length };
}

/**
 * Best executable route between two assets.
 *
 * - token <-> ASE: direct swap on whichever venue pays more.
 * - token -> token: token -> ASE, then ASE -> token, each hop routed
 *   independently to its best pool.
 *
 * Throws with a readable reason when neither venue can price the trade.
 */
export async function findRoute(
  tokenIn: SwapToken,
  tokenOut: SwapToken,
  amountIn: bigint,
  { tokens, slippageBps }: RouteOptions,
): Promise<RouteQuote> {
  if (amountIn <= 0n) throw new Error('Enter an amount to swap.');
  if (sameAddress(tokenIn.address, tokenOut.address)) {
    throw new Error('Pick two different assets.');
  }

  const direct = tokenIn.isNative || tokenOut.isNative;
  if (direct) {
    const best = await bestLeg(tokenIn, tokenOut, amountIn, tokens, slippageBps);
    if (!best) throw new Error('No live pool can price this trade.');
    return {
      legs: [{ tokenIn, tokenOut, pool: best.pool, quote: best.quote }],
      amountIn,
      amountOut: best.quote.amountOut,
      minOut: best.quote.minOut,
      priceImpactPct: best.quote.priceImpactPct,
      venues: [best.pool.venue],
      ammAddresses: [best.pool.ammAddress ?? ''],
      compared: best.compared,
      runnerUp: best.runnerUp,
    };
  }

  // Cross-asset: both tokens price against ASE, so route through it.
  const first = await bestLeg(tokenIn, ASE_TOKEN, amountIn, tokens, slippageBps);
  if (!first) throw new Error(`No live ASE pool for ${tokenIn.symbol}.`);
  const second = await bestLeg(ASE_TOKEN, tokenOut, first.quote.amountOut, tokens, slippageBps);
  if (!second) throw new Error(`No live ASE pool for ${tokenOut.symbol}.`);

  return {
    legs: [
      { tokenIn, tokenOut: ASE_TOKEN, pool: first.pool, quote: first.quote },
      { tokenIn: ASE_TOKEN, tokenOut, pool: second.pool, quote: second.quote },
    ],
    amountIn,
    amountOut: second.quote.amountOut,
    minOut: second.quote.minOut,
    priceImpactPct: first.quote.priceImpactPct + second.quote.priceImpactPct,
    venues: [first.pool.venue, second.pool.venue],
    ammAddresses: [first.pool.ammAddress ?? '', second.pool.ammAddress ?? ''],
    compared: first.compared + second.compared,
    runnerUp: second.runnerUp ?? first.runnerUp,
  };
}

/** Short human description of the route, e.g. "Auras → AseDex". */
export function routeLabel(route: RouteQuote | null): string {
  if (!route) return '—';
  const names = route.venues.map((venue) => (venue === 'asedex' ? 'AseDex' : 'Auras'));
  return names.join(' → ');
}

export interface ExecuteRouteParams {
  client: AsentumClient;
  ownerHex: string;
  route: RouteQuote;
  /** Pool universe used to re-quote the next hop from the actual fill. */
  tokens?: SwapToken[];
  slippageBps?: number;
  onStage?: (stage: string) => void;
}

export interface ExecuteRouteResult {
  hashes: string[];
  approvalHashes: string[];
  /** What each leg actually spent and received, read from its receipt. */
  legs: {
    hash: string;
    approvalHash?: string;
    poolId: string;
    venue: SwapToken['venue'];
    amountIn: bigint;
    received: bigint;
  }[];
  received: bigint | null;
}

/**
 * Execute the route leg by leg, waiting for each receipt before signing the
 * next one. That is deliberate: the second hop spends the ASE produced by the
 * first, so it must not be quoted or submitted against a pre-trade balance.
 */
export async function executeRoute({
  client,
  ownerHex,
  route,
  tokens,
  slippageBps,
  onStage,
}: ExecuteRouteParams): Promise<ExecuteRouteResult> {
  const hashes: string[] = [];
  const approvalHashes: string[] = [];
  const legs: ExecuteRouteResult['legs'] = [];
  let received: bigint | null = null;

  for (let index = 0; index < route.legs.length; index += 1) {
    let leg = route.legs[index];
    // A later hop spends what the previous hop actually delivered, not what it
    // was quoted at. Re-quote it so its amountIn and minOut match the balance.
    if (index > 0 && received !== null && received > 0n && tokens && tokens.length > 0) {
      let requoted: RouteQuote;
      try {
        requoted = await findRoute(leg.tokenIn, leg.tokenOut, received, {
          tokens,
          slippageBps: slippageBps ?? 50,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `The first leg completed, but the next hop could not be re-quoted (${reason}). ` +
          'The received ASE is in your wallet — retry the remaining swap when the node is responsive.',
        );
      }
      leg = requoted.legs[0];
    }
    const step = route.legs.length > 1 ? ` (${index + 1}/${route.legs.length})` : '';
    onStage?.(
      `${leg.tokenIn.symbol} → ${leg.tokenOut.symbol} on ${leg.pool.venue === 'asedex' ? 'AseDex' : 'Auras'}${step}`,
    );
    const result = await executeSwap({
      client,
      ownerHex,
      tokenIn: leg.tokenIn,
      pool: leg.pool,
      amountIn: leg.quote.amountIn,
      minOut: leg.quote.minOut,
      onStage,
    });
    hashes.push(result.hash);
    if (result.approvalHash) approvalHashes.push(result.approvalHash);

    onStage?.(`Waiting for ${leg.tokenOut.symbol}${step}…`);
    const receipt = await client.waitReceipt(result.hash, 180_000);
    if (!receipt.success) {
      throw new Error(
        `${leg.tokenIn.symbol} → ${leg.tokenOut.symbol} reverted on chain. ${
          index > 0 ? 'The first leg already completed; only the remaining balance is affected.' : 'No balance changed.'
        }`,
      );
    }
    const actual = await readSwappedAmount(receipt as unknown as Record<string, unknown>).catch(() => null);
    received = actual && actual > 0n ? actual : leg.quote.amountOut;
    legs.push({
      hash: result.hash,
      approvalHash: result.approvalHash,
      poolId: leg.pool.poolId,
      venue: leg.pool.venue,
      amountIn: leg.quote.amountIn,
      received,
    });
  }

  return { hashes, approvalHashes, legs, received };
}
