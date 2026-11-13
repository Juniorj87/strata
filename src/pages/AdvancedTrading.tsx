import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import {
  getCandles,
  getMarketPairs,
  getMarketTrades,
  marketFor,
  pairToken,
  timeframeById,
  tradablePairs,
  TIMEFRAMES,
  type MarketPair,
} from '../lib/marketData';
import { computeSpot } from '../lib/registry';
import {
  ASE_TOKEN,
  executeSwap,
  quoteSwap,
  readSwappedAmount,
  type SwapQuote,
  type SwapToken,
} from '../lib/swap';
import {
  cancelLimitOrder,
  createLimitOrder,
  limitOrderError,
  readLimitOrderConfig,
  readOwnerLimitOrders,
  readPoolLimitOrders,
  type LimitOrder,
  type LimitOrderConfig,
} from '../lib/limitOrders';
import { AURAS_AMM, ASEDEX_AMM, explorerTxUrl, getBalance, toHexAddress, viewCall } from '../lib/rpc';
import { fmtNum, fmtTimestamp, formatUnits, parseUnits, shortHash, weiToAse } from '../lib/format';
import { perpsIntegration } from '../lib/perps';
import { CandleChart } from '../components/CandleChart';

const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SLIPPAGE_PRESETS = [10, 50, 100];
const TTL_OPTIONS = [
  { label: '1 day', value: 86_400 },
  { label: '7 days', value: 604_800 },
  { label: '30 days', value: 2_592_000 },
  { label: '90 days', value: 7_776_000 },
];

const STRATEGY_PRESETS = [
  { template: 'dca', name: 'DCA', text: 'Buy a fixed ASE amount on a schedule until the budget ends.', interval: 3600, pro: false },
  { template: 'grid', name: 'Grid', text: 'Two-sided inventory grid around the current pool price.', interval: 60, pro: false },
  { template: 'twap', name: 'TWAP', text: 'Split one token sale into timed swaps.', interval: 300, pro: false },
  { template: 'limit-exit', name: 'Take-profit', text: 'One scheduled sell once the pool price reaches a target.', interval: 60, pro: false },
  { template: 'risk-managed', name: 'Risk-managed exit', text: 'Spot-only scheduled sells: stop-loss, take-profit and drawdown caps.', interval: 300, pro: false },
  { template: 'momentum-signal', name: 'Momentum signal', text: 'Publish a signal from consecutive TWAP windows; does not trade.', interval: 60, pro: true },
  { template: 'momentum-trader', name: 'Momentum trader', text: 'Sell the selected token into ASE when the signal threshold is crossed.', interval: 60, pro: true },
  { template: 'scale', name: 'Scale order', text: 'Sell token inventory in scheduled price-triggered slices.', interval: 60, pro: true },
];

interface PairState {
  decimals: number;
  reserveToken: string;
  reserveNative: string;
  feeBps: number;
  spot: number;
}

async function loadPairState(pair: MarketPair): Promise<PairState> {
  const token = pairToken(pair);
  if (!token) throw new Error('This pool has no ASE side.');
  const [pool, decimals] = await Promise.all([
    viewCall<unknown>(pair.amm, 'getPool', [pair.chainPoolId]),
    viewCall<unknown>(token.address, 'decimals', []).catch(() => 18),
  ]);
  const parsed = typeof pool === 'string' ? JSON.parse(pool) as Record<string, unknown> : pool as Record<string, unknown>;
  if (!parsed) throw new Error('The pool contract returned no state.');
  const t0 = String(parsed.token0 ?? '').toLowerCase();
  const reserve0 = String(parsed.reserve0 ?? '0');
  const reserve1 = String(parsed.reserve1 ?? '0');
  const nativeIs0 = t0 === NATIVE;
  const reserveToken = nativeIs0 ? reserve1 : reserve0;
  const reserveNative = nativeIs0 ? reserve0 : reserve1;
  const dec = Number(decimals);
  const safeDec = Number.isInteger(dec) && dec >= 0 && dec <= 18 ? dec : 18;
  return {
    decimals: safeDec,
    reserveToken,
    reserveNative,
    feeBps: Number(parsed.feeBps ?? pair.feeBps ?? 30) || 30,
    spot: Number(computeSpot(reserveToken, reserveNative, String(parsed.feeBps ?? pair.feeBps ?? 30), safeDec)) / 1e18,
  };
}

function priceFmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (abs >= 0.01) return value.toFixed(6);
  return value.toPrecision(5);
}

function orderSide(order: LimitOrder): 'buy' | 'sell' {
  return order.tokenIn.toLowerCase() === NATIVE ? 'buy' : 'sell';
}

/** ASE per whole token for an escrowed order. */
function orderPrice(order: LimitOrder, decimals: number): number {
  try {
    const amountIn = Number(BigInt(order.amountIn));
    const minOut = Number(BigInt(order.minOut));
    const unit = 10 ** decimals;
    if (orderSide(order) === 'buy') {
      return amountIn / (minOut / unit);
    }
    return (minOut / 1e18) / (amountIn / unit);
  } catch {
    return 0;
  }
}

function limitPriceWei(price: string): bigint {
  return parseUnits(price.trim(), 18);
}

export function AdvancedTrading() {
  const wallet = useWallet();
  const client = useAsentum();
  const [params, setParams] = useSearchParams();

  const pairsState = useAsync(() => getMarketPairs(), 60_000);
  const pairs = useMemo(() => {
    const supported = new Set([AURAS_AMM.toLowerCase(), ASEDEX_AMM.toLowerCase()]);
    return tradablePairs(pairsState.data ?? []).filter((item) => supported.has(item.amm.toLowerCase()));
  }, [pairsState.data]);

  const requested = params.get('pool');
  const pair = useMemo(
    () => pairs.find((item) => item.poolKey === requested) ?? pairs[0] ?? null,
    [pairs, requested],
  );

  const market = pair ? marketFor(pair) : null;
  const token = market ? { address: market.tokenAddress, symbol: market.symbol } : null;
  const pairKey = pair?.poolKey ?? '';
  // The limit-order module is deployed next to Auras v2 only. AseDex and the
  // legacy v1 pools have no order module, so they stay market-order only.
  const limitEnabled = pair?.amm?.toLowerCase() === AURAS_AMM.toLowerCase();
  const pairDep = `${pairKey}:${wallet.address ?? ''}`;

  const pairState = useAsync(
    () => (pair ? loadPairState(pair) : Promise.reject(new Error('No pool selected'))),
    30_000,
    Boolean(pair),
    pairKey,
  );

  const [timeframe, setTimeframe] = useState('1m');
  const tf = timeframeById(timeframe);

  const candles = useAsync(
    () => (pair ? getCandles(pair, tf) : Promise.resolve([])),
    20_000,
    Boolean(pair),
    `${pairKey}:${tf.id}`,
  );

  const trades = useAsync(
    () => (pair ? getMarketTrades(pair, 24) : Promise.resolve([])),
    12_000,
    Boolean(pair),
    pairKey,
  );

  const config = useAsync<LimitOrderConfig>(() => readLimitOrderConfig(), 120_000, limitEnabled);

  const ownerHex = wallet.address ? toHexAddress(wallet.address) : '';
  const ownOrders = useAsync(
    () => (ownerHex ? readOwnerLimitOrders(ownerHex) : Promise.resolve([])),
    20_000,
    Boolean(ownerHex) && limitEnabled,
    `${ownerHex}:${limitEnabled}`,
  );

  const poolOrders = useAsync(
    () => (pair && token ? readPoolLimitOrders(pair.chainPoolId, token.address) : Promise.resolve({ orders: [], total: 0, truncated: false })),
    20_000,
    Boolean(pair && token) && limitEnabled,
    pairKey,
  );

  const balances = useAsync(
    async () => {
      if (!wallet.address || !token) return { ase: 0n, token: 0n };
      const [native, tokenRaw] = await Promise.all([
        getBalance(wallet.address).catch(() => ({ balance: '0', nonce: '0' })),
        viewCall<unknown>(token.address, 'balanceOf', [ownerHex]).catch(() => '0'),
      ]);
      return {
        ase: BigInt(native.balance || '0'),
        token: BigInt(String(tokenRaw).replace(/"/g, '') || '0'),
      };
    },
    20_000,
    Boolean(wallet.address && token),
    pairDep,
  );

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderKind, setOrderKind] = useState<'market' | 'limit' | 'bot'>('market');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastTx, setLastTx] = useState('');
  const quoteSeq = useRef(0);

  const [limitPrice, setLimitPrice] = useState('');
  const [limitAmount, setLimitAmount] = useState('');
  const [limitTtl, setLimitTtl] = useState(2_592_000);
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitError, setLimitError] = useState('');
  const [limitNotice, setLimitNotice] = useState('');
  const [cancelBusy, setCancelBusy] = useState('');

  const decimals = pairState.data?.decimals ?? 18;
  const baseToken: SwapToken | null = useMemo(() => {
    if (!pair || !token || !pairState.data) return null;
    return {
      address: token.address,
      symbol: token.symbol || 'TOKEN',
      name: token.symbol || 'Token',
      decimals: pairState.data.decimals,
      isNative: false,
      venue: pair.dex,
      ammAddress: pair.amm,
      poolId: pair.chainPoolId,
      reserveToken: pairState.data.reserveToken,
      reserveNative: pairState.data.reserveNative,
      feeBps: pairState.data.feeBps,
      spotAse: pairState.data.spot,
    };
  }, [pair, token, pairState.data]);

  const tokenIn = side === 'buy' ? ASE_TOKEN : baseToken;
  const tokenOut = side === 'buy' ? baseToken : ASE_TOKEN;

  const amountIn = useMemo(() => {
    try { return parseUnits(amount || '0', side === 'buy' ? 18 : decimals); } catch { return 0n; }
  }, [amount, side, decimals]);

  const walletBalance = side === 'buy' ? (balances.data?.ase ?? 0n) : (balances.data?.token ?? 0n);

  useEffect(() => {
    setAmount('');
    setQuote(null);
    setQuoteError('');
    setError('');
    setNotice('');
    setLastTx('');
    setLimitPrice('');
    setLimitAmount('');
    setLimitError('');
    setLimitNotice('');
  }, [pairKey]);

  // Live AMM quote, re-read after a short idle so typing does not spam the node.
  useEffect(() => {
    const seq = ++quoteSeq.current;
    if (!tokenIn || !tokenOut || !baseToken || amountIn <= 0n) {
      setQuote(null);
      setQuoteError('');
      setQuoting(false);
      return;
    }
    setQuoting(true);
    const timer = window.setTimeout(() => {
      quoteSwap({ tokenIn, tokenOut, amountIn, pool: baseToken, slippageBps })
        .then((next) => {
          if (quoteSeq.current !== seq) return;
          setQuote(next);
          setQuoteError('');
        })
        .catch((err: unknown) => {
          if (quoteSeq.current !== seq) return;
          setQuote(null);
          setQuoteError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (quoteSeq.current === seq) setQuoting(false);
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [tokenIn, tokenOut, baseToken, amountIn, slippageBps]);

  const refreshMarket = () => {
    pairsState.refresh();
    pairState.refresh();
    candles.refresh();
    trades.refresh();
    balances.refresh();
    ownOrders.refresh();
    poolOrders.refresh();
  };

  const runMarketOrder = async () => {
    if (!wallet.connected || !wallet.address) { wallet.openConnect(); return; }
    setBusy(true);
    setError('');
    setNotice('');
    setLastTx('');
    try {
      if (!baseToken) throw new Error('The selected pool is not ready. Wait for its on-chain state to load, then retry.');
      if (!tokenIn || !tokenOut) throw new Error('Select a valid trade side and token.');
      if (amountIn <= 0n) throw new Error('Enter an amount greater than zero.');
      // Always request a fresh quote here. The background quote is only a preview;
      // it must never prevent the user from attempting a trade or leave the button inert.
      setStage('Refreshing the AMM quote…');
      const fresh = await quoteSwap({ tokenIn, tokenOut, amountIn, pool: baseToken, slippageBps });
      if (fresh.minOut <= 0n) throw new Error('The fresh quote returned a zero minimum. Reduce the amount.');
      const result = await executeSwap({
        client,
        ownerHex,
        tokenIn,
        pool: baseToken,
        amountIn,
        minOut: fresh.minOut,
        onStage: setStage,
      });
      setLastTx(result.hash);
      setStage('Waiting for confirmation…');
      const receipt = await client.waitReceipt(result.hash, 180_000);
      if (!receipt.success) throw new Error('The swap reverted on chain. No balance changed.');
      const received = await readSwappedAmount(receipt as unknown as Record<string, unknown>).catch(() => null);
      const actual = received && received > 0n ? received : fresh.amountOut;
      setNotice(
        `${side === 'buy' ? 'Bought' : 'Sold'} · ${formatUnits(actual, tokenOut.decimals, 6)} ${tokenOut.symbol} received`,
      );
      setAmount('');
      setQuote(null);
      refreshMarket();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(/reject|denied|cancel|declin/i.test(raw)
        ? 'The wallet rejected the transaction. Nothing was sent.'
        : /insufficient|balance/i.test(raw)
          ? 'Insufficient balance for this order.'
          : raw);
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const limitPriceValue = (() => {
    try { return limitPrice.trim() ? limitPriceWei(limitPrice) : 0n; } catch { return 0n; }
  })();

  const limitAmountRaw = useMemo(() => {
    try { return parseUnits(limitAmount || '0', side === 'buy' ? 18 : decimals); } catch { return 0n; }
  }, [limitAmount, side, decimals]);

  const limitMinOut = useMemo(() => {
    if (limitAmountRaw <= 0n || limitPriceValue <= 0n) return 0n;
    const scale = 10n ** BigInt(decimals);
    return side === 'buy'
      ? (limitAmountRaw * scale) / limitPriceValue
      : (limitAmountRaw * limitPriceValue) / scale;
  }, [limitAmountRaw, limitPriceValue, side, decimals]);

  const limitValueAse = side === 'buy' ? limitAmountRaw : limitMinOut;
  const minOrderAse = config.data?.minOrderAse ?? 100_000_000_000_000_000n;
  const belowMinimum = limitAmountRaw > 0n && limitValueAse < minOrderAse;

  const submitLimitOrder = async () => {
    if (!wallet.connected || !wallet.address) { wallet.openConnect(); return; }
    if (!pair || !baseToken) return;
    setLimitBusy(true);
    setLimitError('');
    setLimitNotice('');
    try {
      if (limitPriceValue <= 0n) throw new Error('Enter a target price in ASE.');
      if (limitMinOut <= 0n) throw new Error('This price and amount produce no output. Check the values.');
      if (belowMinimum) throw new Error('This order is below the AMM minimum of 0.1 ASE.');
      const { hash } = await createLimitOrder({
        client,
        ownerHex,
        poolId: pair.chainPoolId,
        tokenIn: side === 'buy' ? NATIVE : baseToken.address,
        amountIn: limitAmountRaw,
        minOut: limitMinOut,
        ttlSec: limitTtl,
        onStage: (next) => setStage(next),
      });
      setLastTx(hash);
      setStage('Waiting for the order to confirm…');
      const receipt = await client.waitReceipt(hash, 180_000);
      if (!receipt.success) throw new Error('The limit order reverted on chain.');
      setLimitNotice(
        `${side === 'buy' ? 'Buy' : 'Sell'} limit order posted · fills when the AMM output reaches ${formatUnits(limitMinOut, side === 'buy' ? decimals : 18, 6)} ${side === 'buy' ? baseToken.symbol : 'ASE'}`,
      );
      setLimitAmount('');
      ownOrders.refresh();
      poolOrders.refresh();
    } catch (err) {
      setLimitError(limitOrderError(err));
    } finally {
      setLimitBusy(false);
      setStage('');
    }
  };

  const cancel = async (orderId: string) => {
    setCancelBusy(orderId);
    setLimitError('');
    setLimitNotice('');
    try {
      const hash = await cancelLimitOrder(client, orderId);
      setLastTx(hash);
      const receipt = await client.waitReceipt(hash, 120_000);
      if (!receipt.success) throw new Error('The cancel reverted on chain.');
      setLimitNotice(`Order #${orderId} cancelled and its escrow refunded.`);
      ownOrders.refresh();
      poolOrders.refresh();
      balances.refresh();
    } catch (err) {
      setLimitError(limitOrderError(err));
    } finally {
      setCancelBusy('');
    }
  };

  const changePair = (poolKey: string) => {
    const next = new URLSearchParams(params);
    next.set('pool', poolKey);
    setParams(next, { replace: true });
  };

  const setMax = () => {
    // Leave a small ASE reserve so the swap can still pay for gas.
    const usable = side === 'buy' && walletBalance > 50_000_000_000_000_000n
      ? walletBalance - 50_000_000_000_000_000n
      : walletBalance;
    if (usable <= 0n) return;
    const dec = side === 'buy' ? 18 : decimals;
    const scale = 10n ** BigInt(dec);
    const whole = usable / scale;
    const frac = (usable % scale).toString().padStart(dec, '0').slice(0, 8).replace(/0+$/, '');
    setAmount(`${whole}${frac ? `.${frac}` : ''}`);
  };

  const perps = perpsIntegration();
  // Carry the exact selected on-chain pool into the bot builder. The indexer
  // pool key is not the contract pool id; Deploy expects chainPoolId.
  const botUrl = (template: string, interval: number, pro = false) => {
    const query = new URLSearchParams({
      template,
      interval: String(interval),
      mode: pro ? 'pro' : 'lite',
    });
    if (pair?.chainPoolId) query.set('pool', pair.chainPoolId);
    query.set('chartTf', timeframe);
    if (pair?.dex === 'asedex') query.set('venue', 'asepad');
    return `/deploy?${query.toString()}`;
  };
  const book = poolOrders.data?.orders ?? [];
  const bids = book.filter((order) => orderSide(order) === 'buy').sort((a, b) => orderPrice(b, decimals) - orderPrice(a, decimals));
  const asks = book.filter((order) => orderSide(order) === 'sell').sort((a, b) => orderPrice(a, decimals) - orderPrice(b, decimals));
  const myOpen = (ownOrders.data ?? []).filter((order) => order.status === 'open');
  const insufficient = amountIn > 0n && amountIn > walletBalance;
  // Do not gate execution on the debounced preview quote. The click handler
  // obtains a fresh on-chain quote itself and reports the exact failure inline.
  const canTrade = Boolean(wallet.connected && baseToken && amountIn > 0n && !insufficient && !busy);
  const change = market?.change24;

  return (
    <>
      <section className="wrap detail-head advanced-head">
        <div>
          <span className="label">Advanced Trading · Asentum testnet</span>
          <h1 className="detail-title">Trade the live AMM.</h1>
          <p className="section-note" style={{ maxWidth: 660, marginTop: 16 }}>
            Real indexed candles, an on-chain quote for every market order, and escrowed limit orders on the Auras
            v2 AMM. Strata has no order-book venue connected; this screen uses AMM execution only.
          </p>
        </div>
        <div className="advanced-head-actions">
          <Link className="btn btn-ghost btn-sm" to="/swap">Simple swap</Link>
          <Link className="btn btn-primary btn-sm" to="/deploy">Automate this pair</Link>
        </div>
      </section>

      <section className="wrap">
        <div className="advanced-flow">
          <div className="advanced-flow-item">
            <span className="label">1 · Analyse</span>
            <strong>Read the candles</strong>
            <p>Pick 1m, 5m, 15m, 1h or 1d. Candles are built from indexed Swap events, so a quiet market shows gaps, not invented prices.</p>
          </div>
          <div className="advanced-flow-item">
            <span className="label">2 · Execute</span>
            <strong>Place the order</strong>
            <p>A market order swaps against the AMM right away. A limit order is escrowed on-chain and fills only when the pool can pay its minimum.</p>
          </div>
          <div className="advanced-flow-item">
            <span className="label">3 · Automate</span>
            <strong>Hand it to a bot</strong>
            <p>DCA, grid, TWAP, take-profit and stop-loss run as contracts on the Asentum Cron. Same pair, no tab needed.</p>
            <Link className="home-text-link" to={botUrl('dca', 3600)}>Create a bot for this market →</Link>
          </div>
        </div>
      </section>

      <section className="wrap advanced-page">
        <div className="advanced-toolbar">
          <div className="pair-select">
            <span className="label">Market</span>
            <select
              value={pair?.poolKey ?? ''}
              onChange={(event) => changePair(event.target.value)}
              aria-label="Select trading pair"
              className="input"
            >
              {pairs.length === 0 && <option value="">No ASE pairs indexed</option>}
              {pairs.map((item) => {
                const view = marketFor(item);
                const volume = view?.volume24Ase;
                return (
                  <option key={item.poolKey} value={item.poolKey}>
                    {view?.symbol ?? item.base}/ASE · {item.dex === 'asedex' ? 'AseDex' : `Auras v${item.version ?? 2}`}
                    {volume ? ` · ${fmtNum(Math.round(volume))} ASE 24h` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <dl className="advanced-market-stats">
            <div>
              <dt>Price</dt>
              <dd className="mono">{priceFmt(market?.priceAse)} ASE</dd>
            </div>
            <div>
              <dt>24h</dt>
              <dd className={`mono ${change === null || change === undefined ? '' : change >= 0 ? 'up' : 'down'}`}>
                {change === null || change === undefined ? '—' : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`}
              </dd>
            </div>
            <div>
              <dt>24h volume</dt>
              <dd className="mono">{market?.volume24Ase ? `${fmtNum(Math.round(market.volume24Ase))} ASE` : '—'}</dd>
            </div>
            <div>
              <dt>Liquidity</dt>
              <dd className="mono">{pair?.tvlQuote ? `${fmtNum(Math.round(pair.tvlQuote))} ASE` : '—'}</dd>
            </div>
            <div>
              <dt>Fee</dt>
              <dd className="mono">{((pairState.data?.feeBps ?? pair?.feeBps ?? 30) / 100).toFixed(2)}%</dd>
            </div>
          </dl>
        </div>

        {pairState.error && (
          <p className="swap-note down">Pool state could not be read: {pairState.error}. Market orders stay disabled until it loads.</p>
        )}
        {pairState.loading && !pairState.data && !pairState.error && (
          <p className="field-help">Reading reserves and token decimals from the pool…</p>
        )}

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
                  {tf.seconds === 1800 ? '2×15m aggregated' : tf.seconds === 604800 ? '7×1d aggregated' : 'Auras indexer'}
                </span>
              </div>
              <CandleChart
                candles={candles.data ?? []}
                intervalSec={tf.seconds}
                symbol={token?.symbol ?? '—'}
                loading={candles.loading}
                error={candles.error}
              />
              <p className="advanced-chart-note">
                Candles come from indexed Swap events. Empty buckets are omitted, not filled with a synthetic price.
                Scroll to zoom and drag to pan.
              </p>
            </div>

            <div className="advanced-lower-grid">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="label">Market trades</span>
                    <p className="muted">Latest indexed fills for this pool</p>
                  </div>
                  <button type="button" className="chip" onClick={() => trades.refresh()}>Refresh</button>
                </div>
                <div className="table-scroll advanced-trades">
                  <table className="leaderboard-table">
                    <thead>
                      <tr><th>Time</th><th>Side</th><th>Price</th><th>Size</th><th>Tx</th></tr>
                    </thead>
                    <tbody>
                      {(trades.data ?? []).map((trade) => (
                        <tr key={trade.txHash}>
                          <td className="mono dim">{fmtTimestamp(trade.timestamp)}</td>
                          <td>
                            <span className={trade.side === 'buy' ? 'exec-side is-buy' : 'exec-side is-sell'}>
                              {trade.side === 'buy' ? 'BUY' : 'SELL'}
                            </span>
                          </td>
                          <td className="mono">{priceFmt(trade.price)}</td>
                          <td className="mono">{fmtNum(Number(trade.sizeQuote.toFixed(3)))} ASE</td>
                          <td>
                            <a className="link-arrow mono" href={explorerTxUrl(trade.txHash)} target="_blank" rel="noreferrer">
                              {shortHash(trade.txHash)}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(trades.data ?? []).length === 0 && (
                    <p className="muted advanced-empty">
                      {trades.loading ? 'Reading the trade tape…' : trades.error ?? 'No indexed fills for this pool yet.'}
                    </p>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <div>
                    <span className="label">Open AMM limit orders</span>
                    <p className="muted">Escrowed orders on Auras v2 · executed against pool liquidity</p>
                  </div>
                </div>
                <div className="order-book">
                  <div className="order-book-side">
                    <span className="label">Open buys · paying ASE</span>
                    {bids.slice(0, 6).map((order) => (
                      <div className="order-book-row" key={order.id}>
                        <span className="mono up">{priceFmt(orderPrice(order, decimals))}</span>
                        <span className="mono">{weiToAse(order.amountIn, 2)} ASE</span>
                      </div>
                    ))}
                    {!limitEnabled && <p className="muted advanced-empty">No limit-order module on this AMM.</p>}
                    {limitEnabled && bids.length === 0 && <p className="muted advanced-empty">No open bids.</p>}
                  </div>
                  <div className="order-book-side">
                    <span className="label">Open sells · {token?.symbol}</span>
                    {asks.slice(0, 6).map((order) => (
                      <div className="order-book-row" key={order.id}>
                        <span className="mono down">{priceFmt(orderPrice(order, decimals))}</span>
                        <span className="mono">{formatUnits(order.amountIn, decimals, 2)} {token?.symbol}</span>
                      </div>
                    ))}
                    {!limitEnabled && <p className="muted advanced-empty">No limit-order module on this AMM.</p>}
                    {limitEnabled && asks.length === 0 && <p className="muted advanced-empty">No open asks.</p>}
                  </div>
                </div>
                <p className="advanced-book-note">
                  {!limitEnabled
                    ? 'This market supports AMM swaps only; limit orders exist only on Auras v2 pools.'
                    : poolOrders.data
                      ? `${poolOrders.data.orders.length} matching open orders in the first ${Math.min(100, poolOrders.data.total)} of ${poolOrders.data.total} on-chain ids${poolOrders.data.truncated ? ' · more exist than this page shows' : ''}.`
                      : 'Reading open orders…'}
                  {limitEnabled && ' There is no matching engine: each order fills only when the AMM can pay its minimum.'}
                </p>
              </div>
            </div>
          </div>

          <aside className="advanced-order-col">
            <div className="panel advanced-ticket">
              {orderKind !== 'bot' && (
                <div className="advanced-side-switch" role="group" aria-label="Order side">
                  <button type="button" className={side === 'buy' ? 'active buy' : ''} onClick={() => setSide('buy')}>Buy</button>
                  <button type="button" className={side === 'sell' ? 'active sell' : ''} onClick={() => setSide('sell')}>Sell</button>
                </div>
              )}

              <div className="advanced-kind-switch" role="tablist" aria-label="Spot execution type">
                <button type="button" className={orderKind === 'market' ? 'active' : ''} onClick={() => setOrderKind('market')}>Market</button>
                <button
                  type="button"
                  className={orderKind === 'limit' && limitEnabled ? 'active' : ''}
                  onClick={() => limitEnabled && setOrderKind('limit')}
                  disabled={!limitEnabled}
                  title={limitEnabled ? undefined : 'Limit orders exist only on Auras v2 pools'}
                >
                  Limit
                </button>
                <button type="button" className={orderKind === 'bot' ? 'active' : ''} onClick={() => setOrderKind('bot')}>Spot bot</button>
              </div>
              {!limitEnabled && orderKind === 'limit' && (
                <p className="field-help">Limit orders are available only on Auras v2 pools. This market supports AMM swaps only.</p>
              )}

              {orderKind === 'bot' ? (
                <div className="advanced-bot-panel">
                  <span className="label">Automate {token?.symbol ?? 'this token'} / ASE</span>
                  <p className="field-help">Choose a Spot strategy for this pool. It runs without leverage through Asentum Cron; the selected pool and venue will be carried into the bot builder.</p>
                  <div className="advanced-bot-quick">
                    {STRATEGY_PRESETS.map((preset) => (
                      <Link key={preset.template} to={botUrl(preset.template, preset.interval, preset.pro)} className="advanced-strategy-row">
                        <span><strong>{preset.name}</strong><small>{preset.text}</small><small className="mono">Default execution: {preset.interval >= 3600 ? `${preset.interval / 3600}h` : `${preset.interval / 60}m`}</small></span>
                        <span aria-hidden="true">→</span>
                      </Link>
                    ))}
                  </div>
                  <div className="advanced-bot-context">
                    <strong>Chart: {tf.label}</strong>
                    <span>Execution interval is configured separately in the bot builder. The on-chain strategy uses its own pool-price/TWAP checks; chart candles are for your analysis and are not sent to the contract.</span>
                  </div>
                  <Link className="btn btn-primary swap-action" to={botUrl('dca', 300)}>Create a 5-minute bot for this pair →</Link>
                </div>
              ) : orderKind === 'market' ? (
                <>
                  <label className="field">
                    <span>Amount {side === 'buy' ? 'ASE' : token?.symbol}</span>
                    <div className="advanced-amount-row">
                      <input
                        className="input"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                        inputMode="decimal"
                        placeholder="0.0"
                      />
                      <button type="button" className="chip" onClick={setMax}>MAX</button>
                    </div>
                  </label>
                  <p className="field-help mono">
                    Balance {formatUnits(walletBalance, side === 'buy' ? 18 : decimals, 5)} {side === 'buy' ? 'ASE' : token?.symbol}
                  </p>

                  <dl className="swap-details advanced-quote">
                    <div>
                      <dt>Receive (est.)</dt>
                      <dd className="mono">
                        {quoting ? '…' : quote && tokenOut ? `${formatUnits(quote.amountOut, tokenOut.decimals, 6)} ${tokenOut.symbol}` : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Minimum received</dt>
                      <dd className="mono">{quote && tokenOut ? `${formatUnits(quote.minOut, tokenOut.decimals, 6)} ${tokenOut.symbol}` : '—'}</dd>
                    </div>
                    <div>
                      <dt>Price impact</dt>
                      <dd className="mono">{quote ? `${quote.priceImpactPct.toFixed(2)}%` : '—'}</dd>
                    </div>
                  </dl>

                  <div className="swap-slippage">
                    <span className="label">Slippage</span>
                    <div className="swap-slippage-opts">
                      {SLIPPAGE_PRESETS.map((bps) => (
                        <button
                          key={bps}
                          type="button"
                          className={slippageBps === bps ? 'chip-btn active' : 'chip-btn'}
                          onClick={() => setSlippageBps(bps)}
                        >
                          {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className={canTrade ? 'btn btn-primary swap-action' : 'btn btn-ghost swap-action'}
                    disabled={busy || (wallet.connected && (!baseToken || amountIn <= 0n || insufficient))}
                    onClick={runMarketOrder}
                  >
                    {busy ? stage || 'Working…' : !wallet.connected ? 'Connect wallet'
                      : insufficient ? 'Insufficient balance'
                        : amountIn <= 0n ? 'Enter an amount'
                          : `${side === 'buy' ? 'Buy' : 'Sell'} ${token?.symbol ?? ''} on the AMM`}
                  </button>
                  {quoteError && <p className="swap-note down">Preview quote unavailable: {quoteError}. You can retry the on-chain quote by pressing the trade button.</p>}
                  {!pairState.data && <p className="field-help">{pairState.loading ? 'Loading the selected pool from Asentum…' : pairState.error || 'Waiting for the selected pool state.'}</p>}
                  {wallet.connected && amountIn > 0n && !quote && !quoting && !quoteError && <p className="field-help">Waiting for a live quote from the selected AMM contract. Trading stays disabled until a valid quote is available.</p>}
                  <p className="field-help">
                    Market orders are AMM swaps with an on-chain minimum-output guard. They are not limit orders.
                  </p>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Target price · ASE per {token?.symbol}</span>
                    <input
                      className="input"
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(event.target.value.replace(/[^\d.]/g, ''))}
                      inputMode="decimal"
                      placeholder={market?.priceAse ? String(market.priceAse) : '0.0'}
                    />
                  </label>
                  <label className="field">
                    <span>Amount {side === 'buy' ? 'ASE' : token?.symbol}</span>
                    <div className="advanced-amount-row">
                      <input
                        className="input"
                        value={limitAmount}
                        onChange={(event) => setLimitAmount(event.target.value.replace(/[^\d.]/g, ''))}
                        inputMode="decimal"
                        placeholder="0.0"
                      />
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          if (walletBalance <= 0n) return;
                          const dec = side === 'buy' ? 18 : decimals;
                          const scale = 10n ** BigInt(dec);
                          const whole = walletBalance / scale;
                          const frac = (walletBalance % scale).toString().padStart(dec, '0').slice(0, 8).replace(/0+$/, '');
                          setLimitAmount(`${whole}${frac ? `.${frac}` : ''}`);
                        }}
                      >
                        MAX
                      </button>
                    </div>
                  </label>
                  <label className="field">
                    <span>Expires</span>
                    <select className="input" value={limitTtl} onChange={(event) => setLimitTtl(Number(event.target.value))}>
                      {TTL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  <dl className="swap-details advanced-quote">
                    <div>
                      <dt>Order value</dt>
                      <dd className="mono">{limitAmountRaw > 0n ? `${weiToAse(limitValueAse, 4)} ASE` : '—'}</dd>
                    </div>
                    <div>
                      <dt>Minimum output</dt>
                      <dd className="mono">
                        {limitMinOut > 0n
                          ? `${formatUnits(limitMinOut, side === 'buy' ? decimals : 18, 6)} ${side === 'buy' ? token?.symbol : 'ASE'}`
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>Contract minimum</dt>
                      <dd className="mono">0.1 ASE · {config.data?.maxOpenPerWallet ?? 10} open max</dd>
                    </div>
                  </dl>

                  <button
                    type="button"
                    className={wallet.connected && !limitBusy && !belowMinimum && limitMinOut > 0n ? 'btn btn-primary swap-action' : 'btn btn-ghost swap-action'}
                    disabled={limitBusy || (wallet.connected && (limitMinOut <= 0n || belowMinimum))}
                    onClick={submitLimitOrder}
                  >
                    {limitBusy ? stage || 'Working…' : !wallet.connected ? 'Connect wallet'
                      : belowMinimum ? 'Below 0.1 ASE minimum'
                        : limitMinOut <= 0n ? 'Enter a price and amount'
                          : `Post ${side} limit`}
                  </button>
                  {limitError && <p className="swap-note down">{limitError}</p>}
                  {limitNotice && <p className="swap-note up">{limitNotice}</p>}
                  <p className="field-help">
                    The input is escrowed in the Auras contract. It fills automatically when the pool output clears
                    your minimum, and expires at the selected time. Not a resting order in a matching book.
                  </p>
                </>
              )}

              {notice && <p className="swap-note up">{notice}</p>}
              {error && <p className="swap-note down">{error}</p>}
              {lastTx && (
                <p className="swap-note mono">
                  Transaction{' '}
                  <a className="link-arrow" href={explorerTxUrl(lastTx)} target="_blank" rel="noreferrer">
                    {shortHash(lastTx)} ↗
                  </a>
                </p>
              )}
            </div>

            <div className="panel advanced-orders">
              <div className="panel-head">
                <div>
                  <span className="label">Your open orders</span>
                  <p className="muted">Read from the Auras contract</p>
                </div>
                <button type="button" className="chip" onClick={() => ownOrders.refresh()}>Refresh</button>
              </div>
              {!limitEnabled && <p className="muted advanced-empty">This market has no limit-order module; use Market orders.</p>}
              {limitEnabled && !wallet.connected && <p className="muted advanced-empty">Connect a wallet to see its limit orders.</p>}
              {limitEnabled && wallet.connected && myOpen.length === 0 && (
                <p className="muted advanced-empty">
                  {ownOrders.loading ? 'Reading orders…' : 'No open limit orders for this wallet.'}
                </p>
              )}
              {myOpen.map((order) => (
                <div className="advanced-order-row" key={order.id}>
                  <div>
                    <span className={orderSide(order) === 'buy' ? 'exec-side is-buy' : 'exec-side is-sell'}>
                      {orderSide(order) === 'buy' ? 'BUY' : 'SELL'}
                    </span>
                    <strong className="mono"> #{order.id}</strong>
                    <span className="mono muted"> · pool {order.poolId}</span>
                  </div>
                  <div className="mono advanced-order-meta">
                    {orderSide(order) === 'buy'
                      ? `${weiToAse(order.amountIn, 4)} ASE → min ${formatUnits(order.minOut, decimals, 4)} tokens`
                      : `${formatUnits(order.amountIn, decimals, 4)} tokens → min ${weiToAse(order.minOut, 4)} ASE`}
                  </div>
                  <div className="advanced-order-foot">
                    <span className="mono muted">expires {fmtTimestamp(Number(order.expiresAt))}</span>
                    <button
                      type="button"
                      className="chip"
                      disabled={cancelBusy === order.id}
                      onClick={() => void cancel(order.id)}
                    >
                      {cancelBusy === order.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="panel advanced-strategy">
              <div className="panel-head">
                <div>
                  <span className="label">Spot bots · on-chain strategies</span>
                  <p className="muted">Runs on Asentum Cron · minimum interval 60s · no leverage</p>
                </div>
              </div>
              <div className="advanced-strategy-list">
                {STRATEGY_PRESETS.map((preset) => (
                  <Link key={preset.template} to={botUrl(preset.template, preset.interval, preset.pro)} className="advanced-strategy-row">
                    <span>
                      <strong>{preset.name}</strong>
                      <small>{preset.text}</small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
              <p className="field-help">
                Chart timeframe and bot execution are separate. Contracts read the pool/TWAP state when Cron fires; they do not receive chart candles. Cron's supported interval is 60–86,400 seconds, subject to the strategy contract and funded escrow.
              </p>
              <div className="advanced-strategy-foot">
                <Link className="btn btn-primary btn-sm" to={botUrl('dca', 3600)}>
                  Build a bot for this pair →
                </Link>
              </div>
            </div>

            <div className="panel advanced-perps">
              <div className="panel-head">
                <div>
                  <span className="label">Perps · separate derivatives market</span>
                  <p className="muted">Long / short · leverage · margin · liquidation</p>
                </div>
                <span className="status-badge off">Not connected</span>
              </div>
              <p className="advanced-perps-copy">{perps.reason} Spot bots are not Perps: they trade the underlying AMM pool without leverage or short positions.</p>
              <div className="advanced-perps-actions">
                <button type="button" className="btn btn-ghost btn-sm" disabled title={perps.reason}>Long</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled title={perps.reason}>Short</button>
              </div>
              <p className="field-help">
                Spot swaps are never shown as perp positions, leverage or liquidation. The adapter in
                <code> src/lib/perps.ts</code> is ready for a published venue.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

export default AdvancedTrading;
