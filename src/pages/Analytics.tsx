import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import {
  buildSeries,
  fillsInRange,
  loadProtocol,
  pairActivity,
  RANGES,
  strategyRows,
  type RangeKey,
  type StrategyRow,
} from '../lib/protocol';
import { fmtAgeFrom, fmtNum, fmtWei, formatUnits, shortAddr } from '../lib/format';
import { BarList, ColumnChart } from '../components/Charts';
import { botTypeFor } from '../lib/templates';

type SortKey = 'fills' | 'gross' | 'inventory' | 'recent';

const SORT_LABEL: Record<SortKey, string> = {
  fills: 'executions',
  gross: 'gross ASE',
  inventory: 'open inventory',
  recent: 'last activity',
};

function asBig(value: string): bigint {
  try { return BigInt(value || '0'); } catch { return 0n; }
}

function statusOf(row: StrategyRow): { label: string; className: string } {
  const strategy = row.strategy;
  if (strategy.stopped === true) return { label: 'Stopped', className: 'status-badge off' };
  if (strategy.cron !== null) return { label: 'Scheduled', className: 'status-badge live' };
  return { label: 'Idle', className: 'status-badge pending' };
}

export function Analytics() {
  const { data, loading, error, refresh } = useAsync(() => loadProtocol(), 30_000);
  const [range, setRange] = useState<RangeKey>('30D');
  const [sortKey, setSortKey] = useState<SortKey>('fills');
  const [sortDesc, setSortDesc] = useState(true);

  const rows = useMemo(() => (data ? strategyRows(data) : []), [data]);
  const verifiedRows = useMemo(() => rows.filter((row) => row.strategy.verified), [rows]);
  const stats = data?.stats ?? null;
  const rangeFills = useMemo(
    () => fillsInRange(data?.fills ?? [], range),
    [data, range],
  );
  const executionSeries = useMemo(
    () => buildSeries(rangeFills, range, 'executions'),
    [rangeFills, range],
  );
  const volumeSeries = useMemo(
    () => buildSeries(rangeFills, range, 'ase'),
    [rangeFills, range],
  );
  const pairs = useMemo(() => pairActivity(rangeFills), [rangeFills]);

  const sorted = useMemo(() => {
    const value = (row: StrategyRow) => {
      switch (sortKey) {
        case 'gross': return Number(asBig(row.grossAseWei));
        case 'inventory': return Number(asBig(row.inventoryAseWei));
        case 'recent': return row.lastFillAt ?? 0;
        default: return row.fills;
      }
    };
    return [...verifiedRows].sort((a, b) => (sortDesc ? value(b) - value(a) : value(a) - value(b)));
  }, [verifiedRows, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((desc) => !desc);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const sortHeader = (key: SortKey, label: string) => (
    <button
      type="button"
      className={sortKey === key ? 'sort-btn active' : 'sort-btn'}
      onClick={() => toggleSort(key)}
      aria-label={`Sort by ${label}`}
    >
      {label} <i aria-hidden="true">{sortKey === key ? (sortDesc ? '↓' : '↑') : '↕'}</i>
    </button>
  );

  const executionsEmpty = executionSeries.points.every((point) => point.value === 0);
  const volumeEmpty = volumeSeries.points.every((point) => point.value === 0);

  const stateLabel = error
    ? data
      ? 'Live refresh failed · last snapshot shown'
      : 'Connection error'
    : loading && !data
      ? 'Reading hub registry and receipts…'
      : stats && stats.verifiedStrategies === 0
        ? 'No verified strategies indexed'
        : `${fmtNum(stats?.verifiedStrategies ?? 0)} verified · ${fmtNum(data?.fills.length ?? 0)} indexed fills`;

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Performance · verified contract data</span>
        <h1 className="detail-title">Protocol analytics</h1>
        <p className="section-note" style={{ maxWidth: 680, marginTop: 18 }}>
          Protocol-wide view of all verified strategies. Every figure below is derived from the same snapshot: Hub registrations, verified contract source, indexed transfers, and the swap receipts behind them. Open any strategy for a per-bot estimate with your own cost basis.
        </p>
        <div className="mode-switch" role="tablist" style={{ marginTop: 22 }}>
          <Link to="/analytics" className="mode-option active">
            <span>Protocol analytics</span>
            <small>Volume & executions</small>
          </Link>
          <Link to="/activity" className="mode-option">
            <span>Activity ledger</span>
            <small>Every indexed fill</small>
          </Link>
          <Link to="/leaderboard" className="mode-option">
            <span>Strategy leaderboard</span>
            <small>Ranked strategies</small>
          </Link>
        </div>
      </section>

      <section className="wrap analytics-page">
        <div className="leaderboard-toolbar">
          <span className={error ? 'live-dot is-warn' : 'live-dot'}>{stateLabel}</span>
          <span className="spacer" />
          <button className="chip" type="button" onClick={refresh}>
            Refresh
          </button>
          <Link className="btn btn-ghost btn-sm" to="/activity">
            Activity ledger →
          </Link>
        </div>

        {error && (
          <div className="notice deploy-error" role="alert" style={{ marginTop: 18 }}>
            <strong>Live refresh failed</strong>
            <span>
              {error}. {data ? 'The figures below are the last successfully indexed snapshot.' : 'Nothing has been indexed in this session yet.'}
            </span>
          </div>
        )}

        <div className="leaderboard-stats">
          <div className="metric">
            <span className="label">Total strategies</span>
            <strong>{stats ? fmtNum(stats.totalStrategies) : '—'}</strong>
          </div>
          <div className="metric">
            <span className="label">Active strategies</span>
            <strong>{stats ? fmtNum(stats.activeStrategies) : '—'}</strong>
          </div>
          <div className="metric">
            <span className="label">Verified strategies</span>
            <strong>{stats ? fmtNum(stats.verifiedStrategies) : '—'}</strong>
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
            <span className="label">Token types traded</span>
            <strong>{stats ? fmtNum(stats.tradedSymbols.length) : '—'}</strong>
          </div>
        </div>

        <div className="range-bar">
          <span className="label">Window</span>
          <div className="range-tabs" role="group" aria-label="Time window">
            {RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={range === item.key ? 'range-tab active' : 'range-tab'}
                onClick={() => setRange(item.key)}
                aria-pressed={range === item.key}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="mono range-note">
            {rangeFills.length === 0
              ? 'no timestamps in this window'
              : `${fmtNum(rangeFills.length)} fills carry an indexed timestamp`}
          </span>
        </div>

        <div className="analytics-charts">
          <div className="chart-block">
            <div className="chart-block-head">
              <div>
                <span className="label">Executions over time</span>
                <p className="muted">Indexed fill receipts · {range}</p>
              </div>
              <span className="mono chart-total">{fmtNum(executionSeries.filled)}</span>
            </div>
            {executionsEmpty ? (
              <div className="chart-empty">
                {loading && !data
                  ? 'Indexing on-chain executions…'
                  : 'No executions with an indexed timestamp in this window.'}
              </div>
            ) : (
              <ColumnChart
                points={executionSeries.points}
                ariaLabel={`Executions over time, ${range}`}
                format={(value) => String(Math.round(value))}
              />
            )}
          </div>

          <div className="chart-block">
            <div className="chart-block-head">
              <div>
                <span className="label">ASE received over time</span>
                <p className="muted">Token → ASE fills only · {range}</p>
              </div>
              <span className="mono chart-total">
                {fmtWei(rangeFills.reduce((sum, fill) => sum + asBig(fill.aseAmount), 0n), 2)}
              </span>
            </div>
            {volumeEmpty ? (
              <div className="chart-empty">
                {loading && !data ? 'Reading swap receipts…' : 'No ASE-received fills in this window.'}
              </div>
            ) : (
              <ColumnChart
                points={volumeSeries.points}
                ariaLabel={`ASE received over time, ${range}`}
                format={(value) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value < 1 ? 2 : 0))}
              />
            )}
          </div>
        </div>

        <div className="preview-grid" style={{ marginBottom: 22 }}>
          <div className="preview-main">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <span className="label">Strategy activity</span>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 5 }}>
                  Ranked by indexed executions
                </p>
              </div>
              <span className="pill pill-live">Verified</span>
            </div>
            <div style={{ marginTop: 22 }}>
              {verifiedRows.length > 0 && verifiedRows.some((row) => row.fills > 0) ? (
                <BarList
                  data={[...verifiedRows]
                    .sort((a, b) => b.fills - a.fills)
                    .slice(0, 8)
                    .map((row) => ({
                      label: row.strategy.name.length > 30 ? `${row.strategy.name.slice(0, 30)}…` : row.strategy.name,
                      value: row.fills,
                      meta: row.strategy.symbol ? `${row.strategy.symbol}/ASE` : undefined,
                    }))}
                  format={(value) => `${value} fills`}
                />
              ) : (
                <div className="empty">
                  <h3>No execution data yet</h3>
                  <p>Verified strategies appear here once their contracts execute a swap.</p>
                </div>
              )}
            </div>
          </div>

          <div className="preview-main">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <span className="label">Trading activity by pair</span>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 5 }}>
                  Never summed across assets
                </p>
              </div>
              <span className="pill pill-live">{range}</span>
            </div>
            <div style={{ marginTop: 22 }}>
              {pairs.length > 0 ? (
                <>
                  <BarList
                    data={pairs.slice(0, 6).map((pair) => ({
                      label: `${pair.symbol}/ASE`,
                      value: pair.fills,
                      meta: `${pair.buys} buy · ${pair.sells} sell`,
                    }))}
                    format={(value) => `${value} fills`}
                  />
                  <dl className="pair-ledger">
                    {pairs.slice(0, 4).map((pair) => (
                      <div key={pair.symbol}>
                        <dt className="mono">{pair.symbol}</dt>
                        <dd className="mono">{fmtWei(pair.aseWei, 3)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <div className="empty">
                  <h3>No paired activity</h3>
                  <p>Choose a wider window or wait for a scheduled run to fill.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="panel analytics-table-panel">
          <div className="panel-head">
            <div>
              <span className="label">Strategy performance</span>
              <p className="muted" style={{ marginTop: 3 }}>
                Sorted by {SORT_LABEL[sortKey]} · {sortDesc ? 'descending' : 'ascending'}
              </p>
            </div>
            <span className="muted" style={{ fontSize: 11.5 }}>
              Verified source · Asentum testnet
            </span>
          </div>
          <div className="table-scroll">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Pair</th>
                  <th>{sortHeader('fills', 'Fills')}</th>
                  <th>Token sold</th>
                  <th className="col-optional">{sortHeader('gross', 'Gross ASE')}</th>
                  <th className="col-optional">{sortHeader('inventory', 'Open inventory')}</th>
                  <th className="col-optional">{sortHeader('recent', 'Last activity')}</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const strategy = row.strategy;
                  const status = statusOf(row);
                  return (
                    <tr key={strategy.address}>
                      <td>
                        <Link to={`/strategies/${strategy.address}`} style={{ color: 'var(--text)' }}>
                          <strong>{strategy.name}</strong>
                        </Link>
                        <span className="mono muted" style={{ display: 'block', fontSize: 10.5, marginTop: 2 }}>
                          {botTypeFor(strategy.template)?.title ?? strategy.template} · {shortAddr(strategy.ase1, 8, 4)} ·{' '}
                          <span className={status.className}>{status.label}</span>
                        </span>
                      </td>
                      <td>{strategy.symbol ? `${strategy.symbol}/ASE` : '—'}</td>
                      <td className="mono">{fmtNum(row.fills)}</td>
                      <td className="mono">
                        {strategy.tokenDecimals === null
                          ? `${row.soldTokenRaw} raw`
                          : `${formatUnits(row.soldTokenRaw, strategy.tokenDecimals, 4)}`}
                      </td>
                      <td className="mono col-optional">{fmtWei(row.grossAseWei, 3)}</td>
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
          {!loading && sorted.length === 0 && (
            <div className="leaderboard-empty">
              <h3>No verified strategy data found yet</h3>
              <p className="muted">
                {error
                  ? 'The chain index could not be read. Retry once the connection recovers.'
                  : 'Deploy a strategy or wait for the indexer to catch up with the finalized block.'}
              </p>
              <Link className="btn btn-primary btn-sm" to="/deploy" style={{ marginTop: 6 }}>
                Deploy a strategy
              </Link>
            </div>
          )}
        </div>

        <div className="leaderboard-note">
          <strong>Methodology</strong>
          <span>
            Fills are counted from swap receipts attributed to a verified strategy contract; executed totals also
            respect the contract&apos;s own counters. Gross ASE received is quote volume from token → ASE fills and is
            not net profit. Open inventory is a live AMM quote, not a sale price. Token amounts are never added
            together across different assets. Time charts only plot fills that carry an indexed timestamp; a bucket
            with no fill stays empty rather than being smoothed or invented. A per-strategy PnL estimate needs a cost
            basis and is computed only on the strategy page.
          </span>
        </div>
      </section>
    </>
  );
}
