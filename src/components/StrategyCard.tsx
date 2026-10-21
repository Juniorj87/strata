import { Link } from 'react-router-dom';
import type { Strategy } from '../types';
import { fmtDuration, fmtPct, shortAddr } from '../lib/format';
import { Sparkline } from './Charts';

const statusClass: Record<Strategy['status'], string> = {
  live: 'pill pill-live',
  paused: 'pill pill-paused',
  ended: 'pill pill-ended',
};

export function StrategyCard({ strategy }: { strategy: Strategy }) {
  const positive = strategy.pnlPct >= 0;

  return (
    <Link to={`/strategies/${strategy.id}`} className="card">
      <div className="card-head">
        <div>
          <div className="card-title">{strategy.name}</div>
          <div className="card-sub">
            {strategy.pair} · {shortAddr(strategy.author)}
          </div>
        </div>
        <span className={statusClass[strategy.status]}>{strategy.status}</span>
      </div>

      <div className="card-metrics">
        <div>
          <div className="metric-label">P&amp;L</div>
          <div className={`metric-value ${positive ? 'up' : 'down'}`}>{fmtPct(strategy.pnlPct)}</div>
        </div>
        <div>
          <div className="metric-label">Win rate</div>
          <div className="metric-value">{strategy.winRate.toFixed(1)}%</div>
        </div>
        <div>
          <div className="metric-label">Trades</div>
          <div className="metric-value">{strategy.trades}</div>
        </div>
      </div>

      <Sparkline data={strategy.equity} color={positive ? 'var(--up)' : 'var(--down)'} />

      <div className="card-foot">
        <span className="mono">
          {strategy.status === 'live'
            ? `next run in ${fmtDuration(strategy.nextRunSec)}`
            : strategy.status === 'paused'
              ? 'paused by owner'
              : 'ended'}
        </span>
        <span>fee {strategy.feeBps} bps</span>
      </div>
    </Link>
  );
}
