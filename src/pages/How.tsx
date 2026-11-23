import { Link } from 'react-router-dom';
import { BOT_TYPES, TEMPLATES } from '../lib/templates';

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'quick-start', label: 'Quick start' },
  { id: 'templates', label: 'Templates' },
  { id: 'advanced-trading', label: 'Advanced Trading' },
  { id: 'tokens-wallets', label: 'Tokens & wallets' },
  { id: 'costs', label: 'Costs & escrow' },
  { id: 'limits', label: 'Risk & limits' },
  { id: 'faq', label: 'FAQ' },
  { id: 'links', label: 'Official links' },
];

const STEPS = [
  {
    number: '01',
    title: 'Choose what you want the bot to do',
    text: 'Pick one of five behaviours: DCA, take-profit, grid, stop-loss or TWAP. Every field is plain language, and the review panel shows exactly what the bot will do before you sign.',
  },
  {
    number: '02',
    title: 'Set the market and the limits',
    text: 'Select a live Auras or AseDex pool. Enter the token allocation or ASE budget, the schedule and, for risk-managed strategies, stop-loss, take-profit, drawdown and daily loss limits.',
  },
  {
    number: '03',
    title: 'Review the budget, then sign',
    text: 'Strata checks the live token balance, token decimals and the minimum cron escrow before your wallet is asked to sign. The token budget and the gas budget are shown separately.',
  },
  {
    number: '04',
    title: 'The network runs the schedule',
    text: 'The strategy registers with the Asentum Cron Registry. No browser tab and no private server needs to stay open; each run spends from the funded escrow.',
  },
  {
    number: '05',
    title: 'Monitor, stop and withdraw',
    text: 'Follow fills and estimates on the strategy page. The owner can stop the schedule, withdraw remaining ASE and reclaim unsold tokens. Unused escrow returns to the contract.',
  },
];

const FAQ = [
  {
    q: 'Do I need to install anything?',
    a: 'No. You need an Asentum wallet and some ASE for the network fee. Strata runs in the browser and never asks for a seed phrase.',
  },
  {
    q: 'What happens when the gas escrow runs out?',
    a: 'When escrow can no longer cover another run, the Cron Registry removes the job and refunds the remaining escrow. You can also stop a bot before then and withdraw its remaining funds. The current Strata interface does not expose a top-up action. Escrow is not a subscription and Strata does not bill you.',
  },
  {
    q: 'Is a strategy executed continuously?',
    a: 'No. Every template runs on a schedule. Price checks, stop-loss and take-profit are evaluated only when the scheduled call executes. Between runs the market can move freely.',
  },
  {
    q: 'Why can a swap fail?',
    a: 'Auras swaps carry a 2% minimum-output guard. In a fast or thin market the received amount can fall below that guard, so the swap reverts and the run can be retried while escrow remains. This protects against extreme slippage but does not guarantee an execution.',
  },
  {
    q: 'Does Strata hold my funds or take a performance fee?',
    a: 'No. Funds sit in the strategy contract you own, and Strata takes no performance fee. The only costs are network gas and the AMM swap fee, both paid on-chain.',
  },
];

export function How() {
  return (
    <div className="wrap doc-shell">
      <aside className="doc-nav" aria-label="Documentation sections">
        <span className="label">Documentation</span>
        {NAV.map((item) => (
          <a key={item.id} href={`#${item.id}`}>
            {item.label}
          </a>
        ))}
      </aside>

      <div className="doc-content">
        <section id="overview">
          <span className="label">Strata docs · Asentum testnet</span>
          <h1 style={{ marginTop: 14 }}>Automated strategies, documented end to end.</h1>
          <p>
            Strata turns a set of trading rules into a JavaScript contract on Asentum. The network calls that
            contract on a schedule through the Cron Registry, and every action — deployment, funding, scheduling,
            stopping and withdrawal — is a transaction your wallet signs.
          </p>
          <p>
            There is one builder: five guided bot types, a plain-language review, and a few wallet prompts. No raw
            configuration and no code needed. The three advanced templates still ship in <code>contracts/</code>{' '}
            for CLI deployments, but they are not part of the simple flow.
          </p>
          <div className="doc-hero-actions">
            <Link className="btn btn-primary" to="/deploy">
              Create a strategy <span className="arr" aria-hidden="true">→</span>
            </Link>
            <Link className="btn btn-ghost" to="/strategies">
              Browse the catalog
            </Link>
          </div>
        </section>

        <section id="quick-start">
          <h2>Quick start</h2>
          <p>
            The whole path from an idea to a running bot is five signed steps. Keep the deploy tab open while the
            wallet confirms each one.
          </p>
          <div className="doc-steps">
            {STEPS.map((step) => (
              <div className="doc-step" key={step.number}>
                <span className="feature-number">{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="templates">
          <h2>Templates</h2>
          <p>
            Eight contracts are supported. Five are available in the builder; the other three are advanced
            templates deployed from the CLI.
          </p>

          <div className="table-scroll">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>What it needs</th>
                  <th>Cadence</th>
                  <th>Behaviour</th>
                </tr>
              </thead>
              <tbody>
                {TEMPLATES.map((template) => {
                  const guided = BOT_TYPES.find((bot) => bot.templateId === template.id);
                  const needs =
                    template.requires === 'gas'
                      ? 'ASE gas escrow only'
                      : template.requires === 'ase'
                        ? 'ASE budget + escrow'
                        : template.requires === 'both'
                          ? 'Tokens + ASE reserve + escrow'
                          : 'Token allocation + escrow';
                  return (
                    <tr key={template.id}>
                      <td>
                        {template.name}
                        <span className="dim" style={{ display: 'block', fontSize: 12.5, fontWeight: 400, marginTop: 3 }}>
                          {guided ? 'Simple builder' : 'CLI only'}
                        </span>
                      </td>
                      <td>{needs}</td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{template.intervalSec}s</td>
                      <td style={{ fontSize: 13.5, lineHeight: 1.6 }}>{template.behavior}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="doc-callout" style={{ borderLeftColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
            <strong>Execution is scheduled, not continuous</strong>
            Price conditions are evaluated each time the cron job runs. Between runs the market keeps moving, so a
            target can be crossed and missed without an execution.
          </div>
        </section>

        <section id="advanced-trading">
          <h2>Advanced Trading</h2>
          <p>
            Advanced Trading is the manual spot-trading workspace. It reads market pairs, candles and recent fills
            from the Auras public indexer and reads pool reserves and token decimals from Asentum contracts.
          </p>
          <ul>
            <li><strong style={{ color: 'var(--text)' }}>Timeframes:</strong> 1m, 5m, 15m, 30m, 1h, 4h, 1d and 1w. The 30m and 1w views are aggregated from smaller indexed candles.</li>
            <li><strong style={{ color: 'var(--text)' }}>Candles:</strong> built from indexed AMM Swap events. Buckets with no fills remain gaps; Strata does not fabricate prices or volume.</li>
            <li><strong style={{ color: 'var(--text)' }}>Market orders:</strong> immediate AMM swaps. The app refreshes the quote before asking the wallet to sign and applies a minimum-output/slippage guard.</li>
            <li><strong style={{ color: 'var(--text)' }}>Limit orders:</strong> escrowed, scheduled AMM execution is available only on supported Auras v2 pools. These are not resting orders in a central order book and do not use a matching engine.</li>
            <li><strong style={{ color: 'var(--text)' }}>AseDex:</strong> market swaps are supported where a live ASE pool is indexed. The Auras v2 limit-order module is not available on AseDex pools.</li>
            <li><strong style={{ color: 'var(--text)' }}>Bot mode:</strong> creates a Spot strategy contract for the selected pool. The builder receives the exact on-chain pool ID and venue.</li>
            <li><strong style={{ color: 'var(--text)' }}>Spot bots:</strong> DCA, Grid, TWAP, Momentum, Risk-managed exits, Limit Sell and Scale Order run through Asentum Cron. They do not use leverage or open short positions.</li>
            <li><strong style={{ color: 'var(--text)' }}>Stop-loss / take-profit:</strong> are conditions inside the Risk-managed Spot strategy. They are checked only when the scheduled Cron run executes, not continuously.</li>
          </ul>
          <p>
            The chart timeframe is independent of the bot schedule. Asentum Cron supports intervals from 60 seconds,
            but not sub-minute high-frequency execution. A 5m chart does not automatically make a bot run every 5m;
            choose the execution interval separately in the builder.
          </p>
          <p>
            <strong style={{ color: 'var(--text)' }}>Perps are a separate product.</strong> They require long/short positions,
            margin, leverage, funding, mark/index prices and liquidation rules from a real derivatives venue. No such
            provider is connected here, so the Perps panel is disabled. Spot bots must never be described as Perps.
          </p>
          <div className="doc-hero-actions">
            <Link className="btn btn-primary" to="/advanced">Open Advanced Trading</Link>
            <Link className="btn btn-ghost" to="/deploy">Create a bot</Link>
          </div>
        </section>

        <section id="tokens-wallets">
          <h2>Tokens & wallet registry</h2>
          <p>
            Create Token deploys a user-owned ARC-20 contract to the Asentum testnet and initializes a fixed supply
            to the deploying wallet. The token contract has no hidden mint, tax, blacklist or pause function.
            Token deployment and initialization are separate wallet-confirmed transactions; if initialization fails,
            the deployed contract can be recovered and initialized again.
          </p>
          <p>
            Asentum documents ARC-20 as a draft application standard. Strata uses the published interface and
            verifies the token name, symbol, decimals, supply and deployer balance by reading the contract after
            initialization. Token creation does not automatically create a liquidity pool.
          </p>
          <p>
            Strata has no server-side user database. Strategies and transaction history are stored locally in the
            browser and keyed by wallet. The optional Wallet Registry is off by default and stores only public
            addresses in this browser after explicit opt-in. Turning it off clears the saved list. No private keys,
            seed phrases or signatures are collected.
          </p>
          <div className="doc-hero-actions">
            <Link className="btn btn-primary" to="/create-token">Create a token</Link>
            <Link className="btn btn-ghost" to="/portfolio">Open portfolio & wallet settings</Link>
          </div>
        </section>

        <section id="costs">
          <h2>Costs & escrow</h2>
          <p>
            A bot has two separate budgets, and Strata shows them separately before you sign:
          </p>
          <ul>
            <li>
              <strong style={{ color: 'var(--text)' }}>Cron gas escrow</strong> — paid in ASE when the schedule
              starts. Each run spends from it. Whatever remains when you stop the bot returns to the contract and
              can be withdrawn.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Trading budget</strong> — tokens for sell-side templates, an
              ASE reserve for DCA and grid buys, or both for a grid. These funds sit in the contract, not with
              Strata.
            </li>
          </ul>
          <p style={{ marginTop: 12 }}>
            AMM swaps also pay the pool fee (shown as basis points on the pair). There is no Strata subscription and
            no performance fee. Gas prices and swap prices are network conditions, not something the interface can
            promise in advance.
          </p>
        </section>

        <section id="limits">
          <h2>Risk & limits</h2>
          <p>
            Read this before funding any strategy. Strata is experimental testnet software and not investment
            advice.
          </p>
          <ul>
            <li>Strategies execute spot swaps on an AMM. Price impact and slippage are real, especially in thin pools.</li>
            <li>Each swap uses a 2% minimum-output guard. In fast markets this can make a run revert instead of filling.</li>
            <li>Stop-loss, take-profit and drawdown are checked only on scheduled runs, using the pool reserve price.</li>
            <li>Once triggered, a risk exit is latched and sells at most one configured amount per run until the allocation is exhausted.</li>
            <li>Daily loss limits use your declared average cost and realised fills only. They exclude unrealised inventory losses and gas.</li>
            <li>A source hash match proves the source read from the chain matches the stored hash. It is not an audit and says nothing about profitability.</li>
            <li>Token events do not carry wall-clock timestamps; the activity ledger therefore shows blocks alongside transaction hashes.</li>
          </ul>
        </section>

        <section id="faq">
          <h2>FAQ</h2>
          <div className="faq" style={{ marginTop: 18 }}>
            {FAQ.map((item) => (
              <details className="faq-item" key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="links">
          <h2>Official links</h2>
          <p>Primary sources for the chain, the venues and the source code behind this interface.</p>
          <div className="doc-links">
            <a className="doc-link" href="https://www.asentum.com/docs" target="_blank" rel="noreferrer">
              Asentum documentation <span aria-hidden="true">↗</span>
            </a>
            <a className="doc-link" href="https://www.asentum.com/docs/guides/scheduled-calls" target="_blank" rel="noreferrer">
              Scheduled calls guide <span aria-hidden="true">↗</span>
            </a>
            <a className="doc-link" href="https://explorer.asentum.com" target="_blank" rel="noreferrer">
              Asentum explorer <span aria-hidden="true">↗</span>
            </a>
            <a className="doc-link" href="https://auras.finance" target="_blank" rel="noreferrer">
              Auras Finance <span aria-hidden="true">↗</span>
            </a>
            <a className="doc-link" href="https://asepad.fun" target="_blank" rel="noreferrer">
              AsePad / AseDex <span aria-hidden="true">↗</span>
            </a>
            <a className="doc-link" href="https://github.com/Juniorj87/strata" target="_blank" rel="noreferrer">
              Strata source repository <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
