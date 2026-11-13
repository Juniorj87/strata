import { Link } from 'react-router-dom';
import { useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { getHeads } from '../lib/rpc';
import { loadAseDexPools, loadPools } from '../lib/registry';
import { loadProtocol } from '../lib/protocol';
import { fmtAgeFrom, fmtNum, fmtWei, shortHash } from '../lib/format';
import { explorerTxUrl } from '../lib/rpc';
import { TEMPLATES } from '../lib/templates';

const QUICK_ACTIONS = [
  { to: '/advanced', number: '01', eyebrow: 'SPOT TERMINAL', title: 'Trade a market', text: 'Choose a live pool, inspect the chart and trade with Market, supported Limit orders or a bot.', action: 'Start trading', icon: '↗' },
  { to: '/deploy', number: '02', eyebrow: 'AUTOMATE', title: 'Create a trading bot', text: 'Choose a strategy, set its rules and schedule, then deploy it as an on-chain contract.', action: 'Build a bot', icon: '⌘' },
  { to: '/portfolio', number: '03', eyebrow: 'YOUR ACCOUNT', title: 'View your portfolio', text: 'Review token balances, deployed strategies, funding and contract activity from your wallet.', action: 'Open portfolio', icon: '◫' },
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
          <div className="home-kicker"><span className="home-live-dot" /> ASENTUM TESTNET <span className="home-kicker-sep">/</span> CHAIN 1423</div>
          <h1>Trade the market.<br /><em>Automate the strategy.</em></h1>
          <p className="home-hero-lede">A non-custodial workspace to trade live AMM pools and run on-chain trading strategies. Start with a swap, take control in the terminal, or let a funded contract follow your rules.</p>
          <div className="home-hero-actions">
            <Link className="btn btn-primary" to="/advanced">Open trading terminal <span aria-hidden="true">↗</span></Link>
            <Link className="btn btn-ghost" to="/deploy">Create a bot</Link>
          </div>
          <div className="home-hero-foot"><span>NON-CUSTODIAL</span><i /> <span>ON-CHAIN EXECUTION</span><i /> <span>LIVE POOL DATA</span></div>
        </div>
        <div className="home-hero-panel">
          <div className="home-panel-top"><span className="label">NETWORK OVERVIEW</span><span className="home-network-status"><span className="home-live-dot" /> LIVE</span></div>
          <div className="home-network-title">Asentum <span>·</span> Testnet</div>
          <div className="home-network-chain mono">CHAIN ID 1423</div>
          <div className="home-network-metrics">
            <Metric label="FINALIZED BLOCK" value={heads.data ? heads.data.finalized.toLocaleString('en-US') : '—'} note="Latest finalized height" />
            <Metric label="LIVE POOLS" value={poolCount > 0 ? fmtNum(poolCount) : '—'} note="Auras + AseDex" />
            <Metric label="VERIFIED BOTS" value={stats ? fmtNum(stats.verifiedStrategies) : '—'} note="Inspectable contracts" />
            <Metric label="ACTIVE SCHEDULES" value={stats ? fmtNum(active) : '—'} note="Funded cron schedules" />
          </div>
          <div className="home-panel-bottom"><span>Market data and contract state</span><span className="mono">{protocol.loading ? 'SYNCING…' : 'CONNECTED'}</span></div>
        </div>
        <div className="home-hero-index mono">STRATA / 001</div>
      </section>

      <section className="wrap home-action-section">
        <div className="home-section-heading"><div><span className="label">YOUR WORKSPACE</span><h2>What would you like to do?</h2></div><p>Choose a starting point. Your wallet reviews and approves every on-chain action.</p></div>
        <div className="home-action-grid">
          {QUICK_ACTIONS.map((item) => <Link key={item.to} to={item.to} className="home-action-card">
            <div className="home-action-card-top"><span>{item.number} <b>/</b> {item.eyebrow}</span><span className="home-action-icon">{item.icon}</span></div>
            <div><h3>{item.title}</h3><p>{item.text}</p></div>
            <div className="home-action-card-bottom">{item.action}<span>↗</span></div>
          </Link>)}
        </div>
      </section>

      <section className="wrap home-markets-band">
        <div className="home-markets-copy"><span className="label">LIVE AMM MARKETS</span><h2>Find a market.<br />Make your move.</h2><p>Browse indexed Auras and AseDex pools, compare available liquidity and activity, then open the selected market in the trading terminal.</p><Link className="home-inline-link" to="/advanced">Explore markets in Advanced Trading <span>→</span></Link></div>
        <div className="home-market-summary"><div className="home-market-summary-head"><span>CONNECTED VENUES</span><span className="home-live-dot" /></div><div className="home-venue-row"><span className="home-venue-mark">A</span><span><strong>Auras v2</strong><small>AMM liquidity pools</small></span><b>LIVE</b></div><div className="home-venue-row"><span className="home-venue-mark alt">D</span><span><strong>AseDex</strong><small>AMM liquidity pools</small></span><b>LIVE</b></div><div className="home-market-summary-foot"><span>Indexed pools</span><strong className="mono">{poolCount > 0 ? fmtNum(poolCount) : '—'}</strong></div><small className="home-market-note">Auras is Strata’s primary indexed market-data source; AseDex is an additional connected spot venue. Pool availability and order support depend on each venue and contract.</small></div>
      </section>

      <section className="wrap home-strategies-section">
        <div className="home-section-heading"><div><span className="label">ON-CHAIN AUTOMATION</span><h2>Start with a strategy.</h2></div><p>These are contract templates, not website background jobs. Review the rules, funding and execution interval before deployment.</p></div>
        <div className="home-template-grid">
          {TEMPLATES.slice(0, 4).map((template, index) => <Link key={template.id} to={`/deploy?template=${template.id}`} className="home-template-card"><span className="home-template-number">0{index + 1}</span><div><h3>{template.name}</h3><p>{template.liteDesc}</p></div><span className="home-template-link">Configure strategy <b>↗</b></span></Link>)}
        </div>
        <Link className="home-inline-link home-all-strategies" to="/strategies">Compare all strategy templates <span>→</span></Link>
      </section>

      <section className="wrap home-activity-section">
        <div className="home-section-heading"><div><span className="label">ON-CHAIN HISTORY</span><h2>Latest bot executions.</h2></div><Link className="home-inline-link" to="/activity">View activity ledger <span>→</span></Link></div>
        {fills.length === 0 ? <div className="home-activity-empty"><span className="home-empty-mark">⌁</span><div><strong>No verified executions yet</strong><p>{protocol.loading ? 'Checking indexed contract receipts…' : 'When a Strata strategy completes an indexed trade, its confirmed execution will appear here.'}</p></div><Link to="/deploy">Create your first bot <span>↗</span></Link></div> : <div className="home-activity-table">{fills.map((fill) => <a key={fill.key} href={explorerTxUrl(fill.txHash)} target="_blank" rel="noreferrer" className="home-activity-row"><span className={fill.side === 'buy' ? 'exec-side is-buy' : 'exec-side is-sell'}>{fill.side === 'buy' ? 'BUY' : 'SELL'}</span><span className="home-activity-name"><strong>{fill.strategyName}</strong><small className="mono">{fill.symbol ? `${fill.symbol}/ASE` : 'pair —'}</small></span><span className="mono">{fmtWei(fill.aseAmount, 3)} ASE</span><span className="mono muted">{fmtAgeFrom(fill.timestamp)}</span><span className="mono dim">{shortHash(fill.txHash)}</span><span>↗</span></a>)}</div>}
      </section>

      <section className="wrap home-safety-section"><div><span className="label">BUILT AROUND YOUR WALLET</span><h2>You stay in control.</h2><p>Strata never asks for your seed phrase or holds your private keys. Spot swaps use AMM liquidity. Spot bots are on-chain strategy contracts scheduled by Asentum Cron; stop-loss and take-profit are checked only when a scheduled run executes. Escrowed limit orders are available only on supported Auras v2 pools. Perpetuals (long/short with leverage) and a traditional order book are not connected.</p></div><div className="home-safety-links"><Link to="/how">How Strata works ↗</Link><Link to="/portfolio">Portfolio ↗</Link><Link to="/create-token">Create a token ↗</Link><a href="https://www.asentum.com/docs" target="_blank" rel="noreferrer">Asentum docs ↗</a></div></section>
    </div>
  );
}
