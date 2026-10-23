import { Link } from 'react-router-dom';
import { CodeBlock } from '../components/CodeBlock';
import { Walkthrough } from '../components/Walkthrough';

const CONTRACT = `// Strata template: momentum-signal
//
// Reads the AMM's own TWAP accumulator and publishes a signal every interval.
// The chain fires tick() - no keeper, no server, no API key.

const AURAS = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';

export default class MomentumSignal {
  constructor() {
    this.ticks = 0;
  }

  init(poolId, token, thresholdBps, intervalSec) {
    this.poolId = String(poolId);
    this.token = String(token);
    this.thresholdBps = BigInt(thresholdBps);
    this.ticks = 0;

    // Register the job once. The chain fires it every interval, forever.
    const jobId = cron.schedule(
      this.address,
      'tick',
      [],
      chain.timestamp + Number(intervalSec),
      Number(intervalSec),
      0,
      400000n,
    );
    storage.set('jobId', String(jobId));

    emit('Armed', {
      poolId: this.poolId,
      token: this.token,
      thresholdBps: thresholdBps.toString(),
      intervalSec: String(intervalSec),
      jobId: String(jobId),
    });
  }

  async tick() {
    this.ticks += 1;

    // consult() returns the AMM's TWAP accumulators and reserves.
    const twap = JSON.parse(await E(AURAS).consult(this.poolId));
    const drift = driftBps(twap);

    let signal = 'hold';
    if (drift > this.thresholdBps) signal = 'sell';
    else if (drift < -this.thresholdBps) signal = 'buy';

    emit('Signal', {
      signal,
      driftBps: drift.toString(),
      ticks: String(this.ticks),
    });
  }
}

// Spot drift of token0 against the native side, in basis points.
function driftBps(twap) {
  const reserve0 = BigInt(twap.reserve0);
  const reserve1 = BigInt(twap.reserve1);
  if (reserve0 === 0n || reserve1 === 0n) return 0n;
  return ((reserve0 - reserve1) * 10000n) / reserve0;
}`;

const LIMITS = `// What the chain gives a strategy

cron.schedule(target, method, args, nextRunAt, intervalSec, maxRuns, gasLimit)
  Registers a job in the protocol cron registry. The block builder fires it
  inside block apply - no keeper, no off-chain runner.

E(addr).method(args)
  Asynchronous cross-contract call. Returns a promise. A strategy cannot be
  re-entered mid-execution, and a failed leg reverts the whole tick.

emit(name, payload)
  Indexed event. The registry, the explorer and any indexer read these.

transfer(to, amount)
  Sends native ASE out of the contract.

msg.sender
  The chain calls scheduled methods with the zero address as sender - gate
  anything that should only run on a user transaction.`;

// What a contract cannot do on Asentum today - read straight from the docs
// and verified against the AMM source on chain.
const LIMITS_NOT = `// Hard limits we found in the VM (v0.8.1)

E() carries no value.
  A contract cannot open the NATIVE side of a swap: Auras reads msg.value and
  a cross-contract call arrives with zero. Strategies trade the ARC-20 side.

E() does not work inside view methods.
  A strategy can read another contract inside a transaction (tick), not from
  its own view endpoints.

No Date.now(), no Math.random().
  Use msg.block.timestamp. There is no randomness primitive in v1.

Library approval is disabled by governance.
  A contract cannot import anything - the source must be self-contained.`;

/** Small deploy helper shared by the templates. */
export function How() {
  return (
    <>
      <section className="wrap detail-head">
        <span className="label">How it works</span>
        <h1 className="detail-title">The chain is the scheduler.</h1>
        <p className="section-note" style={{ maxWidth: 680 }}>
          Asentum is a JavaScript-native L1 with protocol-level scheduled execution. A strategy contract arms
          itself once, and the chain calls it on time forever - with the money, the history and the source all
          on-chain.
        </p>
      </section>

      <section className="wrap section" style={{ borderTop: 0, paddingTop: 24 }}>
        <div className="steps">
          <div className="step">
            <div className="step-num">01 / WRITE</div>
            <h3>Plain JavaScript</h3>
            <p>
              A strategy is a contract like any other. Storage, events, an async call into the AMM - the same
              primitives any dapp on Asentum uses.
            </p>
          </div>
          <div className="step">
            <div className="step-num">02 / DEPLOY</div>
            <h3>Source is the artifact</h3>
            <p>
              There is no compiler and no submission form. The deployed source is what runs, and its BLAKE3 hash
              sits in contract state next to the code.
            </p>
          </div>
          <div className="step">
            <div className="step-num">03 / RUN</div>
            <h3>The chain fires it</h3>
            <p>
              <code>cron.schedule</code> puts the job in the protocol registry. Every interval the block builder
              executes it and settles the result.
            </p>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">The contract</span>
            <h2 className="section-title">A complete strategy, source and all.</h2>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <span className="label">contracts/auras-momentum-signal.js</span>
            <span className="mono dim" style={{ fontSize: 12 }}>
              verified by hash on chain
            </span>
          </div>
          <CodeBlock source={CONTRACT} />
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <span className="label">Interactive walkthrough</span>
            <h2 className="section-title">Run one tick yourself.</h2>
          </div>
        </div>
        <p className="section-note" style={{ maxWidth: 640, marginBottom: 16 }}>
          Every interval the chain fires <code>tick()</code>. The strategy reads the AMM's TWAP, compares the drift
          with <code>thresholdBps</code> and emits exactly one signal. Tighten the threshold and watch <code>hold</code>{' '}
          turn into <code>buy</code>/<code>sell</code>.
        </p>
        <Walkthrough />
      </section>

      <section className="wrap section">
        <div className="how-grid">
          <div className="panel">
            <div className="panel-head">
              <span className="label">What the VM gives you</span>
            </div>
            <CodeBlock source={LIMITS} />
          </div>
          <div className="panel">
            <div className="panel-head">
              <span className="label">And what it does not</span>
            </div>
            <CodeBlock source={LIMITS_NOT} />
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="panel">
          <div className="panel-body" style={{ textAlign: 'center', padding: '46px 24px' }}>
            <span className="label">Next</span>
            <h2 className="section-title" style={{ margin: '12px auto 14px', maxWidth: 620 }}>
              Deploy the first strategy and watch the registry fill up.
            </h2>
            <p className="muted" style={{ maxWidth: 520, margin: '0 auto 26px' }}>
              The script signs, deploys, arms the cron job and writes the address into the registry config. The
              site reads it back from the chain.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link className="btn btn-primary" to="/deploy">
                Open the deployer
              </Link>
              <Link className="btn btn-ghost" to="/strategies">
                See the registry
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
