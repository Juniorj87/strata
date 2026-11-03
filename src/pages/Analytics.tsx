import { Link } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { loadStrategies } from '../lib/registry';
import { fmtNum, fmtWei, shortAddr } from '../lib/format';

function formatTokenAmount(rawValue: string, decimals: number | null, symbol: string | null): string {
  if (decimals === null) return `${rawValue} raw units`;
  const value = BigInt(rawValue || '0');
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} ${symbol ?? 'tokens'}`;
}

export function Analytics() {
  const { data, loading, error, refresh } = useAsync(() => loadStrategies(), 30000);
  const strategies = (data ?? []).filter((item) => item.verified);
  const fills = strategies.reduce((sum, item) => sum + item.trades, 0);
  const grossOutput = strategies.reduce((sum, item) => sum + BigInt(item.realisedWei || '0'), 0n);
  const remainingMark = strategies.reduce((sum, item) => sum + BigInt(item.markValueAseWei || '0'), 0n);
  const tokenSymbols = new Set(strategies.map((item) => item.symbol).filter(Boolean));

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Performance · verified contract data</span>
        <h1 className="detail-title">Strategy analytics</h1>
        <p className="section-note" style={{ maxWidth: 760 }}>See how many strategies are active, how often they executed, how much ASE they received and the estimated value of tokens still held by their contracts. Open a strategy for a more detailed PnL estimate.</p>
        <div className="mode-switch" role="tablist" style={{ marginTop: 18 }}>
          <Link to="/analytics" className="mode-option active">
            <span>Protocol Overview</span><small>Macro volume & executions</small>
          </Link>
          <Link to="/leaderboard" className="mode-option">
            <span>Strategy Leaderboard</span><small>Ranked returns & win rates</small>
          </Link>
        </div>
      </section>
      <section className="wrap analytics-page" style={{ paddingBottom: 90 }}>
        <div className="leaderboard-toolbar"><span className="live-dot">{loading ? 'Reading verified contracts…' : `${strategies.length} verified strategies`}</span><button className="chip" type="button" onClick={refresh}>Refresh</button></div>
        {error && <div className="notice deploy-error">Could not load analytics: {error}</div>}
        <div className="leaderboard-stats">
          <div className="metric"><span className="label">Verified strategies</span><strong>{fmtNum(strategies.length)}</strong></div>
          <div className="metric"><span className="label">Executed fills</span><strong>{fmtNum(fills)}</strong></div>
          <div className="metric"><span className="label">Token types traded</span><strong>{fmtNum(tokenSymbols.size)}</strong></div>
          <div className="metric"><span className="label">Gross ASE proceeds</span><strong>{fmtWei(grossOutput)}</strong></div>
          <div className="metric"><span className="label">Open inventory mark</span><strong>{fmtWei(remainingMark)}</strong></div>
        </div>
        <div className="notice leaderboard-note"><strong>How to interpret this dashboard</strong><span>Token volumes are shown separately per asset because raw units from different tokens cannot be added together. Gross ASE proceeds are not profit. Inventory values are current AMM quotes, not guaranteed sale prices. For an estimated per-strategy PnL, enter your average acquisition cost on that strategy page. Known fill-transaction gas is included only when receipt data is complete; deployment, initialization and Cron escrow costs are not yet a complete accounting ledger.</span></div>
        <div className="panel analytics-table-panel">
          <div className="panel-head"><span className="label">Strategy performance</span><span className="muted">Verified source · Asentum testnet</span></div>
          <div className="table-scroll"><table className="leaderboard-table"><thead><tr><th>Strategy</th><th>Pair</th><th>Fills</th><th>Token sold</th><th>Gross ASE</th><th>Open inventory</th><th>Details</th></tr></thead><tbody>
            {strategies.map((item) => <tr key={item.address}><td><strong>{item.name}</strong><span className="mono muted" style={{ display: 'block' }}>{shortAddr(item.ase1, 8, 4)}</span></td><td>{item.symbol ? `${item.symbol}/ASE` : '—'}</td><td>{item.trades}</td><td className="mono">{formatTokenAmount(item.volumeWei, item.tokenDecimals, item.symbol)}</td><td className="mono">{fmtWei(item.realisedWei)}</td><td className="mono">{fmtWei(item.markValueAseWei || '0')}</td><td><Link className="link-arrow" to={`/strategies/${item.address}`}>Open ↗</Link></td></tr>)}
          </tbody></table></div>
          {!loading && strategies.length === 0 && <div className="empty small-empty">No verified strategy data found yet.</div>}
        </div>
      </section>
    </>
  );
}
