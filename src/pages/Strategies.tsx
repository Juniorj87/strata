import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
    tag: 'AUTO-INVEST',
    title: 'DCA (Dollar-Cost Averaging)',
    subtitle: 'Automated recurring accumulation with ASE',
    summary: 'Regularly purchases your selected token with ASE at equal time intervals (e.g. every 1 hour, 4 hours, or 1 day) until your total ASE budget is exhausted.',
    whyUse: 'Removes the emotional stress of trying to time the market. Buying fixed amounts over time averages your entry price down during dips and keeps accumulation disciplined.',
    cadence: '15 min to 1 day (customizable)',
    funding: 'Total ASE budget + 0.05 ASE network fee',
    recommendedFor: 'Long-term accumulation and dip-buying',
  },
  {
    id: 'limit-exit',
    category: 'take-profit',
    tag: 'TAKE-PROFIT',
    title: 'Take-Profit Trigger',
    subtitle: 'Automated sell target into ASE',
    summary: 'Monitors the AMM pool price on schedule and executes one complete sell order into ASE as soon as your target price (+5%, +10%, +20%) is reached. Once executed, the schedule terminates.',
    whyUse: 'Guarantees that your profit targets are locked in automatically when prices spike, without requiring you to sit at your screen 24/7.',
    cadence: 'Checked every 60 seconds',
    funding: 'Token allocation to sell + 0.05 ASE network fee',
    recommendedFor: 'Locking in gains at upper resistance levels',
  },
  {
    id: 'grid',
    category: 'range',
    tag: 'RANGE TRADING',
    title: 'Grid Range Bot',
    subtitle: 'Automated buy-low sell-high across price levels',
    summary: 'Establishes a symmetrical grid of buy and sell price levels around the current price. When the price dips by your step (e.g. -2%), it buys tokens with ASE; when the price rallies (+2%), it sells tokens for ASE.',
    whyUse: 'Generates continuous cash flow during sideways or consolidating markets where the price fluctuates within a horizontal channel without clear directional trend.',
    cadence: 'Continuous execution across 3 to 10 levels',
    funding: 'Tokens (for sell levels) + ASE reserve (for buy levels)',
    recommendedFor: 'Flat, sideways or oscillating market corridors',
  },
  {
    id: 'risk-managed',
    category: 'protection',
    tag: 'CAPITAL PROTECTION',
    title: 'Stop-Loss & Risk Manager',
    subtitle: 'Hard-coded downside protection & daily loss limits',
    summary: 'Safeguards your portfolio from deep drawdowns and flash crashes. If the market drops past your stop-loss percentage (-5%, -10%), the contract latches and executes orderly spot sales into ASE. Also supports trailing drawdown protection and daily loss caps.',
    whyUse: 'Guarantees that a bad market downturn cannot wipe out your capital. The rules execute automatically on-chain without human emotion, panic, or delays.',
    cadence: 'Checked every 5 min to 1 hour',
    funding: 'Token allocation + declared average buy price',
    recommendedFor: 'High-volatility tokens and downside defense',
  },
  {
    id: 'twap',
    category: 'execution',
    tag: 'SPLIT ORDER',
    title: 'TWAP Order Slicer',
    subtitle: 'Large position liquidation without price collapse',
    summary: 'What is TWAP? When selling a large quantity of tokens at once, the transaction exhausts pool liquidity, causing massive price slippage and crashing the price against you. TWAP (Time-Weighted Average Price) divides your large order into multiple equal, smaller slices executed at regular time intervals (e.g. 5 orders over 30 minutes).',
    whyUse: 'Essential for large token holders: ensures minimal price impact on the AMM, allows the pool to absorb the volume naturally, and achieves a vastly superior average execution price.',
    cadence: 'Splits across 5 to 20 timed slices',
    funding: 'Token allocation to liquidate + 0.05 ASE network fee',
    recommendedFor: 'Whales & large bag sales with low pool slippage',
  },
  {
    id: 'scale',
    category: 'execution',
    tag: 'LADDER SELL',
    title: 'Scale Ladder Order',
    subtitle: 'Incremental profit taking at staggered price steps',
    summary: 'Splits a token allocation into a ladder of sell levels between the current pool price and a target upside price. Sells one slice each time a higher price step is breached.',
    whyUse: 'Lets you scale out of a winning position gradually rather than selling everything too early or missing the top.',
    cadence: 'One bounded swap per cron interval as tiers hit',
    funding: 'Token allocation + 0.05 ASE network fee',
    recommendedFor: 'Scaling out of runners during sustained rallies',
  },
  {
    id: 'momentum-signal',
    category: 'analytics',
    tag: 'ANALYTICS',
    title: 'Momentum Signal Generator',
    subtitle: 'Algorithmic trend indicator contract',
    summary: 'Calculates rolling TWAP price windows across consecutive intervals. When moving price changes breach your configured basis-point threshold, it emits on-chain buy, sell, or neutral momentum signals.',
    whyUse: 'Allows algorithmic operators and external smart contracts to read verified on-chain trend indicators without trusting off-chain oracles.',
    cadence: 'Computes trends every 60 seconds',
    funding: 'Gas escrow in ASE only (no tokens required)',
    recommendedFor: 'Algorithmic traders & automated trend listeners',
  },
];

export function Strategies() {
  const [params, setParams] = useSearchParams();
  const activeTab = (params.get('tab') as 'catalog' | 'live' | 'marketplace') || 'catalog';
  const [category, setCategory] = useState<string>('all');
  const { data, loading, error, refresh } = useAsync(() => loadStrategies(), 15000);
  const list = data ?? [];

  const setTab = (tab: 'catalog' | 'live' | 'marketplace') => {
    setParams({ tab }, { replace: true });
  };

  const filteredGuides = category === 'all'
    ? STRATEGY_GUIDES
    : STRATEGY_GUIDES.filter((g) => g.category === category);

  return (
    <>
      <section className="wrap detail-head">
        <span className="label">Strategies · Asentum testnet</span>
        <h1 className="detail-title">Trading strategies.</h1>
        <p className="section-note" style={{ maxWidth: 720 }}>
          Explore automated strategy bots running on Asentum. Review the mechanics of each bot type below,
          inspect live contracts on-chain, or copy community setups from the marketplace.
        </p>

        <div className="mode-switch" role="tablist" style={{ marginTop: 20 }}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'catalog'}
            className={activeTab === 'catalog' ? 'mode-option active' : 'mode-option'}
            onClick={() => setTab('catalog')}
          >
            <span>Strategy Catalog</span>
            <small>Guides & bot types</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'live'}
            className={activeTab === 'live' ? 'mode-option active' : 'mode-option'}
            onClick={() => setTab('live')}
          >
            <span>Live Contracts ({list.length})</span>
            <small>Active on-chain bots</small>
          </button>
          <Link to="/marketplace" className="mode-option">
            <span>Marketplace Catalog</span>
            <small>Copy & deploy setups</small>
          </Link>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 90 }}>
        {activeTab === 'catalog' && (
          <div>
            <div className="chip-row" style={{ marginBottom: 20 }}>
              {[
                { id: 'all', label: `All bots (${STRATEGY_GUIDES.length})` },
                { id: 'accumulation', label: 'Accumulation (DCA)' },
                { id: 'take-profit', label: 'Take-Profit' },
                { id: 'range', label: 'Range Trading (Grid)' },
                { id: 'protection', label: 'Capital Protection' },
                { id: 'execution', label: 'Split Execution (TWAP/Scale)' },
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
                const matchStrategies = list.filter((item) => item.template === guide.id);
                const totalTrades = matchStrategies.reduce((sum, item) => sum + item.trades, 0);
                return (
                  <div className="catalog-card" key={guide.id}>
                    <div>
                      <div className="catalog-card-head">
                        <span className="catalog-tag">{guide.tag}</span>
                        <span className="mono dim" style={{ fontSize: 11 }}>
                          {matchStrategies.length > 0 ? `${matchStrategies.length} active on-chain` : 'Verified Template'}
                        </span>
                      </div>
                      <h2 className="catalog-title">{guide.title}</h2>
                      <div className="catalog-sub">{guide.subtitle}</div>

                      <div className="catalog-body">
                        <div className="catalog-point">
                          <strong>What it does</strong>
                          <p style={{ margin: 0 }}>{guide.summary}</p>
                        </div>
                        <div className="catalog-point">
                          <strong>Why use it</strong>
                          <p style={{ margin: 0 }}>{guide.whyUse}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="catalog-meta">
                        <div><span className="dim">Cadence: </span><strong>{guide.cadence}</strong></div>
                        <div><span className="dim">Needs: </span><strong>{guide.funding}</strong></div>
                        {matchStrategies.length > 0 && (
                          <div><span className="dim">On-chain activity: </span><strong className="mono" style={{ color: 'var(--accent)' }}>{totalTrades} executions</strong></div>
                        )}
                      </div>

                      <Link
                        to={guide.id === 'momentum-signal' ? '/deploy?template=momentum-signal&mode=pro' : `/deploy?template=${guide.id}`}
                        className="btn btn-primary"
                      >
                        Use this template ↗
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'live' && (
          <div>
            <div className="filters">
              <span className="live-dot">
                {loading ? 'Scanning Asentum testnet for verified strategy deployments…' : `${list.length} verified strategy contracts`}
              </span>
              <button className="chip" onClick={refresh} type="button" style={{ marginLeft: 'auto' }}>
                Refresh
              </button>
            </div>

            {error && (
              <div className="notice" style={{ borderLeftColor: 'var(--down)', marginBottom: 20 }}>
                Could not read the strategy list from RPC: {error}
              </div>
            )}

            {loading && list.length === 0 && (
              <div className="scanning-indicator">
                <span className="live-dot">Scanning chain state</span>
                <p style={{ margin: 0, fontSize: 14 }}>Reading strategy contracts from Strata Hub and recent deployments…</p>
              </div>
            )}

            {!loading && list.length === 0 && (
              <div className="empty" style={{ margin: '30px auto' }}>
                <h3 style={{ fontSize: 18, marginBottom: 8 }}>No active strategy contracts discovered</h3>
                <p style={{ maxWidth: 520, margin: '0 auto 10px', fontSize: 14 }}>
                  This tab lists contracts whose source can be read back from the chain. A bot that exists only in
                  this browser&rsquo;s local record (for example an unarmed deployment) is still listed in your portfolio.
                </p>
                <p style={{ maxWidth: 520, margin: '0 auto 20px', fontSize: 14 }}>
                  If you just deployed, give the node a minute and press Refresh: the indexer and the log scan both
                  lag the finalized block slightly.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Link className="btn btn-primary" to="/deploy">
                    Deploy a strategy
                  </Link>
                  <Link className="btn btn-ghost" to="/portfolio">
                    Open my portfolio
                  </Link>
                </div>
              </div>
            )}

            <div className="grid grid-3" style={{ marginTop: 16 }}>
              {list.map((s) => (
                <StrategyCard key={s.address} strategy={s} />
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
