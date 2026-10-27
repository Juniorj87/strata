import type { LivePool } from '../lib/registry';
import { weiToAse } from '../lib/format';

export function PoolGrid({ pools, loading }: { pools: LivePool[]; loading?: boolean }) {
  if (pools.length === 0) {
    if (loading) {
      return (
        <div className="muted mono" style={{ padding: '32px 0', textAlign: 'center', fontSize: 13 }}>
          Syncing live pool reserves from Auras AMM on chain…
        </div>
      );
    }
    return null;
  }

  return (
    <div className="pool-grid">
      {pools.map((pool) => (
        <div className="pool" key={pool.id}>
          <div className="pool-head">
            <span className="pool-symbol">
              {pool.symbol}
              <span className="dim" style={{ fontSize: 13, fontWeight: 400 }}>
                /ASE
              </span>
            </span>
            <span className="pool-price mono">{weiToAse(pool.spot, 6)}</span>
          </div>
          <div className="card-sub" style={{ marginTop: 10 }}>
            reserves {weiToAse(pool.reserveToken, 2)} {pool.symbol} · {weiToAse(pool.reserveNative, 2)} ASE
          </div>
          <div className="card-foot" style={{ borderTop: 0, paddingTop: 10 }}>
            <span>pool #{pool.id}</span>
            <span>fee {pool.feeBps} bps</span>
          </div>
        </div>
      ))}
    </div>
  );
}
