import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Pair, Strategy } from '../types';
import { fmtAse } from '../lib/format';

type TemplateId = Strategy['template'];

const TEMPLATES: { id: TemplateId; name: string; desc: string; cron: string }[] = [
  {
    id: 'momentum',
    name: 'Momentum',
    desc: 'Buys when the rolling return crosses a threshold, sells when it crosses back.',
    cron: 'every 60s',
  },
  {
    id: 'mean-reversion',
    name: 'Mean reversion',
    desc: 'Sells into strength, buys back on weakness against a moving average.',
    cron: 'every 120s',
  },
  { id: 'twap', name: 'TWAP', desc: 'Slices one order across N intervals so the fill is spread.', cron: 'every 300s' },
  { id: 'grid', name: 'Grid', desc: 'Two-sided orders around a reference price, re-centred after each fill.', cron: 'every 60s' },
  { id: 'dca', name: 'DCA', desc: 'Fixed notional every interval. The set-and-forget baseline.', cron: 'every 3600s' },
];

const PAIRS: Pair[] = ['ASE/USD', 'ASE/aUSD', 'AUR/ASE', 'GRID/ASE'];
const INTERVALS = [60, 120, 300, 900, 3600];

function hash32(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

function fakeAddress(seed: string): string {
  const chars = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const out = [];
  let h = hash32(seed);
  for (let i = 0; i < 38; i += 1) {
    h = (h * 1103515245 + 12345) >>> 0;
    out.push(chars[h % chars.length]);
  }
  return `ase1${out.join('')}`;
}

export function Deploy() {
  const [params] = useSearchParams();
  const preset = params.get('template') as TemplateId | null;
  const [template, setTemplate] = useState<TemplateId>(preset && TEMPLATES.some((t) => t.id === preset) ? preset : 'momentum');
  const [pair, setPair] = useState<Pair>('ASE/USD');
  const [notional, setNotional] = useState('250');
  const [threshold, setThreshold] = useState('120');
  const [interval, setInterval] = useState(60);
  const [deployed, setDeployed] = useState<{ address: string; txHash: string } | null>(null);

  const meta = TEMPLATES.find((t) => t.id === template)!;
  const gasEstimate = useMemo(() => 0.0042 + interval / 3600, [interval]);

  if (deployed) {
    return (
      <section className="wrap section">
        <div className="panel" style={{ maxWidth: 640, margin: '40px auto' }}>
          <div className="success">
            <span className="tag tag-deploy">deployed</span>
            <h2>Your strategy is armed.</h2>
            <p className="muted" style={{ maxWidth: 440, margin: '0 auto' }}>
              The contract scheduled its first job in the cron registry. It will start trading on the next
              interval boundary, without any server involved.
            </p>
            <div className="addr-box">{deployed.address}</div>
            <div className="mono dim" style={{ fontSize: 12 }}>
              tx {deployed.txHash}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 26 }}>
              <Link className="btn btn-ghost" to="/strategies">
                Open the registry
              </Link>
              <a
                className="btn btn-ghost"
                href={`https://explorer.asentum.com/address/${deployed.address}`}
                target="_blank"
                rel="noreferrer"
              >
                Explorer ↗
              </a>
            </div>
          </div>
        </div>
        <p className="mono dim" style={{ textAlign: 'center', fontSize: 12 }}>
          Demo mode — no wallet is connected. The real flow signs with your Asentum wallet and broadcasts to
          chain 1423.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Deployer</span>
        <h1 className="detail-title">Ship a strategy, not a bot.</h1>
        <p className="section-note" style={{ maxWidth: 620 }}>
          Pick a template, set the parameters, and the contract schedules itself. The source you deploy is the
          source that runs — publicly, forever.
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
                  className={`template ${template === t.id ? 'on' : ''}`}
                  onClick={() => {
                    setTemplate(t.id);
                    const match = t.cron.match(/\d+/);
                    if (match) setInterval(Number(match[0]));
                  }}
                >
                  <div className="template-name">{t.name}</div>
                  <div className="template-desc">{t.desc}</div>
                  <div className="mono dim" style={{ fontSize: 11, marginTop: 10 }}>
                    {t.cron}
                  </div>
                </button>
              ))}
            </div>

            <div className="step-num" style={{ marginTop: 40 }}>
              02 / PARAMETERS
            </div>

            <div className="row-2">
              <div className="field">
                <label htmlFor="pair">Pair</label>
                <select id="pair" className="input" value={pair} onChange={(e) => setPair(e.target.value as Pair)}>
                  {PAIRS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="notional">Notional per run (ASE)</label>
                <input
                  id="notional"
                  className="input"
                  value={notional}
                  onChange={(e) => setNotional(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="row-2">
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
              <div className="field">
                <label htmlFor="interval">Interval (seconds)</label>
                <select
                  id="interval"
                  className="input"
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                >
                  {INTERVALS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="notice" style={{ marginTop: 22 }}>
              Cron jobs are prepaid: the chain debits a gas escrow on every fire and stops the job when the
              escrow runs out. Top up any time, cancel whenever — unused escrow is refunded.
            </div>
          </div>

          <aside className="panel" style={{ position: 'sticky', top: 88 }}>
            <div className="panel-head">
              <span className="label">03 / REVIEW</span>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Template</dt>
                <dd>{meta.name}</dd>
                <dt>Pair</dt>
                <dd>{pair}</dd>
                <dt>Notional</dt>
                <dd>{notional} ASE / run</dd>
                <dt>Threshold</dt>
                <dd>{threshold} bps</dd>
                <dt>Cadence</dt>
                <dd>every {interval}s</dd>
                <dt>Deploy fee</dt>
                <dd>≈ {gasEstimate.toFixed(4)} ASE</dd>
                <dt>Escrow</dt>
                <dd>≈ {fmtAse(0.5)}</dd>
              </dl>

              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 22, justifyContent: 'center' }}
                type="button"
                onClick={() =>
                  setDeployed({
                    address: fakeAddress(`${template}${pair}${notional}${threshold}${interval}`),
                    txHash: `0x${hash32(`${template}${notional}${Date.now()}`).toString(16).padStart(12, '0')}`,
                  })
                }
              >
                Deploy to testnet
              </button>

              <p className="mono dim" style={{ fontSize: 11.5, marginTop: 12, textAlign: 'center' }}>
                demo mode · no wallet connected
              </p>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
