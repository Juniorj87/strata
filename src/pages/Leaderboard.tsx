import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { NETWORK } from '../lib/network';
import { loadProtocol, POINTS, strategyRows, walletRows, type StrategyRow, type WalletRow } from '../lib/protocol';
import { explorerAddressUrl, toHexAddress } from '../lib/rpc';
import { fmtAgeFrom, fmtNum, fmtWei, formatUnits, shortAddr } from '../lib/format';
import { botTypeFor } from '../lib/templates';
import { InfoTip } from '../components/InfoTip';

type SortKey = 'points' | 'running' | 'fills' | 'gross' | 'recent';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'points', label: 'Points' },
  { key: 'running', label: 'Bots running' },
  { key: 'fills', label: 'Executions' },
  { key: 'gross', label: 'Gross ASE' },
  { key: 'recent', label: 'Last activity' },
];

function asBig(value: string): bigint {
  try { return BigInt(value || '0'); } catch { return 0n; }
}

function walletValue(row: WalletRow, key: SortKey): number {
  switch (key) {
    case 'points': return row.points;
    case 'gross': return Number(asBig(row.grossAseWei));
    case 'recent': return row.lastFillAt ?? 0;
    case 'fills': return row.fills;
    default: return row.running;
  }
}

function strategyValue(row: StrategyRow, key: 'fills' | 'gross' | 'recent'): number {
  if (key === 'gross') return Number(asBig(row.grossAseWei));
  if (key === 'recent') return row.lastFillAt ?? 0;
  return row.fills;
}

export function Leaderboard() {
  const wallet = useWallet();
  const { data, loading, error, refresh } = useAsync(() => loadProtocol(), 30_000);
  const [sortKey, setSortKey] = useState<SortKey>('points');
  const [sortDesc, setSortDesc] = useState(true);
  const [boardTab, setBoardTab] = useState<'wallets' | 'bots'>('wallets');
  const [strategySort, setStrategySort] = useState<'fills' | 'gross' | 'recent'>('fills');

  const wallets = useMemo(() => (data ? walletRows(data) : []), [data]);
  const strategies = useMemo(
    () => (data ? strategyRows(data).filter((row) => row.strategy.verified) : []),
    [data],
  );
  const stats = data?.stats ?? null;

  const sortedWallets = useMemo(
    () => [...wallets].sort((a, b) => {
      const diff = walletValue(b, sortKey) - walletValue(a, sortKey);
      if (diff !== 0) return sortDesc ? diff : -diff;
      // A stable tiebreak keeps the busiest wallets above idle ones.
      return b.fills - a.fills;
    }),
    [wallets, sortKey, sortDesc],
  );

  const sortedStrategies = useMemo(
    () => [...strategies].sort((a, b) => strategyValue(b, strategySort) - strategyValue(a, strategySort)),
    [strategies, strategySort],
  );

  const runningBots = useMemo(
    () => strategies.filter((row) => row.strategy.cron !== null && row.strategy.stopped !== true).length,
    [strategies],
  );

  const totalPoints = useMemo(() => wallets.reduce((sum, row) => sum + row.points, 0), [wallets]);
  const myWallet = useMemo(() => {
    if (!wallet.address) return null;
    let address = wallet.address.trim().toLowerCase();
    try { address = toHexAddress(address).toLowerCase(); } catch { /* keep the raw form */ }
    return wallets.find((row) => row.wallet.toLowerCase() === address) ?? null;
  }, [wallets, wallet.address]);
  const myRank = useMemo(() => {
    if (!myWallet) return -1;
    return sortedWallets.findIndex((row) => row.wallet.toLowerCase() === myWallet.wallet.toLowerCase());
  }, [sortedWallets, myWallet]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((desc) => !desc);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const stateLabel = error
    ? data
      ? 'Live refresh failed · last snapshot shown'
      : 'Connection error'
    : loading && !data
      ? 'Reading verified contracts…'
      : wallets.length === 0
        ? 'No ranked wallets yet'
        : `${fmtNum(wallets.length)} wallets · ${fmtNum(runningBots)} bots running`;

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Leaderboard · {NETWORK.shortLabel}</span>
        <h1 className="detail-title">
          The wallets behind
          <br />
          the running bots.
        </h1>
        <p className="section-note" style={{ marginTop: 10 }}>
          Ranked by verified Strata contract executions and gross ASE volume across every wallet&apos;s bots.
          <InfoTip
            label="Ranking rules"
            text="Every figure sums the verified Strata contracts owned by each wallet from on-chain swap receipts. Gross ASE is proceeds, not profit; open inventory uses a live AMM quote."
          />
        </p>
        <div className="advanced-head-actions" style={{ marginTop: 16 }}>
          <Link className="btn btn-ghost btn-sm" to="/activity">
            Fills ledger →
          </Link>
          <Link className="btn btn-primary btn-sm" to="/deploy">
            Launch a bot to earn points
          </Link>
        </div>
      </section>

      <section className="wrap leaderboard-page">
        <div className="leaderboard-toolbar">
          <span className={error ? 'live-dot is-warn' : 'live-dot'}>{stateLabel}</span>
          <span className="spacer" />
          <button type="button" className="chip" onClick={refresh}>
            Refresh
          </button>
        </div>

        {error && (
          <div className="notice deploy-error" role="alert" style={{ marginBottom: 18 }}>
            <strong>Live refresh failed</strong>
            <span>
              {error}. {data ? 'The ranking below is the last successfully indexed snapshot.' : 'No snapshot has loaded yet.'}
            </span>
          </div>
        )}

        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
            <div>
              <span className="label">Your points</span>
              <strong style={{ display: 'block', fontSize: 32, marginTop: 4 }}>
                {myWallet ? fmtNum(myWallet.points) : wallet.connected ? '0' : '—'}
              </strong>
              <span className="muted" style={{ fontSize: 13.5 }}>
                {!wallet.connected
                  ? 'Connect a wallet to see your points and rank.'
                  : myWallet
                    ? `Rank #${myRank + 1} of ${sortedWallets.length} · ${myWallet.strategies} bots · ${fmtNum(myWallet.fills)} executions · ${fmtWei(myWallet.grossAseWei, 2)} gross ASE`
                    : 'No verified bot found for this wallet yet. Launch a bot; points appear after its first indexed execution.'}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.65, maxWidth: 380 }}>
              <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 3 }}>How points are earned</strong>
              {POINTS.perBot} per launched bot · {POINTS.perFill} per execution · 1 per {POINTS.asePerPoint} ASE received.
              Only verified on-chain activity counts.
            </div>
          </div>
        </div>

        <div className="kpi-strip">
          <div className="kpi-card">
            <span className="label">Ranked wallets</span>
            <strong className="mono">{data ? fmtNum(wallets.length) : '—'}</strong>
            <small>{data ? `${fmtNum(totalPoints)} points awarded` : 'Indexed owners'}</small>
          </div>
          <div className="kpi-card">
            <span className="label">Bots running</span>
            <strong className="mono">{data ? fmtNum(runningBots) : '—'}</strong>
            <small>Active Cron schedules</small>
          </div>
          <div className="kpi-card">
            <span className="label">Executed fills</span>
            <strong className="mono">{stats ? fmtNum(stats.executedFills) : '—'}</strong>
            <small>{stats?.lastFillAt ? `Last fill ${fmtAgeFrom(stats.lastFillAt)}` : 'Confirmed swaps'}</small>
          </div>
          <div className="kpi-card">
            <span className="label">Gross ASE received</span>
            <strong className="mono">{stats ? fmtWei(stats.grossAseWei, 2) : '—'}</strong>
            <small>{stats ? `Open mark ${fmtWei(stats.inventoryAseWei, 2)}` : 'Total proceeds'}</small>
          </div>
        </div>

        <div className="seg-tabs" style={{ marginBottom: 18 }} role="tablist" aria-label="Leaderboard view">
          <button
            type="button"
            role="tab"
            aria-selected={boardTab === 'wallets'}
            className={boardTab === 'wallets' ? 'seg-tab active' : 'seg-tab'}
            onClick={() => setBoardTab('wallets')}
          >
            Wallet ranking
            <span className="seg-tab-count">{sortedWallets.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={boardTab === 'bots'}
            className={boardTab === 'bots' ? 'seg-tab active' : 'seg-tab'}
            onClick={() => setBoardTab('bots')}
          >
            Individual bots
            <span className="seg-tab-count">{sortedStrategies.length}</span>
          </button>
        </div>

        {boardTab === 'wallets' ? (
        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="label">Wallet ranking</span>
              <p className="muted" style={{ marginTop: 3 }}>
                {sortedWallets.length === 0
                  ? 'Awaiting the first verified execution'
                  : 'Click a column to re-rank · every bot belongs to the wallet above it'}
              </p>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>
              {NETWORK.shortLabel} · live
            </span>
          </div>

          {loading && !data && (
            <div style={{ padding: 18, display: 'grid', gap: 8 }}>
              {[0, 1, 2, 3, 4].map((row) => (
                <div className="skeleton" key={row} style={{ height: 40 }} />
              ))}
            </div>
          )}

          {!loading && sortedWallets.length === 0 && (
            <div className="leaderboard-empty">
              <h3>{error ? 'The leaderboard could not be read' : 'No verified wallets ranked yet'}</h3>
              <p className="muted">
                {error
                  ? 'The registry or explorer did not answer. Retry once the connection recovers.'
                  : 'A wallet appears once one of its verified bots has produced at least one indexed swap.'}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <Link className="btn btn-primary btn-sm" to="/deploy">
                  Deploy a strategy
                </Link>
                <Link className="btn btn-ghost btn-sm" to="/strategies">
                  Browse strategies
                </Link>
              </div>
            </div>
          )}

          {sortedWallets.length > 0 && (
            <div className="table-scroll">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Wallet</th>
                    <th>Bots</th>
                    {COLUMNS.map((column) => (
                      <th key={column.key}>
                        <button
                          type="button"
                          className={sortKey === column.key ? 'sort-btn active' : 'sort-btn'}
                          onClick={() => toggleSort(column.key)}
                          aria-label={`Sort by ${column.label}`}
                        >
                          {column.label}{' '}
                          <i aria-hidden="true">{sortKey === column.key ? (sortDesc ? '↓' : '↑') : '↕'}</i>
                        </button>
                      </th>
                    ))}
                    <th>Pairs</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedWallets.map((wallet, index) => (
                    <tr key={wallet.wallet}>
                      <td className="mono rank-cell">{index + 1}</td>
                      <td>
                        <span className="mono">{shortAddr(wallet.wallet, 8, 6)}</span>
                        <span className="mono muted" style={{ display: 'block', fontSize: 13, marginTop: 2 }}>
                          {wallet.running > 0 ? `${wallet.running} running` : 'no schedule running'}
                        </span>
                      </td>
                      <td className="mono">{wallet.strategies}</td>
                      <td className="mono"><strong>{fmtNum(wallet.points)}</strong></td>
                      <td className="mono">{fmtNum(wallet.running)}</td>
                      <td className="mono">{fmtNum(wallet.fills)}</td>
                      <td className="mono">{fmtWei(wallet.grossAseWei, 3)}</td>
                      <td className="mono">{wallet.lastFillAt ? fmtAgeFrom(wallet.lastFillAt) : '—'}</td>
                      <td>{wallet.tokens.slice(0, 3).join(' · ') || '—'}</td>
                      <td>
                        <a
                          className="link-arrow"
                          href={explorerAddressUrl(wallet.wallet)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Explorer →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        ) : (
        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="label">Bots behind these wallets</span>
              <p className="muted" style={{ marginTop: 3 }}>
                Individual verified strategy contracts aggregated in the wallet ranking
              </p>
            </div>
            <div className="swap-slippage-opts">
              {(['fills', 'gross', 'recent'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={strategySort === key ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => setStrategySort(key)}
                >
                  {key === 'fills' ? 'Fills' : key === 'gross' ? 'Gross ASE' : 'Recent'}
                </button>
              ))}
            </div>
          </div>

          {sortedStrategies.length === 0 ? (
            <div className="leaderboard-empty">
              <h3>No verified bots indexed</h3>
              <p className="muted">Bots appear once their contract is verified and has produced an indexed swap.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Bot</th>
                    <th>Owner</th>
                    <th>Pair</th>
                    <th>Executions</th>
                    <th>Token sold</th>
                    <th>Gross ASE</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStrategies.map((row, index) => {
                    const strategy = row.strategy;
                    return (
                      <tr key={strategy.address}>
                        <td className="mono rank-cell">{index + 1}</td>
                        <td>
                          <Link to={`/strategies/${strategy.address}`} style={{ color: 'var(--text)' }}>
                            <strong>{strategy.name}</strong>
                          </Link>
                          <span className="mono muted" style={{ display: 'block', fontSize: 13, marginTop: 2 }}>
                            {botTypeFor(strategy.template)?.title ?? strategy.template} · {shortAddr(strategy.address, 8, 4)}
                          </span>
                        </td>
                        <td className="mono">{strategy.owner ? shortAddr(strategy.owner) : '—'}</td>
                        <td>{strategy.symbol ? `${strategy.symbol}/ASE` : '—'}</td>
                        <td className="mono">{fmtNum(row.fills)}</td>
                        <td className="mono">
                          {strategy.tokenDecimals === null
                            ? `${row.soldTokenRaw} raw`
                            : `${formatUnits(row.soldTokenRaw, strategy.tokenDecimals, 4)} ${strategy.symbol ?? ''}`.trim()}
                        </td>
                        <td className="mono">{fmtWei(row.grossAseWei, 3)}</td>
                        <td>
                          <Link className="link-arrow" to={`/strategies/${strategy.address}`}>
                            Open →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        <details className="soft-details" style={{ marginTop: 20 }}>
          <summary>How this ranking is computed</summary>
          <div className="soft-details-body">
            Position is determined only by confirmed data: a wallet&apos;s bots are the verified contracts whose
            owner field is that address, fills come from swap receipts attributed to those contracts, and the
            running count only includes bots whose cron job still exists and whose stop flag is false. Volume is
            the token amount sold, quoted in the token&apos;s own decimals and never merged across assets. Gross ASE
            received is quote volume from token → ASE fills — proceeds, not profit. Open inventory is a live AMM
            quote of unsold tokens. Points are awarded only for verified on-chain actions: {POINTS.perBot} for a
            bot that reaches the registry, {POINTS.perFill} for every indexed execution, and 1 point for each{' '}
            {POINTS.asePerPoint} ASE received. Points are recomputed from chain data on every load; nothing is
            stored off-chain. No ROI or PnL is displayed here because a reliable profit figure needs a per-strategy
            cost basis, which is only computed on the strategy page where it can be explained.
          </div>
        </details>
      </section>
    </>
  );
}

export default Leaderboard;
