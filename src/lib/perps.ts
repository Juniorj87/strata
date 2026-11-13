/**
 * Perps provider adapter.
 *
 * There is no public perpetuals venue connected to Strata today: AsePad has
 * described an external perps protocol in testing (spot price as oracle, an
 * insurance fund), but no contract address or API is published. This module
 * defines the seam a future provider plugs into. Until one is configured,
 * every action throws and the UI shows an integration status instead of a
 * trade button that pretends to work.
 *
 * Nothing here derives a perp price, funding rate or liquidation price from
 * the spot AMM. A spot swap is not a substitute for a perp position.
 */

export type PerpsStatus = 'unavailable' | 'configured' | 'live';

export interface PerpsMarket {
  symbol: string;
  baseToken: string;
  quoteToken: string;
  markPrice: number;
  indexPrice: number;
  fundingRateHourly: number;
  openInterest: number;
  maxLeverage: number;
  maintenanceMarginBps: number;
}

export interface PerpsPosition {
  id: string;
  market: string;
  side: 'long' | 'short';
  size: string;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  margin: string;
  liquidationPrice: number;
  unrealisedPnl: number;
  fundingPaid: number;
  openedAt: number;
}

export interface OpenPositionRequest {
  market: string;
  side: 'long' | 'short';
  margin: string;
  leverage: number;
  takeProfit?: number;
  stopLoss?: number;
}

export interface PerpsProvider {
  readonly id: string;
  readonly label: string;
  status(): Promise<PerpsStatus>;
  markets(): Promise<PerpsMarket[]>;
  positions(owner: string): Promise<PerpsPosition[]>;
  openPosition(owner: string, request: OpenPositionRequest): Promise<string>;
  closePosition(owner: string, positionId: string): Promise<string>;
  history(owner: string): Promise<PerpsPosition[]>;
}

export class PerpsUnavailableError extends Error {
  constructor() {
    super(
      'Perpetuals are not connected. No public perps contract or API is available on Asentum yet. This is not an AseDex limitation: AseDex is a spot AMM, and Auras is also a spot AMM; neither supplies the margin, funding and liquidation engine required for perpetuals. '
      + 'so Strata cannot open, price or liquidate a position.',
    );
    this.name = 'PerpsUnavailableError';
  }
}

/** A provider that is honest about having no venue behind it. */
class UnconfiguredPerpsProvider implements PerpsProvider {
  readonly id = 'unconfigured';
  readonly label = 'No provider connected';
  private unavailable(): never {
    throw new PerpsUnavailableError();
  }
  async status(): Promise<PerpsStatus> { return 'unavailable'; }
  async markets(): Promise<PerpsMarket[]> { return []; }
  async positions(): Promise<PerpsPosition[]> { return []; }
  async history(): Promise<PerpsPosition[]> { return []; }
  async openPosition(): Promise<string> { return this.unavailable(); }
  async closePosition(): Promise<string> { return this.unavailable(); }
}

export const PERPS_PROVIDER: PerpsProvider = new UnconfiguredPerpsProvider();

export interface PerpsIntegrationInfo {
  status: PerpsStatus;
  provider: string;
  venue: string;
  reason: string;
  /** What the adapter needs before it can price a position. */
  requirements: string[];
  /** Everything the spot stack must not be used for. */
  notSupported: string[];
}

export function perpsIntegration(): PerpsIntegrationInfo {
  return {
    status: 'unavailable',
    provider: PERPS_PROVIDER.label,
    venue: 'External perps protocol (announced by AsePad, not published)',
    reason:
      'No contract address, ABI or API for a perpetuals venue is public. This is not blocked specifically by AseDex: Auras and AseDex are spot AMMs, not derivatives engines. Strata will not derive perp prices, '
      + 'funding or liquidations from the spot AMM.',
    requirements: [
      'A published contract address or API endpoint for the perps venue',
      'A mark/index price source and funding-rate method',
      'Margin, leverage and liquidation rules with a maintenance-margin parameter',
      'A way to read open positions and liquidation prices per wallet',
      'An insurance-fund address and its payout semantics',
    ],
    notSupported: [
      'Long / short positions',
      'Leverage and margin',
      'Liquidation prices',
      'Funding rates',
      'Perp stop-loss / take-profit',
    ],
  };
}

export function isPerpsAvailable(info: PerpsIntegrationInfo): boolean {
  return info.status === 'live' || info.status === 'configured';
}
