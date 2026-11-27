export type TemplateVenue = 'spot' | 'perps';

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
  /** Whether the current contract can place token -> ASE spot trades. */
  trades: boolean;
  /** Venue category: Spot AMM (Auras / AseDex) or AsePad Perps. */
  venue?: TemplateVenue;
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
    venue: 'spot',
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
    venue: 'spot',
  },
  {
    id: 'grid',
    name: 'Grid',
    desc: 'Runs a two-sided Auras inventory grid: buys ASE into the token below the reference price and sells deposited tokens above it.',
    liteDesc: 'Set buy and sell sizes, a price step and a total ASE reserve. Strata executes each buy level below the reference price and each sell level above it.',
    behavior: 'Two-sided grid. Deposit token inventory for sell levels and fund a separate ASE reserve for buy levels. Each level executes at most once; the schedule checks prices every 60 seconds, and the first run is at least five minutes after arming. Auras swaps are atomic and use a 2% minimum-output guard.',
    intervalSec: 60,
    requires: 'both',
    trades: true,
    contract: 'contracts/grid.js',
    venue: 'spot',
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
    venue: 'spot',
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
    venue: 'spot',
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
    venue: 'spot',
  },
  {
    id: 'limit-exit',
    name: 'Limit sell trigger',
    desc: 'Watches the Auras pool price on a schedule and sells one token amount into ASE after the target price is reached.',
    liteDesc: 'Set a target price and an amount. Strata checks the pool on schedule and makes one sell when the target is reached.',
    behavior: 'Scheduled reduce-only spot sell. The trigger is checked every run, the first run is at least five minutes after arming, and it is not a resting order-book limit order. After one sale the schedule stops.',
    intervalSec: 60,
    requires: 'tokens',
    trades: true,
    contract: 'contracts/limit-exit.js',
    venue: 'spot',
  },
  {
    id: 'scale',
    name: 'Scale order',
    desc: 'Splits a token allocation into price-triggered sell levels between the current pool price and a target price.',
    liteDesc: 'Create a sell ladder. Strata checks the pool price and sells one slice each time a price level is reached.',
    behavior: 'Reduce-only spot execution through Auras AMM. This is a scheduled on-chain price trigger (first run at least five minutes after arming), not a resting limit order in an order book. It sells token inventory into ASE only.',
    intervalSec: 60,
    requires: 'tokens',
    trades: true,
    contract: 'contracts/scale.js',
    venue: 'spot',
  },
  // ── AsePad Perps Bot Templates ──────────────────────────────────────────────
  {
    id: 'perp-dca',
    name: 'Perp DCA',
    desc: 'Opens or scales into a leveraged Long or Short position on AsePad Perps on a recurring Cron schedule with optional TP/SL.',
    liteDesc: 'Accumulate a leveraged Long or Short position on AsePad Perps at equal intervals, with optional automatic Take-Profit and Stop-Loss.',
    behavior: 'Isolated ASE margin is deposited into the AsePad Perps Vault at init. Asentum Cron executes each leveraged leg via AsePad Perps Engine and checks optional TP/SL exits.',
    intervalSec: 300,
    requires: 'ase',
    trades: false,
    contract: 'contracts/perp-dca.js',
    venue: 'perps',
  },
  {
    id: 'perp-trigger',
    name: 'Perp Trigger',
    desc: 'Watches AsePad Perps mark price and opens a leveraged Long or Short when your target entry price is crossed, with optional TP/SL.',
    liteDesc: 'Wait for a dip or breakout on the AsePad Perps oracle mark, open a leveraged Long or Short automatically, and monitor optional TP/SL.',
    behavior: 'Scheduled mark-price entry trigger on AsePad Perps with isolated margin in your bot contract.',
    intervalSec: 60,
    requires: 'ase',
    trades: false,
    contract: 'contracts/perp-trigger.js',
    venue: 'perps',
  },
  {
    id: 'perp-grid',
    name: 'Perp Grid',
    desc: 'Runs a leveraged grid on AsePad Perps: adds levels when price steps against your anchor and takes profit (+step) on reversals.',
    liteDesc: 'Trade sideways oscillations on AsePad Perps with leverage — scales in across price steps and reduces each level for profit on rebounds.',
    behavior: 'Maintains isolated margin in AsePad Perps Vault; opens/increases on adverse grid steps and reduces/closes on +step reversals.',
    intervalSec: 60,
    requires: 'ase',
    trades: false,
    contract: 'contracts/perp-grid.js',
    venue: 'perps',
  },
  {
    id: 'perp-risk',
    name: 'Perp SL / TP',
    desc: 'Opens a leveraged Long or Short position on AsePad Perps guarded by on-chain Stop-Loss, Take-Profit and trailing drawdown.',
    liteDesc: 'Enter an isolated leveraged Long or Short position on AsePad Perps with automated Stop-Loss, Take-Profit and trailing drawdown.',
    behavior: 'Checks AsePad Perps oracle mark every interval and automatically closes the position and withdraws collateral when any exit guard triggers.',
    intervalSec: 60,
    requires: 'ase',
    trades: false,
    contract: 'contracts/perp-risk.js',
    venue: 'perps',
  },
  {
    id: 'perp-twap',
    name: 'Perp TWAP',
    desc: 'Splits a large leveraged Long or Short entry on AsePad Perps into N equal timed slices.',
    liteDesc: 'Build a leveraged Long or Short position on AsePad Perps in equal timed parts to average across mark updates.',
    behavior: 'Isolated ASE margin in AsePad Perps Vault; each Cron slice sizes from live oracle mark and stops once all slices complete.',
    intervalSec: 300,
    requires: 'ase',
    trades: false,
    contract: 'contracts/perp-twap.js',
    venue: 'perps',
  },
  {
    id: 'perp-momentum',
    name: 'Perp Momentum',
    desc: 'Follows AsePad Perps mark momentum: opens Long on upward drift and closes/flips Short on downward drift.',
    liteDesc: 'Reads consecutive AsePad Perps mark observations and trades Long/Short trend swings automatically.',
    behavior: 'Isolated ASE margin in AsePad Perps Vault; opens Long on upward mark moves above threshold and closes or flips Short on downward reversals.',
    intervalSec: 300,
    requires: 'ase',
    trades: false,
    contract: 'contracts/perp-momentum.js',
    venue: 'perps',
  },
];

/** The five bot types offered in the simple Spot terminal, in trader language. */
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

/** Six autonomous Cron bot types for AsePad Perps (isolated contract vault). */
export const PERP_BOT_TYPES: BotType[] = [
  {
    templateId: 'perp-dca',
    mark: 'DCA',
    title: 'Perp DCA',
    short: 'Long / Short',
    blurb: 'Open and scale a leveraged Long or Short position on AsePad Perps on a fixed Cron schedule, with optional TP/SL.',
  },
  {
    templateId: 'perp-trigger',
    mark: 'TRIG',
    title: 'Trigger',
    short: 'Dip / Breakout',
    blurb: 'Wait for AsePad Perps mark price to cross your target move, enter with leverage and watch optional TP/SL.',
  },
  {
    templateId: 'perp-grid',
    mark: 'GRID',
    title: 'Perp Grid',
    short: 'Range grid',
    blurb: 'Scale into leveraged levels on step moves and automatically take profit when price rebounds.',
  },
  {
    templateId: 'perp-risk',
    mark: 'RISK',
    title: 'SL / TP Bot',
    short: 'Guarded pos',
    blurb: 'Enter a leveraged Long or Short guarded on-chain by Stop-Loss, Take-Profit and trailing drawdown.',
  },
  {
    templateId: 'perp-twap',
    mark: 'TWAP',
    title: 'Perp TWAP',
    short: 'Split entry',
    blurb: 'Split a leveraged Long or Short entry into equal timed slices across AsePad Perps mark updates.',
  },
  {
    templateId: 'perp-momentum',
    mark: 'MOM',
    title: 'Perp Momentum',
    short: 'Trend follow',
    blurb: 'Reads consecutive AsePad Perps mark observations and trades Long on upward drift, Short on downward drift.',
  },
];

/** Five direct `perps.asepad.fun` native order bots (submitted via `engine.placeOrder` for your wallet account). */
export type PerpsDirectKind = 'DCA' | 'SCALE' | 'LIMIT' | 'TRAIL' | 'STOP';

export interface PerpsDirectBotType {
  kind: PerpsDirectKind;
  mark: string;
  title: string;
  short: string;
  blurb: string;
}

export const PERPS_DIRECT_BOT_TYPES: PerpsDirectBotType[] = [
  {
    kind: 'DCA',
    mark: 'TWAP',
    title: 'TWAP / DCA',
    short: 'Keeper slices',
    blurb: 'Places a native TWAP/DCA order directly on your perps.asepad.fun account — sliced automatically by AsePad keepers.',
  },
  {
    kind: 'SCALE',
    mark: 'SCALE',
    title: 'Scale Ladder',
    short: 'Price ladder',
    blurb: 'Places stepped orders between From and To prices directly on perps.asepad.fun (up to 16 ladder steps).',
  },
  {
    kind: 'LIMIT',
    mark: 'LIMIT',
    title: 'Limit + TP/SL',
    short: 'GTC / Post-only',
    blurb: 'Places a resting Limit order on perps.asepad.fun with optional attached Take-Profit and Stop-Loss exits.',
  },
  {
    kind: 'TRAIL',
    mark: 'TRAIL',
    title: 'Trailing Stop',
    short: 'Trails mark %',
    blurb: 'Places an on-chain trailing stop directly on perps.asepad.fun that ratchets automatically with mark price.',
  },
  {
    kind: 'STOP',
    mark: 'TRIG',
    title: 'Stop / TP',
    short: 'Mark trigger',
    blurb: 'Places a Stop or Take-Profit trigger order directly on your perps.asepad.fun vault account.',
  },
];

export function templateById(id: string | null): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

export function botTypeFor(templateId: string): BotType | null {
  return BOT_TYPES.find((bot) => bot.templateId === templateId)
    ?? PERP_BOT_TYPES.find((bot) => bot.templateId === templateId)
    ?? null;
}

export function isPerpTemplate(templateId: string | null | undefined): boolean {
  return Boolean(templateId && templateId.startsWith('perp-'));
}
