import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { loadStrategies } from '../lib/registry';
import { StrategyCard } from '../components/StrategyCard';

interface StrategyGuide {
  id: string;
  category: 'accumulation' | 'take-profit' | 'range' | 'protection' | 'execution' | 'analytics';
  tag: string;
  title: string;
  subtitle: string;
  summary: string;
  whyUse: string;
  cadence: string;
  funding: string;
  recommendedFor: string;
}

const STRATEGY_GUIDES: StrategyGuide[] = [
  {
    id: 'dca',
    category: 'accumulation',
    tag: 'Auto-invest',
    title: 'DCA (Dollar-Cost Averaging)',
    subtitle: 'Automated recurring accumulation with ASE',
    summary:
      'Regularly purchases your selected token with ASE at equal time intervals (for example every hour, four hours or one day) until the total ASE budget is exhausted.',
    whyUse:
      'Removes the emotional stress of trying to time the market. Fixed amounts over time average your entry through dips and keep accumulation disciplined.',
    cadence: '15 minutes to 1 day',
    funding: 'Total ASE budget + cron gas escrow',
    recommendedFor: 'Long-term accumulation and dip-buying',
  },
  {
    id: 'limit-exit',
    category: 'take-profit',
    tag: 'Take-profit',
    title: 'Take-Profit Trigger',
    subtitle: 'Automated sell target into ASE',
    summary:
      'Monitors the AMM pool price on schedule and executes one complete sell order into ASE as soon as your target price (+5%, +10%, +20%) is reached. Once executed, the schedule terminates.',
    whyUse:
      'Locks in a profit target automatically when prices spike, without sitting in front of a screen. It is a scheduled check, not a resting order-book limit.',
    cadence: 'Checked every 60 seconds',
    funding: 'Token allocation to sell + cron gas escrow',
    recommendedFor: 'Locking in gains at upper resistance levels',
  },
  {
    id: 'grid',
    category: 'range',
    tag: 'Range trading',
    title: 'Grid Range Bot',
    subtitle: 'Automated buy-low, sell-high across price levels',
    summary:
      'Establishes a symmetrical grid of buy and sell price levels around the current price. When the price dips by your step (-2%) it buys with ASE; when it rallies (+2%) it sells tokens for ASE.',
    whyUse:
      'Generates continuous activity during sideways markets where price oscillates inside a horizontal channel without a clear directional trend.',
    cadence: 'Continuous across 3 to 10 levels',
    funding: 'Tokens for sell levels + separate ASE reserve for buy levels',
    recommendedFor: 'Flat, sideways or oscillating corridors',
  },
  {
    id: 'risk-managed',
    category: 'protection',
    tag: 'Capital protection',
    title: 'Stop-Loss & Risk Manager',
    subtitle: 'Downside protection and daily loss limits',
    summary:
      'Safeguards the position from deep drawdowns. If the market drops past your stop-loss (-5%, -10%), the contract latches and executes orderly spot sales into ASE. Trailing drawdown and daily loss caps are supported too.',
    whyUse:
      'A bad downturn cannot be left entirely to emotion or delay: the rules execute on-chain, without a human in the loop.',
    cadence: 'Checked every 5 minutes to 1 hour',
    funding: 'Token allocation + declared average buy price',
    recommendedFor: 'High-volatility tokens and downside defence',
  },
  {
    id: 'twap',
    category: 'execution',
    tag: 'Split order',
    title: 'TWAP Order Slicer',
    subtitle: 'Large position liquidation without price collapse',
    summary:
      'Selling a large quantity at once exhausts pool liquidity and moves the price against you. TWAP divides the order into equal slices executed at regular intervals — five orders over thirty minutes, for example.',
    whyUse:
      'Keeps price impact contained on an AMM, lets the pool absorb volume naturally, and improves the average execution price of a large exit.',
    cadence: 'Splits across 5 to 20 timed slices',
    funding: 'Token allocation to liquidate + cron gas escrow',
    recommendedFor: 'Large bag sales with low pool slippage',
  },
  {
    id: 'scale',
    category: 'execution',
    tag: 'Ladder sell',
    title: 'Scale Ladder Order',
    subtitle: 'Incremental profit taking at staggered price steps',
    summary:
      'Splits a token allocation into a ladder of sell levels between the current pool price and a target upside price, selling one slice each time a higher step is breached.',
    whyUse:
      'Lets you scale out of a winning position gradually instead of selling everything too early or missing the top.',
    cadence: 'One bounded swap per cron interval',
    funding: 'Token allocation + cron gas escrow',
    recommendedFor: 'Scaling out of runners during sustained rallies',
  },
  {
    id: 'momentum-signal',
    category: 'analytics',
    tag: 'Analytics',
    title: 'Momentum Signal Generator',
    subtitle: 'Algorithmic trend indicator contract',
    summary:
      'Calculates rolling TWAP windows across consecutive intervals. When average price movement breaches your basis-point threshold, it emits on-chain buy, sell or neutral momentum signals.',
    whyUse:
      'Gives operators and other contracts a verified on-chain trend indicator without trusting an off-chain oracle.',
    cadence: 'Computes trends every 60 seconds',
    funding: 'Gas escrow in ASE only — no tokens required',
    recommendedFor: 'Algorithmic traders and automated trend listeners',
  },
];

type CatalogTab = 'catalog' | 'live' | 'marketplace';

export function Strategies() {
  const wallet = useWallet();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const activeTab: CatalogTab = tabParam === 'live' || tabParam === 'marketplace' ? tabParam : 'catalog';
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'idle'>('all');
  const { data, loading, error, refresh } = useAsync(
    () => loadStrategies(wallet.address ?? undefined),
    15000,
    true,
    wallet.address,
  );
  const list = useMemo(() => data ?? [], [data]);

  const setTab = (tab: CatalogTab) => {
    setParams({ tab }, { replace: true });
  };

  const filteredGuides =
    category === 'all' ? STRATEGY_GUIDES : STRATEGY_GUIDES.filter((guide) => guide.category === category);

  const filteredContracts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return list.filter((item) => {
      const scheduled = item.cron !== null && item.stopped !== true;
      if (statusFilter === 'scheduled' && !scheduled) return false;
      if (statusFilter === 'idle' && scheduled) return false;
      if (!term) return true;
      return `${item.name} ${item.template} ${item.symbol ?? ''} ${item.ase1}`.toLowerCase().includes(term);
    });
  }, [list, query, statusFilter]);

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Strategies · Asentum testnet</span>
        <h1 className="detail-title">Trading strategies,<br />without the terminal.</h1>
        <p className="section-note" style={{ maxWidth: 640, marginTop: 18 }}>
          Every strategy below is a contract you own. Read what each bot type does, inspect the live contracts
          already executing on Asentum, or start from a shared setup.
        </p>

        <div className="mode-switch" role="tablist" aria-label="Strategy views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'catalog'}
            className={activeTab === 'catalog' ? 'mode-option active' : 'mode-option'}
            onClick={() => setTab('catalog')}
          >
            <span>Strategy catalog</span>
            <small>Mechanics & bot types</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'live'}
            className={activeTab === 'live' ? 'mode-option active' : 'mode-option'}
            onClick={() => setTab('live')}
          >
            <span>Live contracts ({list.length})</span>
            <small>Executing on-chain</small>
          </button>
          <Link to="/marketplace" className="mode-option">
            <span>Marketplace</span>
            <small>Shared setups</small>
          </Link>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 96 }}>
        {activeTab === 'catalog' && (
          <div>
            <div className="chip-row" style={{ marginBottom: 22 }}>
              {[
                { id: 'all', label: `All templates (${STRATEGY_GUIDES.length})` },
                { id: 'accumulation', label: 'Accumulation' },
                { id: 'take-profit', label: 'Take-profit' },
                { id: 'range', label: 'Range / grid' },
                { id: 'protection', label: 'Protection' },
                { id: 'execution', label: 'Split execution' },
                { id: 'analytics', label: 'Analytics' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={category === chip.id ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => setCategory(chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div className="catalog-grid">
              {filteredGuides.map((guide) => {
                const matches = list.filter((item) => item.template === guide.id);
                const scheduled = matches.filter((item) => item.cron !== null && item.stopped !== true);
                const totalTrades = matches.reduce((sum, item) => sum + item.trades, 0);

                return (
                  <article className="catalog-card" key={guide.id}>
                    <div>
                      <div className="catalog-card-head">
                        <span className="catalog-tag">{guide.tag}</span>
                        <span className="mono dim" style={{ fontSize: 10.5 }}>
                          {matches.length > 0
                            ? `${matches.length} on-chain · ${scheduled.length} scheduled`
                            : 'Verified template'}
                        </span>
                      </div>
                      <h2 className="catalog-title">{guide.title}</h2>
                      <div className="catalog-sub">{guide.subtitle}</div>

                      <div className="catalog-body">
                        <div className="catalog-point">
                          <strong>What it does</strong>
                          <p>{guide.summary}</p>
                        </div>
                        <div className="catalog-point">
                          <strong>Why use it</strong>
                          <p>{guide.whyUse}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="catalog-meta">
                        <div>
                          <span className="dim">Cadence </span>
                          <strong>{guide.cadence}</strong>
                        </div>
                        <div>
                          <span className="dim">Needs </span>
                          <strong>{guide.funding}</strong>
                        </div>
                        <div>
                          <span className="dim">Best for </span>
                          <strong>{guide.recommendedFor}</strong>
                        </div>
                        {matches.length > 0 && (
                          <div>
                            <span className="dim">Indexed fills </span>
                            <strong className="mono" style={{ color: 'var(--accent)' }}>
                              {totalTrades}
                            </strong>
                          </div>
                        )}
                      </div>

                      <Link
                        to={
                          guide.id === 'momentum-signal'
                            ? '/deploy?template=momentum-signal&mode=pro'
                            : `/deploy?template=${guide.id}`
                        }
                        className="btn btn-ghost"
                      >
                        Use this template <span className="arr" aria-hidden="true">→</span>
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'live' && (
          <div>
            <div className="contract-toolbar">
              <input
                className="input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, token or address…"
                aria-label="Search live strategies"
              />
              <select
                className="input"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | 'scheduled' | 'idle')}
                aria-label="Filter by schedule status"
                style={{ maxWidth: 170 }}
              >
                <option value="all">All contracts</option>
                <option value="scheduled">Scheduled</option>
                <option value="idle">Idle</option>
              </select>
              <span className="spacer" />
              <span className="live-dot">
                {loading ? 'Reading chain' : `${filteredContracts.length} of ${list.length} contracts`}
              </span>
              <button className="chip" onClick={refresh} type="button">
                Refresh
              </button>
            </div>

            {error && (
              <div className="notice deploy-error" role="alert" style={{ marginBottom: 20 }}>
                <strong>Could not read the strategy list from RPC</strong>
                <span>{error}</span>
              </div>
            )}

            {loading && list.length === 0 && (
              <div className="grid grid-3">
                {[0, 1, 2, 3, 4, 5].map((item) => (
                  <div className="card" key={item} aria-hidden="true">
                    <div className="skeleton" style={{ height: 16, width: '62%' }} />
                    <div className="skeleton" style={{ height: 10, width: '44%' }} />
                    <div className="skeleton" style={{ height: 46 }} />
                    <div className="skeleton" style={{ height: 10, width: '70%' }} />
                  </div>
                ))}
              </div>
            )}

            {!loading && list.length === 0 && (
              <div className="empty" style={{ margin: '30px auto' }}>
                <h3>No active strategy contracts discovered</h3>
                <p>
                  This view lists contracts whose source can be read back from the chain. A bot that exists only
                  in this browser&rsquo;s local record — for example an unarmed deployment — still appears in your
                  portfolio.
                </p>
                <p>
                  If you just deployed, give the node a minute and press Refresh: the indexer and the log scan both
                  lag the finalized block slightly.
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
                  <Link className="btn btn-primary" to="/deploy">
                    Deploy a strategy
                  </Link>
                  <Link className="btn btn-ghost" to="/portfolio">
                    Open my portfolio
                  </Link>
                </div>
              </div>
            )}

            {!loading && list.length > 0 && filteredContracts.length === 0 && (
              <div className="empty">
                <h3>No contracts match this filter</h3>
                <p>Clear the search or switch the status filter to see every indexed contract.</p>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setStatusFilter('all');
                  }}
                >
                  Reset filters
                </button>
              </div>
            )}

            <div className="grid grid-3">
              {filteredContracts.map((strategy) => (
                <StrategyCard key={strategy.address} strategy={strategy} />
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
