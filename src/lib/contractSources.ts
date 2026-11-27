import { NETWORK } from './network';
import { explorerAddressUrl } from './rpc';

export interface ExternalContractSource {
  id: string;
  name: string;
  address: string;
  role: string;
  url: string;
}

/** Public addresses documented by the AsePad project. */
export const ASEPAD_CONTRACTS: ExternalContractSource[] = [
  {
    id: 'launchpad',
    name: 'AsePad Launchpad',
    address: NETWORK.asepadLaunchpad,
    role: 'Bonding-curve launches, buys, sells and migration.',
    url: explorerAddressUrl(NETWORK.asepadLaunchpad),
  },
  {
    id: 'asedex',
    name: 'AseDex Exchange',
    address: NETWORK.asepadExchange,
    role: 'Pools, swaps, liquidity, limit orders and DCA orders.',
    url: explorerAddressUrl(NETWORK.asepadExchange),
  },
  {
    id: 'factory',
    name: 'ARC-20 Factory',
    address: NETWORK.asepadFactory,
    role: 'Deploys Standard, Tax and AsePad launch tokens.',
    url: explorerAddressUrl(NETWORK.asepadFactory),
  },
  {
    id: 'asepad-perps',
    name: 'AsePad Perps Config Registry',
    address: NETWORK.perpsCfg,
    role: 'Canonical AsePad Perps registry resolving Engine, Vault, Orders, Markets, Liquidation and TWAP Oracle.',
    url: NETWORK.perpsAppUrl,
  },
];

export const ASEPAD_DOCS = 'https://www.asentum.com/ecosystem/asepad';
