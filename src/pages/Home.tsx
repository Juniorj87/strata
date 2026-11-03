import { Link } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { getHeads } from '../lib/rpc';
import { loadPools, loadStrategies, loadTape } from '../lib/registry';
import { Tape } from '../components/Tape';

const FEATURES = [
  { num: '01', title: 'Risk controls', text: 'Set a position budget, maximum order size, price protection and an emergency stop before you deploy.', href: '/deploy?template=risk-managed', action: 'Configure risk' },
  { num: '02', title: 'Advanced execution', text: 'Use TWAP, DCA, a scheduled limit exit or a multi-level scale ladder. Auras spot strategies trade automatically on-chain.', href: '/deploy?template=scale', action: 'Explore execution' },
  { num: '03', title: 'Leaderboard & stats', text: 'See fills, gross proceeds, open inventory and live network rankings across all active strategies.', href: '/leaderboard', action: 'View leaderboard' },
  { num: '04', title: 'Strategy templates', text: 'Browse verified strategy contracts, pick your trading pair and launch automated bots in seconds.', href: '/strategies', action: 'Explore strategies' },
  { num: '05', title: 'AsePad ecosystem', text: 'Inspect AsePad, AseDex and the ARC-20 factory, then open the native exchange for its own limit and DCA orders.', href: '/deploy', action: 'Explore venues' },
];

export function Home() {
  const heads = useAsync(() => getHeads(), 5000);
  const tape = useAsync(() => loadTape(8), 8000);
  const pools = useAsync(() => loadPools(), 20000);
  const strategies = useAsync(() => loadStrategies(), 20000);
  const live = strategies.data ?? [];
  const verified = live.filter((item) => item.verified);

  return (
    <>
      <section className="wrap friendly-hero">
        <div className="friendly-hero-copy">
          <span className="label">On-chain strategy automation · Asentum</span>
          <h1 className="hero-title">Launch a bot in a minute.<br /><em>No servers. No code.</em></h1>
          <p className="hero-lede">Pick DCA, take-profit, grid, stop-loss or TWAP, choose the token and the amount, then press launch. Strata deploys the contract to Asentum and the network runs the schedule.</p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/deploy">Create a bot <span aria-hidden="true">→</span></Link>
            <Link className="btn btn-ghost" to="/strategies">Explore strategies</Link>
          </div>
          <div className="friendly-trust-row"><span><i /> No-code Lite mode</span><span><i /> Wallet signs every action</span><span><i /> Public contract source</span></div>
        </div>
        <div className="friendly-hero-side">
          <div className="friendly-flow-card">
            <span className="label">Your first deployment</span>
            <div className="friendly-flow-step"><b>1</b><div><strong>Choose a bot type</strong><span>DCA, take-profit, grid, stop-loss or TWAP</span></div></div>
            <div className="friendly-flow-step"><b>2</b><div><strong>Choose a pair and amount</strong><span>Strata reads available pools and token details</span></div></div>
            <div className="friendly-flow-step"><b>3</b><div><strong>Launch and sign</strong><span>Your wallet approves each on-chain transaction</span></div></div>
            <div className="friendly-flow-footer"><span className="live-dot">Protocol scheduler</span><span className="mono">24 / 7 · on chain</span></div>
          </div>
          <div className="friendly-pro-note"><span className="pro-mark">PRO</span><div><strong>Need source code and CLI?</strong><span>Switch to Pro in the deployer for PowerShell, raw parameters and contract inspection.</span><Link to="/deploy">See Pro mode →</Link></div></div>
        </div>
      </section>

      <section className="wrap friendly-stats">
        <div><span className="label">Finalized block</span><strong>{heads.data?.finalized.toLocaleString('en-US') ?? '—'}</strong><small>Asentum testnet</small></div>
        <div><span className="label">Live Auras pools</span><strong>{pools.data?.length ?? '—'}</strong><small>Pairs read from chain</small></div>
        <div><span className="label">Discovered contracts</span><strong>{verified.length}</strong><small>Source hash matched</small></div>
        <div><span className="label">Executions indexed</span><strong>{verified.reduce((sum, item) => sum + item.trades, 0).toLocaleString('en-US')}</strong><small>Verified fill events</small></div>
      </section>

      <section className="wrap section friendly-section">
        <div className="section-head">
          <div><span className="label">Start simple</span><h2 className="section-title">You choose the rules. The chain handles the schedule.</h2></div>
          <p className="section-note">Lite is the default for everyday users. Technical settings and source code stay available in Pro, so the first screen does not overwhelm you.</p>
        </div>
        <div className="friendly-paths grid grid-2">
          <article className="friendly-path-card friendly-path-lite"><span className="path-kicker">LITE · RECOMMENDED</span><h3>Set it up in a few steps</h3><p>Choose a ready-made strategy, pick a pool, enter the amount and read a plain-language review before your wallet asks you to sign.</p><ul><li>No PowerShell</li><li>Clear token and gas budgets</li><li>Risk controls on supported templates</li></ul><Link className="btn btn-primary" to="/deploy">Start with Lite →</Link></article>
          <article className="friendly-path-card"><span className="path-kicker">PRO · FOR BUILDERS</span><h3>Control every parameter</h3><p>Inspect the JavaScript source, adjust intervals and thresholds, copy CLI commands and deploy from PowerShell with your local signer.</p><ul><li>Raw contract parameters</li><li>Source and hash inspection</li><li>Local CLI workflow</li></ul><Link className="btn btn-ghost" to="/deploy?mode=pro">Open Pro mode →</Link></article>
        </div>
      </section>

      <section className="wrap section friendly-section">
        <div className="section-head"><div><span className="label">Platform features</span><h2 className="section-title">More than a deploy button.</h2></div><p className="section-note">Execution, risk, transparent performance and community discovery in one place.</p></div>
        <div className="friendly-feature-grid">
          {FEATURES.map((item) => <article className="friendly-feature" key={item.num}><span className="feature-number">{item.num}</span><h3>{item.title}</h3><p>{item.text}</p><Link to={item.href}>{item.action} →</Link></article>)}
        </div>
      </section>

      <section className="wrap section friendly-section">
        <div className="section-head"><div><span className="label">Network activity</span><h2 className="section-title">What is happening now</h2></div><Link className="link-arrow" to="/leaderboard">Open leaderboard →</Link></div>
        <div className="grid grid-2 friendly-live-grid">
          <div className="panel"><div className="panel-head"><span className="label">Recent Auras swaps</span><span className="live-dot">Live</span></div><Tape rows={tape.data ?? []} /></div>
          <div className="panel"><div className="panel-head"><span className="label">Verified strategies</span><Link className="link-arrow" to="/strategies">View all →</Link></div><div className="panel-body friendly-strategy-list">
            {strategies.loading && <div className="muted">Reading verified contracts…</div>}
            {!strategies.loading && verified.slice(0, 4).map((item) => <div className="friendly-strategy-row" key={item.address}><div><strong>{item.name}</strong><span>{item.template} · {item.symbol ? `${item.symbol}/ASE` : 'pair unavailable'}</span></div><Link to={`/strategies/${item.address}`}>Inspect →</Link></div>)}
            {!strategies.loading && verified.length === 0 && <p className="muted">No verified strategy contracts found yet. Create the first one from Lite.</p>}
          </div></div>
        </div>
      </section>

      <section className="wrap friendly-bottom-cta"><div><span className="label">Ready when you are</span><h2>Start with a strategy, not a terminal.</h2><p>Pick a template. Review every limit. Keep control of your wallet.</p></div><Link className="btn btn-primary" to="/deploy">Create your first strategy →</Link></section>
    </>
  );
}
