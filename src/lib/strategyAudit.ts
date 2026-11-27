import type { LiveStrategy, StrategyEvent } from './registry';

export interface SafetyCheckItem {
  label: string;
  detail: string;
  status: 'ok' | 'warn' | 'fail';
}

export interface CronDecisionItem {
  key: string;
  block: number;
  title: string;
  detail: string;
  tone: 'ok' | 'warn' | 'muted';
  txHash: string;
}

function rawToDecimal(raw: string | undefined, decimals: number): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  try {
    const val = BigInt(raw);
    const scale = 10n ** BigInt(decimals);
    const whole = val / scale;
    const frac = (val % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole.toString()}${frac ? `.${frac}` : ''}`;
  } catch {
    return null;
  }
}

/**
 * Glass Box contract audit: explains what the verified JS contract can and
 * cannot do in plain language based on BLAKE3 verification and its source code.
 */
export function inspectContractSafety(strategy: LiveStrategy): SafetyCheckItem[] {
  const src = strategy.source || '';
  const isPerp = strategy.venue === 'asepad-perps' || strategy.template.startsWith('perp-');
  const checks: SafetyCheckItem[] = [];

  checks.push({
    label: strategy.verified ? 'BLAKE3 source match' : 'Source hash mismatch',
    detail: strategy.verified
      ? 'On-chain codeHash matches the read-back JavaScript contract byte-for-byte.'
      : 'Read-back source hash does not match the chain account codeHash.',
    status: strategy.verified ? 'ok' : 'fail',
  });

  const hasOwnerGuard = /assert\(\s*msg\.sender\s*===\s*(?:owner|storage\.get\('owner'\))/.test(src);
  const hasWithdraw = /\bwithdraw\s*\(/.test(src);
  checks.push({
    label: hasOwnerGuard && hasWithdraw ? 'Owner-only withdrawals' : 'Withdrawal guard',
    detail: hasOwnerGuard && hasWithdraw
      ? 'Only the deploying owner wallet can stop the schedule and withdraw funds.'
      : 'Inspect the source below to confirm who can withdraw funds.',
    status: hasOwnerGuard && hasWithdraw ? 'ok' : 'warn',
  });

  const hasCronGuard = /assert\(\s*msg\.sender\s*===\s*CRON/.test(src);
  checks.push({
    label: hasCronGuard ? 'Cron-gated execution' : 'Execution gate',
    detail: hasCronGuard
      ? 'Automated ticks can only be triggered by the Asentum Cron system contract.'
      : 'Tick execution is not strictly restricted to the Cron Registry.',
    status: hasCronGuard ? 'ok' : 'warn',
  });

  if (isPerp) {
    checks.push({
      label: 'Isolated Perps Vault margin',
      detail: 'Trades against AsePad Perps Engine with isolated collateral; subject to leverage and liquidation risk.',
      status: 'warn',
    });
  } else {
    const hasSlippageGuard = /9800n\s*\/\s*10000n/.test(src) || /minOut/.test(src);
    checks.push({
      label: hasSlippageGuard ? '2% AMM slippage guard' : 'Spot AMM execution',
      detail: hasSlippageGuard
        ? 'Each swap enforces a minimum-output guard and reverts instead of filling at extreme slippage.'
        : 'Executes spot swaps against live AMM liquidity.',
      status: hasSlippageGuard ? 'ok' : 'warn',
    });
  }

  return checks;
}

function summarizeEvent(event: StrategyEvent, strategy: LiveStrategy): CronDecisionItem {
  const args = event.args ?? {};
  const isPerp = strategy.venue === 'asepad-perps' || strategy.template.startsWith('perp-');

  if (event.name === 'StrataDeploy') {
    return {
      key: `${event.txHash}-${event.block}-deploy`,
      block: event.block,
      title: 'Contract deployed',
      detail: `Template ${String(args.template ?? strategy.template)} initialised on-chain`,
      tone: 'muted',
      txHash: event.txHash,
    };
  }
  if (event.name === 'Armed') {
    return {
      key: `${event.txHash}-${event.block}-armed`,
      block: event.block,
      title: 'Cron schedule armed',
      detail: `Job #${String(args.jobId ?? strategy.jobId ?? '—')} · every ${String(args.intervalSec ?? strategy.intervalSec ?? '—')}s`,
      tone: 'ok',
      txHash: event.txHash,
    };
  }
  if (event.name === 'Signal') {
    const sig = String(args.signal ?? 'hold');
    const reason = args.reason ? String(args.reason) : '';
    return {
      key: `${event.txHash}-${event.block}-signal-${sig}`,
      block: event.block,
      title: `Cron tick · ${sig.toUpperCase()}`,
      detail: reason ? `Reason: ${reason}` : `Tick #${String(args.ticks ?? '—')}`,
      tone: sig === 'hold' ? 'muted' : 'ok',
      txHash: event.txHash,
    };
  }
  if (event.name === 'Fill') {
    if (isPerp) {
      const side = String(args.side ?? 'PERP');
      return {
        key: `${event.txHash}-${event.block}-fill-${side}`,
        block: event.block,
        title: `Perp execution · ${side}`,
        detail: args.marginWei ? `Margin ${rawToDecimal(String(args.marginWei), 18) ?? '—'} ASE` : 'Executed on AsePad Perps Engine',
        tone: 'ok',
        txHash: event.txHash,
      };
    }
    const sold = String(args.tokenIn ?? '').toLowerCase() === (strategy.token ?? '').toLowerCase();
    return {
      key: `${event.txHash}-${event.block}-fill`,
      block: event.block,
      title: sold ? 'AMM Fill · Sold token' : 'AMM Fill · Bought token',
      detail: `Executed on ${strategy.venue === 'asedex' ? 'AseDex' : 'Auras'} pool #${strategy.poolId ?? '—'}`,
      tone: 'ok',
      txHash: event.txHash,
    };
  }

  const pairs = Object.entries(args)
    .filter(([key]) => key !== 'poolId' && key !== 'token')
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value).slice(0, 24)}`)
    .join(' · ');

  return {
    key: `${event.txHash}-${event.block}-${event.name}`,
    block: event.block,
    title: event.name,
    detail: pairs || 'On-chain event emitted',
    tone: /stop|exit|liquidat/i.test(event.name) ? 'warn' : 'muted',
    txHash: event.txHash,
  };
}

/**
 * Merges fills and lifecycle events into a chronological Cron decision timeline
 * so users understand both why a bot traded and why it waited.
 */
export function buildCronDecisionFeed(strategy: LiveStrategy): CronDecisionItem[] {
  const seen = new Set<string>();
  const combined: CronDecisionItem[] = [];
  const all = [...strategy.fillEvents, ...strategy.events].sort((a, b) => b.block - a.block);
  for (const event of all) {
    const item = summarizeEvent(event, strategy);
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    combined.push(item);
    if (combined.length >= 25) break;
  }
  return combined;
}

/**
 * Build a /deploy URL pre-filled with the exact configuration read from a live
 * strategy contract (`getConfig()` + `getStatus()`).
 */
export function buildCloneStrategyUrl(strategy: LiveStrategy): string {
  const cfg = strategy.rawConfig ?? {};
  const isPerp = strategy.venue === 'asepad-perps' || strategy.template.startsWith('perp-');
  const params = new URLSearchParams({ template: strategy.template, cloned: '1' });

  if (isPerp) {
    params.set('venue', 'perps');
    const market = cfg.marketId ?? strategy.marketId;
    if (market) params.set('market', market);
    const side = cfg.side ?? strategy.perpSide;
    if (side) params.set('side', side);
    const lev = cfg.leverage ?? (strategy.perpLeverage ? String(strategy.perpLeverage) : '');
    if (lev) params.set('leverage', lev);
    const margin = rawToDecimal(cfg.totalMarginWei ?? cfg.marginWei, 18);
    if (margin) params.set('margin', margin);
    const legMargin = rawToDecimal(cfg.marginPerLegWei, 18);
    if (legMargin) params.set('legMargin', legMargin);
    const interval = cfg.intervalSec ?? (strategy.intervalSec ? String(strategy.intervalSec) : '');
    if (interval) params.set('interval', interval);
    if (cfg.slices) params.set('slices', cfg.slices);
    if (cfg.levels) params.set('levels', cfg.levels);
    if (cfg.tpBps) params.set('tpPct', String(Number(cfg.tpBps) / 100));
    if (cfg.slBps) params.set('slPct', String(Number(cfg.slBps) / 100));
    if (cfg.maxDrawdownBps) params.set('drawdownPct', String(Number(cfg.maxDrawdownBps) / 100));
    if (cfg.stepBps) params.set('stepPct', String(Number(cfg.stepBps) / 100));
    if (cfg.thresholdBps) params.set('threshold', cfg.thresholdBps);
    if (cfg.triggerMoveBps) params.set('triggerMovePct', String(Number(cfg.triggerMoveBps) / 100));
    if (cfg.triggerDir) params.set('triggerDir', cfg.triggerDir);
    return `/deploy?${params.toString()}`;
  }

  if (strategy.venue === 'asedex') params.set('venue', 'asepad');
  const pool = cfg.poolId ?? strategy.poolId;
  if (pool) params.set('pool', pool);
  if (strategy.token) params.set('token', strategy.token);

  const decimals = strategy.tokenDecimals ?? (cfg.decimals !== undefined ? Number(cfg.decimals) : 18);
  const rawSize = cfg.sellSizeWei ?? cfg.sizeWei ?? cfg.sizePerLevelWei ?? cfg.notionalWei;
  if (strategy.template !== 'dca') {
    const size = rawToDecimal(rawSize, decimals);
    if (size) params.set('size', size);
    const budget = rawToDecimal(cfg.budgetWei ?? cfg.notionalWei, decimals);
    if (budget) params.set('budget', budget);
  }
  const buySizeAse = rawToDecimal(cfg.buySizeAseWei, 18);
  if (buySizeAse) params.set('buySizeAse', buySizeAse);
  const buyBudgetAse = rawToDecimal(cfg.totalBudgetAseWei ?? cfg.buyBudgetAseWei, 18);
  if (buyBudgetAse) params.set('buyBudgetAse', buyBudgetAse);

  const threshold = cfg.thresholdBps ?? cfg.stepBps;
  if (threshold) params.set('threshold', threshold);
  const interval = cfg.intervalSec ?? (strategy.intervalSec ? String(strategy.intervalSec) : '');
  if (interval) params.set('interval', interval);
  if (cfg.slices) params.set('slices', cfg.slices);
  if (cfg.levels) params.set('levels', cfg.levels);
  const costBasis = rawToDecimal(cfg.costBasisAseWeiPerToken, 18);
  if (costBasis) params.set('costBasis', costBasis);
  const dailyLoss = rawToDecimal(cfg.dailyLossLimitAseWei, 18);
  if (dailyLoss) params.set('dailyLoss', dailyLoss);
  if (cfg.stopLossBps) params.set('stopLoss', cfg.stopLossBps);
  if (cfg.takeProfitBps) params.set('takeProfit', cfg.takeProfitBps);
  if (cfg.maxDrawdownBps) params.set('maxDrawdown', cfg.maxDrawdownBps);
  if (cfg.targetUpsideBps) params.set('targetUpside', cfg.targetUpsideBps);

  return `/deploy?${params.toString()}`;
}
