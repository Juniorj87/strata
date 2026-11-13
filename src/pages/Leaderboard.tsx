import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { loadProtocol, strategyRows, walletRows, type StrategyRow, type WalletRow } from '../lib/protocol';
import { fmtAgeFrom, fmtNum, fmtWei, formatUnits, shortAddr } from '../lib/format';
import { botTypeFor } from '../lib/templates';

type SortKey = 'running' | 'fills' | 'gross' | 'recent';

const COLUMNS: { key: SortKey; label: string }[] = [
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
  const { data, loading, error, refresh } = useAsync(() => loadProtocol(), 30_000);
  const [sortKey, setSortKey] = useState<SortKey>('running');
  const [sortDesc, setSortDesc] = useState(true);
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
        <span className="label">Leaderboard · wallets that run bots here</span>
        <h1 className="detail-title">
          The wallets behind
          <br />
          the running bots.
        </h1>
        <p className="section-note" style={{ maxWidth: 680, marginTop: 18 }}>
          Wallets are ranked, not individual bots: every figure is the sum of the verified Strata contracts that
          wallet owns, read from their own swap receipts. Gross ASE is proceeds, not profit; open inventory is a
          live AMM quote. A bot with an ended schedule still counts in its wallet&apos;s history but not in the
          running count.
        </p>
        <div className="mode-switch" role="tablist" style={{ marginTop: 22 }}>
          <Link to="/analytics" className="mode-option">
            <span>Overview</span>
            <small>Volume &amp; executions</small>
          </Link>
          <Link to="/activity" className="mode-option">
            <span>Fills</span>
            <small>Every indexed fill</small>
          </Link>
          <Link to="/leaderboard" className="mode-option active">
            <span>Leaderboard</span>
            <small>Wallets ranked</small>
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
          <Link className="btn btn-ghost btn-sm" to="/activity">
            Fills ledger →
          </Link>
        </div>

        {error && (
          <div className="notice deploy-error" role="alert" style={{ marginBottom: 18 }}>
            <strong>Live refresh failed</strong>
            <span>
              {error}. {data ? 'The ranking below is the last successfully indexed snapshot.' : 'No snapshot has loaded yet.'}
            </span>
          </div>
        )}

        <div className="leaderboard-stats">
          <div className="metric">
            <span className="label">Ranked wallets</span>
            <strong>{data ? fmtNum(wallets.length) : '—'}</strong>
          </div>
          <div className="metric">
            <span className="label">Bots running</span>
            <strong>{data ? fmtNum(runningBots) : '—'}</strong>
          </div>
          <div className="metric">
            <span className="label">Executed fills</span>
            <strong>{stats ? fmtNum(stats.executedFills) : '—'}</strong>
          </div>
          <div className="metric">
            <span className="label">Gross ASE received</span>
            <strong>{stats ? fmtWei(stats.grossAseWei, 2) : '—'}</strong>
          </div>
          <div className="metric">
            <span className="label">Open inventory mark</span>
            <strong>{stats ? fmtWei(stats.inventoryAseWei, 2) : '—'}</strong>
          </div>
          <div className="metric">
            <span className="label">Last fill</span>
            <strong>{stats?.lastFillAt ? fmtAgeFrom(stats.lastFillAt) : '—'}</strong>
          </div>
        </div>

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
              Asentum testnet · live
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
                      <td className="mono">{fmtNum(wallet.running)}</td>
                      <td className="mono">{fmtNum(wallet.fills)}</td>
                      <td className="mono">{fmtWei(wallet.grossAseWei, 3)}</td>
                      <td className="mono">{wallet.lastFillAt ? fmtAgeFrom(wallet.lastFillAt) : '—'}</td>
                      <td>{wallet.tokens.slice(0, 3).join(' · ') || '—'}</td>
                      <td>
                        <a
                          className="link-arrow"
                          href={`https://explorer.asentum.com/address/${wallet.wallet}`}
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

        <div className="panel" style={{ marginTop: 18 }}>
          <div className="panel-head">
            <div>
              <span className="label">Bots behind these wallets</span>
              <p className="muted" style={{ marginTop: 3 }}>
                Secondary view — the same contracts aggregated above, listed individually
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

        <div className="leaderboard-note">
          <strong>How this ranking is computed</strong>
          <span>
            Position is determined only by confirmed data: a wallet&apos;s bots are the verified contracts whose
            owner field is that address, fills come from swap receipts attributed to those contracts, and the
            running count only includes bots whose cron job still exists and whose stop flag is false. Volume is
            the token amount sold, quoted in the token&apos;s own decimals and never merged across assets. Gross ASE
            received is quote volume from token → ASE fills — proceeds, not profit. Open inventory is a live AMM
            quote of unsold tokens. No ROI or PnL is displayed here because a reliable profit figure needs a
            per-strategy cost basis, which is only computed on the strategy page where it can be explained.
          </span>
        </div>
      </section>
    </>
  );
}

export default Leaderboard;
