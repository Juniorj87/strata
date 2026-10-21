import { Link, useParams } from 'react-router-dom';
import { executionLog, strategyById } from '../data/mock';
import { fmtAge, fmtAse, fmtDuration, fmtNum, fmtPct, shortAddr, shortHash } from '../lib/format';
import { CodeBlock } from '../components/CodeBlock';
import { EquityChart } from '../components/Charts';

export function StrategyDetail() {
  const { id } = useParams();
  const strategy = strategyById(id);

  if (!strategy) {
    return (
      <section className="wrap section">
        <h1 className="detail-title">Strategy not found</h1>
        <p className="muted">It may have been removed or never existed.</p>
        <Link className="btn btn-ghost" to="/strategies" style={{ marginTop: 20 }}>
          Back to registry
        </Link>
      </section>
    );
  }

  const positive = strategy.pnlPct >= 0;

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">{strategy.template} template</span>
        <h1 className="detail-title">{strategy.name}</h1>
        <div className="detail-meta">
          <span className={`pill pill-${strategy.status}`}>{strategy.status}</span>
          <span>{strategy.pair}</span>
          <span>·</span>
          <span className="mono">{shortAddr(strategy.address, 14, 8)}</span>
          <span>·</span>
          <span>deployed {strategy.deployedAgo}</span>
          <span>·</span>
          <span>by {strategy.author}</span>
        </div>
      </section>

      <section className="wrap">
        <div className="metrics">
          <div className="metric">
            <div className="metric-label">P&amp;L</div>
            <div className={`metric-value ${positive ? 'up' : 'down'}`}>{fmtPct(strategy.pnlPct)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Net ASE</div>
            <div className={`metric-value ${positive ? 'up' : 'down'}`}>{fmtAse(strategy.pnlAse)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Win rate</div>
            <div className="metric-value">{strategy.winRate.toFixed(1)}%</div>
          </div>
          <div className="metric">
            <div className="metric-label">Trades</div>
            <div className="metric-value">{fmtNum(strategy.trades)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Volume</div>
            <div className="metric-value">{fmtAse(strategy.volumeAse, 0)}</div>
          </div>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 80 }}>
        <div className="panels">
          <div style={{ display: 'grid', gap: 20 }}>
            <div className="panel">
              <div className="panel-head">
                <span className="label">Equity curve</span>
                <span className="mono dim" style={{ fontSize: 12 }}>
                  indexed to 100 at deploy
                </span>
              </div>
              <div className="chart-wrap">
                <EquityChart data={strategy.equity} />
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="label">Contract source</span>
                <span className="mono dim" style={{ fontSize: 12 }}>
                  verifiable by hash
                </span>
              </div>
              <CodeBlock source={strategy.source} />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 20 }}>
            <div className="panel">
              <div className="panel-head">
                <span className="label">Schedule</span>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Cadence</dt>
                  <dd>every {fmtDuration(strategy.intervalSec)}</dd>
                  <dt>Next run</dt>
                  <dd>
                    {strategy.status === 'live' ? `in ${fmtDuration(strategy.nextRunSec)}` : 'not scheduled'}
                  </dd>
                  <dt>Fee</dt>
                  <dd>{strategy.feeBps} bps on fills</dd>
                  <dt>Gas spent</dt>
                  <dd>{strategy.gasAse.toFixed(2)} ASE</dd>
                  <dt>Pool</dt>
                  <dd className="mono">Auras · {strategy.pair}</dd>
                </dl>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="label">Execution log</span>
                <span className="tape-live">live</span>
              </div>
              {executionLog.map((row) => (
                <div className="log-row" key={row.txHash + row.block}>
                  <span className="dim">#{row.block.toLocaleString('en-US')}</span>
                  <span>
                    {row.method}() <span className="dim">→ {row.result}</span>
                    <span className="dim" style={{ display: 'block', fontSize: 11 }}>
                      {shortHash(row.txHash)} · {row.gas}
                    </span>
                  </span>
                  <span className="dim" style={{ fontSize: 11 }}>
                    {fmtAge(row.block % 90)}
                  </span>
                </div>
              ))}
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
