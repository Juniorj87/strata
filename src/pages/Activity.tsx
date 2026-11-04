import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { explorerTxUrl, getHeads } from '../lib/rpc';
import { loadPools, loadTape } from '../lib/registry';
import { loadProtocol, type ProtocolFill } from '../lib/protocol';
import { getUserTxs } from '../lib/userStrategies';
import { formatUnits, fmtAgeFrom, fmtNum, fmtTimestamp, fmtWei, shortAddr, shortHash } from '../lib/format';
import { Tape } from '../components/Tape';

type SideFilter = 'all' | 'buy' | 'sell';
const PAGE = 40;

function tokenText(fill: ProtocolFill): string {
  const symbol = fill.symbol ?? 'tokens';
  if (fill.tokenDecimals === null) return `${Number(fill.tokenAmount).toLocaleString('en-US')} raw`;
  return `${formatUnits(fill.tokenAmount, fill.tokenDecimals, 4)} ${symbol}`;
}

export function Activity() {
  const wallet = useWallet();
  const [side, setSide] = useState<SideFilter>('all');
  const [strategyFilter, setStrategyFilter] = useState('all');
  const [tokenFilter, setTokenFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);

  const protocol = useAsync(() => loadProtocol(), 30_000);
  const tapes = useAsync(() => loadTape(8), 30_000);
  const pools = useAsync(() => loadPools(), 120_000);
  const heads = useAsync(() => getHeads(), 15_000);

  const snapshot = protocol.data;
  const fills = useMemo(() => snapshot?.fills ?? [], [snapshot]);
  const strategies = useMemo(
    () => (snapshot?.strategies ?? []).filter((item) => item.template !== 'strata-hub'),
    [snapshot],
  );
  const tradedStrategies = useMemo(
    () => strategies.filter((item) => item.verified && (item.fillEvents.length > 0 || item.trades > 0)),
    [strategies],
  );
  const tokens = useMemo(() => snapshot?.stats.tokenSymbols ?? [], [snapshot]);

  const visible = useMemo(
    () =>
      fills.filter((fill) => {
        if (side !== 'all' && fill.side !== side) return false;
        if (strategyFilter !== 'all' && fill.strategyAddress !== strategyFilter) return false;
        if (tokenFilter !== 'all' && fill.symbol !== tokenFilter) return false;
        return true;
      }),
    [fills, side, strategyFilter, tokenFilter],
  );

  const blockRange = fills.length ? { from: fills[fills.length - 1].block, to: fills[0].block } : null;
  const userTxs = wallet.connected && wallet.address ? getUserTxs(wallet.address) : [];
  const truncated = fills.some((fill) => fill.timestamp === null);

  const stateLabel = protocol.error
    ? snapshot
      ? 'Live refresh failed · last snapshot shown'
      : 'Connection error'
    : protocol.loading && !snapshot
      ? 'Indexing verified contracts…'
      : fills.length === 0
        ? 'No fills indexed yet'
        : `${fmtNum(fills.length)} fills · head #${(snapshot?.head ?? 0).toLocaleString('en-US')}`;

  const resetFilters = () => {
    setSide('all');
    setStrategyFilter('all');
    setTokenFilter('all');
    setLimit(PAGE);
  };

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Activity · Asentum testnet</span>
        <h1 className="detail-title">
          Every execution,
          <br />
          in order.
        </h1>
        <p className="section-note" style={{ maxWidth: 660, marginTop: 18 }}>
          A chronological ledger of the fills indexed from verified Strata contracts, plus the swaps flowing through
          the Auras pools right now. Each row links back to its transaction and the strategy that produced it.
        </p>
        <div className="mode-switch" role="tablist" style={{ marginTop: 22 }}>
          <Link to="/analytics" className="mode-option">
            <span>Protocol analytics</span>
            <small>Volume & executions</small>
          </Link>
          <Link to="/activity" className="mode-option active">
            <span>Activity ledger</span>
            <small>Every indexed fill</small>
          </Link>
          <Link to="/leaderboard" className="mode-option">
            <span>Strategy leaderboard</span>
            <small>Ranked strategies</small>
          </Link>
        </div>
      </section>

      <section className="wrap activity-page">
        <div className="leaderboard-toolbar">
          <span className={protocol.error ? 'live-dot is-warn' : 'live-dot'}>{stateLabel}</span>
          <span className="spacer" />
          <button type="button" className="chip" onClick={protocol.refresh}>
            Refresh
          </button>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>
            auto · 30s
          </span>
        </div>

        <div className="stat-strip" style={{ borderTop: 0, marginBottom: 26 }}>
          <div className="stat">
            <span className="label">Fills indexed</span>
            <div className="stat-value">{snapshot ? fmtNum(fills.length) : '—'}</div>
            <span className="stat-sub">{tradedStrategies.length} strategies with execution history</span>
          </div>
          <div className="stat">
            <span className="label">Buys / sells</span>
            <div className="stat-value">
              {snapshot ? `${fmtNum(snapshot.stats.buyFills)} / ${fmtNum(snapshot.stats.sellFills)}` : '—'}
            </div>
            <span className="stat-sub">Token bought / sold against ASE</span>
          </div>
          <div className="stat">
            <span className="label">Latest fill</span>
            <div className="stat-value">{fills[0] ? `#${fills[0].block.toLocaleString('en-US')}` : '—'}</div>
            <span className="stat-sub">
              {fills[0] ? fmtAgeFrom(fills[0].timestamp) : `Finalized #${(heads.data?.finalized ?? 0).toLocaleString('en-US')}`}
            </span>
          </div>
          <div className="stat">
            <span className="label">Coverage</span>
            <div className="stat-value" style={{ fontSize: 17, paddingTop: 6 }}>
              {blockRange ? `${blockRange.from.toLocaleString('en-US')}–${blockRange.to.toLocaleString('en-US')}` : '—'}
            </div>
            <span className="stat-sub">Block range of indexed fills</span>
          </div>
        </div>

        {protocol.error && (
          <div className="notice deploy-error" role="alert" style={{ marginBottom: 18 }}>
            <strong>Live refresh failed</strong>
            <span>
              {protocol.error}.{' '}
              {snapshot
                ? 'Rows below are the last successfully indexed snapshot.'
                : 'Nothing has been indexed in this session yet.'}
            </span>
          </div>
        )}

        <div className="activity-layout">
          <div className="activity-feed">
            <div className="act-feed-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={side === 'all' ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => setSide('all')}
                >
                  All fills
                </button>
                <button
                  type="button"
                  className={side === 'sell' ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => setSide('sell')}
                >
                  Sells
                </button>
                <button
                  type="button"
                  className={side === 'buy' ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => setSide('buy')}
                >
                  Buys
                </button>
                <select
                  className="input"
                  style={{ height: 30, width: 190, fontSize: 11.5 }}
                  value={tokenFilter}
                  onChange={(event) => {
                    setTokenFilter(event.target.value);
                    setLimit(PAGE);
                  }}
                  aria-label="Filter by token"
                >
                  <option value="all">Every token</option>
                  {tokens.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  style={{ height: 30, width: 210, fontSize: 11.5 }}
                  value={strategyFilter}
                  onChange={(event) => {
                    setStrategyFilter(event.target.value);
                    setLimit(PAGE);
                  }}
                  aria-label="Filter by strategy"
                >
                  <option value="all">Every strategy</option>
                  {tradedStrategies.map((item) => (
                    <option key={item.address} value={item.address}>
                      {item.name.length > 28 ? `${item.name.slice(0, 28)}…` : item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>
                  {visible.length} rows
                </span>
                <button type="button" className="chip" onClick={protocol.refresh}>
                  Refresh
                </button>
              </div>
            </div>

            <div className="act-head" aria-hidden="true">
              <span>Side</span>
              <span>Strategy / time</span>
              <span>Token</span>
              <span>ASE</span>
              <span>Block</span>
              <span>Tx</span>
            </div>

            {protocol.loading && fills.length === 0 && (
              <div style={{ padding: 18, display: 'grid', gap: 8 }}>
                {[0, 1, 2, 3, 4, 5].map((row) => (
                  <div className="skeleton" key={row} style={{ height: 36 }} />
                ))}
              </div>
            )}

            {!protocol.loading && fills.length === 0 && (
              <div className="leaderboard-empty">
                <h3>{protocol.error ? 'The ledger could not be read' : 'No fills indexed yet'}</h3>
                <p className="muted" style={{ maxWidth: 480 }}>
                  {protocol.error
                    ? 'The explorer or RPC did not answer. Retry once the connection recovers — no synthetic rows are shown.'
                    : 'Activity is read from verified contracts and the swap receipts behind every transfer. Once a strategy executes a swap, its fill appears here with time, block and transaction hash.'}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <Link className="btn btn-primary btn-sm" to="/deploy">
                    Deploy a bot
                  </Link>
                  <Link className="btn btn-ghost btn-sm" to="/strategies?tab=live">
                    Live contracts
                  </Link>
                </div>
              </div>
            )}

            {fills.length > 0 && visible.length === 0 && (
              <div className="leaderboard-empty">
                <h3>No fills match this filter</h3>
                <p className="muted">Choose another side, token or strategy to see the rest of the ledger.</p>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={resetFilters}>
                  Reset filters
                </button>
              </div>
            )}

            {visible.slice(0, limit).map((fill) => (
              <div className="act-row" key={fill.key}>
                <span className={`act-side ${fill.side}`} aria-label={fill.side}>
                  {fill.side === 'sell' ? 'SELL' : 'BUY'}
                </span>
                <div className="act-main">
                  <strong>{fill.strategyName}</strong>
                  <span>
                    {fill.symbol ? `${fill.symbol}/ASE` : 'pair unavailable'} ·{' '}
                    <Link to={`/strategies/${fill.strategyAddress}`} style={{ color: 'var(--accent)' }}>
                      {shortAddr(fill.strategyAddress)}
                    </Link>{' '}
                    · {fill.owner ? `wallet ${shortAddr(fill.owner)}` : 'wallet —'} ·{' '}
                    <span className="mono">{fmtTimestamp(fill.timestamp)}</span>
                  </span>
                </div>
                <div className="act-cell">
                  <small>Token</small>
                  {tokenText(fill)}
                </div>
                <div className="act-cell">
                  <small>{fill.side === 'sell' ? 'ASE received' : 'ASE spent'}</small>
                  {fmtWei(fill.aseAmount, 4)}
                </div>
                <div className="act-cell">
                  <small>Block / status</small>
                  <span className="mono">
                    #{fill.block.toLocaleString('en-US')} · <span className="status-badge live">Confirmed</span>
                  </span>
                </div>
                <a
                  className="act-link"
                  href={explorerTxUrl(fill.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  title={`${fill.side} · block ${fill.block.toLocaleString('en-US')} · ${fill.txHash}`}
                  aria-label={`Open transaction ${fill.txHash} in the explorer`}
                >
                  {shortHash(fill.txHash).slice(0, 6)}↗
                </a>
              </div>
            ))}

            {visible.length > limit && (
              <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'center' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimit((value) => value + PAGE)}>
                  Load {Math.min(PAGE, visible.length - limit)} more
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel">
              <div className="panel-head">
                <span className="label">Network pulse</span>
                <span className="live-dot">{protocol.error ? 'Retrying' : 'Live'}</span>
              </div>
              <div className="panel-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                <div className="pulse-list">
                  <div className="pulse-row">
                    <span>Finalized block</span>
                    <strong>{heads.data ? heads.data.finalized.toLocaleString('en-US') : '—'}</strong>
                  </div>
                  <div className="pulse-row">
                    <span>Live AMM pools</span>
                    <strong>{pools.data ? fmtNum(pools.data.length) : '—'}</strong>
                  </div>
                  <div className="pulse-row">
                    <span>Verified strategies</span>
                    <strong>{snapshot ? fmtNum(snapshot.stats.verifiedStrategies) : '—'}</strong>
                  </div>
                  <div className="pulse-row">
                    <span>Executed fills</span>
                    <strong>{snapshot ? fmtNum(snapshot.stats.executedFills) : '—'}</strong>
                  </div>
                  <div className="pulse-row">
                    <span>Gross ASE received</span>
                    <strong>{snapshot ? fmtWei(snapshot.stats.grossAseWei, 3) : '—'}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="label">Recent Auras swaps</span>
                <span className="tape-live">live</span>
              </div>
              <Tape rows={tapes.data ?? []} />
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="label">Your transactions</span>
                {wallet.connected ? (
                  <Link to="/portfolio" className="link-arrow" style={{ fontSize: 11 }}>
                    Portfolio →
                  </Link>
                ) : (
                  <span className="pill pill-ended">Wallet off</span>
                )}
              </div>
              <div className="panel-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                {!wallet.connected && (
                  <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.65 }}>
                    Connect a wallet to see the deployment, funding and withdrawal transactions recorded for this
                    browser.
                  </p>
                )}
                {wallet.connected && userTxs.length === 0 && (
                  <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.65 }}>
                    No local transaction records yet. Launch a bot and each signed step is stored here.
                  </p>
                )}
                {userTxs.slice(0, 5).map((tx) => (
                  <div className="pulse-row" key={tx.hash}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.description}
                    </span>
                    <a
                      href={explorerTxUrl(tx.hash)}
                      target="_blank"
                      rel="noreferrer"
                      className="mono"
                      style={{
                        color:
                          tx.status === 'confirmed'
                            ? 'var(--up)'
                            : tx.status === 'pending'
                              ? 'var(--warn)'
                              : 'var(--down)',
                      }}
                    >
                      {tx.status} ↗
                    </a>
                  </div>
                ))}
              </div>
            </div>

            <p className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
              Fills are read from the transfers of verified strategy contracts, resolved against the swap receipt of
              the same transaction. Timestamps come from the receipt, so every row shows the real execution time.
              {truncated ? ' Some fills predate the index window and show — instead of a time.' : ''}{' '}
              {snapshot?.capped ? 'One strategy exceeded the indexed transfer cap; its history may be incomplete.' : ''}{' '}
              Gross ASE is quote volume, not profit.{' '}
              {tapes.data && tapes.data.length > 0 ? 'The Auras tape shows swaps from the last 600 blocks.' : ''}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
