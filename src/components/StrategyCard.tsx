import { Link } from 'react-router-dom';
import type { LiveStrategy } from '../lib/registry';
import { fmtDuration, fmtWei, shortAddr } from '../lib/format';

function nextRunIn(cron: LiveStrategy['cron']): string | null {
  if (!cron?.nextRunAt) return null;
  const raw = Number(cron.nextRunAt);
  if (!Number.isFinite(raw) || raw === 0) return null;
  const seconds = raw > 1e12 ? Math.floor((raw - Date.now()) / 1000) : Math.floor(raw - Date.now() / 1000);
  return seconds > 0 ? fmtDuration(seconds) : 'due';
}

export function StrategyCard({ strategy }: { strategy: LiveStrategy }) {
  const live = strategy.cron !== null;
  const countdown = nextRunIn(strategy.cron);

  return (
    <Link to={`/strategies/${strategy.address}`} className="card">
      <div className="card-head">
        <div>
          <div className="card-title">{strategy.name}</div>
          <div className="card-sub">
            {strategy.symbol ? `${strategy.symbol}/ASE` : 'no pool'} · {shortAddr(strategy.ase1)}
          </div>
        </div>
        <span className={live ? 'pill pill-live' : 'pill pill-ended'}>{live ? 'live' : 'idle'}</span>
      </div>

      <div className="card-metrics">
        <div>
          <div className="metric-label">Fills</div>
          <div className="metric-value">{strategy.trades}</div>
        </div>
        <div>
          <div className="metric-label">Volume</div>
          <div className="metric-value">{fmtWei(strategy.volumeWei, 2)}</div>
        </div>
        <div>
          <div className="metric-label">Held</div>
          <div className="metric-value">{fmtWei(strategy.balanceAse, 2)}</div>
        </div>
      </div>

      <div className="card-foot">
        <span className="mono">
          {countdown ? `next run ${countdown}` : strategy.intervalSec ? `every ${fmtDuration(strategy.intervalSec)}` : 'no cron'}
        </span>
        <span className={strategy.verified ? 'verify' : 'verify bad'}>
          {strategy.verified ? 'hash ok' : 'hash ?'}
        </span>
      </div>
    </Link>
  );
}
