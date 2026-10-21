import { useMemo, useState } from 'react';
import { strategies } from '../data/mock';
import type { Pair, StrategyStatus } from '../types';
import { StrategyCard } from '../components/StrategyCard';

const STATUSES: (StrategyStatus | 'all')[] = ['all', 'live', 'paused', 'ended'];
const PAIRS: (Pair | 'all')[] = ['all', 'ASE/USD', 'AUR/ASE', 'ASE/aUSD', 'GRID/ASE'];
const PAIR_LABEL: Record<string, string> = { all: 'any pair' };

export function Strategies() {
  const [status, setStatus] = useState<StrategyStatus | 'all'>('all');
  const [pair, setPair] = useState<Pair | 'all'>('all');
  const [sort, setSort] = useState<'pnl' | 'trades' | 'new'>('pnl');

  const list = useMemo(() => {
    const filtered = strategies.filter(
      (s) => (status === 'all' || s.status === status) && (pair === 'all' || s.pair === pair),
    );
    return [...filtered].sort((a, b) => {
      if (sort === 'pnl') return b.pnlPct - a.pnlPct;
      if (sort === 'trades') return b.trades - a.trades;
      return a.deployedAgo.localeCompare(b.deployedAgo);
    });
  }, [status, pair, sort]);

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Registry</span>
        <h1 className="detail-title">Strategies on chain</h1>
        <p className="section-note" style={{ maxWidth: 620 }}>
          Every entry is a deployed contract with published source. P&amp;L is computed from on-chain fills, not
          from a dashboard that can be edited.
        </p>
      </section>

      <section className="wrap" style={{ paddingBottom: 80 }}>
        <div className="filters">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={`chip ${status === s ? 'on' : ''}`}
              onClick={() => setStatus(s)}
              type="button"
            >
              {s}
            </button>
          ))}
          <span style={{ width: 12 }} />
          {PAIRS.map((p) => (
            <button key={p} className={`chip ${pair === p ? 'on' : ''}`} onClick={() => setPair(p)} type="button">
              {PAIR_LABEL[p] ?? p}
            </button>
          ))}
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="pnl">sort: best P&amp;L</option>
            <option value="trades">sort: most trades</option>
            <option value="new">sort: newest</option>
          </select>
        </div>

        <div className="grid grid-3">
          {list.map((s) => (
            <StrategyCard key={s.id} strategy={s} />
          ))}
        </div>

        {list.length === 0 && (
          <p className="muted" style={{ padding: '40px 0' }}>
            No strategy matches this filter yet.
          </p>
        )}
      </section>
    </>
  );
}
