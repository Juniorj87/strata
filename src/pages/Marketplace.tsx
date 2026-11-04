import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../lib/hooks';
import { loadMarketplaceListings } from '../lib/marketplace';
import { loadStrategies } from '../lib/registry';
import { TEMPLATES } from '../lib/templates';
import { shortAddr } from '../lib/format';


function rawToTokenAmount(raw: string | undefined, decimals: number | null): string | null {
  if (!raw || decimals === null) return null;
  try {
    const value = BigInt(raw);
    const scale = 10n ** BigInt(decimals);
    const whole = value / scale;
    const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole.toString()}${fraction ? `.${fraction}` : ''}`;
  } catch { return null; }
}

function buildTemplateUrl(listing: import('../lib/marketplace').MarketplaceListing): string {
  const config = listing.config;
  const params = new URLSearchParams({ template: listing.template, mode: 'lite' });
  if (config) {
    if (config.poolId) params.set('pool', config.poolId);
    const decimals = listing.liveStrategy.tokenDecimals ?? (config.decimals !== undefined ? Number(config.decimals) : null);
    const rawSize = config.sellSizeWei ?? config.sizeWei ?? config.sizePerLevelWei ?? config.notionalWei;
    const size = listing.template === 'dca' ? null : rawToTokenAmount(rawSize, decimals);
    if (size) params.set('size', size);
    let budgetRaw = listing.template === 'dca' ? undefined : config.budgetWei ?? config.notionalWei;
    let budgetSuggested = false;
    if (!budgetRaw && rawSize && listing.template !== 'dca') {
      let suggested = BigInt(rawSize);
      if (listing.template === 'grid') suggested *= BigInt(config.levels ?? '5');
      budgetRaw = suggested.toString();
      budgetSuggested = true;
    }
    const budget = rawToTokenAmount(budgetRaw, decimals);
    if (budget) params.set('budget', budget);
    const buySizeAse = rawToTokenAmount(config.buySizeAseWei, 18);
    const buyBudgetAse = rawToTokenAmount(config.buyBudgetAseWei, 18);
    if (buySizeAse) params.set('buySizeAse', buySizeAse);
    if (buyBudgetAse) params.set('buyBudgetAse', buyBudgetAse);
    if (budgetSuggested) params.set('budgetHint', 'suggested');
    const threshold = config.thresholdBps ?? config.stepBps;
    if (threshold) params.set('threshold', threshold);
    for (const [key, value] of [
      ['interval', config.intervalSec], ['slices', config.slices], ['levels', config.levels],
      ['costBasis', rawToTokenAmount(config.costBasisAseWeiPerToken, 18) ?? undefined],
      ['dailyLoss', rawToTokenAmount(config.dailyLossLimitAseWei, 18) ?? undefined],
      ['stopLoss', config.stopLossBps], ['takeProfit', config.takeProfitBps],
      ['maxDrawdown', config.maxDrawdownBps], ['targetUpside', config.targetUpsideBps],
    ] as const) if (value) params.set(key, value);
  }
  params.set('fromMarketplace', '1');
  return `/deploy?${params.toString()}`;
}

export function Marketplace() {
  const [query, setQuery] = useState('');
  const [template, setTemplate] = useState('all');
  const marketplace = useAsync(() => loadMarketplaceListings(), 60000);
  const network = useAsync(() => loadStrategies(), 60000);
  const rawListings = marketplace.data?.listings;
  const listings = useMemo(() => rawListings ?? [], [rawListings]);
  const discovered = network.data ?? [];
  const filtered = useMemo(() => listings.filter((item) => {
    const matchesQuery = `${item.title} ${item.description} ${item.tags} ${item.liveStrategy.owner ?? ''}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (template === 'all' || item.template === template);
  }), [listings, query, template]);
  const listed = new Set(listings.map((item) => item.strategy.toLowerCase()));
  const unlisted = discovered.filter((item) => item.verified && !listed.has(item.address.toLowerCase()));

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Community · verified on-chain strategies</span>
        <h1 className="detail-title">Shared strategies.</h1>
        <p className="section-note" style={{ maxWidth: 700, marginTop: 18 }}>
          Browse strategies shared by their creators. Review what each strategy is designed to do, see its on-chain activity and use its template as a starting point. Use shared settings as a starting point, then review every value before signing. A listing is not an endorsement or a performance guarantee.
        </p>
        <div className="mode-switch" role="tablist" style={{ marginTop: 22 }}>
          <Link to="/strategies" className="mode-option">
            <span>Strategy catalog</span>
            <small>Mechanics & bot types</small>
          </Link>
          <Link to="/strategies?tab=live" className="mode-option">
            <span>Live contracts</span>
            <small>Executing on-chain</small>
          </Link>
          <Link to="/marketplace" className="mode-option active">
            <span>Marketplace</span>
            <small>Shared setups</small>
          </Link>
        </div>
      </section>

      <section className="wrap marketplace-page" style={{ paddingBottom: 90 }}>
        <div className="marketplace-intro panel">
          <div>
            <span className="label">How publishing works</span>
            <h2>Shared by creators. Checked against the chain.</h2>
            <p className="muted">A creator shares a strategy they own. Strata checks that the public contract still matches its original source and that the creator is its owner.</p>
          </div>
          <div className="marketplace-intro-actions">
            <Link className="btn btn-primary" to="/strategies">Explore deployed strategies</Link>
            <Link className="btn btn-ghost" to="/deploy">Create your own</Link>
          </div>
        </div>

        {!marketplace.data?.configured && !marketplace.loading && (
          <div className="notice marketplace-notice" style={{ marginTop: 18 }}>
            <strong>Community publishing is not enabled yet</strong>
            <span>The site operator still needs to connect the shared publishing registry. Until then, this page can discover verified public strategies, but it will not label them as community-published.</span>
          </div>
        )}

        <div className="marketplace-toolbar" style={{ marginTop: 28 }}>
          <input aria-label="Search marketplace" className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, description or tag…" />
          <select aria-label="Filter by strategy type" className="input" value={template} onChange={(event) => setTemplate(event.target.value)}>
            <option value="all">All strategy types</option>
            {TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button className="chip" type="button" onClick={() => { marketplace.refresh(); network.refresh(); }}>Refresh</button>
        </div>

        <div className="section-head" style={{ marginTop: 34 }}>
          <div><span className="label">Published by the community</span><h2 className="section-title">Live listings</h2></div>
          <span className="pill pill-live">{marketplace.loading ? 'Loading…' : `${filtered.length} verified listings`}</span>
        </div>
        {marketplace.error && <div className="notice deploy-error">Marketplace could not be read: {marketplace.error}</div>}
        {marketplace.data?.configured && !marketplace.loading && filtered.length === 0 && (
          <div className="empty"><h3>No published strategies match this search.</h3><p>Try another filter or explore the public contracts listed below.</p></div>
        )}
        <div className="grid grid-3">
          {filtered.map((listing) => (
            <article className="market-card" key={listing.strategy}>
              <div className="market-card-top"><span className="pill pill-live">Source verified</span><span className="label">{listing.config ? 'Settings included' : 'Template only'}</span></div>
              <h3>{listing.title}</h3>
              <p className="muted">{listing.description || 'No description supplied.'}</p>
              <div className="market-card-meta"><span>Owner</span><a className="mono" href={`https://explorer.asentum.com/address/${listing.liveStrategy.ase1}`} target="_blank" rel="noreferrer">{shortAddr(listing.owner, 8, 5)}</a></div>
              <div className="market-card-meta"><span>Contract</span><span className="mono">{shortAddr(listing.strategy, 8, 5)}</span></div>
              <div className="market-card-actions"><Link className="btn btn-ghost" to={`/strategies/${listing.strategy}`}>Inspect</Link><Link className="btn btn-primary" to={buildTemplateUrl(listing)}>{listing.config ? 'Use shared settings' : 'Use this template'}</Link></div>
            </article>
          ))}
        </div>

        <div className="section-head" style={{ marginTop: 42 }}>
          <div><span className="label">Open discovery</span><h2 className="section-title">Other verified strategies</h2></div>
          <span className="muted">{unlisted.length} found</span>
        </div>
        <p className="muted" style={{ marginBottom: 18 }}>These strategies were found on Asentum and their source matches a Strata template. Their creators have not necessarily published a listing.</p>
        <div className="market-contract-list">
          {unlisted.slice(0, 12).map((item) => (
            <div className="market-contract-row" key={item.address}>
              <div><strong>{item.name}</strong><span className="muted">{item.template} · {item.symbol ? `${item.symbol}/ASE` : 'pair not indexed'}</span></div>
              <span className="mono">{shortAddr(item.ase1, 9, 5)}</span>
              <Link className="link-arrow" to={`/strategies/${item.address}`}>Inspect ↗</Link>
            </div>
          ))}
          {unlisted.length === 0 && <div className="empty small-empty">No additional verified contracts were found in the current explorer index.</div>}
        </div>
      </section>
    </>
  );
}
