import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWallet } from '@asentum/connect';
import { useAsync } from '../lib/hooks';
import { NETWORK } from '../lib/network';
import { loadStrategies } from '../lib/registry';
import { StrategyCard } from '../components/StrategyCard';
import { InfoTip } from '../components/InfoTip';

interface StrategyGuide {
  id: string;
  category: 'accumulation' | 'take-profit' | 'range' | 'protection' | 'execution' | 'analytics' | 'perps';
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
      'Checks the AMM pool price on each scheduled run and executes one complete sell order into ASE on the first run where your target price (+5%, +10%, +20%) is met. Once executed, the schedule terminates.',
    whyUse:
      'Locks in a profit target automatically when prices spike, without sitting in front of a screen. It is a scheduled check, not a resting order-book limit.',
    cadence: 'Every run (min 60s; first run ≥5 min)',
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
      'Takes repeated small profits during sideways markets where price oscillates inside a horizontal channel without a clear directional trend.',
    cadence: 'Scheduled checks across 3 to 10 levels',
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
    id: 'momentum-trader',
    category: 'analytics',
    tag: 'Momentum',
    title: 'Momentum Trader',
    subtitle: 'One-sided momentum execution into ASE',
    summary:
      'Compares consecutive Auras TWAP windows. When upward drift crosses your threshold, it sells a fixed amount of the deposited token into ASE. It does not open a buy position.',
    whyUse:
      'Turns a momentum signal into an actual spot sale with a minimum-output guard, without an off-chain bot holding the tokens.',
    cadence: 'Checks every run (min 60s; first run ≥5 min)',
    funding: 'Token inventory + cron gas escrow',
    recommendedFor: 'Selling into strength with a defined size',
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
  {
    id: 'perp-dca',
    category: 'perps',
    tag: 'AsePad Perps',
    title: 'Perp DCA Bot',
    subtitle: 'Automated leveraged Long / Short accumulation on perps.asepad.fun',
    summary:
      'Deposits isolated ASE margin into AsePad Perps Vault and scales into a leveraged Long or Short position on a fixed Cron schedule, with optional automatic Take-Profit and Stop-Loss exits.',
    whyUse:
      'Averages leveraged perpetual entries on-chain without leaving a bot server running, and protects the position automatically on every tick.',
    cadence: '1 minute to 1 day',
    funding: 'ASE Vault margin + 0.05 ASE cron escrow',
    recommendedFor: 'Leveraged Long / Short DCA with automated TP/SL',
  },
  {
    id: 'perp-trigger',
    category: 'perps',
    tag: 'AsePad Perps',
    title: 'Perp Trigger Bot',
    subtitle: 'Dip or breakout leveraged entry trigger on AsePad Perps',
    summary:
      'Monitors the AsePad Perps oracle mark price and opens a leveraged Long or Short automatically once your target move below or above current mark is reached, then watches optional TP/SL.',
    whyUse:
      'Automates conditional perpetual entries at key dips or breakouts without watching the order screen.',
    cadence: 'Checks mark every 60s+',
    funding: 'ASE Vault margin + 0.05 ASE cron escrow',
    recommendedFor: 'Conditional leveraged breakouts or dip entries',
  },
  {
    id: 'perp-grid',
    category: 'perps',
    tag: 'AsePad Perps',
    title: 'Perp Grid Bot',
    subtitle: 'Leveraged range grid on AsePad Perps',
    summary:
      'Scales into leveraged levels on step moves against your anchor price and automatically reduces each level at +step profit when the mark price rebounds.',
    whyUse:
      'Captures repeated oscillations on AsePad Perps using isolated contract collateral.',
    cadence: 'Scheduled mark checks every 60s+',
    funding: 'ASE Vault margin reserve + 0.05 ASE cron escrow',
    recommendedFor: 'Sideways perpetual ranges with leverage',
  },
  {
    id: 'perp-risk',
    category: 'perps',
    tag: 'AsePad Perps',
    title: 'Perp SL / TP / Trailing Bot',
    subtitle: 'Guarded leveraged position on AsePad Perps',
    summary:
      'Opens a leveraged Long or Short on AsePad Perps guarded on-chain by Stop-Loss, Take-Profit and trailing drawdown from peak favorable mark price.',
    whyUse:
      'Locks in upside with trailing drawdown and enforces strict downside limits automatically via Asentum Cron.',
    cadence: 'Checked every 60s+',
    funding: 'ASE Vault margin + 0.05 ASE cron escrow',
    recommendedFor: 'Guarded directional perpetual positions',
  },
  {
    id: 'perp-twap',
    category: 'perps',
    tag: 'AsePad Perps',
    title: 'Perp TWAP Slicer',
    subtitle: 'Timed leveraged entry slices on AsePad Perps',
    summary:
      'Splits a leveraged Long or Short entry into N equal timed slices across AsePad Perps oracle mark updates until the full margin allocation is deployed.',
    whyUse:
      'Spreads leveraged position sizing over time across multiple oracle windows.',
    cadence: '2 to 100 timed slices',
    funding: 'ASE Vault margin + 0.05 ASE cron escrow',
    recommendedFor: 'Larger leveraged entries across timed intervals',
  },
  {
    id: 'perp-momentum',
    category: 'perps',
    tag: 'AsePad Perps',
    title: 'Perp Momentum Bot',
    subtitle: 'Directional Long / Short momentum contract',
    summary:
      'Tracks consecutive AsePad Perps oracle mark changes, opening Long on upward threshold moves and closing or flipping Short on downward moves.',
    whyUse:
      'Follows trend swings automatically on AsePad Perps with isolated contract collateral.',
    cadence: 'Configurable 60s+ interval',
    funding: 'ASE Vault margin + 0.05 ASE cron escrow',
    recommendedFor: 'Algorithmic trend strategies on AsePad Perps',
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
        <span className="label">Strategies · {NETWORK.shortLabel}</span>
        <h1 className="detail-title">Trading strategies,<br />ready to launch.</h1>
        <p className="section-note" style={{ marginTop: 10 }}>
          Non-custodial contract templates you own. Pick a strategy, inspect live bots, or clone a shared setup.
          <InfoTip
            label="How strategy templates work"
            text="Every strategy below deploys as an isolated smart contract owned by your wallet and scheduled via Asentum Cron—never a background server job."
          />
        </p>

        <div className="seg-tabs" role="tablist" aria-label="Strategy views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'catalog'}
            className={activeTab === 'catalog' ? 'seg-tab active' : 'seg-tab'}
            onClick={() => setTab('catalog')}
          >
            Strategy catalog
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'live'}
            className={activeTab === 'live' ? 'seg-tab active' : 'seg-tab'}
            onClick={() => setTab('live')}
          >
            Live contracts
            <span className="seg-tab-count">{list.length}</span>
          </button>
          <Link to="/marketplace" className="seg-tab">
            Marketplace ↗
            <span className="seg-tab-soon">Coming soon</span>
          </Link>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 96 }}>
        {activeTab === 'catalog' && (
          <div>
            <div className="chip-row" style={{ marginBottom: 22 }}>
              {[
                { id: 'all', label: `All templates (${STRATEGY_GUIDES.length})` },
                { id: 'perps', label: 'AsePad Perps · Coming soon', disabled: true },
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
                  disabled={chip.disabled}
                  aria-disabled={chip.disabled}
                  className={category === chip.id ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => { if (!chip.disabled) setCategory(chip.id); }}
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
                        <span className="mono dim" style={{ fontSize: 13 }}>
                          {matches.length > 0
                            ? `${matches.length} on-chain · ${scheduled.length} scheduled`
                            : 'Verified template'}
                        </span>
                      </div>
                      <h2 className="catalog-title">{guide.title}</h2>
                      <div className="catalog-sub" style={{ marginBottom: 0 }}>{guide.subtitle}</div>

                      <div className="catalog-pills">
                        <span className="catalog-pill"><span>Cadence</span> {guide.cadence}</span>
                        <span className="catalog-pill"><span>Needs</span> {guide.funding}</span>
                        {matches.length > 0 && (
                          <span className="catalog-pill"><span>Fills</span> <strong className="mono" style={{ color: 'var(--accent)' }}>{totalTrades}</strong></span>
                        )}
                      </div>

                      <details className="soft-details" style={{ marginTop: 14 }}>
                        <summary>How it works &amp; best for</summary>
                        <div className="soft-details-body" style={{ display: 'grid', gap: 10 }}>
                          <div>
                            <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 2 }}>What it does</strong>
                            <span>{guide.summary}</span>
                          </div>
                          <div>
                            <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 2 }}>Why use it</strong>
                            <span>{guide.whyUse}</span>
                          </div>
                          <div>
                            <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 2 }}>Best for</strong>
                            <span>{guide.recommendedFor}</span>
                          </div>
                        </div>
                      </details>
                    </div>

                    <div>
                      {guide.category === 'perps' ? (
                        <span className="badge-soon">Coming soon</span>
                      ) : ['momentum-signal', 'momentum-trader', 'scale'].includes(guide.id) ? (
                        <span className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                          Advanced template · deployed from the CLI, not the simple builder
                        </span>
                      ) : (
                        <Link
                          to={`/deploy?template=${guide.id}`}
                          className="btn btn-ghost"
                        >
                          Use this template <span className="arr" aria-hidden="true">→</span>
                        </Link>
                      )}
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
