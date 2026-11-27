import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { TIMEFRAMES, timeframeById } from '../lib/marketData';
import {
  PERPS_APP_URL,
  calcPerpsLiquidationPrice,
  calcPerpsSizeWei,
  cancelPerpsNativeOrder,
  closePerpsPositionTx,
  depositPerpsCollateral,
  executePerpsMarketTrade,
  loadPerpsAccount,
  loadPerpsMarketCandles,
  loadPerpsMarketFills,
  loadPerpsMarkets,
  numberToPerpsPriceWei,
  perpsPriceToNumber,
  placePerpsNativeOrder,
  setPerpsMarginMode,
  withdrawPerpsCollateral,
  type PerpsMarket,
} from '../lib/perps';
import { explorerTxUrl, getBalance } from '../lib/rpc';
import { fmtNum, fmtTimestamp, parseUnits, shortHash, weiToAse } from '../lib/format';
import { PERP_BOT_TYPES, PERPS_DIRECT_BOT_TYPES } from '../lib/templates';
import { CandleChart } from './CandleChart';
import { InfoTip } from './InfoTip';

function priceFmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (abs >= 0.01) return value.toFixed(6);
  return value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

export function PerpsTerminal() {
  const wallet = useWallet();
  const client = useAsentum();
  const [params, setParams] = useSearchParams();

  const marketsState = useAsync(() => loadPerpsMarkets(), 20_000);
  const markets = useMemo(() => marketsState.data ?? [], [marketsState.data]);
  const requestedMkt = params.get('market');
  const market: PerpsMarket | null = useMemo(
    () => markets.find((m) => m.id === requestedMkt) ?? markets[0] ?? null,
    [markets, requestedMkt],
  );

  const [timeframe, setTimeframe] = useState('5m');
  const tf = timeframeById(timeframe);

  const candles = useAsync(
    () => (market ? loadPerpsMarketCandles(market, tf.seconds) : Promise.resolve([])),
    20_000,
    Boolean(market),
    `${market?.id ?? ''}:${tf.id}`,
  );

  const fills = useAsync(
    () => (market ? loadPerpsMarketFills(market.id) : Promise.resolve([])),
    15_000,
    Boolean(market),
    market?.id ?? '',
  );

  const account = useAsync(
    () => (wallet.connected && wallet.address && market
      ? loadPerpsAccount(wallet.address, market.id)
      : Promise.resolve(null)),
    12_000,
    Boolean(wallet.connected && wallet.address && market),
    `${wallet.address ?? ''}:${market?.id ?? ''}`,
  );

  const nativeBal = useAsync(
    () => (wallet.connected && wallet.address ? getBalance(wallet.address) : Promise.resolve({ balance: '0', nonce: '0' })),
    15_000,
    Boolean(wallet.connected && wallet.address),
    wallet.address ?? '',
  );

  const initialSide = params.get('side')?.toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const [side, setSide] = useState<'LONG' | 'SHORT'>(initialSide);
  const [tab, setTab] = useState<'market' | 'limit' | 'bot'>('market');
  const [lowerTab, setLowerTab] = useState<'position' | 'orders' | 'fills'>('position');
  const [leverage, setLeverage] = useState(3);
  const [marginInput, setMarginInput] = useState('1');
  const [slippageBps, setSlippageBps] = useState(300);

  // Limit order fields
  const [limitPxInput, setLimitPxInput] = useState('');
  const [limitTpInput, setLimitTpInput] = useState('');
  const [limitSlInput, setLimitSlInput] = useState('');
  const [postOnly, setPostOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);

  // Vault deposit / withdraw
  const [vaultAmount, setVaultAmount] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState('');
  const [stage, setStage] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [lastTx, setLastTx] = useState('');

  useEffect(() => {
    if (market) {
      setLeverage((prev) => Math.min(Math.max(1, prev), market.maxLeverage));
      if (!limitPxInput && market.markPrice > 0) {
        setLimitPxInput(priceFmt(side === 'LONG' ? market.markPrice * 0.98 : market.markPrice * 1.02));
      }
    }
  }, [market, side, limitPxInput]);

  const refreshAll = () => {
    marketsState.refresh();
    candles.refresh();
    fills.refresh();
    account.refresh();
    nativeBal.refresh();
  };

  const changeMarket = (id: string) => {
    setLimitPxInput('');
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('venue', 'perps');
      next.set('market', id);
      return next;
    }, { replace: true });
  };

  const walletAseWei = BigInt(nativeBal.data?.balance ?? '0');
  const vaultCollateralWei = BigInt(account.data?.collateralWei ?? '0');
  const vaultReservedWei = BigInt(account.data?.reservedWei ?? '0');
  const freeCollateralWei = BigInt(account.data?.freeCollateralWei ?? '0');
  const posSizeWei = BigInt(account.data?.position.sizeWei ?? '0');
  const posEntryWei = BigInt(account.data?.position.entryPrice ?? '0');
  const posFundingDebtWei = BigInt(account.data?.position.fundingDebtWei ?? '0');
  const posIsLong = posSizeWei > 0n;
  const posAbsSize = posSizeWei < 0n ? -posSizeWei : posSizeWei;

  const entryNum = market ? perpsPriceToNumber(posEntryWei, market.decimals, market.quoteDecimals) : 0;
  const upnlAse = market && posAbsSize > 0n
    ? (Number(posAbsSize) / 10 ** market.decimals) * (market.markPrice - entryNum) * (posIsLong ? 1 : -1)
    : 0;
  const posNotionalAse = market && posAbsSize > 0n
    ? (Number(posAbsSize) / 10 ** market.decimals) * market.markPrice
    : 0;
  const collNum = market ? Number(vaultCollateralWei) / 10 ** market.quoteDecimals : 0;
  const posEffLev = collNum > 0 && posNotionalAse > 0 ? posNotionalAse / collNum : leverage;
  const posLiq = market && entryNum > 0
    ? calcPerpsLiquidationPrice(entryNum, posIsLong ? 'long' : 'short', posEffLev, market.maintenanceMarginBps)
    : null;

  const marginWei = useMemo(() => {
    try { return parseUnits(marginInput || '0', 18); } catch { return 0n; }
  }, [marginInput]);
  const estNotionalWei = marginWei * BigInt(Math.max(1, leverage));
  const estSizeWei = market && BigInt(market.markPriceWei || '0') > 0n
    ? calcPerpsSizeWei(estNotionalWei, BigInt(market.markPriceWei))
    : 0n;
  const estLiqPrice = market && market.markPrice > 0
    ? calcPerpsLiquidationPrice(market.markPrice, side === 'LONG' ? 'long' : 'short', leverage, market.maintenanceMarginBps)
    : null;

  const ensureMarginAndRun = async (requiredMarginWei: bigint, action: () => Promise<string>, successMsg: string) => {
    if (!wallet.connected || !wallet.address) { wallet.openConnect(); return; }
    if (!market) return;
    setBusy(true);
    setError('');
    setNotice('');
    setLastTx('');
    try {
      if (requiredMarginWei > freeCollateralWei) {
        const shortfall = ((requiredMarginWei - freeCollateralWei) * 101n) / 100n;
        setStage(`Depositing ${weiToAse(shortfall, 4)} ASE collateral to AsePad Vault…`);
        const depHash = await depositPerpsCollateral(client, market.id, shortfall, market.quoteToken);
        setLastTx(depHash);
      }
      setStage('Confirm transaction in your wallet…');
      const txHash = await action();
      setLastTx(txHash);
      setNotice(successMsg);
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const submitMarket = () => {
    if (!market) return;
    if (marginWei <= 0n || estSizeWei <= 0n) {
      setError('Enter a positive ASE margin amount.');
      return;
    }
    const minNotional = BigInt(market.minOrderNotionalWei || '0');
    if (estNotionalWei < minNotional) {
      setError(`Order notional must be at least ${weiToAse(minNotional, 2)} ASE.`);
      return;
    }
    const reqMargin = (estNotionalWei * BigInt(market.initialMarginBps)) / 10_000n;
    void ensureMarginAndRun(
      reqMargin,
      () => executePerpsMarketTrade(client, {
        marketId: market.id,
        side,
        sizeWei: estSizeWei,
        currentSizeWei: posSizeWei,
        markPriceWei: BigInt(market.markPriceWei),
        slippageBps,
      }),
      `${side} ${market.symbol}/ASE market order confirmed.`,
    );
  };

  const submitLimit = () => {
    if (!market) return;
    const limitPxWei = numberToPerpsPriceWei(limitPxInput, market.decimals, market.quoteDecimals);
    if (limitPxWei === '0') {
      setError('Enter a valid Limit price.');
      return;
    }
    const sizeWei = calcPerpsSizeWei(estNotionalWei, BigInt(limitPxWei));
    if (sizeWei <= 0n) {
      setError('Enter a positive margin amount.');
      return;
    }
    const minNotional = BigInt(market.minOrderNotionalWei || '0');
    if (estNotionalWei < minNotional) {
      setError(`Notional must be at least ${weiToAse(minNotional, 2)} ASE.`);
      return;
    }
    const tpPxWei = limitTpInput.trim() ? numberToPerpsPriceWei(limitTpInput, market.decimals, market.quoteDecimals) : '0';
    const slPxWei = limitSlInput.trim() ? numberToPerpsPriceWei(limitSlInput, market.decimals, market.quoteDecimals) : '0';
    const maxDur = Math.max(120_000, market.orderExpiryMs - 60_000);
    const expiryMs = String(Date.now() + Math.min(86_400_000, maxDur));
    const reqMargin = reduceOnly ? 0n : (estNotionalWei * BigInt(market.initialMarginBps)) / 10_000n;

    void ensureMarginAndRun(
      reqMargin,
      () => placePerpsNativeOrder(client, {
        marketId: market.id,
        kind: 'LIMIT',
        side,
        sizeWei: sizeWei.toString(),
        limitPx: limitPxWei,
        postOnly,
        reduceOnly,
        expiryMs,
        ...(tpPxWei !== '0' ? { tpPx: tpPxWei } : {}),
        ...(slPxWei !== '0' ? { slPx: slPxWei } : {}),
      }, market.cronDepositWei),
      `${side} Limit order placed on AsePad Perps.`,
    );
  };

  const handleClosePosition = async () => {
    if (!wallet.connected || !market || posSizeWei === 0n) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setStage('Closing open position…');
      const txHash = await closePerpsPositionTx(client, market.id, posSizeWei, BigInt(market.markPriceWei), slippageBps);
      setLastTx(txHash);
      setNotice(`Closed ${market.symbol}/ASE position.`);
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const handleVaultMove = async (kind: 'deposit' | 'withdraw') => {
    if (!wallet.connected || !market) { wallet.openConnect(); return; }
    let amt = 0n;
    try { amt = parseUnits(vaultAmount || '0', 18); } catch { amt = 0n; }
    if (amt <= 0n) { setError('Enter a positive ASE vault amount.'); return; }
    setVaultBusy(true);
    setError('');
    setNotice('');
    try {
      const txHash = kind === 'deposit'
        ? await depositPerpsCollateral(client, market.id, amt, market.quoteToken)
        : await withdrawPerpsCollateral(client, market.id, amt);
      setLastTx(txHash);
      setVaultAmount('');
      setNotice(kind === 'deposit' ? 'Deposited collateral to AsePad Vault.' : 'Withdrew free collateral from AsePad Vault.');
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVaultBusy(false);
    }
  };

  const handleToggleMarginMode = async () => {
    if (!wallet.connected || !account.data) return;
    const next = account.data.marginMode === 'i' ? 'x' : 'i';
    setVaultBusy(true);
    setError('');
    try {
      const txHash = await setPerpsMarginMode(client, next);
      setLastTx(txHash);
      setNotice(`Switched margin mode to ${next === 'x' ? 'Cross' : 'Isolated'}.`);
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVaultBusy(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    setCancelBusy(orderId);
    setError('');
    try {
      const txHash = await cancelPerpsNativeOrder(client, orderId);
      setLastTx(txHash);
      setNotice(`Order #${orderId} cancelled.`);
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelBusy('');
    }
  };

  const openOrders = (account.data?.orders ?? []).filter((o) => !market || String(o.marketId) === market.id);
  const botLink = (qs: Record<string, string>) => {
    const u = new URLSearchParams({ venue: 'perps', market: market?.id ?? '1', side, leverage: String(leverage), ...qs });
    return `/deploy?${u.toString()}`;
  };

  return (
    <>
      <div className="advanced-toolbar">
        <div className="pair-select">
          <span className="label">Perps Market</span>
          <select
            value={market?.id ?? ''}
            onChange={(e) => changeMarket(e.target.value)}
            aria-label="Select perp market"
            className="input"
          >
            {markets.length === 0 && <option value="">Loading AsePad Perps…</option>}
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.symbol}/ASE PERP · max {m.maxLeverage}x · {m.state}
              </option>
            ))}
          </select>
        </div>

        <dl className="advanced-market-stats">
          <div><dt>Mark Price</dt><dd className="mono">{priceFmt(market?.markPrice)} ASE</dd></div>
          <div><dt>Oracle</dt><dd className="mono">{market ? `${market.oracleSource} · ${market.oracleHealth}` : '—'}</dd></div>
          <div><dt>Max Lev</dt><dd className="mono">{market ? `${market.maxLeverage}x` : '—'}</dd></div>
          <div><dt>Open Interest</dt><dd className="mono">{market ? `${fmtNum(Number(market.openInterest.toFixed(1)))} ASE` : '—'}</dd></div>
          <div><dt>Insurance</dt><dd className="mono">{market ? `${weiToAse(market.insuranceBalanceWei, 1)} ASE` : '—'}</dd></div>
          <div><dt>Taker Fee</dt><dd className="mono">{market ? `${(market.takerFeeBps / 100).toFixed(2)}%` : '—'}</dd></div>
        </dl>
      </div>

      <div className="advanced-grid">
        <div className="advanced-chart-col">
          <div className="panel advanced-chart-panel">
            <div className="panel-head advanced-chart-head">
              <div className="tf-switch" role="group" aria-label="Chart timeframe">
                {TIMEFRAMES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={timeframe === item.id ? 'chip-btn active' : 'chip-btn'}
                    onClick={() => setTimeframe(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <span className="mono muted advanced-source">
                AsePad Perps · <a href={PERPS_APP_URL} target="_blank" rel="noreferrer" className="link-arrow">perps.asepad.fun ↗</a>
                <InfoTip label="Oracle mark source" text="Candles show the spot pool index driving AsePad Perps TWAP oracle mark prices. Scroll to zoom and drag to pan." />
              </span>
            </div>
            <CandleChart
              candles={candles.data ?? []}
              intervalSec={tf.seconds}
              symbol={market ? `${market.symbol}/ASE` : '—'}
              loading={candles.loading}
              error={candles.error}
            />
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="seg-tabs" style={{ marginTop: 0 }} role="tablist" aria-label="Perps account and market views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={lowerTab === 'position'}
                  className={lowerTab === 'position' ? 'seg-tab active' : 'seg-tab'}
                  onClick={() => setLowerTab('position')}
                >
                  Open Position
                  {posSizeWei !== 0n && <span className="seg-tab-count">1</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={lowerTab === 'orders'}
                  className={lowerTab === 'orders' ? 'seg-tab active' : 'seg-tab'}
                  onClick={() => setLowerTab('orders')}
                >
                  Open Orders
                  <span className="seg-tab-count">{openOrders.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={lowerTab === 'fills'}
                  className={lowerTab === 'fills' ? 'seg-tab active' : 'seg-tab'}
                  onClick={() => setLowerTab('fills')}
                >
                  Market Fills
                  <span className="seg-tab-count">{(fills.data ?? []).length}</span>
                </button>
              </div>
              <button type="button" className="chip" onClick={refreshAll}>Refresh</button>
            </div>

            {lowerTab === 'position' && (
              !wallet.connected ? (
                <p className="muted advanced-empty">Connect wallet to view your AsePad Perps position.</p>
              ) : posSizeWei === 0n ? (
                <p className="muted advanced-empty">No open position on {market?.symbol ?? 'this market'}.</p>
              ) : (
                <div className="panel-body">
                  <div className="bot-facts">
                    <div><span>Side</span><strong className={posIsLong ? 'up' : 'down'}>{posIsLong ? 'LONG' : 'SHORT'}</strong></div>
                    <div><span>Size</span><strong className="mono">{(Number(posAbsSize) / 10 ** (market?.decimals ?? 18)).toFixed(4)} {market?.symbol}</strong></div>
                    <div><span>Entry Price</span><strong className="mono">{priceFmt(entryNum)} ASE</strong></div>
                    <div><span>Mark Price</span><strong className="mono">{priceFmt(market?.markPrice)} ASE</strong></div>
                    <div><span>Est. Liq Price</span><strong className="mono">{priceFmt(posLiq)} ASE</strong></div>
                    <div>
                      <span>Unrealised PnL</span>
                      <strong className={`mono ${upnlAse >= 0 ? 'up' : 'down'}`}>
                        {upnlAse >= 0 ? '+' : ''}{upnlAse.toFixed(4)} ASE
                      </strong>
                    </div>
                    <div><span>Collateral</span><strong className="mono">{weiToAse(vaultCollateralWei, 4)} ASE</strong></div>
                    <div><span>Funding Debt</span><strong className="mono">{weiToAse(posFundingDebtWei, 4)} ASE</strong></div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 14 }}
                    disabled={busy}
                    onClick={() => void handleClosePosition()}
                  >
                    {busy ? 'Closing…' : 'Close position at mark'}
                  </button>
                </div>
              )
            )}

            {lowerTab === 'orders' && (
              <div className="panel-body">
                {!wallet.connected ? (
                  <p className="muted advanced-empty" style={{ padding: 0 }}>Connect wallet to see open orders.</p>
                ) : openOrders.length === 0 ? (
                  <p className="muted advanced-empty" style={{ padding: 0 }}>No open orders for this market.</p>
                ) : (
                  openOrders.map((ord) => (
                    <div className="advanced-order-row" key={ord.id}>
                      <div>
                        <span className={ord.side === 'LONG' ? 'exec-side is-buy' : 'exec-side is-sell'}>{ord.side}</span>
                        <strong className="mono"> {ord.kind} #{ord.id}</strong>
                        <span className="mono muted"> · {ord.state}</span>
                      </div>
                      <div className="mono advanced-order-meta">
                        Size {weiToAse(ord.sizeWei, 3)} {market?.symbol ?? ''}
                        {ord.limitPx !== '0' && market ? ` @ ${priceFmt(perpsPriceToNumber(ord.limitPx, market.decimals, market.quoteDecimals))} ASE` : ''}
                        {ord.triggerPx !== '0' && market ? ` · trig ${priceFmt(perpsPriceToNumber(ord.triggerPx, market.decimals, market.quoteDecimals))}` : ''}
                      </div>
                      <div className="advanced-order-foot">
                        <span className="mono muted">{ord.reduceOnly ? 'Reduce-only' : `Reserved ${weiToAse(ord.reservedWei, 3)} ASE`}</span>
                        <button type="button" className="chip" disabled={cancelBusy === ord.id} onClick={() => void handleCancelOrder(ord.id)}>
                          {cancelBusy === ord.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {lowerTab === 'fills' && (
              <div className="table-scroll advanced-trades">
                <table className="leaderboard-table">
                  <thead>
                    <tr><th>Time</th><th>Side</th><th>Price</th><th>Via</th><th>Tx</th></tr>
                  </thead>
                  <tbody>
                    {(fills.data ?? []).map((f) => (
                      <tr key={`${f.txHash}-${f.sizeDelta}`}>
                        <td className="mono dim">{f.timestamp ? fmtTimestamp(f.timestamp) : `#${f.block}`}</td>
                        <td><span className={f.side === 'LONG' ? 'exec-side is-buy' : 'exec-side is-sell'}>{f.side}</span></td>
                        <td className="mono">{priceFmt(market ? perpsPriceToNumber(f.priceWei, market.decimals, market.quoteDecimals) : 0)}</td>
                        <td className="mono">{f.via}</td>
                        <td><a className="link-arrow mono" href={explorerTxUrl(f.txHash)} target="_blank" rel="noreferrer">{shortHash(f.txHash)}</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(fills.data ?? []).length === 0 && (
                  <p className="muted advanced-empty">{fills.loading ? 'Reading AsePad Engine fills…' : 'No recent fills indexed.'}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="advanced-order-col">
          <div className="panel advanced-ticket">
            {tab !== 'bot' && (
              <div className="advanced-side-switch" role="group" aria-label="Perps side">
                <button type="button" className={side === 'LONG' ? 'active buy' : ''} onClick={() => setSide('LONG')}>Long</button>
                <button type="button" className={side === 'SHORT' ? 'active sell' : ''} onClick={() => setSide('SHORT')}>Short</button>
              </div>
            )}

            <div className="advanced-kind-switch" role="tablist" aria-label="Perps order type">
              <button type="button" className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>Market</button>
              <button type="button" className={tab === 'limit' ? 'active' : ''} onClick={() => setTab('limit')}>Limit</button>
              <button type="button" className={tab === 'bot' ? 'active' : ''} onClick={() => setTab('bot')}>Perp Bot</button>
            </div>

            {tab === 'bot' ? (
              <div className="advanced-bot-panel">
                <span className="label">
                  Automate {market?.symbol ?? 'Market'} on AsePad Perps
                  <InfoTip label="Perp automation modes" text="Cron Contract Bots deploy an isolated contract you own; perps.asepad.fun orders submit native TWAP/Scale/Limit/Trailing orders directly on your Vault account." />
                </span>
                <div className="advanced-bot-quick">
                  {PERP_BOT_TYPES.map((b) => (
                    <Link key={b.templateId} to={botLink({ template: b.templateId })} className="advanced-strategy-row">
                      <span><strong>{b.title}</strong><small>Cron contract · {b.short}</small></span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  ))}
                  {PERPS_DIRECT_BOT_TYPES.map((b) => (
                    <Link key={b.kind} to={botLink({ mode: 'direct', kind: b.kind })} className="advanced-strategy-row">
                      <span><strong>{b.title}</strong><small>perps.asepad.fun · {b.short}</small></span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  ))}
                </div>
                <Link className="btn btn-primary swap-action" to={botLink({ template: 'perp-dca' })}>
                  Open Perps Bot Builder →
                </Link>
              </div>
            ) : (
              <>
                <div className="field">
                  <span>Leverage · max {market?.maxLeverage ?? 10}x</span>
                  <div className="chip-row" style={{ marginTop: 6 }}>
                    {[1, 2, 3, 5, 10].filter((x) => x <= (market?.maxLeverage ?? 10)).map((x) => (
                      <button key={x} type="button" className={leverage === x ? 'chip-btn active' : 'chip-btn'} onClick={() => setLeverage(x)}>{x}x</button>
                    ))}
                  </div>
                </div>

                {tab === 'limit' && (
                  <label className="field">
                    <span>Limit Price · ASE</span>
                    <input className="input" value={limitPxInput} onChange={(e) => setLimitPxInput(e.target.value)} inputMode="decimal" />
                  </label>
                )}

                <label className="field">
                  <span>Margin · ASE</span>
                  <div className="advanced-amount-row">
                    <input className="input" value={marginInput} onChange={(e) => setMarginInput(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />
                  </div>
                </label>
                <div className="pct-row">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className="pct-btn"
                      onClick={() => {
                        const avail = freeCollateralWei > 0n
                          ? freeCollateralWei
                          : (walletAseWei > 100_000_000_000_000_000n ? walletAseWei - 100_000_000_000_000_000n : 0n);
                        const target = pct === 100 ? avail : (avail * BigInt(pct)) / 100n;
                        if (target > 0n) setMarginInput(weiToAse(target, 4));
                      }}
                    >
                      {pct === 100 ? 'MAX' : `${pct}%`}
                    </button>
                  ))}
                </div>

                {tab === 'limit' && (
                  <>
                    <div className="perps-vault-grid">
                      <label className="field">
                        <span>TP Price (opt)</span>
                        <input className="input" value={limitTpInput} onChange={(e) => setLimitTpInput(e.target.value)} placeholder="Optional" inputMode="decimal" />
                      </label>
                      <label className="field">
                        <span>SL Price (opt)</span>
                        <input className="input" value={limitSlInput} onChange={(e) => setLimitSlInput(e.target.value)} placeholder="Optional" inputMode="decimal" />
                      </label>
                    </div>
                    <div className="chip-row">
                      <button type="button" className={postOnly ? 'chip-btn active' : 'chip-btn'} onClick={() => setPostOnly((v) => !v)}>Post-Only</button>
                      <button type="button" className={reduceOnly ? 'chip-btn active' : 'chip-btn'} onClick={() => setReduceOnly((v) => !v)}>Reduce-Only</button>
                    </div>
                  </>
                )}

                <dl className="swap-details advanced-quote">
                  <div><dt>Notional</dt><dd className="mono">{weiToAse(estNotionalWei, 4)} ASE</dd></div>
                  <div><dt>Est. Size</dt><dd className="mono">{weiToAse(estSizeWei, 3)} {market?.symbol ?? ''}</dd></div>
                  <div><dt>Est. Liq Price</dt><dd className="mono">{priceFmt(estLiqPrice)} ASE</dd></div>
                  <div><dt>Free Vault Margin</dt><dd className="mono">{weiToAse(freeCollateralWei, 4)} ASE</dd></div>
                </dl>

                {tab === 'market' && (
                  <div className="swap-slippage">
                    <span className="label">Max Slippage</span>
                    <div className="swap-slippage-opts">
                      {[100, 300, 500].map((bps) => (
                        <button key={bps} type="button" className={slippageBps === bps ? 'chip-btn active' : 'chip-btn'} onClick={() => setSlippageBps(bps)}>
                          {(bps / 100).toFixed(0)}%
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-primary swap-action"
                  disabled={busy || !market}
                  onClick={tab === 'market' ? submitMarket : submitLimit}
                >
                  {busy
                    ? stage || 'Working…'
                    : !wallet.connected
                      ? 'Connect wallet'
                      : `${tab === 'market' ? 'Open' : 'Post Limit'} ${side} ${leverage}x`}
                </button>
              </>
            )}

            {notice && <p className="swap-note up">{notice}</p>}
            {error && <p className="swap-note down">{error}</p>}
            {lastTx && (
              <p className="swap-note mono">
                Tx <a className="link-arrow" href={explorerTxUrl(lastTx)} target="_blank" rel="noreferrer">{shortHash(lastTx)} ↗</a>
              </p>
            )}
          </div>

          <div className="panel advanced-orders">
            <div className="panel-head">
              <div>
                <span className="label">AsePad Vault Margin</span>
                <p className="muted">
                  Mode: <strong>{account.data?.marginMode === 'x' ? 'Cross' : 'Isolated'}</strong> · Free: <strong className="mono">{weiToAse(freeCollateralWei, 3)} ASE</strong>
                </p>
              </div>
              <button type="button" className="chip" disabled={!wallet.connected || vaultBusy} onClick={() => void handleToggleMarginMode()}>
                Switch Mode
              </button>
            </div>
            <div className="panel-body">
              <div className="bot-facts" style={{ marginBottom: 14 }}>
                <div><span>Wallet ASE</span><strong className="mono">{weiToAse(walletAseWei, 3)}</strong></div>
                <div><span>Vault Total</span><strong className="mono">{weiToAse(vaultCollateralWei, 3)}</strong></div>
                <div><span>Reserved</span><strong className="mono">{weiToAse(vaultReservedWei, 3)}</strong></div>
                <div><span>Free Margin</span><strong className="mono">{weiToAse(freeCollateralWei, 3)}</strong></div>
              </div>
              <details className="soft-details">
                <summary>Deposit or withdraw Vault collateral</summary>
                <div className="soft-details-body">
                  <div className="advanced-amount-row">
                    <input
                      className="input"
                      value={vaultAmount}
                      onChange={(e) => setVaultAmount(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder="ASE amount"
                      inputMode="decimal"
                    />
                    <button type="button" className="chip" disabled={vaultBusy} onClick={() => void handleVaultMove('deposit')}>Deposit</button>
                    <button type="button" className="chip" disabled={vaultBusy} onClick={() => void handleVaultMove('withdraw')}>Withdraw</button>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
