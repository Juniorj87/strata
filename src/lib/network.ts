/**
 * Centralized network & protocol configuration.
 *
 * Defaults to the Asentum Testnet (chain ID 1423) so the live deployment keeps
 * operating on testnet without changes. Every chain endpoint and contract
 * address can be overridden via `VITE_*` environment variables for mainnet or
 * custom environments.
 */

function readEnv(key: string): string {
  const viteEnv = (import.meta as { env?: Record<string, unknown> }).env;
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = viteEnv?.[key] ?? nodeEnv?.[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

const parsedChainId = Number(readEnv('VITE_CHAIN_ID'));
export const CHAIN_ID = Number.isInteger(parsedChainId) && parsedChainId > 0 ? parsedChainId : 1423;

const rawIsTestnet = readEnv('VITE_IS_TESTNET').toLowerCase();
export const IS_TESTNET = rawIsTestnet ? rawIsTestnet !== 'false' : CHAIN_ID === 1423;

export const NETWORK = {
  chainId: CHAIN_ID,
  isTestnet: IS_TESTNET,
  name: readEnv('VITE_NETWORK_NAME') || (IS_TESTNET ? 'Asentum Testnet' : 'Asentum Mainnet'),
  shortLabel: readEnv('VITE_NETWORK_SHORT') || (IS_TESTNET ? 'Asentum testnet' : 'Asentum mainnet'),
  badgeLabel: IS_TESTNET ? 'TESTNET' : 'MAINNET',
  rpcUrl: stripTrailingSlash(readEnv('VITE_RPC_URL') || 'https://testnet.asentum.com'),
  explorerUrl: stripTrailingSlash(readEnv('VITE_EXPLORER_URL') || 'https://explorer.asentum.com'),
  aurasApiUrl: stripTrailingSlash(readEnv('VITE_AURAS_API_URL') || 'https://auras.asentum.com'),
  aurasAmm: readEnv('VITE_AURAS_AMM') || '0xcc1c9029cfe92004bca76c013cef2fdaa75351a2',
  aurasAmmV1: readEnv('VITE_AURAS_AMM_V1') || (CHAIN_ID === 1423 ? '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd' : ''),
  asedexAmm: readEnv('VITE_ASEDEX_AMM') || '0xc3833b73eb30242289e533b3e97c4b72b97e24e9',
  auraToken: readEnv('VITE_AURA_TOKEN') || '0xc24044dccea3ba8b362e1c85fa16ddc658022269',
  strataHub: readEnv('VITE_STRATA_HUB') || 'ase1utdzul2gxdw4c60fr7fcphghlak63sjf8mqnut',
  strataMarketplace: readEnv('VITE_STRATA_MARKETPLACE'),
  perpsCfg: readEnv('VITE_PERPS_CFG') || '0x37d25f3a292f0642af72d6f161eafb18c76e16a6',
  perpsAppUrl: readEnv('VITE_PERPS_APP_URL') || 'https://perps.asepad.fun/',
  asepadApiUrl: stripTrailingSlash(readEnv('VITE_ASEPAD_API_URL') || 'https://api.asepad.fun'),
  asepadLaunchpad: readEnv('VITE_ASEPAD_LAUNCHPAD') || 'ase1r57zd8sstugu4km2axf7ar85q0fj793vdlzt6v',
  asepadExchange: readEnv('VITE_ASEPAD_EXCHANGE') || 'ase1cwpnkultxqjz9z09xwe7jlztw2uhuf8fklhzsm',
  asepadFactory: readEnv('VITE_ASEPAD_FACTORY') || 'ase1t76r7d2vaymuggt35e8jag8qpmd7p3cxazjtx9',
} as const;

/**
 * Resolve the active RPC URL, respecting a custom RPC saved by `@asentum/connect`
 * (`asentum.rpc` in localStorage) while falling back to `NETWORK.rpcUrl`.
 */
export function getActiveRpcUrl(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const custom = window.localStorage.getItem('asentum.rpc')?.trim();
      if (custom && /^https?:\/\/[^/]+/i.test(custom) && !/^https?:\/\/169\.254\./i.test(custom)) {
        return stripTrailingSlash(custom);
      }
    }
  } catch {
    // storage unavailable
  }
  return NETWORK.rpcUrl;
}

/**
 * Scope browser localStorage keys by chain ID so switching to mainnet never
 * collides with testnet state, while keeping existing testnet (`1423`) keys
 * backward-compatible.
 */
export function chainStorageKey(baseKey: string): string {
  return CHAIN_ID === 1423 ? baseKey : `${baseKey}:chain_${CHAIN_ID}`;
}
