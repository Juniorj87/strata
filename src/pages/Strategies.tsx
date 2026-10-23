import { Link } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { loadStrategies } from '../lib/registry';
import { StrategyCard } from '../components/StrategyCard';

export function Strategies() {
  const { data, loading, error, refresh } = useAsync(() => loadStrategies(), 15000);
  const list = data ?? [];

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Registry</span>
        <h1 className="detail-title">Strategies on chain</h1>
        <p className="section-note" style={{ maxWidth: 640 }}>
          Every entry is read straight from the chain: the source is fetched from the node, hashed locally with
          BLAKE3 and compared against the <code>codeHash</code> the contract stores. Nothing on this page is
          editable.
        </p>
      </section>

      <section className="wrap" style={{ paddingBottom: 80 }}>
        <div className="filters">
          <span className="live-dot">
            {loading ? 'scanning the chain…' : `${list.length} found · chain 1423`}
          </span>
          <button className="chip" onClick={refresh} type="button" style={{ marginLeft: 'auto' }}>
            refresh
          </button>
        </div>

        {error && (
          <div className="notice" style={{ borderLeftColor: 'var(--down)' }}>
            Chain read failed: {error}
          </div>
        )}

        {loading && (
          <div className="grid grid-3">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        )}

        {!loading && list.length === 0 && (
          <div className="empty">
            <h3>Nothing deployed yet.</h3>
            <p style={{ maxWidth: 460, margin: '0 auto 20px' }}>
              Strata looks for contracts whose source carries the <code>Strata template</code> marker, plus any
              address listed in <code>src/config/strategies.json</code>. Deploy one and it appears here.
            </p>
            <Link className="btn btn-primary" to="/deploy">
              Deploy a strategy
            </Link>
          </div>
        )}

        <div className="grid grid-3">
          {list.map((s) => (
            <StrategyCard key={s.address} strategy={s} />
          ))}
        </div>
      </section>
    </>
  );
}
