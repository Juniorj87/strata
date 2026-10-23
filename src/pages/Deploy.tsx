import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { loadPools } from '../lib/registry';
import { TEMPLATES, templateById } from '../lib/templates';
import { weiToAse } from '../lib/format';
import { WalletPanel } from '../components/WalletPanel';

export function Deploy() {
  const [params] = useSearchParams();
  const [templateId, setTemplateId] = useState(templateById(params.get('template')).id);
  const [poolId, setPoolId] = useState('1');
  const [threshold, setThreshold] = useState('120');
  const [size, setSize] = useState('250');
  const [interval, setInterval] = useState(templateById(params.get('template')).intervalSec);
  const [copied, setCopied] = useState(false);

  const pools = useAsync(() => loadPools(), 10000);
  const template = templateById(templateId);

  const command = `npm run deploy:${template.id} -- --pool ${poolId} --threshold ${threshold} --size ${size} --interval ${interval}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Deployer</span>
        <h1 className="detail-title">Ship a strategy, not a bot.</h1>
        <p className="section-note" style={{ maxWidth: 660 }}>
          The browser never holds a key. Pick a template and parameters, then run one command - the script signs
          with your wallet, deploys the source, arms the cron job and writes the address back into the registry
          config.
        </p>
      </section>

      <section className="wrap" style={{ paddingBottom: 90 }}>
        <div className="deploy-grid">
          <div>
            <div className="step-num">01 / TEMPLATE</div>
            <div className="template-grid" style={{ marginTop: 14 }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`template ${template.id === t.id ? 'on' : ''}`}
                  onClick={() => {
                    setTemplateId(t.id);
                    setInterval(t.intervalSec);
                  }}
                >
                  <div className="template-name">{t.name}</div>
                  <div className="template-desc">{t.desc}</div>
                  <div className="mono dim" style={{ fontSize: 11, marginTop: 10 }}>
                    every {t.intervalSec}s · {t.requires === 'gas' ? 'gas only' : 'needs tokens'}
                  </div>
                </button>
              ))}
            </div>

            <div className="step-num" style={{ marginTop: 40 }}>
              02 / PARAMETERS
            </div>

            <div className="row-2">
              <div className="field">
                <label htmlFor="pool">Pool</label>
                <select id="pool" className="input" value={poolId} onChange={(e) => setPoolId(e.target.value)}>
                  {(pools.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.symbol}/ASE · pool #{p.id}
                    </option>
                  ))}
                  {pools.data?.length === 0 && <option value="1">Auras pool #1</option>}
                </select>
              </div>
              <div className="field">
                <label htmlFor="threshold">Threshold (bps)</label>
                <input
                  id="threshold"
                  className="input"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="row-2">
              <div className="field">
                <label htmlFor="size">Size per run</label>
                <input
                  id="size"
                  className="input"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div className="field">
                <label htmlFor="interval">Interval (seconds)</label>
                <input
                  id="interval"
                  className="input"
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="notice" style={{ marginTop: 22 }}>
              {template.requires === 'gas' ? (
                <>
                  This template only reads and publishes. It needs a few ASE for the cron gas escrow -{' '}
                  <a className="link-arrow" href="https://airdrop.asentum.com" target="_blank" rel="noreferrer">
                    get test ASE ↗
                  </a>
                  .
                </>
              ) : (
                <>
                  This template trades, so it needs the pool's ARC-20 token in the contract balance and an approve to
                  Auras. A contract cannot open the native side of a swap - <code>E()</code> carries no value - so
                  the strategy sells the token side into ASE.
                </>
              )}
            </div>

            {pools.data && pools.data.length > 0 && (
              <div className="panel" style={{ marginTop: 18 }}>
                <div className="panel-head">
                  <span className="label">Live pools</span>
                </div>
                <div className="panel-body">
                  <dl className="kv">
                    {pools.data.map((pool) => (
                      <div key={pool.id} style={{ display: 'contents' }}>
                        <dt>
                          {pool.symbol}/ASE #{pool.id}
                        </dt>
                        <dd>
                          {weiToAse(pool.reserveToken, 2)} {pool.symbol} · {weiToAse(pool.reserveNative, 2)} ASE ·
                          spot {weiToAse(pool.spot, 6)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            )}
          </div>

          <aside className="panel" style={{ position: 'sticky', top: 88 }}>
            <WalletPanel />
            <div className="panel-head" style={{ marginTop: 20 }}>
              <span className="label">03 / REVIEW</span>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Template</dt>
                <dd>{template.name}</dd>
                <dt>Contract</dt>
                <dd style={{ fontSize: 11.5 }}>{template.contract}</dd>
                <dt>Pool</dt>
                <dd>#{poolId}</dd>
                <dt>Threshold</dt>
                <dd>{threshold} bps</dd>
                <dt>Size</dt>
                <dd>{size}</dd>
                <dt>Cadence</dt>
                <dd>every {interval}s</dd>
                <dt>Needs</dt>
                <dd>{template.requires === 'gas' ? 'gas only' : 'token balance + approve'}</dd>
              </dl>

              <div className="cmd" style={{ marginTop: 18 }}>
                <span className="prompt">$</span>
                <span>{command}</span>
                <button onClick={copy} type="button">
                  {copied ? 'copied' : 'copy'}
                </button>
              </div>

              <p className="muted" style={{ fontSize: 13.5, marginTop: 16 }}>
                The script needs a funded testnet key in <code>STRATA_SECRET_KEY</code>. It deploys, calls{' '}
                <code>init</code>, arms the cron job, then prints the contract address and writes it into{' '}
                <code>src/config/strategies.json</code> so this site picks it up on the next refresh.
              </p>

              <Link className="btn btn-ghost" to="/how" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}>
                How the pieces fit →
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
