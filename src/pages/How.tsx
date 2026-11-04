import { Link } from 'react-router-dom';
import { BOT_TYPES, TEMPLATES } from '../lib/templates';

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'quick-start', label: 'Quick start' },
  { id: 'templates', label: 'Templates' },
  { id: 'costs', label: 'Costs & escrow' },
  { id: 'limits', label: 'Risk & limits' },
  { id: 'faq', label: 'FAQ' },
  { id: 'links', label: 'Official links' },
];

const STEPS = [
  {
    number: '01',
    title: 'Choose what you want the bot to do',
    text: 'In the simple terminal pick one of five behaviours: DCA, take-profit, grid, stop-loss or TWAP. Pro exposes all eight templates with raw parameters, the CLI command and contract inspection.',
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
    q: 'Do I need to install anything to use Lite?',
    a: 'No. You need an Asentum wallet and some ASE for the network fee. Lite runs in the browser and never asks for a seed phrase. Pro mode is optional and aimed at developers who want raw parameters, source inspection and a local CLI workflow.',
  },
  {
    q: 'What happens when the gas escrow runs out?',
    a: 'Scheduled runs stop when the contract can no longer pay for them. The owner can top up or stop the bot and withdraw the remaining balance. Escrow is not a subscription and Strata does not bill you.',
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
            The product is deliberately split in two. <strong style={{ color: 'var(--text)' }}>Lite</strong> is the
            default: five guided bot types, plain-language review, no code. <strong style={{ color: 'var(--text)' }}>Pro</strong>{' '}
            exposes all eight templates, raw parameters, the source hash and a PowerShell command for a local
            signer.
          </p>
          <div className="doc-hero-actions">
            <Link className="btn btn-primary" to="/deploy">
              Create a strategy <span className="arr" aria-hidden="true">→</span>
            </Link>
            <Link className="btn btn-ghost" to="/deploy?mode=pro">
              Open Pro mode
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
            Eight contracts are supported. The five in the simple terminal are marked below; every template is
            available in Pro with its full parameter set.
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
                        <span className="dim" style={{ display: 'block', fontSize: 10.5, fontWeight: 400, marginTop: 2 }}>
                          {guided ? 'Lite + Pro' : 'Pro only'}
                        </span>
                      </td>
                      <td>{needs}</td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{template.intervalSec}s</td>
                      <td style={{ fontSize: 12 }}>{template.behavior}</td>
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
