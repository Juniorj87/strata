import { useEffect, useMemo, useState } from 'react';
import type { LiveStrategy } from '../lib/registry';
import { fmtWei } from '../lib/format';
import { getReceipt } from '../lib/rpc';

const WEI = 10n ** 18n;

function parseAseWei(value: string): bigint | null {
  const clean = value.trim();
  if (!/^\d+(?:\.\d{0,18})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return BigInt(whole) * WEI + BigInt(fraction.padEnd(18, '0') || '0');
}

function formatTokenAmount(raw: bigint, decimals: number, symbol: string): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} ${symbol}`;
}

function receiptFeeWei(receipt: Record<string, unknown> | null): bigint | null {
  if (!receipt) return null;
  const direct = receipt.feeWei ?? receipt.gasFeeWei ?? receipt.transactionFeeWei;
  if (direct !== undefined && /^\d+$/.test(String(direct))) return BigInt(String(direct));
  const gasUsed = receipt.gasUsed ?? receipt.cumulativeGasUsed;
  const gasPrice = receipt.effectiveGasPrice ?? receipt.gasPrice ?? receipt.baseFeePerGas;
  if (gasUsed !== undefined && gasPrice !== undefined && /^\d+$/.test(String(gasUsed)) && /^\d+$/.test(String(gasPrice))) {
    return BigInt(String(gasUsed)) * BigInt(String(gasPrice));
  }
  return null;
}

export function StrategyPnlPanel({ strategy }: { strategy: LiveStrategy }) {
  const key = `strata:cost-basis:${strategy.address.toLowerCase()}`;
  const [costBasis, setCostBasis] = useState(() => {
    try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
  });
  const [gasWei, setGasWei] = useState<bigint | null>(null);
  const [gasLoading, setGasLoading] = useState(false);
  const [gasCoverage, setGasCoverage] = useState('Deploy/init and strategy transaction receipts are not available.');

  const tokenAddress = (strategy.token || '').toLowerCase();
  const strategyAddress = strategy.address.toLowerCase();
  const fills = useMemo(() => strategy.fillEvents.filter((event) => event.args.amountIn !== undefined && event.args.amountOut !== undefined && String(event.args.tokenIn || '').toLowerCase() === tokenAddress), [strategy.fillEvents, tokenAddress]);
  const buyFills = useMemo(() => strategy.fillEvents.filter((event) => event.args.amountIn !== undefined && event.args.amountOut !== undefined && String(event.args.side || '').toLowerCase() === 'buy' && String(event.args.tokenOut || '').toLowerCase() === tokenAddress), [strategy.fillEvents, tokenAddress]);
  const totalSoldRaw = useMemo(() => fills.reduce((sum, event) => sum + BigInt(String(event.args.amountIn ?? '0')), 0n), [fills]);
  const totalReceivedWei = useMemo(() => fills.reduce((sum, event) => sum + BigInt(String(event.args.amountOut ?? '0')), 0n), [fills]);
  const boughtRaw = useMemo(() => buyFills.reduce((sum, event) => sum + BigInt(String(event.args.amountOut ?? '0')), 0n), [buyFills]);
  const buyCostWei = useMemo(() => buyFills.reduce((sum, event) => sum + BigInt(String(event.args.amountIn ?? '0')), 0n), [buyFills]);
  const manualBasisWei = parseAseWei(costBasis);
  const indexedBuyBasisWei = buyCostWei > 0n && boughtRaw > 0n && strategy.tokenDecimals !== null ? buyCostWei * (10n ** BigInt(strategy.tokenDecimals)) / boughtRaw : null;
  const basisWei = manualBasisWei ?? indexedBuyBasisWei;
  const scale = strategy.tokenDecimals === null ? null : 10n ** BigInt(strategy.tokenDecimals);
  const soldCostWei = basisWei !== null && scale ? totalSoldRaw * basisWei / scale : null;
  const remainingCostWei = basisWei !== null && scale ? BigInt(strategy.tokenBalance || '0') * basisWei / scale : null;
  const realisedBeforeGas = soldCostWei === null ? null : totalReceivedWei - soldCostWei;
  const unrealised = remainingCostWei === null || strategy.markValueAseWei === null ? null : BigInt(strategy.markValueAseWei) - remainingCostWei;
  const indexedFillsComplete = strategy.historyComplete && strategy.fillEvents.length === strategy.trades;
  const transferFlow = useMemo(() => strategy.tokenTransfers.reduce((totals, event) => {
    const from = String(event.args.from ?? '').toLowerCase();
    const to = String(event.args.to ?? '').toLowerCase();
    const amountText = String(event.args.value ?? event.args.amount ?? event.args.amountWei ?? '');
    if (!/^\d+$/.test(amountText)) return totals;
    const amount = BigInt(amountText);
    if (to === strategyAddress && from !== strategyAddress) totals.inbound += amount;
    if (from === strategyAddress && to !== strategyAddress) totals.outbound += amount;
    return totals;
  }, { inbound: 0n, outbound: 0n }), [strategy.tokenTransfers, strategyAddress]);
  const unmatchedInbound = transferFlow.inbound >= boughtRaw ? transferFlow.inbound - boughtRaw : 0n;
  const unmatchedOutbound = transferFlow.outbound >= totalSoldRaw ? transferFlow.outbound - totalSoldRaw : 0n;
  const transferMismatch = transferFlow.inbound < boughtRaw || transferFlow.outbound < totalSoldRaw;
  const transfersReconciled = strategy.transferHistoryComplete && !transferMismatch && unmatchedOutbound === 0n && (unmatchedInbound === 0n || manualBasisWei !== null);
  const accountingComplete = indexedFillsComplete && transfersReconciled;
  const totalPnl = realisedBeforeGas === null || unrealised === null || gasWei === null || !accountingComplete ? null : realisedBeforeGas + unrealised - gasWei;
  const trackedCostWei = soldCostWei !== null && remainingCostWei !== null ? soldCostWei + remainingCostWei : null;
  const roiBps = totalPnl !== null && trackedCostWei !== null && trackedCostWei > 0n ? (totalPnl * 10000n) / trackedCostWei : null;
  const roiText = roiBps === null ? 'Incomplete data' : `${roiBps < 0n ? '-' : '+'}${(roiBps < 0n ? -roiBps : roiBps) / 100n}.${((roiBps < 0n ? -roiBps : roiBps) % 100n).toString().padStart(2, '0')}%`;

  useEffect(() => {
    let cancelled = false;
    const txs = [...new Set(strategy.accountingTxHashes.filter(Boolean))];
    if (txs.length === 0) {
      return () => { cancelled = true; };
    }
    setGasLoading(true);
    const trackedTxs = txs.slice(0, 100);
    Promise.all(trackedTxs.map((hash) => getReceipt(hash).catch(() => null)))
      .then((receipts) => {
        if (cancelled) return;
        let total = 0n;
        let known = 0;
        receipts.forEach((receipt) => {
          const fee = receiptFeeWei(receipt);
          if (fee !== null) { total += fee; known += 1; }
        });
        const complete = known === receipts.length && txs.length <= 100;
        setGasWei(complete ? total : null);
        setGasCoverage(complete
          ? `Observed gas fees from all ${known} deploy/init, strategy-event and ARC-20 transfer receipts.`
          : `Gas receipts are incomplete: read ${known} of ${receipts.length} checked receipts, with ${Math.max(0, txs.length - 100)} older transactions outside the 100-receipt limit. Combined PnL is withheld.`);
      })
      .finally(() => { if (!cancelled) setGasLoading(false); });
    return () => { cancelled = true; };
  }, [strategy.address, strategy.accountingTxHashes]);

  const saveBasis = () => {
    if (basisWei === null || basisWei <= 0n) return;
    try { window.localStorage.setItem(key, costBasis.trim()); } catch { /* storage may be disabled */ }
  };

  return (
    <div className="panel pnl-panel">
      <div className="panel-head"><div><span className="label">PnL estimate</span><p className="muted" style={{ marginTop: 3 }}>Indexed buys and sells + live inventory quote</p></div><span className="pill pill-live">Estimate</span></div>
      <div className="panel-body">
        <div className="pnl-basis-row">
          <div className="field" style={{ margin: 0, flex: 1 }}><label htmlFor="strategyCostBasis">Average acquisition cost · ASE per whole token</label><input id="strategyCostBasis" className="input" value={costBasis} onChange={(event) => setCostBasis(event.target.value)} placeholder="Enter weighted average buy price" inputMode="decimal" /></div>
          <button className="btn btn-primary" type="button" onClick={saveBasis} disabled={basisWei === null || basisWei <= 0n}>Save cost basis</button>
        </div>
        {basisWei === null || basisWei <= 0n ? (
          <div className="notice" style={{ marginTop: 16 }}><strong>One input is needed</strong><span>No acquisition cost was found in indexed buy fills. Enter your average purchase price in ASE; this fallback is saved only in this browser.</span></div>
        ) : (
          <div className="pnl-metrics">
            <div><span className="label">Realised PnL before gas</span><strong className={realisedBeforeGas !== null && realisedBeforeGas >= 0n ? 'up' : 'down'}>{fmtWei(realisedBeforeGas ?? 0n)}</strong></div>
            <div><span className="label">Unrealised inventory PnL</span><strong className={unrealised !== null && unrealised >= 0n ? 'up' : 'down'}>{unrealised === null ? 'Quote unavailable' : fmtWei(unrealised)}</strong></div>
            <div><span className="label">Observed deploy / strategy / transfer gas</span><strong>{gasLoading ? 'Reading receipts…' : gasWei === null ? 'Not fully available' : fmtWei(gasWei)}</strong></div>
            <div><span className="label">PnL after observed strategy gas</span><strong className={totalPnl !== null && totalPnl >= 0n ? 'up' : 'down'}>{totalPnl === null ? 'Incomplete data' : fmtWei(totalPnl)}</strong></div>
            <div><span className="label">Tracked cost-basis return</span><strong className={roiBps !== null && roiBps >= 0n ? 'up' : 'down'}>{roiText}</strong></div>
          </div>
        )}
        <div className="pnl-footnote">Bought: {strategy.tokenDecimals === null ? boughtRaw.toString() : formatTokenAmount(boughtRaw, strategy.tokenDecimals, strategy.symbol ?? 'tokens')} ({fmtWei(buyCostWei)} spent) · Sold: {strategy.tokenDecimals === null ? totalSoldRaw.toString() : formatTokenAmount(totalSoldRaw, strategy.tokenDecimals, strategy.symbol ?? 'tokens')} · Gross proceeds: {fmtWei(totalReceivedWei)} · Remaining inventory: {strategy.tokenDecimals === null ? `${strategy.tokenBalance} raw units` : formatTokenAmount(BigInt(strategy.tokenBalance || '0'), strategy.tokenDecimals, strategy.symbol ?? 'tokens')}</div>
        <div className="pnl-footnote">Token transfers not explained by strategy swaps: in {strategy.tokenDecimals === null ? unmatchedInbound.toString() : formatTokenAmount(unmatchedInbound, strategy.tokenDecimals, strategy.symbol ?? 'tokens')} · out {strategy.tokenDecimals === null ? unmatchedOutbound.toString() : formatTokenAmount(unmatchedOutbound, strategy.tokenDecimals, strategy.symbol ?? 'tokens')}</div>
        {!strategy.historyComplete && <div className="notice" style={{ marginTop: 12 }}><strong>On-chain event history is incomplete</strong><span>Strata event history or the selected ARC-20 transfer stream could not be verified over the complete deployment-to-current range. Combined PnL and ROI are withheld.</span></div>}
        {strategy.historyComplete && !transfersReconciled && <div className="notice" style={{ marginTop: 12 }}><strong>External token flows detected</strong><span>Some tokens were transferred out of this strategy outside its indexed sell fills, or token transfers could not be reconciled. Their value cannot be established reliably here, so combined PnL and ROI are withheld. External deposits can be included only when you provide a manually verified average acquisition cost.</span></div>}
        {gasCoverage && <p className="muted" style={{ marginTop: 8, fontSize: 11.5 }}>{gasCoverage}</p>}
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Estimate only. Return percentage uses tracked sold-token cost basis plus current inventory cost basis. A manually entered cost basis overrides the average from indexed buy fills. The ARC-20 transfer stream is scanned to detect deposits and withdrawals that do not match Strata swap fills; any unmatched flow blocks combined PnL. Open inventory uses a current Auras AMM quote, not guaranteed executable proceeds. Gas includes available deploy/init, strategy-event and indexed ARC-20 transfer receipts, but Cron escrow consumption and external native ASE deposits/withdrawals are not fully reconstructed as a cash ledger. This is a strategy-level estimate, not whole-wallet net profit. Truncated history, unknown receipt fields, price impact or tax-token mechanics can change the result.</p>
      </div>
    </div>
  );
}
