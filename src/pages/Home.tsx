import { Link } from 'react-router-dom';
import { useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { getHeads } from '../lib/rpc';
import { loadPools } from '../lib/registry';
import { loadProtocol, strategyRows } from '../lib/protocol';
import { fmtAgeFrom, fmtNum, fmtWei } from '../lib/format';
import { BOT_TYPES } from '../lib/templates';
import { BarList } from '../components/Charts';
import { ExecutionField } from '../components/ExecutionField';

const CAPABILITIES = [
  {
    index: '01',
    title: 'Launch without a terminal',
    text: 'Pick a bot type, choose a live pool, set the amount and read the plan in plain language before your wallet signs.',
    points: ['Five guided bot types', 'Live pair and balance checks', 'Plain-language review'],
  },
  {
    index: '02',
    title: 'Keep custody the whole time',
    text: 'Each bot is a contract you own. Stop the schedule, withdraw ASE and reclaim unsold tokens from the same screen.',
    points: ['No server holds funds', 'Owner-only stop and withdraw', 'Source hash verification'],
  },
  {
    index: '03',
    title: 'Watch what actually happened',
    text: 'Fills, gross ASE received, open inventory and contract balances — read from Asentum, not from a spreadsheet.',
    points: ['Per-bot trade history', 'Portfolio balances', 'Public leaderboard'],
  },
];

const STEPS = [
  {
    index: '01',
    title: 'Choose the behaviour',
    text: 'DCA, take-profit, grid, stop-loss, TWAP or a signal contract. Each one states what it does and what it cannot do.',
    art: 'choose',
  },
  {
    index: '02',
    title: 'Set the pair and the limits',
    text: 'Pick a live Auras or AseDex pool, then enter the token allocation, ASE budget, schedule and any risk rules.',
    art: 'limits',
  },
  {
    index: '03',
    title: 'Review, then sign',
    text: 'Strata checks balances, decimals and the cron escrow. You see the token budget and the gas budget separately.',
    art: 'sign',
  },
  {
    index: '04',
    title: 'The network runs the schedule',
    text: 'The contract registers with the Asentum Cron Registry. No browser tab and no private server has to stay online.',
    art: 'run',
  },
];

const FEATURES = [
  {
    num: '01',
    title: 'Strategy templates',
    text: 'Eight production templates with documented parameters, from recurring buys to price-triggered exits.',
    href: '/strategies',
    action: 'Browse templates',
  },
  {
    num: '02',
    title: 'Risk controls',
    text: 'Stop-loss, take-profit, drawdown and daily realised-loss limits, enforced by the contract on each scheduled run.',
    href: '/deploy?template=risk-managed',
    action: 'Configure risk',
  },
  {
    num: '03',
    title: 'Advanced execution',
    text: 'Split large sales into TWAP slices, ladder out at price levels, or run a two-sided grid with separate reserves.',
    href: '/deploy?template=twap',
    action: 'Explore execution',
  },
  {
    num: '04',
    title: 'Portfolio view',
    text: 'Wallet balances, capital committed to bots, gross proceeds and the tokens each contract still holds.',
    href: '/portfolio',
    action: 'Open portfolio',
  },
  {
    num: '05',
    title: 'Public leaderboard',
    text: 'Compare wallets by deployments, filled executions, committed escrow and gross ASE output across the indexed range.',
    href: '/leaderboard',
    action: 'View leaderboard',
  },
  {
    num: '06',
    title: 'Activity ledger',
    text: 'Every indexed fill, with its block, strategy, side, size and transaction hash, in one chronological feed.',
    href: '/activity',
    action: 'Read activity',
  },
];

const FAQ = [
  {
    q: 'Do I have to keep a browser tab or server running?',
    a: 'No. Your bot is a contract registered with the Asentum Cron Registry. The network calls it on its schedule for as long as gas escrow remains in the contract. Strata is only the interface you use to deploy, inspect and manage it.',
  },
  {
    q: 'Who holds the funds while a bot runs?',
    a: 'The strategy contract you own holds the token allocation, the ASE buy reserve and the cron gas escrow. Strata never takes custody. The owner can stop the schedule and withdraw remaining ASE or reclaim unsold tokens from the bot page.',
  },
  {
    q: 'What does it cost to run a bot?',
    a: 'You fund a cron gas escrow in ASE when the schedule starts; unused escrow returns to the contract when the bot stops. Each execution spends gas from that escrow. There is no subscription and Strata takes no performance fee.',
  },
  {
    q: 'Does “source verified” mean the strategy is safe?',
    a: 'No. A source hash match only confirms that the source read back from the chain matches the hash stored in the contract account. It is a consistency check, not a security audit, and it says nothing about profitability.',
  },
  {
    q: 'Can I lose money?',
    a: 'Yes. Strategies execute spot swaps on an AMM at prices that move between scheduled runs. A stop-loss is checked only when its run executes, not continuously, and a 2% minimum-output guard can cause a swap to fail in fast markets. This is experimental testnet software, not investment advice.',
  },
  {
    q: 'Which markets can a bot trade?',
    a: 'Live pools on Auras Finance and AseDex, quoted against ASE. Strata reads pool reserves, token decimals and your balance from the chain before it lets you launch.',
  },
];

function StepArt({ kind }: { kind: string }) {
  const stroke = 'var(--accent)';
  if (kind === 'choose') {
    return (
      <svg viewBox="0 0 180 54" width="100%" height="100%" aria-hidden="true">
        {[0, 1, 2].map((row) =>
          [0, 1, 2].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={14 + col * 52}
              y={8 + row * 14}
              width="44"
              height="9"
              rx="1"
              fill={row === 0 && col === 1 ? 'var(--accent-soft)' : 'transparent'}
              stroke={row === 0 && col === 1 ? stroke : 'var(--line)'}
              strokeWidth="1"
            />
          )),
        )}
      </svg>
    );
  }
  if (kind === 'limits') {
    return (
      <svg viewBox="0 0 180 54" width="100%" height="100%" aria-hidden="true">
        <line x1="16" y1="38" x2="164" y2="38" stroke="var(--line)" />
        {[16, 53, 90, 127, 164].map((x, i) => (
          <line key={x} x1={x} y1={i === 2 ? 16 : 31} x2={x} y2="38" stroke={i === 2 ? stroke : 'var(--line)'} />
        ))}
        <line x1="90" y1="12" x2="90" y2="44" stroke={stroke} strokeDasharray="3 3" strokeOpacity="0.6" />
        <rect x="72" y="6" width="36" height="7" rx="1" fill="var(--accent-soft)" stroke="var(--accent-line)" />
      </svg>
    );
  }
  if (kind === 'sign') {
    return (
      <svg viewBox="0 0 180 54" width="100%" height="100%" aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <g key={row}>
            <circle cx="20" cy={14 + row * 15} r="4" fill="transparent" stroke={row < 2 ? stroke : 'var(--line)'} />
            {row < 2 && <path d={`M18 ${14 + row * 15} l2 2 3.5 -4`} stroke={stroke} strokeWidth="1.2" fill="none" />}
            <line x1="34" y1={14 + row * 15} x2={120 - row * 18} y2={14 + row * 15} stroke="var(--line)" />
          </g>
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 180 54" width="100%" height="100%" aria-hidden="true">
      <line x1="14" y1="40" x2="166" y2="40" stroke="var(--line)" />
      {[14, 45, 76, 107, 138, 166].map((x, i) => (
        <rect
          key={x}
          x={x - 2}
          y={i < 4 ? 26 : 32}
          width="4"
          height={i < 4 ? 14 : 8}
          fill={i < 3 ? stroke : 'var(--line)'}
          opacity={i < 3 ? 0.85 : 1}
        />
      ))}
      <path d="M14 22 L45 17 L76 24 L138 12" stroke="var(--accent-2)" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

export function Home() {
  const wallet = useWallet();
  const heads = useAsync(() => getHeads(), 12_000);
  const pools = useAsync(() => loadPools(), 60_000);
  const protocol = useAsync(() => loadProtocol(wallet.address ?? undefined), 30_000, true, wallet.address);

  const snapshot = protocol.data;
  const stats = snapshot?.stats ?? null;
  const verified = (snapshot?.strategies ?? []).filter((item) => item.verified);
  const activeBots = verified.filter((s) => s.cron !== null && s.stopped !== true).length;
  const pausedBots = verified.filter((s) => s.stopped === true).length;
  const executions = snapshot
    ? strategyRows(snapshot)
        .filter((row) => row.strategy.verified)
        .slice(0, 5)
        .map((row) => ({
          label: row.strategy.name.length > 26 ? `${row.strategy.name.slice(0, 26)}…` : row.strategy.name,
          value: row.strategy.trades,
          meta: row.strategy.symbol ? `${row.strategy.symbol}/ASE` : undefined,
        }))
    : [];

  return (
    <>
      <section className="home-hero">
        <div className="wrap home-hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">On-chain strategy automation · Asentum</span>
            <h1 className="hero-title">
              Trading strategies <br />
              that <em>run themselves</em>.
            </h1>
            <p className="hero-lede">
              Strata turns a set of trading rules into a contract on Asentum. Choose a bot, fund it from your
              wallet, and the network executes the schedule — <strong>no server, no keeper, no tab left open</strong>.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/deploy">
                Create a bot <span className="arr" aria-hidden="true">→</span>
              </Link>
              <Link className="btn btn-ghost" to="/strategies">
                Explore strategies
              </Link>
            </div>
            <div className="hero-trust">
              <span><i />Non-custodial contracts</span>
              <span><i />Wallet signs every action</span>
              <span><i />Public contract source</span>
            </div>
          </div>

          <div className="hero-visual">
            <ExecutionField
              snapshot={snapshot}
              head={heads.data?.finalized ?? null}
              pools={pools.data?.length ?? null}
              loading={protocol.loading}
              error={protocol.error}
            />
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className="stat-strip" style={{ borderTop: 'none', borderBottom: 'none' }}>
          <div className="stat">
            <span className="label">Total Bots</span>
            <div className="stat-value">{stats ? fmtNum(stats.verifiedStrategies) : '—'}</div>
            <span className="stat-sub">
              {stats ? `${activeBots} active · ${pausedBots} paused` : 'Reading the hub registry'}
            </span>
          </div>
          <div className="stat">
            <span className="label">Total Executions</span>
            <div className="stat-value">{stats ? fmtNum(stats.executedFills) : '—'}</div>
            <span className="stat-sub">Verified contract fills</span>
          </div>
          <div className="stat">
            <span className="label">Gross ASE received</span>
            <div className="stat-value">{stats ? fmtWei(stats.grossAseWei, 2) : '—'}</div>
            <span className="stat-sub">Token → ASE fills only</span>
          </div>
          <div className="stat">
            <span className="label">Open inventory</span>
            <div className="stat-value">{stats ? fmtWei(stats.inventoryAseWei, 2) : '—'}</div>
            <span className="stat-sub">Live AMM quote</span>
          </div>
          <div className="stat">
            <span className="label">Last activity</span>
            <div className="stat-value">{stats?.lastFillAt ? fmtAgeFrom(stats.lastFillAt) : '—'}</div>
            <span className="stat-sub">
              {stats ? `${fmtNum(stats.tokenSymbols.length)} token pairs` : '—'}
            </span>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="split">
          <div className="sticky-intro">
            <span className="label">The platform</span>
            <h2 className="section-title">One place for the whole life of a strategy.</h2>
            <p className="section-note" style={{ marginTop: 18 }}>
              Strata is not a signal group or a custodial dashboard. It is the interface to contracts that hold
              your rules, your budget and your exit conditions.
            </p>
            <Link className="btn btn-ghost" to="/how" style={{ marginTop: 24 }}>
              Read the docs <span className="arr" aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="cap-grid">
            {CAPABILITIES.map((item) => (
              <article className="cap-item" key={item.index}>
                <span className="feature-num">{item.index}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <ul>
                  {item.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">How Strata works</span>
            <h2 className="section-title">From rules to a scheduled contract in four steps.</h2>
          </div>
          <p className="section-note">
            Everything is signed by your wallet and recorded on Asentum. There is no backend that can move your
            funds or silently change a parameter.
          </p>
        </div>

        <div className="flow-list">
          {STEPS.map((step) => (
            <div className="flow-step" key={step.index}>
              <span className="flow-step-index">{step.index}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
              <div className="flow-step-art">
                <StepArt kind={step.art} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">Capabilities</span>
            <h2 className="section-title">Built for execution, not for screenshots.</h2>
          </div>
          <p className="section-note">
            Only features that exist in the product today — each one links to the screen where it lives.
          </p>
        </div>

        <div className="feature-ledger">
          {FEATURES.map((feature) => (
            <div className="feature-row" key={feature.num}>
              <span className="feature-num">{feature.num}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              <Link className="link-arrow" to={feature.href}>
                {feature.action} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">Protocol Analytics</span>
            <h2 className="section-title">Chain-derived numbers, plainly labelled.</h2>
          </div>
          <Link className="link-arrow" to="/analytics">
            Open analytics →
          </Link>
        </div>

        <div className="preview-grid">
          <div className="preview-main">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <span className="label">Executions per strategy</span>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 5 }}>
                  Verified contracts only · indexed fill events
                </p>
              </div>
              <span className="pill pill-live">Live data</span>
            </div>

            <div style={{ marginTop: 22 }}>
              {executions.length > 0 ? (
                <BarList data={executions} format={(value) => `${value} fills`} />
              ) : (
                <div className="empty" style={{ borderStyle: 'dashed' }}>
                  <h3>No verified executions indexed</h3>
                  <p>Once a strategy fills an order, its executions appear here and in the analytics view.</p>
                  <Link className="btn btn-ghost btn-sm" to="/deploy">
                    Deploy the first bot
                  </Link>
                </div>
              )}
            </div>

            <div className="preview-kpis">
              <div className="preview-kpi">
                <span className="label">Gross ASE received</span>
                <strong>{stats ? fmtWei(stats.grossAseWei, 2) : '—'}</strong>
              </div>
              <div className="preview-kpi">
                <span className="label">Open inventory mark</span>
                <strong>{stats ? fmtWei(stats.inventoryAseWei, 2) : '—'}</strong>
              </div>
              <div className="preview-kpi">
                <span className="label">Token types traded</span>
                <strong>{stats ? fmtNum(stats.tradedSymbols.length) : '—'}</strong>
              </div>
              <div className="preview-kpi">
                <span className="label">Indexed fills</span>
                <strong>{stats ? fmtNum(stats.indexedFills) : '—'}</strong>
              </div>
            </div>
          </div>

          <div className="preview-side">
            <span className="label">What these figures mean</span>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.65 }}>
              Gross ASE is the quote-token volume strategies received from indexed swaps — it is not net profit.
              Open inventory is valued at the current AMM quote, not a guaranteed sale price.
            </p>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.65 }}>
              Token amounts are never summed across assets, because raw units from different tokens are not
              comparable. For a per-bot estimate, enter your acquisition cost on the strategy page.
            </p>
            <Link className="btn btn-ghost" to="/analytics" style={{ alignSelf: 'flex-start', marginTop: 'auto' }}>
              Protocol analytics →
            </Link>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">Public Leaderboard</span>
            <h2 className="section-title">See who is actually executing.</h2>
          </div>
          <Link className="link-arrow" to="/leaderboard">
            Full leaderboard →
          </Link>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="label">Top strategies by filled executions</span>
              <p className="muted">Verified contracts · chain-derived counts</p>
            </div>
            <span className="pill pill-live">On-chain</span>
          </div>

          {verified.length === 0 ? (
            <div className="panel-body">
              <div className="empty" style={{ border: 0 }}>
                <h3>No verified strategies yet</h3>
                <p>The leaderboard fills as wallets register strategies with Strata Hub.</p>
                <Link className="btn btn-primary btn-sm" to="/deploy">
                  Launch a strategy
                </Link>
              </div>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Strategy</th>
                    <th>Pair</th>
                    <th>Fills</th>
                    <th>Gross ASE</th>
                    <th>Balance in contract</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...verified]
                    .sort((a, b) => b.trades - a.trades)
                    .slice(0, 5)
                    .map((item, index) => (
                      <tr key={item.address} className={index === 0 ? 'is-leader' : undefined}>
                        <td className="rank-cell">{String(index + 1).padStart(2, '0')}</td>
                        <td>
                          <Link to={`/strategies/${item.address}`} style={{ color: 'var(--text)' }}>
                            {item.name}
                          </Link>
                        </td>
                        <td>{item.symbol ? `${item.symbol}/ASE` : '—'}</td>
                        <td className="mono">{fmtNum(item.trades)}</td>
                        <td className="mono">{fmtWei(item.realisedWei, 2)}</td>
                        <td className="mono">{fmtWei(item.balanceAse, 2)}</td>
                        <td>
                          <span className={item.cron ? 'status-badge live' : 'status-badge off'}>
                            {item.cron ? 'Scheduled' : 'Idle'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">Trust & control</span>
            <h2 className="section-title">No custodian in the loop.</h2>
          </div>
          <p className="section-note">
            Three checks shape every deployment: who signs, who can exit, and what verification actually proves.
          </p>
        </div>

        <div className="trust-grid">
          <div className="trust-item">
            <span className="trust-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="4" y="10" width="16" height="10" rx="1.5" />
                <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
              </svg>
            </span>
            <h3>Your wallet signs</h3>
            <p>
              Deployment, funding, scheduling and withdrawal are separate signed transactions. Strata never asks
              for a seed phrase or private key.
            </p>
          </div>
          <div className="trust-item">
            <span className="trust-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 3v18M5 8h14M5 16h14" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </span>
            <h3>You keep the exit</h3>
            <p>
              Stop the schedule at any time, withdraw remaining ASE, and reclaim unsold tokens. The contract
              enforces the same rules for every owner.
            </p>
          </div>
          <div className="trust-item">
            <span className="trust-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 7l8-4 8 4v5c0 4.5-3.2 7.6-8 9-4.8-1.4-8-4.5-8-9V7Z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <h3>Verifiable, not guaranteed</h3>
            <p>
              The source read from the chain is compared with the contract&rsquo;s stored hash. That check proves
              consistency — never profitability, safety or an audit.
              </p>
            </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="split">
          <div className="sticky-intro">
            <span className="label">FAQ</span>
            <h2 className="section-title">The questions worth asking first.</h2>
            <p className="section-note" style={{ marginTop: 18 }}>
              Still unsure? The documentation walks through escrow, execution limits and every template
              parameter.
            </p>
            <Link className="btn btn-ghost" to="/how" style={{ marginTop: 22 }}>
              Open docs
            </Link>
          </div>

          <div className="faq">
            {FAQ.map((item) => (
              <details className="faq-item" key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <div>
            <span className="label">Start with a bot, not a terminal</span>
            <h2>Put one rule on-chain today.</h2>
            <p>
              {BOT_TYPES.map((bot) => bot.title).join(', ')} — five guided bot types, one review screen, your
              wallet on every step.
            </p>
          </div>
          <Link className="btn btn-primary" to="/deploy">
            Create your first bot <span className="arr" aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </>
  );
}
