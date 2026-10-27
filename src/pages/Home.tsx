import { Link } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { getHeads } from '../lib/rpc';
import { loadPools, loadStrategies, loadTape } from '../lib/registry';
import { CodeBlock } from '../components/CodeBlock';
import { PoolGrid } from '../components/PoolGrid';
import { StrategyCard } from '../components/StrategyCard';
import { Tape } from '../components/Tape';
import { WalletConnectButton } from '../components/WalletConnectButton';

const SNIPPET = `// A strategy is a contract. It schedules itself, then reads the AMM.
export default class Momentum {
  init(poolId, token, thresholdBps) {
    this.poolId = poolId;
    this.token = token;
    this.thresholdBps = BigInt(thresholdBps);

    // The chain fires this every minute. No keeper. No server.
    const jobId = cron.schedule(this.address, 'tick', [], chain.timestamp + 60, 60, 0, 500000n);
    storage.set('jobId', String(jobId));
  }

  async tick() {
    // The AMM's own TWAP accumulator - no oracle contract needed.
    const twap = JSON.parse(await E(AURAS).consult(this.poolId));
    const drift = driftBps(twap);

    if (drift > this.thresholdBps) emit('Signal', { signal: 'sell', driftBps: drift.toString() });
    else emit('Signal', { signal: 'hold', driftBps: drift.toString() });
  }
}`;

const COMPARE: [string, string, string][] = [
  ['Where the logic lives', 'On a server you control', 'On chain, source published'],
  ['Runs when your laptop sleeps', 'No', 'Yes - the chain fires it'],
  ['Scheduler', 'cron job or bot keeper', 'Protocol-level cron registry'],
  ['Cost to stay alive', 'Hosting + API keys', 'Gas escrow per job'],
  ['Audit before you trust it', 'Ask the operator', 'Read the source, verify the hash'],
  ['Kill switch', 'Kill the process', 'Cancel the scheduled job'],
  ['Price data', 'Your API key, your risk', "The AMM's own TWAP accumulator"],
];

export function Home() {
  const heads = useAsync(() => getHeads(), 4000);
  const tape = useAsync(() => loadTape(10), 6000);
  const pools = useAsync(() => loadPools(), 15000);
  const strategies = useAsync(() => loadStrategies(), 15000);

  const live = strategies.data ?? [];

  return (
    <>
      <section className="wrap hero">
        <div className="hero-copy">
          <span className="label">Adaptive strategies as contracts</span>
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
            <WalletConnectButton />
          </div>
          <p className="hero-note">
            chain 1423 · 2s blocks · native ASE · live data read straight from the chain
          </p>
        </div>

        <div className="hero-side">
          <Tape rows={tape.data ?? []} />
        </div>
      </section>

      <section className="wrap">
        <div className="stat-strip">
          <div className="stat">
            <div className="label">Finalised height</div>
            <div className="stat-value">{heads.data?.finalized.toLocaleString('en-US') ?? '-'}</div>
            <div className="stat-sub">never changes, ~2s blocks</div>
          </div>
          <div className="stat">
            <div className="label">Tip</div>
            <div className="stat-value">{heads.data?.tip.toLocaleString('en-US') ?? '-'}</div>
            <div className="stat-sub">~3 blocks ahead of finality</div>
          </div>
          <div className="stat">
            <div className="label">Auras pools</div>
            <div className="stat-value">{pools.data?.length ?? '-'}</div>
            <div className="stat-sub">live reserves and TWAP</div>
          </div>
          <div className="stat">
            <div className="label">Strategies</div>
            <div className="stat-value">{strategies.loading ? '…' : live.length}</div>
            <div className="stat-sub">discovered on chain</div>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">The venue</span>
            <h2 className="section-title">Auras pools, read live.</h2>
          </div>
          <a className="link-arrow" href="https://auras.finance" target="_blank" rel="noreferrer">
            Open Auras ↗
          </a>
        </div>
        <PoolGrid pools={pools.data?.slice(0, 12) ?? []} loading={pools.loading} />
      </section>

      <section className="wrap section">
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
              Deployment uploads the source itself - it is what runs, forever. Anyone can read it in the explorer
              and verify the BLAKE3 hash before they fund it.
            </p>
          </div>
          <div className="step">
            <div className="step-num">03 / RUN</div>
            <h3>The chain fires it</h3>
            <p>
              <code>cron.schedule()</code> registers a job in the protocol registry. Every interval the chain
              executes the call and settles the trade - no keeper, no server, no API keys to rotate.
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
              <span className="label">What the chain gives you</span>
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
                <dt>Price feed</dt>
                <dd>AMM TWAP accumulator</dd>
                <dt>Kill switch</dt>
                <dd>cancel the job, refund escrow</dd>
              </dl>
              <p className="muted" style={{ marginTop: 18, fontSize: 14 }}>
                Cross-contract calls are asynchronous, so a strategy cannot be re-entered mid-execution and a
                failed leg reverts the whole tick.
              </p>
              <Link className="link-arrow" to="/how" style={{ display: 'inline-block', marginTop: 14 }}>
                Read the long version →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">Live strategies</span>
            <h2 className="section-title">Contracts that trade while you sleep.</h2>
          </div>
          <Link className="link-arrow" to="/strategies">
            View all strategies →
          </Link>
        </div>

        {strategies.loading && (
          <div className="grid grid-3">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        )}

        {!strategies.loading && live.length === 0 && (
          <div className="empty">
            <h3>No strategy is deployed yet.</h3>
            <p style={{ maxWidth: 480, margin: '0 auto 20px' }}>
              The registry reads the chain directly. Deploy the first one and it shows up here - source, hash
              verification, cron schedule and every fill.
            </p>
            <Link className="btn btn-primary" to="/deploy">
              Deploy the first strategy
            </Link>
          </div>
        )}

        <div className="grid grid-3">
          {live.slice(0, 3).map((s) => (
            <StrategyCard key={s.address} strategy={s} />
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
              Templates for momentum, mean reversion, TWAP, grid and DCA. The first one costs a few ASE in gas and
              runs unattended.
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
