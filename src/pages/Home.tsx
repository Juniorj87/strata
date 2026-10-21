import { Link } from 'react-router-dom';
import { chainStats, strategies } from '../data/mock';
import { fmtNum } from '../lib/format';
import { CodeBlock } from '../components/CodeBlock';
import { StrategyCard } from '../components/StrategyCard';
import { Tape } from '../components/Tape';

const SNIPPET = `// A strategy is a contract. It schedules itself, then trades.
export default class Twap {
  init(pool, notionalWei) {
    this.pool = pool;
    this.notionalWei = BigInt(notionalWei);

    // The chain fires this every hour. No keeper. No server.
    cron.schedule(this.address, 'tick', [], chain.timestamp + 3600, 3600, 0, 300000n);
  }

  async tick() {
    await E(this.pool).swapExactIn(QUOTE_TOKEN, this.notionalWei / 6n);
    emit('Leg', { filled: true });
  }
}`;

const COMPARE: [string, string, string][] = [
  ['Where the logic lives', 'On a server you control', 'On chain, source published'],
  ['Runs when your laptop sleeps', 'No', 'Yes — the chain fires it'],
  ['Scheduler', 'cron job or bot keeper', 'Protocol-level cron'],
  ['Cost to stay alive', 'Hosting + API keys', 'Gas escrow per job'],
  ['Audit before you trust it', 'Ask the operator', 'Read the source in the explorer'],
  ['Kill switch', 'Kill the process', 'Cancel the scheduled job'],
  ['History', 'Off-chain, yours to trust', 'Every call is a transaction'],
];

export function Home() {
  const featured = strategies.filter((s) => s.status === 'live').slice(0, 3);

  return (
    <>
      <section className="wrap hero">
        <div className="hero-copy">
          <span className="label">Trading strategies as contracts</span>
          <h1 className="hero-title">
            Your strategy runs on the <em>chain</em>, not on a server.
          </h1>
          <p className="hero-lede">
            Write trading logic as a JavaScript contract, deploy it once, and let the protocol schedule it. The
            source is public, every fill is a transaction, and there is no bot to keep alive.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/deploy">
              Deploy a strategy
            </Link>
            <Link className="btn btn-ghost" to="/strategies">
              Browse strategies
            </Link>
          </div>
          <p className="hero-note">
            chain 1423 · 2s blocks · native ASE · built on the public Asentum testnet
          </p>
        </div>

        <div className="hero-side">
          <Tape />
        </div>
      </section>

      <section className="wrap">
        <div className="stat-strip">
          <div className="stat">
            <div className="label">Block height</div>
            <div className="stat-value">{fmtNum(chainStats.blockHeight)}</div>
            <div className="stat-sub">finalised, ~2s apart</div>
          </div>
          <div className="stat">
            <div className="label">Strategies live</div>
            <div className="stat-value">{chainStats.strategiesLive}</div>
            <div className="stat-sub">on-chain, all public</div>
          </div>
          <div className="stat">
            <div className="label">Volume routed</div>
            <div className="stat-value">{fmtNum(chainStats.volumeAse)} ASE</div>
            <div className="stat-sub">through Auras pools</div>
          </div>
          <div className="stat">
            <div className="label">Strategy calls</div>
            <div className="stat-value">{fmtNum(chainStats.strategyTxs)}</div>
            <div className="stat-sub">cron-fired transactions</div>
          </div>
        </div>
      </section>

      <section className="wrap section" id="how">
        <div className="section-head">
          <div>
            <span className="label">How it works</span>
            <h2 className="section-title">Three steps, then you stop touching it.</h2>
          </div>
          <p className="section-note">
            Asentum runs contracts in a hardened JavaScript sandbox and schedules them at the protocol level, so a
            strategy contract can re-arm itself with a single line of code.
          </p>
        </div>

        <div className="steps">
          <div className="step">
            <div className="step-num">01 / WRITE</div>
            <h3>Plain JavaScript</h3>
            <p>
              A strategy is a contract like any other: top-level functions, a storage map, an event per decision.
              No Solidity, no ABI, no build pipeline to fight.
            </p>
          </div>
          <div className="step">
            <div className="step-num">02 / DEPLOY</div>
            <h3>Source goes on chain</h3>
            <p>
              Deployment uploads the source itself — it is what runs, forever. Anyone can read it in the explorer
              and verify the hash before they fund it.
            </p>
          </div>
          <div className="step">
            <div className="step-num">03 / RUN</div>
            <h3>The chain fires it</h3>
            <p>
              <code>cron.schedule()</code> registers a job in the protocol registry. Every interval the chain
              executes the call and settles the trade — no keeper, no server, no API keys to rotate.
            </p>
          </div>
        </div>

        <div className="grid grid-2" style={{ marginTop: 20 }}>
          <div className="panel">
            <div className="panel-head">
              <span className="label">A strategy contract</span>
              <span className="mono dim" style={{ fontSize: 12 }}>
                strategy.js
              </span>
            </div>
            <CodeBlock source={SNIPPET} />
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="label">What you get instead</span>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Scheduler</dt>
                <dd>protocol cron registry</dd>
                <dt>Execution</dt>
                <dd>inside block apply, final</dd>
                <dt>Cost</dt>
                <dd>gas escrow, prepaid</dd>
                <dt>Audit</dt>
                <dd>source + BLAKE3 hash on chain</dd>
                <dt>Failure mode</dt>
                <dd>job exhausts, funds stay yours</dd>
                <dt>Kill switch</dt>
                <dd>cancel the job, refund escrow</dd>
              </dl>
              <p className="muted" style={{ marginTop: 18, fontSize: 14 }}>
                The strategy contract calls into the AMM with <code>E(pool).swapExactIn(...)</code> — asynchronous,
                so the call cannot be re-entered, and a failed leg reverts the whole tick.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">Live strategies</span>
            <h2 className="section-title">People already run these without a server.</h2>
          </div>
          <Link className="link-arrow" to="/strategies">
            View all strategies →
          </Link>
        </div>

        <div className="grid grid-3">
          {featured.map((s) => (
            <StrategyCard key={s.id} strategy={s} />
          ))}
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">Why a contract, not a bot</span>
            <h2 className="section-title">The difference is who holds the clock.</h2>
          </div>
        </div>

        <div className="panel">
          <table className="compare">
            <thead>
              <tr>
                <th />
                <th>Off-chain bot</th>
                <th className="ours">On-chain strategy</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([label, bot, contract]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="muted">{bot}</td>
                  <td className="ours">{contract}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wrap section">
        <div className="panel">
          <div className="panel-body" style={{ textAlign: 'center', padding: '46px 24px' }}>
            <span className="label">Start small</span>
            <h2 className="section-title" style={{ margin: '12px auto 14px', maxWidth: 620 }}>
              Deploy one template, watch the chain run it for an hour.
            </h2>
            <p className="muted" style={{ maxWidth: 520, margin: '0 auto 26px' }}>
              Templates for momentum, mean reversion, TWAP, grid and DCA. Your first strategy costs a few ASE in
              gas and runs unattended.
            </p>
            <Link className="btn btn-primary" to="/deploy">
              Open the deployer
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
