import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { loadStrategy } from '../lib/registry';
import { explorerAddressUrl, explorerTxUrl } from '../lib/rpc';
import { fmtDuration, fmtWei, shortHash, weiToAse } from '../lib/format';
import { CodeBlock } from '../components/CodeBlock';

function nextRunLabel(cron: { nextRunAt: string } | null): string {
  if (!cron?.nextRunAt) return 'not scheduled';
  const raw = Number(cron.nextRunAt);
  if (!Number.isFinite(raw) || raw === 0) return 'not scheduled';
  const seconds = raw > 1e12 ? Math.floor((raw - Date.now()) / 1000) : Math.floor(raw - Date.now() / 1000);
  return seconds > 0 ? `in ${fmtDuration(seconds)}` : 'due now';
}

export function StrategyDetail() {
  const { address = '' } = useParams();
  const { data: strategy, loading, error } = useAsync(
    () => loadStrategy(address.toLowerCase()),
    12000,
    address.length > 0,
  );

  if (loading) {
    return (
      <section className="wrap section">
        <div className="skeleton" style={{ height: 320 }} />
      </section>
    );
  }

  if (error || !strategy) {
    return (
      <section className="wrap section">
        <h1 className="detail-title">Strategy not found</h1>
        <p className="muted">
          {error ? `Chain read failed: ${error}` : 'No contract source at that address - it may not exist yet.'}
        </p>
        <Link className="btn btn-ghost" to="/strategies" style={{ marginTop: 20 }}>
          Back to registry
        </Link>
      </section>
    );
  }

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">{strategy.template} template</span>
        <h1 className="detail-title">{strategy.name}</h1>
        <div className="detail-meta">
          <span className={strategy.verified ? 'verify' : 'verify bad'}>
            {strategy.verified ? '✓ source hash matches codeHash' : '✗ hash mismatch'}
          </span>
          <span className="mono">{strategy.ase1}</span>
          <span>·</span>
          <span>first event at block {strategy.deployBlock.toLocaleString('en-US')}</span>
          <span>·</span>
          <a className="link-arrow" href={explorerAddressUrl(strategy.address)} target="_blank" rel="noreferrer">
            explorer ↗
          </a>
        </div>
      </section>

      <section className="wrap">
        <div className="metrics">
          <div className="metric">
            <div className="metric-label">Fills</div>
            <div className="metric-value">{strategy.trades}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Volume</div>
            <div className="metric-value">{fmtWei(strategy.volumeWei, 2)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">ASE held</div>
            <div className="metric-value">{fmtWei(strategy.balanceAse, 3)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Realised</div>
            <div className="metric-value">{fmtWei(strategy.realisedWei, 3)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Cadence</div>
            <div className="metric-value">
              {strategy.intervalSec ? fmtDuration(strategy.intervalSec) : '-'}
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 80 }}>
        <div className="panels">
          <div style={{ display: 'grid', gap: 20 }}>
            <div className="panel">
              <div className="panel-head">
                <span className="label">Contract source - read from the node</span>
                <span className="mono dim" style={{ fontSize: 12 }}>
                  {strategy.source.length} chars
                </span>
              </div>
              <CodeBlock source={strategy.source} />
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="label">Events</span>
                <span className="mono dim" style={{ fontSize: 12 }}>
                  {strategy.events.length} on chain
                </span>
              </div>
              {strategy.events.length === 0 ? (
                <div className="panel-body muted">No events emitted yet.</div>
              ) : (
                strategy.events.map((event) => (
                  <div className="log-row" key={`${event.txHash}-${event.block}-${event.name}`}>
                    <span className="dim">#{event.block.toLocaleString('en-US')}</span>
                    <span>
                      {event.name}
                      <span className="dim" style={{ display: 'block', fontSize: 11 }}>
                        {Object.entries(event.args)
                          .filter(([key]) => key !== 'poolId')
                          .map(([key, value]) => `${key}=${String(value).slice(0, 28)}`)
                          .join('  ')}
                      </span>
                      <a
                        className="dim"
                        style={{ display: 'block', fontSize: 11 }}
                        href={explorerTxUrl(event.txHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortHash(event.txHash)} ↗
                      </a>
                    </span>
                    <span />
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 20 }}>
            <div className="panel">
              <div className="panel-head">
                <span className="label">Schedule</span>
                <span className="live-dot">cron</span>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Job id</dt>
                  <dd>{strategy.jobId ?? '-'}</dd>
                  <dt>Interval</dt>
                  <dd>{strategy.cron ? `${strategy.cron.intervalSec}s` : strategy.intervalSec ? `${strategy.intervalSec}s` : '-'}</dd>
                  <dt>Next run</dt>
                  <dd>{nextRunLabel(strategy.cron)}</dd>
                  <dt>Gas escrow</dt>
                  <dd>{strategy.cron ? `${weiToAse(strategy.cron.gasEscrow, 4)} ASE` : '-'}</dd>
                  <dt>Runs left</dt>
                  <dd>{strategy.cron?.runsLeft ?? '-'}</dd>
                </dl>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="label">Verification</span>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>On-chain</dt>
                  <dd style={{ wordBreak: 'break-all' }}>{strategy.codeHash || '-'}</dd>
                  <dt>Local BLAKE3</dt>
                  <dd style={{ wordBreak: 'break-all' }}>{strategy.localHash}</dd>
                  <dt>Verdict</dt>
                  <dd>{strategy.verified ? 'match' : 'mismatch'}</dd>
                </dl>
                <p className="muted" style={{ marginTop: 16, fontSize: 13.5 }}>
                  The source above was fetched with <code>eth_getCode</code>, hashed locally, and compared with the
                  <code> codeHash</code> the contract stores. That is the whole verification story - no compiler,
                  no submission form.
                </p>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="label">Venue</span>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Pool</dt>
                  <dd>{strategy.poolId ? `Auras #${strategy.poolId}` : '-'}</dd>
                  <dt>Pair</dt>
                  <dd>{strategy.symbol ? `${strategy.symbol}/ASE` : '-'}</dd>
                  <dt>Last signal</dt>
                  <dd>{strategy.lastSignal ?? '-'}</dd>
                  <dt>Signal block</dt>
                  <dd>{strategy.lastSignalBlock?.toLocaleString('en-US') ?? '-'}</dd>
                </dl>
              </div>
            </div>

            <div className="panel">
              <div className="panel-body" style={{ textAlign: 'center' }}>
                <p className="muted" style={{ fontSize: 14, marginBottom: 16 }}>
                  Fork this template with your own parameters. The source is yours to copy.
                </p>
                <Link className="btn btn-primary" to={`/deploy?template=${strategy.template}`}>
                  Deploy this strategy
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
