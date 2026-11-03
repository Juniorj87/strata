import { loadStrategy, type LiveStrategy } from './registry';
import { toHexAddress, viewCall } from './rpc';

export const MARKETPLACE_ADDRESS = String(
  import.meta.env?.VITE_STRATA_MARKETPLACE ||
  ''
).trim();

export interface MarketplaceListing {
  strategy: string;
  owner: string;
  template: string;
  title: string;
  description: string;
  tags: string;
  active: boolean;
  updatedAt: string;
  config: Record<string, string> | null;
  liveStrategy: LiveStrategy;
}

function decodeListing(value: unknown): Omit<MarketplaceListing, 'liveStrategy'> | null {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const strategy = String(parsed.strategy ?? '');
    if (!strategy) return null;
    let config: Record<string, string> | null = null;
    try {
      const rawConfig = typeof parsed.config === 'string' ? JSON.parse(parsed.config) as unknown : parsed.config;
      if (rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)) {
        const raw = rawConfig as Record<string, unknown>;
        const safe: Record<string, string> = {};
        for (const key of ['version', 'template', 'poolId', 'token', 'thresholdBps', 'stepBps', 'intervalSec', 'sizeWei', 'budgetWei', 'decimals', 'notionalWei', 'slices', 'levels', 'costBasisAseWeiPerToken', 'dailyLossLimitAseWei', 'stopLossBps', 'takeProfitBps', 'maxDrawdownBps', 'targetUpsideBps', 'sizePerLevelWei', 'sellSizeWei', 'buySizeAseWei', 'buyBudgetAseWei']) {
          const value = raw[key];
          if (typeof value === 'string' || typeof value === 'number') safe[key] = String(value);
        }
        if (['1', '2'].includes(safe.version ?? '') && safe.template === String(parsed.template ?? '')) config = safe;
      }
    } catch { config = null; }
    return {
      strategy,
      owner: String(parsed.owner ?? ''),
      template: String(parsed.template ?? ''),
      title: String(parsed.title ?? 'Untitled strategy'),
      description: String(parsed.description ?? ''),
      tags: String(parsed.tags ?? ''),
      active: Boolean(parsed.active),
      updatedAt: String(parsed.updatedAt ?? '0'),
      config,
    };
  } catch {
    return null;
  }
}

/** Reads a configured on-chain marketplace and verifies every listed source before displaying it. */
export async function loadMarketplaceListings(): Promise<{ listings: MarketplaceListing[]; configured: boolean }> {
  if (!MARKETPLACE_ADDRESS) return { listings: [], configured: false };
  const registryAddress = toHexAddress(MARKETPLACE_ADDRESS);
  const count = Number(await viewCall<unknown>(registryAddress, 'getListingCount', []));
  if (!Number.isFinite(count) || count < 0) throw new Error('Marketplace returned an invalid listing count.');
  const indexes = Array.from({ length: Math.min(count, 100) }, (_, index) => index);
  const rawListings = await Promise.all(indexes.map((index) => viewCall<unknown>(registryAddress, 'getListingAt', [String(index)]).catch(() => '')));
  const candidates = rawListings.map(decodeListing).filter((entry): entry is Omit<MarketplaceListing, 'liveStrategy'> => Boolean(entry?.active));
  const listings = await Promise.all(candidates.map(async (entry) => {
    const liveStrategy = await loadStrategy(entry.strategy).catch(() => null);
    if (!liveStrategy?.verified || liveStrategy.owner?.toLowerCase() !== entry.owner.toLowerCase()) return null;
    if (liveStrategy.template !== entry.template) return null;
    return { ...entry, liveStrategy };
  }));
  return { listings: listings.filter((entry): entry is MarketplaceListing => Boolean(entry)), configured: true };
}
