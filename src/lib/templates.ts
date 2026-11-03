export interface Template {
  id: string;
  name: string;
  desc: string;
  intervalSec: number;
  /** What the strategy needs before it can do anything. */
  requires: 'gas' | 'tokens' | 'ase' | 'both';
  contract: string;
  /** Plain-language description for the one-click flow. */
  liteDesc: string;
  /** Important implementation limitation shown before signing. */
  behavior: string;
  /** Whether the current contract can place token -> ASE trades. */
  trades: boolean;
}

export const TEMPLATES: Template[] = [
  {
    id: 'momentum-signal',
    name: 'Momentum signal',
    desc: 'Compares consecutive Auras TWAP windows and publishes a buy / sell / hold signal every interval. Gas only.',
    liteDesc: 'Compares consecutive TWAP windows and publishes a signal when average price movement crosses your threshold. It does not trade.',
    behavior: 'Signal only. No token deposit is needed; the cron schedule is funded with ASE.',
    intervalSec: 60,
    requires: 'gas',
    trades: false,
    contract: 'contracts/auras-momentum-signal.js',
  },
  {
    id: 'momentum-trader',
    name: 'Momentum trader',
    desc: 'Sells the pool token into ASE when the upward TWAP drift crosses your threshold.',
    liteDesc: 'Compares consecutive TWAP windows and sells a fixed amount of the selected token into ASE when upward movement crosses your threshold.',
    behavior: 'One-sided execution: the current contract sells the selected ARC-20 token into ASE. It does not open a buy position.',
    intervalSec: 60,
    requires: 'tokens',
    trades: true,
    contract: 'contracts/auras-momentum-trader.js',
  },
  {
    id: 'grid',
    name: 'Grid',
    desc: 'Runs a two-sided Auras inventory grid: buys ASE into the token below the reference price and sells deposited tokens above it.',
    liteDesc: 'Set buy and sell sizes, a price step and a total ASE reserve. Strata executes each buy level below the reference price and each sell level above it.',
    behavior: 'Two-sided grid. Deposit token inventory for sell levels and fund a separate ASE reserve for buy levels. Each level executes at most once; the schedule checks prices every 60 seconds. Auras swaps are atomic and use a 2% minimum-output guard.',
    intervalSec: 60,
    requires: 'both',
    trades: true,
    contract: 'contracts/grid.js',
  },
  {
    id: 'twap',
    name: 'TWAP slicer',
    desc: 'Splits a token-to-ASE sale into a fixed number of smaller timed legs.',
    liteDesc: 'Splits one token sale into smaller timed parts to avoid sending the full amount in one swap.',
    behavior: 'Token-to-ASE TWAP. The token amount is split into timed atomic Auras swaps; one failed swap reverts that run and can be retried by Cron while escrow remains. Each slice is a separate swap, not an order-book partial fill. Stop is available to the owner; unspent tokens can be reclaimed after stopping.',
    intervalSec: 300,
    requires: 'tokens',
    trades: true,
    contract: 'contracts/twap.js',
  },
  {
    id: 'dca',
    name: 'DCA',
    desc: 'Buys the selected pool token with a fixed ASE amount on a recurring schedule until the ASE budget is used.',
    liteDesc: 'Choose how much ASE to spend per purchase, your total ASE budget and the interval. Strata buys the token automatically until the budget is exhausted.',
    behavior: 'Recurring ASE-to-token spot buys through Auras. The total ASE purchase budget and cron escrow are funded at initialization. Each swap is atomic with a 2% minimum-output guard; the final purchase may be smaller than the configured size.',
    intervalSec: 3600,
    requires: 'ase',
    trades: true,
    contract: 'contracts/dca.js',
  },
  {
    id: 'risk-managed',
    name: 'Risk-managed trader',
    desc: 'A scheduled token-to-ASE strategy with price guards, a declared average cost basis, a daily realised-loss stop and a hard allocation cap.',
    liteDesc: 'Set how much to sell each time and define your stop-loss, take-profit and loss limits. The contract checks these rules on every scheduled run.',
    behavior: 'Spot-only and sell-only. Stop-loss, take-profit and drawdown use the Auras pool reserve price checked on each Cron run. Once an exit triggers, the condition is latched and the strategy sells no more than one configured trade size per run until its declared allocation is exhausted. Daily loss uses your entered average acquisition cost and realised fills only; this is not a continuous external price oracle or a full portfolio PnL oracle.',
    intervalSec: 300,
    requires: 'tokens',
    trades: true,
    contract: 'contracts/risk-managed.js',
  },
  {
    id: 'limit-exit',
    name: 'Limit sell trigger',
    desc: 'Watches the Auras pool price on a schedule and sells one token amount into ASE after the target price is reached.',
    liteDesc: 'Set a target price and an amount. Strata checks the pool on schedule and makes one sell when the target is reached.',
    behavior: 'Scheduled reduce-only spot sell. The trigger is checked every run; it is not a resting order-book limit order and does not continuously watch the price. After one sale the schedule stops.',
    intervalSec: 60,
    requires: 'tokens',
    trades: true,
    contract: 'contracts/limit-exit.js',
  },
  {
    id: 'scale',
    name: 'Scale order',
    desc: 'Splits a token allocation into price-triggered sell levels between the current pool price and a target price.',
    liteDesc: 'Create a sell ladder. Strata checks the pool price and sells one slice each time a price level is reached.',
    behavior: 'Reduce-only spot execution through Auras AMM. This is a scheduled on-chain price trigger, not a resting limit order in an order book. It sells token inventory into ASE only.',
    intervalSec: 60,
    requires: 'tokens',
    trades: true,
    contract: 'contracts/scale.js',
  },
];

/** The five bot types offered in the simple terminal, in trader language. */
export interface BotType {
  templateId: string;
  /** Short monogram shown in the tab badge (no emoji glyphs). */
  mark: string;
  title: string;
  short: string;
  blurb: string;
}

export const BOT_TYPES: BotType[] = [
  {
    templateId: 'dca',
    mark: 'DCA',
    title: 'DCA',
    short: 'Auto-invest',
    blurb: 'Buy a token with ASE automatically at equal intervals — averages your entry without watching the chart.',
  },
  {
    templateId: 'limit-exit',
    mark: 'TP',
    title: 'Take-Profit',
    short: 'Sell target',
    blurb: 'Sell a token into ASE once the pool price rises to your target. One execution, then the schedule stops.',
  },
  {
    templateId: 'grid',
    mark: 'GRID',
    title: 'Grid Bot',
    short: 'Range grid',
    blurb: 'Buy lower and sell higher around the current price — a set of levels that earn on sideways movement.',
  },
  {
    templateId: 'risk-managed',
    mark: 'RISK',
    title: 'Stop-Loss',
    short: 'Protection',
    blurb: 'Sell automatically when the price drops to your stop — and take profit when it reaches your target.',
  },
  {
    templateId: 'twap',
    mark: 'TWAP',
    title: 'TWAP',
    short: 'Split order',
    blurb: 'Sell a large amount in equal parts over time so one swap does not move the price against you.',
  },
];

export function templateById(id: string | null): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

export function botTypeFor(templateId: string): BotType | null {
  return BOT_TYPES.find((bot) => bot.templateId === templateId) ?? null;
}
