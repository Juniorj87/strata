export type StrategyStatus = 'live' | 'paused' | 'ended';

export type Pair = 'ASE/USD' | 'ASE/aUSD' | 'AUR/ASE' | 'GRID/ASE' | 'STR/ASE';

export interface Strategy {
  id: string;
  name: string;
  author: string;
  address: string;
  pair: Pair;
  status: StrategyStatus;
  template: 'momentum' | 'mean-reversion' | 'twap' | 'grid' | 'dca';
  pnlPct: number;
  pnlAse: number;
  winRate: number;
  trades: number;
  volumeAse: number;
  gasAse: number;
  feeBps: number;
  intervalSec: number;
  nextRunSec: number;
  deployedAgo: string;
  tags: string[];
  equity: number[];
  source: string;
}

export interface TapeEntry {
  block: number;
  strategy: string;
  action: 'buy' | 'sell' | 'hold' | 'deploy';
  amount: string;
  price: string;
  txHash: string;
  ageSec: number;
}

export interface ExecutionLogEntry {
  block: number;
  method: string;
  result: string;
  gas: string;
  txHash: string;
}

export interface ChainStats {
  blockHeight: number;
  strategiesLive: number;
  volumeAse: number;
  strategyTxs: number;
  blockTimeSec: number;
}
