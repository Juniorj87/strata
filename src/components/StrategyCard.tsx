import { Link } from 'react-router-dom';
import type { LiveStrategy } from '../lib/registry';
import { fmtDuration, fmtWei, shortAddr } from '../lib/format';
import { botTypeFor } from '../lib/templates';

function nextRunIn(cron: LiveStrategy['cron']): string | null {
  if (!cron?.nextRunAt) return null;
  const raw = Number(cron.nextRunAt);
  if (!Number.isFinite(raw) || raw === 0) return null;
  const seconds = raw > 1e12 ? Math.floor((raw - Date.now()) / 1000) : Math.floor(raw - Date.now() / 1000);
  return seconds > 0 ? fmtDuration(seconds) : 'due now';
}

export function StrategyCard({ strategy }: { strategy: LiveStrategy }) {
  const scheduled = strategy.cron !== null && strategy.stopped !== true;
  const countdown = nextRunIn(strategy.cron);
  const bot = botTypeFor(strategy.template);

  return (
    <Link to={`/strategies/${strategy.address}`} className="card">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="card-title">
            {strategy.name.length > 34 ? `${strategy.name.slice(0, 34)}…` : strategy.name}
          </div>
          <div className="card-sub">
            {bot?.title ?? strategy.template} · {strategy.symbol ? `${strategy.symbol}/ASE` : 'no pool'} ·{' '}
            {shortAddr(strategy.ase1)}
          </div>
        </div>
        <span className={scheduled ? 'status-badge live' : 'status-badge off'}>
          {scheduled ? 'Scheduled' : 'Idle'}
        </span>
      </div>

      <div className="card-metrics">
        <div>
          <div className="metric-label">Fills</div>
          <div className="metric-value">{strategy.trades}</div>
        </div>
        <div>
          <div className="metric-label">Gross ASE</div>
          <div className="metric-value">{fmtWei(strategy.realisedWei, 2)}</div>
        </div>
        <div>
          <div className="metric-label">In contract</div>
          <div className="metric-value">{fmtWei(strategy.balanceAse, 2)}</div>
        </div>
      </div>

      <div className="card-foot">
        <span className="mono" style={{ fontSize: 10.5 }}>
          {countdown
            ? `next run in ${countdown}`
            : strategy.intervalSec
              ? `every ${fmtDuration(strategy.intervalSec)}`
              : 'no schedule'}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span className={strategy.verified ? 'verify' : 'verify bad'}>
            {strategy.verified ? 'source match' : 'unverified'}
          </span>
          <span style={{ color: 'var(--accent)' }}>→</span>
        </span>
      </div>
    </Link>
  );
}
