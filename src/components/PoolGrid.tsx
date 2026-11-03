import { Link } from 'react-router-dom';
import type { LivePool } from '../lib/registry';
import { weiToAse } from '../lib/format';

export function PoolGrid({
  pools,
  loading,
  selectedPoolId,
  onSelect,
}: {
  pools: LivePool[];
  loading?: boolean;
  selectedPoolId?: string;
  onSelect?: (pool: LivePool) => void;
}) {
  if (pools.length === 0) {
    if (loading) {
      return (
        <div className="muted mono" style={{ padding: '32px 0', textAlign: 'center', fontSize: 13 }}>
          Syncing live pool reserves on chain…
        </div>
      );
    }
    return (
      <div className="empty small-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>No pools discovered for this venue yet.</p>
      </div>
    );
  }

  return (
    <div className="pool-grid">
      {pools.map((pool) => {
        const isSelected = selectedPoolId === pool.id;
        const content = (
          <>
            <div className="pool-head">
              <span className="pool-symbol">
                {pool.symbol}
                <span className="dim" style={{ fontSize: 13, fontWeight: 400, marginLeft: 4 }}>
                  /ASE
                </span>
              </span>
              <span className="pool-price mono">{weiToAse(pool.spot, 6)} ASE</span>
            </div>
            <div className="card-sub" style={{ marginTop: 8 }}>
              reserves: {weiToAse(pool.reserveToken, 2)} {pool.symbol} · {weiToAse(pool.reserveNative, 2)} ASE
            </div>
            <div className="card-foot" style={{ borderTop: 0, paddingTop: 10 }}>
              <span>pool #{pool.id} · {pool.venue === 'asedex' ? 'AseDex' : 'Auras'}</span>
              <span>fee {pool.feeBps} bps</span>
            </div>
          </>
        );

        if (onSelect) {
          return (
            <button
              type="button"
              className={`pool ${isSelected ? 'selected' : ''}`}
              key={pool.id}
              onClick={() => onSelect(pool)}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: isSelected ? '1px solid var(--accent)' : undefined,
                background: isSelected ? 'var(--accent-soft)' : undefined,
                outline: 'none',
                width: '100%',
              }}
            >
              {content}
            </button>
          );
        }

        return (
          <Link
            to={`/deploy?pool=${pool.id}`}
            className={`pool ${isSelected ? 'selected' : ''}`}
            key={pool.id}
            title="Deploy strategy with this pair"
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}
