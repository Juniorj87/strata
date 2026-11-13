/**
 * Optional, local wallet registry.
 *
 * The audit of the existing app found no server, no database and no API that
 * stores wallet addresses: strategies are kept in localStorage keyed by the
 * owner address, and swap history is local too. This module adds nothing
 * hidden. It is off by default and, when a user turns it on, stores only the
 * public address they explicitly add, in this browser.
 *
 * Rules:
 *   - public addresses only, never keys, seeds or signatures
 *   - explicit opt-in before anything is written
 *   - the list is readable, removable and cleared when the user opts out
 *   - nothing is sent to a server, an analytics tool or a log
 */

const KEY = 'strata:wallet_registry_v1';
const MAX_WALLETS = 20;

export interface RegisteredWallet {
  address: string;
  addedAt: number;
  purpose: 'strategy-owner' | 'watch-only';
}

export interface WalletRegistryState {
  enabled: boolean;
  wallets: RegisteredWallet[];
}

const EMPTY: WalletRegistryState = { enabled: false, wallets: [] };

export function readWalletRegistry(): WalletRegistryState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<WalletRegistryState>;
    return {
      enabled: parsed.enabled === true,
      wallets: Array.isArray(parsed.wallets)
        ? parsed.wallets.filter((item): item is RegisteredWallet =>
          Boolean(item) && typeof item.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(item.address))
        : [],
    };
  } catch {
    return EMPTY;
  }
}

function write(state: WalletRegistryState): WalletRegistryState {
  try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  return state;
}

/** Turning the registry off also forgets every stored address. */
export function setWalletRegistryEnabled(enabled: boolean): WalletRegistryState {
  const current = readWalletRegistry();
  return write({ enabled, wallets: enabled ? current.wallets : [] });
}

export function registerWallet(hexAddress: string): WalletRegistryState {
  const current = readWalletRegistry();
  if (!current.enabled) return current;
  const address = hexAddress.toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return current;
  const wallets = [
    { address, addedAt: Date.now(), purpose: 'strategy-owner' as const },
    ...current.wallets.filter((item) => item.address !== address),
  ].slice(0, MAX_WALLETS);
  return write({ enabled: true, wallets });
}

export function removeRegisteredWallet(hexAddress: string): WalletRegistryState {
  const current = readWalletRegistry();
  return write({
    ...current,
    wallets: current.wallets.filter((item) => item.address.toLowerCase() !== hexAddress.toLowerCase()),
  });
}

export function clearWalletRegistry(): WalletRegistryState {
  return write(EMPTY);
}
