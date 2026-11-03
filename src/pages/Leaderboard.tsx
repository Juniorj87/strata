import { Link } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { loadLeaderboard } from '../lib/leaderboard';
import { fmtNum, fmtWei, shortAddr } from '../lib/format';

function explorerAddress(address: string): string {
  return `https://explorer.asentum.com/address/${address}`;
}

function formatTokenAmount(raw: string, decimals: number | null): string {
  if (decimals === null) return `${raw} raw`;
  const value = BigInt(raw || '0');
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const digits = Math.min(decimals, 4);
  const fractionText = digits > 0 ? fraction.toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '') : '';
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

export function Leaderboard() {
  const { data, loading, error, refresh } = useAsync(() => loadLeaderboard(), 60_000);
  const rows = data?.rows ?? [];
  const totalDeploys = rows.reduce((sum, row) => sum + row.deploys, 0);
  const totalFills = rows.reduce((sum, row) => sum + row.fills, 0);
  const totalGross = rows.reduce((sum, row) => sum + BigInt(row.grossAseWei), 0n);
  const totalEscrow = rows.reduce((sum, row) => sum + BigInt(row.escrowWei), 0n);

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">On-chain activity · Asentum testnet</span>
        <h1 className="detail-title">Strategy leaderboard</h1>
        <p className="section-note" style={{ maxWidth: 720 }}>
          Ranked from Strata Hub registrations and strategy events. Deploys, filled executions, committed gas escrow
          and gross ASE output are chain-derived. This is activity data, not a profitability ranking.
        </p>
        <div className="mode-switch" role="tablist" style={{ marginTop: 18 }}>
          <Link to="/analytics" className="mode-option">
            <span>Protocol Overview</span><small>Macro volume & executions</small>
          </Link>
          <Link to="/leaderboard" className="mode-option active">
            <span>Strategy Leaderboard</span><small>Ranked returns & win rates</small>
          </Link>
        </div>
      </section>

      <section className="wrap leaderboard-page" style={{ paddingBottom: 90 }}>
        <div className="leaderboard-toolbar">
          <div className="live-dot">
            {loading ? 'indexing on-chain activity…' : `${rows.length} wallets · finalized block ${data?.toBlock.toLocaleString('en-US') ?? '—'}`}
          </div>
          <button className="chip" onClick={refresh} type="button">Refresh data</button>
          <Link className="btn btn-primary btn-sm" to="/deploy">Deploy a strategy</Link>
        </div>

        <div className="leaderboard-stats">
          <div className="metric"><span className="label">Registered deployments</span><strong>{fmtNum(totalDeploys)}</strong></div>
          <div className="metric"><span className="label">Filled executions</span><strong>{fmtNum(totalFills)}</strong></div>
          <div className="metric"><span className="label">Gross ASE output</span><strong>{fmtWei(totalGross)}</strong></div>
          <div className="metric"><span className="label">Gas escrow committed</span><strong>{fmtWei(totalEscrow)}</strong></div>
        </div>

        {error && <div className="notice deploy-error" role="alert">Could not load leaderboard: {error}</div>}

        <div className="panel leaderboard-panel">
          <div className="panel-head leaderboard-head">
            <div><span className="label">Ranked wallets</span><p className="muted">Sorted by gross ASE output, then deployment count</p></div>
            <span className="pill pill-live">On-chain</span>
          </div>
          {loading && !data ? (
            <div className="leaderboard-empty">Reading chain events…</div>
          ) : rows.length === 0 ? (
            <div className="leaderboard-empty">
              <h3>No registered strategies in the indexed range yet.</h3>
              <p className="muted">New Lite and Pro deployments register through Strata Hub. Older deployments do not appear until they are registered.</p>
              <Link className="btn btn-ghost" to="/deploy">Launch the first strategy →</Link>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="leaderboard-table">
                <thead><tr>
                  <th>#</th><th>Wallet</th><th>Deploys</th><th>Fills</th><th>Gas escrow</th><th>Token input</th><th>Gross ASE output</th><th>Share</th><th>ROI</th>
                </tr></thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.wallet}>
                      <td className="rank-cell">{String(index + 1).padStart(2, '0')}</td>
                      <td><a className="mono wallet-link" href={explorerAddress(row.wallet)} target="_blank" rel="noreferrer" title={row.wallet}>{shortAddr(row.wallet, 9, 5)}</a></td>
                      <td>{fmtNum(row.deploys)}</td>
                      <td>{fmtNum(row.fills)}</td>
                      <td className="mono">{fmtWei(row.escrowWei)}</td>
                      <td className="token-input-cell">{row.tokenInputs.length ? row.tokenInputs.map((item) => <span className="mono token-input-line" key={item.token} title={item.token}>{formatTokenAmount(item.amount, item.decimals)} {item.symbol}</span>) : <span className="muted">—</span>}</td>
                      <td className="mono">{fmtWei(row.grossAseWei)}</td>
                      <td><span className="share-pill">{row.sharePct.toFixed(2)}%</span></td>
                      <td><span className="muted">Not measured</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="notice leaderboard-note">
          <strong>How to read these figures</strong>
          <span>Token input is the volume of ARC-20 tokens sold by each strategy, grouped by token symbol. Gross ASE output is the resulting quote-token volume, not net profit. Escrow committed is the amount initially funded for scheduled execution, not measured gas spent. ROI needs token acquisition cost, deposits, withdrawals and mark-to-market inventory, which are not yet tracked as one accounting ledger.</span>
        </div>
        {data && <p className="muted leaderboard-coverage">Coverage: blocks {data.fromBlock.toLocaleString('en-US')}–{data.toBlock.toLocaleString('en-US')}. {data.indexedHub ? 'Start block found from the explorer contract index.' : 'Explorer index unavailable; showing a bounded recent-chain window.'} {data.skippedUnverified > 0 ? `${data.skippedUnverified} unverified or unsupported registrations were excluded.` : 'All indexed registrations passed template/source verification.'}</p>}
      </section>
    </>
  );
}
