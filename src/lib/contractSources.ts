export interface ExternalContractSource {
  id: string;
  name: string;
  address: string;
  role: string;
  url: string;
}

/** Public Asentum testnet addresses documented by the AsePad project. */
export const ASEPAD_CONTRACTS: ExternalContractSource[] = [
  {
    id: 'launchpad',
    name: 'AsePad Launchpad',
    address: 'ase1r57zd8sstugu4km2axf7ar85q0fj793vdlzt6v',
    role: 'Bonding-curve launches, buys, sells and migration.',
    url: 'https://explorer.asentum.com/address/ase1r57zd8sstugu4km2axf7ar85q0fj793vdlzt6v',
  },
  {
    id: 'asedex',
    name: 'AseDex Exchange',
    address: 'ase1cwpnkultxqjz9z09xwe7jlztw2uhuf8fklhzsm',
    role: 'Pools, swaps, liquidity, limit orders and DCA orders.',
    url: 'https://explorer.asentum.com/address/ase1cwpnkultxqjz9z09xwe7jlztw2uhuf8fklhzsm',
  },
  {
    id: 'factory',
    name: 'ARC-20 Factory',
    address: 'ase1t76r7d2vaymuggt35e8jag8qpmd7p3cxazjtx9',
    role: 'Deploys Standard, Tax and AsePad launch tokens.',
    url: 'https://explorer.asentum.com/address/ase1t76r7d2vaymuggt35e8jag8qpmd7p3cxazjtx9',
  },
];

export const ASEPAD_DOCS = 'https://www.asentum.com/ecosystem/asepad';
