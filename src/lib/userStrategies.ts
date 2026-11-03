import { toHexAddress, getBalance, viewCall } from './rpc';
import type { LivePool } from './registry';

export interface DeployedStrategyRecord {
  address: string;
  template: string;
  templateName?: string;
  poolId: string;
  tokenSymbol: string;
  tokenAddress: string;
  venue: 'auras' | 'asedex';
  deployTxHash: string;
  initTxHash?: string;
  transferTxHash?: string;
  hubTxHash?: string;
  status: 'active' | 'deployed' | 'initialized' | 'funded' | 'failed';
  budget?: string;
  size?: string;
  buyBudgetAse?: string;
  buySizeAse?: string;
  slices?: string;
  levels?: string;
  threshold?: string;
  interval?: number;
  createdAt: number;
  owner: string;
}

export interface UserTxRecord {
  hash: string;
  type: 'deploy' | 'init' | 'fund' | 'register' | 'cancel' | 'withdraw';
  description: string;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
  strategyAddress?: string;
  error?: string;
}

export interface UserTokenHolding {
  symbol: string;
  name: string;
  token: string;
  decimals: number;
  balanceRaw: string;
  balanceFmt: string;
  balanceNum: number;
  poolId: string;
  venue: 'auras' | 'asedex';
  isNative?: boolean;
}

const STRATEGIES_PREFIX = 'strata:user_strategies:';
const ALL_STRATEGIES_KEY = 'strata:all_user_strategies';
const TXS_PREFIX = 'strata:user_txs:';

export function saveUserStrategy(record: DeployedStrategyRecord): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const ownerKey = record.owner.toLowerCase();
    const ownerHex = toHexAddress(ownerKey).toLowerCase();

    // 1. Save in owner key
    for (const key of [`${STRATEGIES_PREFIX}${ownerKey}`, `${STRATEGIES_PREFIX}${ownerHex}`]) {
      const list: DeployedStrategyRecord[] = JSON.parse(localStorage.getItem(key) ?? '[]');
      const idx = list.findIndex((s) => s.address.toLowerCase() === record.address.toLowerCase());
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...record };
      } else {
        list.unshift(record);
      }
      localStorage.setItem(key, JSON.stringify(list));
    }

    // 2. Save in all strategies list
    const all: DeployedStrategyRecord[] = JSON.parse(localStorage.getItem(ALL_STRATEGIES_KEY) ?? '[]');
    const allIdx = all.findIndex((s) => s.address.toLowerCase() === record.address.toLowerCase());
    if (allIdx >= 0) {
      all[allIdx] = { ...all[allIdx], ...record };
    } else {
      all.unshift(record);
    }
    localStorage.setItem(ALL_STRATEGIES_KEY, JSON.stringify(all));
  } catch (err) {
    console.error('Failed to save strategy record:', err);
  }
}

export function getUserStrategies(ownerAddress?: string): DeployedStrategyRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    if (!ownerAddress) {
      return JSON.parse(localStorage.getItem(ALL_STRATEGIES_KEY) ?? '[]');
    }
    const ownerKey = ownerAddress.toLowerCase();
    const hex = toHexAddress(ownerKey).toLowerCase();

    const list1: DeployedStrategyRecord[] = JSON.parse(localStorage.getItem(`${STRATEGIES_PREFIX}${ownerKey}`) ?? '[]');
    const list2: DeployedStrategyRecord[] = JSON.parse(localStorage.getItem(`${STRATEGIES_PREFIX}${hex}`) ?? '[]');

    const combined = [...list1];
    for (const item of list2) {
      if (!combined.some((s) => s.address.toLowerCase() === item.address.toLowerCase())) {
        combined.push(item);
      }
    }
    return combined;
  } catch {
    return [];
  }
}

export function saveUserTx(walletAddress: string, tx: UserTxRecord): void {
  if (typeof window === 'undefined' || !window.localStorage || !walletAddress) return;
  try {
    const key = `${TXS_PREFIX}${walletAddress.toLowerCase()}`;
    const list: UserTxRecord[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    const idx = list.findIndex((t) => t.hash.toLowerCase() === tx.hash.toLowerCase());
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...tx };
    } else {
      list.unshift(tx);
    }
    localStorage.setItem(key, JSON.stringify(list.slice(0, 100)));
  } catch (err) {
    console.error('Failed to save tx record:', err);
  }
}

export function getUserTxs(walletAddress?: string): UserTxRecord[] {
  if (typeof window === 'undefined' || !window.localStorage || !walletAddress) return [];
  try {
    return JSON.parse(localStorage.getItem(`${TXS_PREFIX}${walletAddress.toLowerCase()}`) ?? '[]');
  } catch {
    return [];
  }
}

/**
 * The wallet hands back the connected address in whatever form it uses, so a
 * single failed conversion must not zero out every balance on the page.
 */
function resolveHex(address: string): string {
  try {
    return toHexAddress(address).toLowerCase();
  } catch {
    return address.trim().toLowerCase();
  }
}

/** Read balanceOf, retrying with the other address form before giving up. */
async function readTokenBalance(token: string, hex: string, alt?: string): Promise<bigint> {
  const toUnits = (raw: unknown): bigint => BigInt(String(raw ?? '0').replace(/"/g, '').trim() || '0');
  try {
    const first = toUnits(await viewCall<unknown>(token, 'balanceOf', [hex]));
    if (first > 0n) return first;
  } catch {
    // fall through to the alternative argument form
  }
  if (alt && alt !== hex) {
    try {
      return toUnits(await viewCall<unknown>(token, 'balanceOf', [alt]));
    } catch {
      // unreadable token; caller decides what to show
    }
  }
  return 0n;
}

export async function fetchUserTokenHoldings(
  walletAddress: string,
  pools: LivePool[],
  displayAddress?: string | null,
): Promise<UserTokenHolding[]> {
  if (!walletAddress) return [];
  const hex = resolveHex(walletAddress);
  const alt = displayAddress ? String(displayAddress).trim() : undefined;
  const holdings: UserTokenHolding[] = [];

  // 1. Native ASE Balance
  try {
    let balData = await getBalance(hex);
    let nativeBal = BigInt(balData.balance || '0');
    if (nativeBal === 0n && alt && alt !== hex) {
      balData = await getBalance(alt).catch(() => balData);
      nativeBal = BigInt(balData.balance || '0');
    }
    if (nativeBal > 0n) {
      const whole = nativeBal / 10n ** 18n;
      const frac = (nativeBal % 10n ** 18n).toString().padStart(18, '0').slice(0, 4);
      holdings.push({
        symbol: 'ASE',
        name: 'Asentum Native Token',
        token: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        decimals: 18,
        balanceRaw: balData.balance,
        balanceFmt: `${whole.toLocaleString('en-US')}.${frac}`,
        balanceNum: Number(whole) + Number(frac) / 10000,
        poolId: '',
        venue: 'auras',
        isNative: true,
      });
    }
  } catch (err) {
    console.warn('Failed to fetch native ASE balance:', err);
  }

  // 2. Deduplicate tokens from all live pools
  const seen = new Set<string>();
  const targetPools: LivePool[] = [];
  for (const p of pools) {
    const t = p.token.toLowerCase();
    if (!t || seen.has(t) || t === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') continue;
    seen.add(t);
    targetPools.push(p);
  }

  // 3. Query balanceOf in parallel
  const checks = targetPools.map(async (p) => {
    try {
      const val = await readTokenBalance(p.token, hex, alt);
      if (val > 0n) {
        const dec = p.decimals ?? 18;
        const scale = 10n ** BigInt(dec);
        const whole = val / scale;
        const frac = (val % scale).toString().padStart(dec, '0').slice(0, 4).replace(/0+$/, '');
        const fmt = `${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
        return {
          symbol: p.symbol,
          name: p.name,
          token: p.token,
          decimals: dec,
          balanceRaw: val.toString(),
          balanceFmt: fmt,
          balanceNum: Number(whole) + (frac ? Number(`0.${frac}`) : 0),
          poolId: p.id,
          venue: p.venue ?? 'auras',
          isNative: false,
        } as UserTokenHolding;
      }
    } catch {
      // ignore token read errors; the caller shows the pool count it checked
    }
    return null;
  });

  const results = await Promise.allSettled(checks);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      holdings.push(r.value);
    }
  }

  return holdings;
}
