import { Link } from 'react-router-dom';
import { useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { CHAIN_ID, IS_TESTNET, NETWORK } from '../lib/network';
import { PERPS_APP_URL } from '../lib/perps';
import { getHeads } from '../lib/rpc';
import { loadAseDexPools, loadPools } from '../lib/registry';
import { loadProtocol } from '../lib/protocol';
import { fmtAgeFrom, fmtNum, fmtWei, shortHash } from '../lib/format';
import { explorerTxUrl } from '../lib/rpc';
import { TEMPLATES } from '../lib/templates';

const QUICK_ACTIONS = [
  { to: '/advanced', number: '01', eyebrow: 'TERMINAL', title: 'Trade Spot or Perps', text: 'Chart live pools, swap across Auras and AseDex, or trade leveraged Long/Short Perps.', action: 'Open terminal', icon: '↗' },
  { to: '/deploy', number: '02', eyebrow: 'AUTOMATE', title: 'Create a trading bot', text: 'Launch isolated Spot AMM bots or AsePad Perps automation in a guided flow.', action: 'Build a bot', icon: '⌘' },
  { to: '/portfolio', number: '03', eyebrow: 'ACCOUNT', title: 'Manage your portfolio', text: 'Track token balances, open Perps positions, and active bot contracts in one place.', action: 'Open portfolio', icon: '◫' },
];

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="home-metric"><span>{label}</span><strong className="mono">{value}</strong><small>{note}</small></div>;
}

export function Home() {
  const wallet = useWallet();
  const heads = useAsync(() => getHeads(), 12_000);
  const pools = useAsync(() => loadPools(), 60_000);
  const asedex = useAsync(() => loadAseDexPools(), 60_000);
  const protocol = useAsync(() => loadProtocol(wallet.address ?? undefined), 30_000, true, wallet.address);
  const snapshot = protocol.data;
  const stats = snapshot?.stats;
  const verified = (snapshot?.strategies ?? []).filter((item) => item.verified);
  const active = verified.filter((item) => item.cron !== null && item.stopped !== true).length;
  const poolCount = (pools.data?.length ?? 0) + (asedex.data?.length ?? 0);
  const fills = (snapshot?.fills ?? []).slice(0, 5);

  return (
    <div className="home-page">
      <section className="wrap home-hero">
        <div className="home-hero-copy">
          <div className="home-kicker"><span className="home-live-dot" /> {NETWORK.name.toUpperCase()} <span className="home-kicker-sep">/</span> CHAIN {CHAIN_ID}</div>
          <h1>Trade the market.<br /><em>Automate the strategy.</em></h1>
          <p className="home-hero-lede">Non-custodial Spot &amp; Perpetuals terminal with on-chain trading bots. Execute direct swaps, open leveraged positions, or deploy automated strategies from your wallet.</p>
          <div className="home-hero-actions">
            <Link className="btn btn-primary" to="/advanced">Open trading terminal <span aria-hidden="true">↗</span></Link>
            <Link className="btn btn-ghost" to="/deploy">Create a bot</Link>
          </div>
          <div className="home-hero-foot"><span>SELF-CUSTODY</span><i /> <span>ON-CHAIN EXECUTION</span><i /> <span>SPOT &amp; PERPS</span></div>
        </div>
        <div className="home-hero-panel">
          <div className="home-panel-top"><span className="label">NETWORK OVERVIEW</span><span className="home-network-status"><span className="home-live-dot" /> LIVE</span></div>
          <div className="home-network-title">Asentum <span>·</span> {IS_TESTNET ? 'Testnet' : 'Mainnet'}</div>
          <div className="home-network-chain mono">CHAIN ID {CHAIN_ID}</div>
          <div className="home-network-metrics">
            <Metric label="FINALIZED BLOCK" value={heads.data ? heads.data.finalized.toLocaleString('en-US') : '—'} note="Latest finalized height" />
            <Metric label="LIVE POOLS" value={poolCount > 0 ? fmtNum(poolCount) : '—'} note="Auras + AseDex" />
            <Metric label="VERIFIED BOTS" value={stats ? fmtNum(stats.verifiedStrategies) : '—'} note="Inspectable contracts" />
            <Metric label="ACTIVE SCHEDULES" value={stats ? fmtNum(active) : '—'} note="Funded cron schedules" />
          </div>
          <div className="home-panel-bottom"><span>Chain &amp; indexer telemetry</span><span className="mono">{protocol.loading ? 'SYNCING…' : 'CONNECTED'}</span></div>
        </div>
      </section>

      <section className="wrap home-action-section">
        <div className="home-section-heading"><div><span className="label">WORKSPACE</span><h2>Choose where to start.</h2></div><p>Every swap, order, and bot runs from your own wallet approval.</p></div>
        <div className="home-action-grid">
          {QUICK_ACTIONS.map((item) => <Link key={item.to} to={item.to} className="home-action-card">
            <div className="home-action-card-top"><span>{item.number} <b>/</b> {item.eyebrow}</span><span className="home-action-icon">{item.icon}</span></div>
            <div><h3>{item.title}</h3><p>{item.text}</p></div>
            <div className="home-action-card-bottom">{item.action}<span>↗</span></div>
          </Link>)}
        </div>
      </section>

      <section className="wrap home-markets-band">
        <div className="home-markets-copy"><span className="label">CONNECTED VENUES</span><h2>Find a market.<br />Make your move.</h2><p>Best-price routing across Auras and AseDex spot pools, plus direct Vault-margined Long/Short execution on AsePad Perps.</p><Link className="home-inline-link" to="/advanced">Open Advanced Trading <span>→</span></Link></div>
        <div className="home-market-summary">
          <div className="home-market-summary-head"><span>LIVE VENUES</span><span className="home-live-dot" /></div>
          <div className="home-venue-row"><span className="home-venue-mark">A</span><span><strong>Auras v2</strong><small>Spot AMM pools &amp; limit orders</small></span><b>LIVE</b></div>
          <div className="home-venue-row"><span className="home-venue-mark alt">D</span><span><strong>AseDex</strong><small>Spot AMM liquidity pools</small></span><b>LIVE</b></div>
          <div className="home-venue-row"><span className="home-venue-mark">P</span><span><strong>AsePad Perps</strong><small>perps.asepad.fun · Leveraged Perps</small></span><b>LIVE</b></div>
          <div className="home-market-summary-foot"><span>Indexed Spot pools</span><strong className="mono">{poolCount > 0 ? fmtNum(poolCount) : '—'}</strong></div>
        </div>
      </section>

      <section className="wrap home-strategies-section">
        <div className="home-section-heading"><div><span className="label">AUTOMATION TEMPLATES</span><h2>Start with a strategy.</h2></div><p>Pick a strategy type, choose your token and budget, and review the summary before signing.</p></div>
        <div className="home-template-grid">
          {TEMPLATES.slice(0, 4).map((template, index) => <Link key={template.id} to={`/deploy?template=${template.id}`} className="home-template-card"><span className="home-template-number">0{index + 1}</span><div><h3>{template.name}</h3><p>{template.liteDesc}</p></div><span className="home-template-link">Configure <b>↗</b></span></Link>)}
        </div>
        <Link className="home-inline-link home-all-strategies" to="/strategies">Browse all strategy templates <span>→</span></Link>
      </section>

      <section className="wrap home-activity-section">
        <div className="home-section-heading"><div><span className="label">ON-CHAIN HISTORY</span><h2>Latest bot executions.</h2></div><Link className="home-inline-link" to="/activity">View activity ledger <span>→</span></Link></div>
        {fills.length === 0 ? <div className="home-activity-empty"><span className="home-empty-mark">⌁</span><div><strong>No verified executions yet</strong><p>{protocol.loading ? 'Checking indexed contract receipts…' : 'Confirmed trades from Strata bots appear here automatically.'}</p></div><Link to="/deploy">Create your first bot <span>↗</span></Link></div> : <div className="home-activity-table">{fills.map((fill) => <a key={fill.key} href={explorerTxUrl(fill.txHash)} target="_blank" rel="noreferrer" className="home-activity-row"><span className={fill.side === 'buy' ? 'exec-side is-buy' : 'exec-side is-sell'}>{fill.side === 'buy' ? 'BUY' : 'SELL'}</span><span className="home-activity-name"><strong>{fill.strategyName}</strong><small className="mono">{fill.symbol ? `${fill.symbol}/ASE` : 'pair —'}</small></span><span className="mono">{fmtWei(fill.aseAmount, 3)} ASE</span><span className="mono muted">{fmtAgeFrom(fill.timestamp)}</span><span className="mono dim">{shortHash(fill.txHash)}</span><span>↗</span></a>)}</div>}
      </section>

      <section className="wrap home-safety-section"><div><span className="label">SELF-CUSTODY</span><h2>You stay in control.</h2><p>Strata never holds your keys. Spot bots run in isolated contracts you own; Perp bots connect directly to AsePad Perps Vault and Engine.</p></div><div className="home-safety-links"><Link to="/how">How Strata works ↗</Link><Link to="/portfolio">Portfolio ↗</Link><Link to="/create-token">Create a token ↗</Link><a href={PERPS_APP_URL} target="_blank" rel="noreferrer">AsePad Perps ↗</a></div></section>
    </div>
  );
}
