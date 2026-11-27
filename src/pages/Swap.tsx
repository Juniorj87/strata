import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsentum, useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { CHAIN_ID, NETWORK } from '../lib/network';
import { loadAseDexPools, loadPools } from '../lib/registry';
import { explorerTxUrl, getHeads, toHexAddress } from '../lib/rpc';
import { fetchUserTokenHoldings, type UserTokenHolding } from '../lib/userStrategies';
import { fmtNum, fmtTimestamp, formatUnits, parseUnits, shortHash } from '../lib/format';
import {
  ASE_TOKEN,
  swapTokens,
  type SwapToken,
} from '../lib/swap';
import {
  executeRoute,
  findRoute,
  routeLabel,
  type RouteQuote,
} from '../lib/router';
import { reconcileSwaps, saveSwap, type SwapHistoryRecord } from '../lib/swapHistory';
import { TokenMark } from '../components/TokenMark';
import { InfoTip } from '../components/InfoTip';

const SLIPPAGE_KEY = 'strata:slippage-bps';
const SLIPPAGE_PRESETS = [10, 50, 100];

function readSlippage(): number {
  try {
    const saved = Number(window.localStorage.getItem(SLIPPAGE_KEY));
    return Number.isFinite(saved) && saved >= 1 && saved <= 5000 ? saved : 50;
  } catch {
    return 50;
  }
}

function balanceOf(holdings: UserTokenHolding[], token: SwapToken): bigint {
  if (token.isNative) {
    const native = holdings.find((item) => item.isNative);
    return native ? BigInt(native.balanceRaw) : 0n;
  }
  const match = holdings.find((item) => item.token.toLowerCase() === token.address.toLowerCase());
  return match ? BigInt(match.balanceRaw) : 0n;
}

function TokenPicker({
  open,
  title,
  tokens,
  holdings,
  exclude,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  tokens: SwapToken[];
  holdings: UserTokenHolding[];
  exclude?: string;
  onSelect: (token: SwapToken) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const term = query.trim().toLowerCase();
  const visible = tokens
    .filter((token) => token.address.toLowerCase() !== (exclude ?? '').toLowerCase())
    .filter((token) => !term
      || token.symbol.toLowerCase().includes(term)
      || token.name.toLowerCase().includes(term)
      || token.address.toLowerCase().includes(term))
    .slice(0, 60);

  return (
    <div className="swap-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="swap-modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="swap-modal-head">
          <span className="label">{title}</span>
          <button type="button" className="swap-modal-close" onClick={onClose} aria-label="Close token list">
            ✕
          </button>
        </div>
        <input
          ref={inputRef}
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by symbol or contract address"
          aria-label="Search tokens"
        />
        <div className="swap-token-list">
          {visible.length === 0 && (
            <p className="muted swap-picker-empty">No live pool matches that search.</p>
          )}
          {visible.map((token) => {
            const raw = balanceOf(holdings, token);
            return (
              <button
                type="button"
                className="swap-token-row"
                key={`${token.venue}-${token.address}`}
                onClick={() => onSelect(token)}
              >
                <TokenMark symbol={token.symbol} isNative={token.isNative} />
                <span className="swap-token-row-main">
                  <strong>{token.symbol}</strong>
                  <small className="mono">
                    {token.isNative ? 'native ASE' : `${shortHash(token.address)} · ${token.venue === 'asedex' ? 'AseDex' : 'Auras'}`}
                  </small>
                </span>
                <span className="swap-token-row-balance mono">
                  {formatUnits(raw, token.decimals, 4)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="muted swap-picker-note">
          Every token here comes from a live pool read on chain. The router compares both AMMs automatically.
        </p>
      </div>
    </div>
  );
}

export function Swap() {
  const wallet = useWallet();
  const client = useAsentum();
  const pools = useAsync(() => loadPools(), 60_000);
  const asedexPools = useAsync(() => loadAseDexPools(), 60_000);
  const heads = useAsync(() => getHeads(), 15_000);

  const universe = useMemo(
    () => swapTokens(pools.data ?? [], asedexPools.data ?? []),
    [pools.data, asedexPools.data],
  );
  const allTokens = useMemo(() => [...universe.ase, ...universe.tokens], [universe]);
  // The router needs one entry per venue, but the picker should show a token
  // once. Showing Auras and AseDex rows for the same asset only confused the
  // choice; the winning venue is shown in the route panel instead.
  const pickerTokens = useMemo(() => {
    const seen = new Set<string>();
    const out: SwapToken[] = [];
    for (const token of allTokens) {
      const key = token.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(token);
    }
    return out;
  }, [allTokens]);

  const [tokenIn, setTokenIn] = useState<SwapToken>(ASE_TOKEN);
  const [tokenOut, setTokenOut] = useState<SwapToken | null>(null);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(readSlippage);
  const [picker, setPicker] = useState<'in' | 'out' | null>(null);
  const [holdings, setHoldings] = useState<UserTokenHolding[]>([]);
  const [route, setRoute] = useState<RouteQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteStale, setQuoteStale] = useState(false);
  const [quoteTick, setQuoteTick] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [txHash, setTxHash] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<SwapHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const quoteRequest = useRef(0);

  // Keep the two sides distinct. Any token can now be swapped for any other
  // token; when both tokens match, the receive side moves to another asset.
  useEffect(() => {
    if (!pools.data && !asedexPools.data) return;
    if (!tokenOut || tokenOut.address.toLowerCase() === tokenIn.address.toLowerCase()) {
      setTokenOut(tokenIn.isNative ? (universe.tokens[0] ?? null) : ASE_TOKEN);
    }
  }, [pools.data, asedexPools.data, universe.tokens, tokenOut, tokenIn]);

  useEffect(() => {
    if (!wallet.connected || !wallet.address) {
      setHoldings([]);
      return;
    }
    let active = true;
    const all = [...(pools.data ?? []), ...(asedexPools.data ?? [])];
    if (all.length === 0) return;
    fetchUserTokenHoldings(wallet.address, all, wallet.ase1Address)
      .then((items) => { if (active) setHoldings(items); })
      .catch(() => { /* balances stay at the last known value */ });
    return () => { active = false; };
  }, [wallet.connected, wallet.address, wallet.ase1Address, pools.data, asedexPools.data]);

  const loadHistory = useMemo(
    () => async () => {
      if (!wallet.address) {
        setHistory([]);
        return;
      }
      setHistoryLoading(true);
      try {
        setHistory(await reconcileSwaps(wallet.address));
      } finally {
        setHistoryLoading(false);
      }
    },
    [wallet.address],
  );

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const amountIn = useMemo(() => {
    try {
      return parseUnits(amount || '0', tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [amount, tokenIn.decimals]);

  const sameToken = Boolean(tokenOut && tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase());

  useEffect(() => {
    const request = ++quoteRequest.current;
    if (!tokenOut || amountIn <= 0n || sameToken) {
      setRoute(null);
      setQuoteError('');
      setQuoting(false);
      return;
    }
    setQuoting(true);
    const timer = window.setTimeout(() => {
      findRoute(tokenIn, tokenOut, amountIn, { tokens: universe.tokens, slippageBps })
        .then((next) => {
          if (quoteRequest.current !== request) return;
          setRoute(next);
          setQuoteStale(false);
          setQuoteError('');
        })
        .catch((err: unknown) => {
          if (quoteRequest.current !== request) return;
          const raw = err instanceof Error ? err.message : String(err);
          const transient = /non-JSON|busy|502|504|timed out|network|fetch|no response/i.test(raw);
          setQuoteError(transient
            ? 'The Asentum node is busy right now. The last quote is kept and a retry runs automatically.'
            : raw);
          setQuoteStale(true);
          if (transient) {
            window.setTimeout(() => {
              if (quoteRequest.current === request) setQuoteTick((value) => value + 1);
            }, 4000);
          }
        })
        .finally(() => {
          if (quoteRequest.current === request) setQuoting(false);
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [tokenIn, tokenOut, amountIn, slippageBps, universe.tokens, sameToken, quoteTick]);

  const walletBalanceIn = balanceOf(holdings, tokenIn);
  const insufficient = amountIn > 0n && amountIn > walletBalanceIn;
  const canSwap = Boolean(wallet.connected && tokenOut && route && amountIn > 0n && !insufficient && !busy && !sameToken);

  const setSlippage = (next: number) => {
    const clamped = Math.min(5000, Math.max(1, Math.round(next)));
    setSlippageBps(clamped);
    try { window.localStorage.setItem(SLIPPAGE_KEY, String(clamped)); } catch { /* storage unavailable */ }
  };

  const resetQuote = () => {
    setRoute(null);
    setQuoteError('');
    setQuoteStale(false);
    setMessage('');
    setError('');
  };

  const flip = () => {
    if (!tokenOut) return;
    const nextIn = tokenOut;
    setTokenIn(nextIn);
    setTokenOut(tokenIn);
    setAmount('');
    resetQuote();
  };

  const pickToken = (token: SwapToken) => {
    if (picker === 'in') {
      if (tokenOut && tokenOut.address.toLowerCase() === token.address.toLowerCase()) setTokenOut(tokenIn);
      setTokenIn(token);
    } else {
      if (tokenIn.address.toLowerCase() === token.address.toLowerCase()) setTokenIn(tokenOut ?? ASE_TOKEN);
      setTokenOut(token);
    }
    setPicker(null);
    setAmount('');
    resetQuote();
  };

  const setPercent = (pct: number) => {
    if (walletBalanceIn <= 0n) return;
    const reserve = tokenIn.isNative && pct === 100 && walletBalanceIn > 50_000_000_000_000_000n
      ? 50_000_000_000_000_000n
      : 0n;
    const usable = walletBalanceIn > reserve ? walletBalanceIn - reserve : walletBalanceIn;
    const target = pct === 100 ? usable : (usable * BigInt(pct)) / 100n;
    if (target <= 0n) return;
    const decimals = tokenIn.decimals;
    const scale = 10n ** BigInt(decimals);
    const whole = target / scale;
    const fraction = (target % scale).toString().padStart(decimals, '0').slice(0, 8).replace(/0+$/, '');
    setAmount(`${whole}${fraction ? `.${fraction}` : ''}`);
  };

  const runSwap = async () => {
    if (!wallet.connected || !wallet.address || !tokenOut) return;
    setBusy(true);
    setError('');
    setMessage('');
    setTxHash('');
    try {
      const ownerHex = toHexAddress(wallet.address);
      setStage('Refreshing the best route…');
      // Route and guard are re-read immediately before signing.
      const fresh = await findRoute(tokenIn, tokenOut, amountIn, { tokens: universe.tokens, slippageBps });
      if (fresh.minOut <= 0n) throw new Error('The fresh quote returned a zero minimum. Reduce the amount and try again.');

      const result = await executeRoute({
        client,
        ownerHex,
        route: fresh,
        tokens: universe.tokens,
        slippageBps,
        onStage: setStage,
      });
      const owner = wallet.address;
      setTxHash(result.hashes[result.hashes.length - 1] ?? '');
      setStage('Recording the swap…');

      // One history row per on-chain leg, so a routed swap is fully traceable.
      fresh.legs.forEach((leg, index) => {
        const hash = result.hashes[index];
        if (!hash) return;
        const executed = result.legs[index];
        const received = executed?.received ?? leg.quote.amountOut;
        const spent = executed?.amountIn ?? leg.quote.amountIn;
        saveSwap(owner, {
          hash,
          approvalHash: result.legs[index]?.approvalHash,
          wallet: owner,
          timestamp: Date.now(),
          poolId: executed?.poolId ?? leg.pool.poolId,
          venue: executed?.venue ?? leg.pool.venue,
          tokenIn: { address: leg.tokenIn.address, symbol: leg.tokenIn.symbol, decimals: leg.tokenIn.decimals },
          tokenOut: { address: leg.tokenOut.address, symbol: leg.tokenOut.symbol, decimals: leg.tokenOut.decimals },
          amountIn: spent.toString(),
          quotedOut: leg.quote.amountOut.toString(),
          minOut: leg.quote.minOut.toString(),
          status: 'confirmed',
          amountOut: received.toString(),
        });
      });

      const received = result.received ?? fresh.amountOut;
      setMessage(
        `${formatUnits(received, tokenOut.decimals, 6)} ${tokenOut.symbol} received${
          fresh.legs.length > 1 ? ` · routed via ${routeLabel(fresh)}` : ''
        }`,
      );
      setStage('');
      setAmount('');
      setRoute(null);
      pools.refresh();
      asedexPools.refresh();
      if (wallet.address) {
        const all = [...(pools.data ?? []), ...(asedexPools.data ?? [])];
        fetchUserTokenHoldings(wallet.address, all, wallet.ase1Address)
          .then(setHoldings)
          .catch(() => { /* balances refresh on the next poll */ });
        setHistory(await reconcileSwaps(wallet.address));
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const friendly = /reject|denied|cancel|declin/i.test(raw)
        ? 'The wallet rejected the transaction. Nothing was sent.'
        : /insufficient|balance/i.test(raw)
          ? 'Insufficient balance for this swap.'
          : /non-JSON|busy|502|504|timed out|network|fetch|no response/i.test(raw)
            ? 'The Asentum node did not answer the quote. Nothing was signed — try again in a moment.'
            : raw;
      setError(friendly);
      if (txHash && wallet.address) {
        void reconcileSwaps(wallet.address).then(setHistory).catch(() => {});
      }
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const actionLabel = (() => {
    if (!wallet.connected) return 'Connect wallet';
    if (!tokenOut) return 'Choose a token';
    if (sameToken) return 'Choose a different pair';
    if (!amount || amountIn <= 0n) return 'Enter an amount';
    if (quoting) return 'Finding the best route…';
    if (insufficient) return `Insufficient ${tokenIn.symbol}`;
    if (quoteError && !route) return 'No route for this pair';
    if (busy) return stage || 'Working…';
    return `Swap ${tokenIn.symbol} for ${tokenOut.symbol}`;
  })();

  const onAction = () => {
    if (!wallet.connected) {
      wallet.openConnect();
      return;
    }
    if (canSwap) void runSwap();
  };

  const heldTokens = holdings.filter((holding) => !holding.isNative && holding.balanceNum > 0);
  const rate = route && tokenOut
    ? Number(formatUnits(route.amountOut, tokenOut.decimals, 8).replace(/,/g, ''))
      / Math.max(1e-18, Number(formatUnits(route.amountIn, tokenIn.decimals, 8).replace(/,/g, '')))
    : null;

  return (
    <>
      <section className="wrap detail-head swap-head">
        <div className="advanced-head">
          <div>
            <span className="label">Swap · {NETWORK.shortLabel}</span>
            <h1 className="detail-title">Swap at the best price.</h1>
            <p className="section-note" style={{ marginTop: 8 }}>
              Automatic best-price routing across Auras and AseDex pools.
              <InfoTip
                label="How routing works"
                text="Strata quotes every live pool on Auras and AseDex and executes whichever route pays the most. Token-to-token pairs route through ASE automatically."
              />
            </p>
            <div className="meta-strip">
              <span className="meta-strip-item">Network <strong>Asentum · {CHAIN_ID}</strong></span>
              <span className="meta-strip-item">Block <strong className="mono">{heads.data ? heads.data.finalized.toLocaleString('en-US') : '—'}</strong></span>
              <span className="meta-strip-item">Live pools <strong className="mono">{fmtNum((pools.data?.length ?? 0) + (asedexPools.data?.length ?? 0))}</strong></span>
            </div>
          </div>
          <div className="advanced-head-actions">
            <Link className="btn btn-ghost btn-sm" to="/advanced">
              Charts &amp; limit orders →
            </Link>
            <Link className="btn btn-primary btn-sm" to="/deploy">
              Automate with a bot
            </Link>
          </div>
        </div>
      </section>

      <section className="wrap swap-page">
        <div className="swap-layout">
          <div className="swap-column">
            <div className="swap-frame">
              <div className="swap-frame-head">
                <span className="label">Spot Swap</span>
                <div className="swap-frame-tools">
                  <span className="mono swap-venue-tag">{route ? routeLabel(route) : 'Auto route'}</span>
                  {route && (
                    <span className="mono swap-fee-tag">
                      {`${route.legs.length} hop${route.legs.length > 1 ? 's' : ''}`}
                    </span>
                  )}
                </div>
              </div>

              <div className="swap-side">
                <div className="swap-side-head">
                  <span>You pay</span>
                  <span className="swap-balance">
                    Balance {formatUnits(walletBalanceIn, tokenIn.decimals, 4)}
                    {wallet.connected && walletBalanceIn > 0n && (
                      <span className="pct-row" style={{ marginLeft: 8 }}>
                        {[25, 50, 75, 100].map((pct) => (
                          <button key={pct} type="button" className="pct-btn" onClick={() => setPercent(pct)}>
                            {pct === 100 ? 'MAX' : `${pct}%`}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                </div>
                <div className="swap-input-row">
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                    inputMode="decimal"
                    placeholder="0.0"
                    aria-label={`Amount of ${tokenIn.symbol} to pay`}
                  />
                  <button type="button" className="swap-token-btn" onClick={() => setPicker('in')}>
                    <TokenMark symbol={tokenIn.symbol} isNative={tokenIn.isNative} />
                    <strong>{tokenIn.symbol}</strong>
                    <span aria-hidden="true">▾</span>
                  </button>
                </div>
              </div>

              <div className="swap-flip-row">
                <button type="button" className="swap-flip" onClick={flip} aria-label="Switch swap direction">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />
                  </svg>
                </button>
              </div>

              <div className="swap-side swap-side-out">
                <div className="swap-side-head">
                  <span>You receive</span>
                  <span className="swap-balance">
                    Balance {tokenOut ? formatUnits(balanceOf(holdings, tokenOut), tokenOut.decimals, 4) : '—'}
                  </span>
                </div>
                <div className="swap-input-row">
                  <output className="swap-output mono">
                    {quoting && !route
                      ? '…'
                      : route && tokenOut
                        ? formatUnits(route.amountOut, tokenOut.decimals, 8)
                        : '0.0'}
                  </output>
                  <button
                    type="button"
                    className="swap-token-btn"
                    onClick={() => setPicker('out')}
                  >
                    {tokenOut
                      ? <><TokenMark symbol={tokenOut.symbol} isNative={tokenOut.isNative} /><strong>{tokenOut.symbol}</strong></>
                      : <strong>Choose</strong>}
                    <span aria-hidden="true">▾</span>
                  </button>
                </div>
                {route && tokenOut && (
                  <p className="swap-receive-note">
                    Best route: <strong>{routeLabel(route)}</strong>
                    {route.legs.length > 1 ? ' · via ASE' : ''}
                    {route.compared > 1 ? ` · compared ${route.compared} pools` : ''}
                  </p>
                )}
              </div>

              <dl className="swap-details">
                <div>
                  <dt>Rate</dt>
                  <dd className="mono">
                    {rate !== null && tokenOut
                      ? `1 ${tokenIn.symbol} = ${rate.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${tokenOut.symbol}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Minimum received</dt>
                  <dd className="mono">
                    {route && tokenOut ? `${formatUnits(route.minOut, tokenOut.decimals, 8)} ${tokenOut.symbol}` : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Price impact</dt>
                  <dd className={`mono ${route && route.priceImpactPct > 3 ? 'down' : route && route.priceImpactPct > 1 ? 'warn' : ''}`}>
                    {route ? `${route.priceImpactPct.toFixed(2)}%` : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Route</dt>
                  <dd className="mono">{route ? routeLabel(route) : 'Auto'}</dd>
                </div>
              </dl>

              <div className="swap-slippage">
                <span className="label">Slippage tolerance</span>
                <div className="swap-slippage-opts">
                  {SLIPPAGE_PRESETS.map((bps) => (
                    <button
                      key={bps}
                      type="button"
                      className={slippageBps === bps ? 'chip-btn active' : 'chip-btn'}
                      onClick={() => setSlippage(bps)}
                    >
                      {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
                    </button>
                  ))}
                  <label className="swap-slippage-custom">
                    <input
                      value={(slippageBps / 100).toString()}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) setSlippage(next * 100);
                      }}
                      inputMode="decimal"
                      aria-label="Custom slippage tolerance in percent"
                    />
                    <span>%</span>
                  </label>
                </div>
              </div>

              <button
                type="button"
                className={canSwap ? 'btn btn-primary swap-action' : 'btn btn-ghost swap-action'}
                disabled={busy || (wallet.connected && !canSwap)}
                onClick={onAction}
              >
                {actionLabel}
              </button>

              {quoteError && (
                <p className={quoteStale && route ? 'swap-note warn' : 'swap-note down'}>
                  {quoteError}
                </p>
              )}
              {route && quoteStale && (
                <p className="swap-note muted">
                  This is the last value the pools returned. Every leg is re-quoted before you sign.
                </p>
              )}
              {insufficient && !quoteError && (
                <p className="swap-note down">
                  You hold {formatUnits(walletBalanceIn, tokenIn.decimals, 4)} {tokenIn.symbol}. Reduce the amount or
                  add funds.
                </p>
              )}
              {slippageBps > 300 && (
                <p className="swap-note warn">High slippage: a 3%+ minimum-output gap can execute far from the quoted price.</p>
              )}
              {stage && <p className="swap-note">{stage}</p>}
              {message && <p className="swap-note up">{message}</p>}
              {error && (
                <div className="notice deploy-error" role="alert" style={{ marginTop: 12 }}>
                  <strong>Swap did not complete</strong>
                  <span>{error}</span>
                </div>
              )}
              {txHash && (
                <p className="swap-note mono">
                  Transaction{' '}
                  <a className="link-arrow" href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
                    {shortHash(txHash)} ↗
                  </a>
                </p>
              )}
            </div>

            <div className="swap-history">
              <div className="swap-history-head">
                <div>
                  <span className="label">Your swaps</span>
                  <p className="muted">Signed from this browser · confirmed against the chain</p>
                </div>
                <button type="button" className="chip" onClick={() => void loadHistory()} disabled={historyLoading}>
                  {historyLoading ? 'Checking…' : 'Refresh'}
                </button>
              </div>

              {!wallet.connected && (
                <p className="muted swap-history-empty">Connect a wallet to read its swap history.</p>
              )}
              {wallet.connected && history.length === 0 && !historyLoading && (
                <p className="muted swap-history-empty">
                  No swaps recorded yet. Completed swaps appear here with their transaction hash and status.
                </p>
              )}

              {history.length > 0 && (
                <div className="table-scroll">
                  <table className="leaderboard-table swap-history-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Sold</th>
                        <th>Bought</th>
                        <th>Rate</th>
                        <th>Status</th>
                        <th>Transaction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => {
                        const out = row.amountOut ?? row.quotedOut;
                        const inUnits = Number(formatUnits(row.amountIn, row.tokenIn.decimals, 6).replace(/,/g, ''));
                        const outUnits = Number(formatUnits(out, row.tokenOut.decimals, 6).replace(/,/g, ''));
                        return (
                          <tr key={row.hash}>
                            <td className="mono dim">{fmtTimestamp(row.timestamp)}</td>
                            <td>
                              <strong>{formatUnits(row.amountIn, row.tokenIn.decimals, 6)} {row.tokenIn.symbol}</strong>
                              <span className="mono muted" style={{ display: 'block', fontSize: 13 }}>
                                {row.venue === 'asedex' ? 'AseDex' : 'Auras'} · min {formatUnits(row.minOut, row.tokenOut.decimals, 6)}
                              </span>
                            </td>
                            <td>{formatUnits(out, row.tokenOut.decimals, 6)} {row.tokenOut.symbol}</td>
                            <td className="mono">
                              {inUnits > 0 ? (outUnits / inUnits).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'}
                            </td>
                            <td>
                              <span className={row.status === 'confirmed' ? 'status-badge live' : row.status === 'failed' ? 'status-badge off' : 'status-badge pending'}>
                                {row.status}
                              </span>
                            </td>
                            <td>
                              <a className="link-arrow mono" href={explorerTxUrl(row.hash)} target="_blank" rel="noreferrer">
                                {shortHash(row.hash)} ↗
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <aside className="swap-aside">
            <div className="swap-aside-block">
              <span className="label">Best route</span>
              {route ? (
                <div className="swap-route">
                  {route.legs.map((leg, index) => (
                    <div className="swap-route-hop" key={`${leg.pool.venue}-${leg.pool.poolId}-${index}`}>
                      <span className="swap-route-index mono">{index + 1}</span>
                      <div>
                        <strong>{leg.tokenIn.symbol} → {leg.tokenOut.symbol}</strong>
                        <span className="mono muted">
                          {leg.pool.venue === 'asedex' ? 'AseDex' : 'Auras'} · pool #{leg.pool.poolId} · {formatUnits(leg.quote.amountOut, leg.tokenOut.decimals, 6)} {leg.tokenOut.symbol}
                        </span>
                      </div>
                    </div>
                  ))}
                  {route.runnerUp && (
                    <p className="muted swap-aside-note">
                      Kept the better price; the other venue would have paid{' '}
                      {formatUnits(route.runnerUp.amountOut, route.legs[route.legs.length - 1].tokenOut.decimals, 6)}{' '}
                      {route.legs[route.legs.length - 1].tokenOut.symbol}.
                    </p>
                  )}
                </div>
              ) : (
                <p className="muted">Enter an amount to see the winning venue, pool and hops.</p>
              )}
            </div>

            {wallet.connected && heldTokens.length > 0 && (
              <div className="swap-aside-block">
                <span className="label">Swap from your wallet</span>
                <div className="swap-holdings">
                  {heldTokens.slice(0, 6).map((holding) => {
                    const token = universe.tokens.find((item) => item.address.toLowerCase() === holding.token.toLowerCase());
                    return (
                      <button
                        type="button"
                        key={holding.token}
                        className="swap-holding-row"
                        disabled={!token}
                        onClick={() => {
                          if (!token) return;
                          setTokenIn(token);
                          if (tokenOut?.address.toLowerCase() === token.address.toLowerCase()) setTokenOut(ASE_TOKEN);
                          setAmount('');
                          resetQuote();
                        }}
                      >
                        <span>{holding.symbol}</span>
                        <span className="mono">{holding.balanceFmt}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="muted swap-aside-note">
                  Tokens with a live ASE pool are selectable. Others need liquidity before they can be swapped here.
                </p>
              </div>
            )}

            <details className="soft-details">
              <summary>How swaps execute</summary>
              <div className="soft-details-body">
                <ul className="swap-checklist" style={{ marginBottom: 10 }}>
                  <li>Both AMMs are quoted for every hop; the larger output wins.</li>
                  <li>Token pairs without a direct pool route through ASE in two swaps.</li>
                  <li>Each leg carries its own on-chain minimum-output guard.</li>
                  <li>Strata never holds keys and never sends a transaction without your wallet confirmation.</li>
                </ul>
                <Link className="link-arrow" to="/how">Read the execution guide →</Link>
              </div>
            </details>
          </aside>
        </div>
      </section>

      <TokenPicker
        open={picker !== null}
        title={picker === 'out' ? 'Receive token' : 'Pay with'}
        tokens={pickerTokens}
        holdings={holdings}
        exclude={picker === 'out' ? tokenIn.address : tokenOut?.address}
        onSelect={pickToken}
        onClose={() => setPicker(null)}
      />
    </>
  );
}

export default Swap;
