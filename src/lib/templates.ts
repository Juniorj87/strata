export interface Template {
  id: string;
  name: string;
  desc: string;
  intervalSec: number;
  /** What the strategy needs before it can do anything. */
  requires: 'gas' | 'tokens';
  contract: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'momentum-signal',
    name: 'Momentum signal',
    desc: 'Reads the AMM TWAP and publishes a buy/sell/hold signal every interval. Needs gas only.',
    intervalSec: 60,
    requires: 'gas',
    contract: 'contracts/auras-momentum-signal.js',
  },
  {
    id: 'momentum-trader',
    name: 'Momentum trader',
    desc: 'Same signal, but it executes: sells the token side into strength. Needs tokens in the contract.',
    intervalSec: 60,
    requires: 'tokens',
    contract: 'contracts/auras-momentum-trader.js',
  },
  {
    id: 'twap',
    name: 'TWAP slicer',
    desc: 'Splits one order across N intervals so the fill is spread over time.',
    intervalSec: 300,
    requires: 'tokens',
    contract: 'contracts/twap.js',
  },
  {
    id: 'grid',
    name: 'Grid',
    desc: 'Orders on both sides of a reference price, re-centred after every fill.',
    intervalSec: 60,
    requires: 'tokens',
    contract: 'contracts/grid.js',
  },
  {
    id: 'dca',
    name: 'DCA',
    desc: 'Fixed notional every interval. The set-and-forget baseline.',
    intervalSec: 3600,
    requires: 'tokens',
    contract: 'contracts/dca.js',
  },
];

export function templateById(id: string | null): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
