import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { loadProtocol, strategyRows, walletRows, type StrategyRow } from '../lib/protocol';
import { fmtAgeFrom, fmtNum, fmtWei, formatUnits, shortAddr } from '../lib/format';
import { botTypeFor } from '../lib/templates';

type SortKey = 'fills' | 'gross' | 'inventory' | 'recent' | 'volume';

const COLUMNS: { key: SortKey; label: string; optional?: boolean }[] = [
  { key: 'fills', label: 'Executions' },
  { key: 'volume', label: 'Token sold', optional: true },
  { key: 'gross', label: 'Gross ASE' },
  { key: 'inventory', label: 'Open inventory', optional: true },
  { key: 'recent', label: 'Last activity', optional: true },
];

function asBig(value: string): bigint {
  try { return BigInt(value || '0'); } catch { return 0n; }
}

function rowValue(row: StrategyRow, key: SortKey): number {
  switch (key) {
    case 'gross': return Number(asBig(row.grossAseWei));
    case 'inventory': return Number(asBig(row.inventoryAseWei));
    case 'recent': return row.lastFillAt ?? 0;
    case 'volume': return Number(asBig(row.soldTokenRaw));
    default: return row.fills;
  }
}

export function Leaderboard() {
  const { data, loading, error, refresh } = useAsync(() => loadProtocol(), 30_000);
  const [sortKey, setSortKey] = useState<SortKey>('gross');
  const [sortDesc, setSortDesc] = useState(true);

  const rows = useMemo(() => (data ? strategyRows(data).filter((row) => row.strategy.verified) : []), [data]);
  const wallets = useMemo(() => (data ? walletRows(data) : []), [data]);
  const stats = data?.stats ?? null;

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (sortDesc ? rowValue(b, sortKey) - rowValue(a, sortKey) : rowValue(a, sortKey) - rowValue(b, sortKey))),
    [rows, sortKey, sortDesc],
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
      : rows.length === 0
        ? 'No ranked strategies yet'
        : `${fmtNum(rows.length)} verified strategies · ranked by ${sortKey === 'recent' ? 'last activity' : sortKey}`;

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Leaderboard · verified contracts only</span>
        <h1 className="detail-title">
          Ranked by what
          <br />
          the chain confirms.
        </h1>
        <p className="section-note" style={{ maxWidth: 680, marginTop: 18 }}>
          Public ranking of all verified strategies. Strategies are ordered by quote volume and execution count taken from their own swap receipts. Gross ASE is proceeds, not profit; open inventory is a live AMM quote. No ROI is shown without a verified cost basis.
        </p>
        <div className="mode-switch" role="tablist" style={{ marginTop: 22 }}>
          <Link to="/analytics" className="mode-option">
            <span>Protocol analytics</span>
            <small>Volume & executions</small>
          </Link>
          <Link to="/activity" className="mode-option">
            <span>Activity ledger</span>
            <small>Every indexed fill</small>
          </Link>
          <Link to="/leaderboard" className="mode-option active">
            <span>Strategy leaderboard</span>
            <small>Ranked strategies</small>
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
            Activity ledger →
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
            <span className="label">Ranked strategies</span>
            <strong>{stats ? fmtNum(stats.verifiedStrategies) : '—'}</strong>
          </div>
          <div className="metric">
            <span className="label">Active</span>
            <strong>{stats ? fmtNum(stats.activeStrategies) : '—'}</strong>
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
              <span className="label">Strategy ranking</span>
              <p className="muted" style={{ marginTop: 3 }}>
                {sorted.length === 0 ? 'Awaiting the first verified execution' : 'Click a column to re-rank'}
              </p>
            </div>
            <span className="muted" style={{ fontSize: 11.5 }}>
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

          {!loading && sorted.length === 0 && (
            <div className="leaderboard-empty">
              <h3>{error ? 'The leaderboard could not be read' : 'No verified strategies ranked yet'}</h3>
              <p className="muted">
                {error
                  ? 'The registry or explorer did not answer. Retry once the connection recovers.'
                  : 'A strategy appears once its contract is verified and has produced at least one indexed swap.'}
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

          {sorted.length > 0 && (
            <div className="table-scroll">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Strategy</th>
                    <th className="col-optional">Creator</th>
                    <th>Pair</th>
                    {COLUMNS.map((column) => (
                      <th key={column.key} className={column.optional ? 'col-optional' : undefined}>
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
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, index) => {
                    const strategy = row.strategy;
                    return (
                      <tr key={strategy.address}>
                        <td className="mono rank-cell">{index + 1}</td>
                        <td>
                          <Link to={`/strategies/${strategy.address}`} style={{ color: 'var(--text)' }}>
                            <strong>{strategy.name}</strong>
                          </Link>
                          <span className="mono muted" style={{ display: 'block', fontSize: 10.5, marginTop: 2 }}>
                            {botTypeFor(strategy.template)?.title ?? strategy.template} · {shortAddr(strategy.address, 8, 4)}
                          </span>
                        </td>
                        <td className="mono col-optional">{strategy.owner ? shortAddr(strategy.owner) : '—'}</td>
                        <td>{strategy.symbol ? `${strategy.symbol}/ASE` : '—'}</td>
                        <td className="mono">{fmtNum(row.fills)}</td>
                        <td className="mono col-optional">
                          {strategy.tokenDecimals === null
                            ? `${row.soldTokenRaw} raw`
                            : `${formatUnits(row.soldTokenRaw, strategy.tokenDecimals, 4)} ${strategy.symbol ?? ''}`.trim()}
                        </td>
                        <td className="mono">{fmtWei(row.grossAseWei, 3)}</td>
                        <td className="mono col-optional">{fmtWei(row.inventoryAseWei, 3)}</td>
                        <td className="mono col-optional">{row.lastFillAt ? fmtAgeFrom(row.lastFillAt) : '—'}</td>
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

        <div className="leaderboard-grid">
          <div className="panel">
            <div className="panel-head">
              <div>
                <span className="label">Wallet ranking</span>
                <p className="muted" style={{ marginTop: 3 }}>
                  Aggregated from the same strategy snapshot
                </p>
              </div>
              <span className="pill pill-live">Secondary</span>
            </div>
            {wallets.length === 0 ? (
              <div className="leaderboard-empty">
                <h3>No creator wallets indexed</h3>
                <p className="muted">Creator addresses appear once a verified strategy is registered on the hub.</p>
              </div>
            ) : (
              <div className="wallet-rank">
                {wallets.slice(0, 8).map((wallet, index) => (
                  <div className="wallet-rank-row" key={wallet.wallet}>
                    <span className="mono rank-cell">{index + 1}</span>
                    <div>
                      <strong className="mono">{shortAddr(wallet.wallet, 8, 6)}</strong>
                      <span className="muted" style={{ display: 'block', fontSize: 10.5 }}>
                        {wallet.strategies} strategies · {wallet.fills} fills
                      </span>
                    </div>
                    <span className="mono">{fmtWei(wallet.grossAseWei, 3)}</span>
                    <span className="mono muted" style={{ fontSize: 10.5 }}>
                      {wallet.tokens.slice(0, 3).join(' · ') || '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="leaderboard-note">
            <strong>How this ranking is computed</strong>
            <span>
              Position is determined only by confirmed data: fills come from swap receipts attributed to a verified
              contract, and executed counts also respect the contract&apos;s own counters. Volume is the token amount
              sold, quoted in the token&apos;s own decimals and never merged across assets. Gross ASE received is
              quote volume from token → ASE fills — proceeds, not profit. Open inventory is a live AMM quote of unsold
              tokens. No ROI or PnL is displayed here because a reliable profit figure needs a per-strategy cost
              basis, which is only computed on the strategy page where it can be explained.
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
