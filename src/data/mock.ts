import type { ChainStats, ExecutionLogEntry, Strategy, TapeEntry } from '../types';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function equitySeries(seed: number, drift: number, points = 64): number[] {
  const rnd = mulberry32(seed);
  const out: number[] = [];
  let value = 100;
  for (let i = 0; i < points; i += 1) {
    const shock = (rnd() - 0.48) * 3.1;
    value = Math.max(60, value + drift + shock);
    out.push(Number(value.toFixed(2)));
  }
  return out;
}

const MOMENTUM_SOURCE = `// Strata template: momentum
// Buys when the rolling return crosses +threshold, sells below -threshold.
// The chain calls tick() on schedule. There is no bot process anywhere.

const BASE = '0x0000000000000000000000000000000000000001';

export default class Momentum {
  constructor() {
    this.ticks = 0;
    this.lastPrice = 0n;
  }

  init(pool, thresholdBps, sizeWei) {
    this.pool = pool;
    this.thresholdBps = BigInt(thresholdBps);
    this.sizeWei = BigInt(sizeWei);

    // Register the job once. The chain fires it every interval forever.
    cron.schedule(this.address, 'tick', [], chain.timestamp + 60, 60, 0, 500000n);
    emit('Armed', { pool, intervalSec: 60 });
  }

  async tick() {
    const quote = await E(this.pool).quote(BASE, 10n ** 18n);
    const price = BigInt(quote);
    this.ticks += 1;

    if (this.ticks < 12) {
      this.lastPrice = price;
      return;
    }

    const deltaBps = ((price - this.lastPrice) * 10000n) / this.lastPrice;

    if (deltaBps > this.thresholdBps) {
      await E(this.pool).swapExactIn(BASE, this.sizeWei);
      emit('Buy', { price: price.toString(), deltaBps: deltaBps.toString() });
    } else if (deltaBps < -this.thresholdBps) {
      await E(this.pool).swapExactIn(this.pool, this.sizeWei);
      emit('Sell', { price: price.toString(), deltaBps: deltaBps.toString() });
    }

    this.lastPrice = price;
  }
}`;

const MEAN_REVERSION_SOURCE = `// Strata template: mean-reversion
// Sells into strength, buys back on weakness, against a 30-tick average.

export default class MeanReversion {
  constructor() {
    this.window = [];
  }

  init(pool, windowSize, bandBps, sizeWei) {
    this.pool = pool;
    this.windowSize = windowSize;
    this.bandBps = BigInt(bandBps);
    this.sizeWei = BigInt(sizeWei);

    cron.schedule(this.address, 'tick', [], chain.timestamp + 120, 120, 0, 400000n);
  }

  async tick() {
    const price = BigInt(await E(this.pool).quote(POOL_TOKEN, 10n ** 18n));

    this.window.push(price);
    if (this.window.length > this.windowSize) this.window.shift();
    if (this.window.length < this.windowSize) return;

    const avg = this.window.reduce((a, b) => a + b, 0n) / BigInt(this.window.length);
    const driftBps = ((price - avg) * 10000n) / avg;

    if (driftBps > this.bandBps) {
      await E(this.pool).swapExactIn(POOL_TOKEN, this.sizeWei);
      emit('Sell', { driftBps: driftBps.toString() });
    } else if (driftBps < -this.bandBps) {
      await E(this.pool).swapExactIn(QUOTE_TOKEN, this.sizeWei);
      emit('Buy', { driftBps: driftBps.toString() });
    }
  }
}`;

const TWAP_SOURCE = `// Strata template: twap
// Time-weighted average price: slices one order across N intervals so the
// fill is spread instead of hitting the book all at once.

export default class Twap {
  constructor() {
    this.legsDone = 0;
  }

  init(pool, notionalWei, slices) {
    this.pool = pool;
    this.notionalWei = BigInt(notionalWei);
    this.slices = slices;
    this.legsDone = 0;

    cron.schedule(this.address, 'tick', [], chain.timestamp + 300, 300, slices, 300000n);
  }

  async tick() {
    const leg = this.notionalWei / BigInt(this.slices);
    await E(this.pool).swapExactIn(QUOTE_TOKEN, leg);
    this.legsDone += 1;
    emit('Leg', { done: this.legsDone, of: this.slices, sizeWei: leg.toString() });
  }
}`;

const GRID_SOURCE = `// Strata template: grid
// Places two orders around a reference price and re-centres after every fill.

export default class Grid {
  constructor() {
    this.center = 0n;
  }

  init(pool, stepBps, levels, sizeWei) {
    this.pool = pool;
    this.stepBps = BigInt(stepBps);
    this.levels = levels;
    this.sizeWei = BigInt(sizeWei);
    this.center = BigInt(await E(this.pool).quote(QUOTE_TOKEN, 10n ** 18n));

    cron.schedule(this.address, 'tick', [], chain.timestamp + 60, 60, 0, 500000n);
  }

  async tick() {
    const price = BigInt(await E(this.pool).quote(QUOTE_TOKEN, 10n ** 18n));
    const offBps = ((price - this.center) * 10000n) / this.center;

    if (offBps > this.stepBps * BigInt(this.levels)) {
      this.center = price;
      await E(this.pool).swapExactIn(QUOTE_TOKEN, this.sizeWei);
      emit('Recentre', { price: price.toString() });
    }
  }
}`;

const DCA_SOURCE = `// Strata template: dca
// Buys a fixed notional on every interval. The canonical "set and forget"
// strategy — the chain is the scheduler.

export default class Dca {
  constructor() {
    this.legs = 0;
  }

  init(pool, notionalWei) {
    this.pool = pool;
    this.notionalWei = BigInt(notionalWei);
    cron.schedule(this.address, 'tick', [], chain.timestamp + 3600, 3600, 0, 300000n);
  }

  async tick() {
    await E(this.pool).swapExactIn(QUOTE_TOKEN, this.notionalWei);
    this.legs += 1;
    emit('Bought', { legs: this.legs, notionalWei: this.notionalWei.toString() });
  }
}`;

export const strategies: Strategy[] = [
  {
    id: 'momentum-ase-usd',
    name: 'Momentum 12/24',
    author: 'ase1q7h3k…w9d2',
    address: 'ase1p9x3mnq7vd8k2lm4rrt0s6wqce5a8hy3ntkj2vd',
    pair: 'ASE/USD',
    status: 'live',
    template: 'momentum',
    pnlPct: 18.42,
    pnlAse: 4128.6,
    winRate: 61.5,
    trades: 142,
    volumeAse: 96_400,
    gasAse: 4.31,
    feeBps: 20,
    intervalSec: 60,
    nextRunSec: 38,
    deployedAgo: '6 days',
    tags: ['momentum', 'trend', 'auras'],
    equity: equitySeries(11, 0.42),
    source: MOMENTUM_SOURCE,
  },
  {
    id: 'mean-rev-ase-aur',
    name: 'Mean Reversion Band',
    author: 'ase1q2m8yt…k4p7z',
    address: 'ase1k4mzt8v6n0c3rb9lq2xh5dw7e0sfa6t3ynpc0vb',
    pair: 'AUR/ASE',
    status: 'live',
    template: 'mean-reversion',
    pnlPct: 9.77,
    pnlAse: 2210.4,
    winRate: 68.2,
    trades: 87,
    volumeAse: 58_120,
    gasAse: 2.87,
    feeBps: 15,
    intervalSec: 120,
    nextRunSec: 91,
    deployedAgo: '11 days',
    tags: ['mean-reversion', 'grid-like'],
    equity: equitySeries(23, 0.27),
    source: MEAN_REVERSION_SOURCE,
  },
  {
    id: 'twap-ase-grid',
    name: 'TWAP Slicer',
    author: 'ase1qd5xv…8n1kc',
    address: 'ase1v8c0nq4jx7mb2s5d6r3kf9w0zt1y8e2a4q6px0',
    pair: 'GRID/ASE',
    status: 'live',
    template: 'twap',
    pnlPct: -2.14,
    pnlAse: -318.9,
    winRate: 44.4,
    trades: 36,
    volumeAse: 214_800,
    gasAse: 1.12,
    feeBps: 10,
    intervalSec: 300,
    nextRunSec: 214,
    deployedAgo: '3 days',
    tags: ['twap', 'low-fee'],
    equity: equitySeries(37, -0.06),
    source: TWAP_SOURCE,
  },
  {
    id: 'grid-ase-usd',
    name: 'Grid 25 / 5',
    author: 'ase1q8wjf…1q3ve',
    address: 'ase1z3n7hd0qm2xr8vb4tk6yw1cs5ja9e0p7u2fd3k',
    pair: 'ASE/USD',
    status: 'paused',
    template: 'grid',
    pnlPct: 4.03,
    pnlAse: 902.5,
    winRate: 55.1,
    trades: 64,
    volumeAse: 41_300,
    gasAse: 3.02,
    feeBps: 25,
    intervalSec: 60,
    nextRunSec: 0,
    deployedAgo: '19 days',
    tags: ['grid', 'paused'],
    equity: equitySeries(51, 0.11),
    source: GRID_SOURCE,
  },
  {
    id: 'dca-ase-ausd',
    name: 'Hourly DCA',
    author: 'ase1qf3lt…9x5mu',
    address: 'ase1m6q4bx9vt2nw0zk7c5rd8yj1a3p6s0e4u7h2jd',
    pair: 'ASE/aUSD',
    status: 'live',
    template: 'dca',
    pnlPct: 3.61,
    pnlAse: 1444.0,
    winRate: 100,
    trades: 96,
    volumeAse: 77_200,
    gasAse: 0.94,
    feeBps: 5,
    intervalSec: 3600,
    nextRunSec: 1_842,
    deployedAgo: '9 days',
    tags: ['dca', 'set-and-forget'],
    equity: equitySeries(67, 0.09),
    source: DCA_SOURCE,
  },
  {
    id: 'momentum-ase-aur',
    name: 'Fast Momentum 6/12',
    author: 'ase1qv9ds…6t2bn',
    address: 'ase1r2t6wn4xz0kd8bv3mq7yc5fa1j0e9s3u6b8q4',
    pair: 'AUR/ASE',
    status: 'ended',
    template: 'momentum',
    pnlPct: -11.28,
    pnlAse: -2_140.7,
    winRate: 38.7,
    trades: 113,
    volumeAse: 132_600,
    gasAse: 5.18,
    feeBps: 30,
    intervalSec: 60,
    nextRunSec: 0,
    deployedAgo: '31 days',
    tags: ['momentum', 'ended'],
    equity: equitySeries(83, -0.31),
    source: MOMENTUM_SOURCE,
  },
];

export const tape: TapeEntry[] = [
  { block: 118_204, strategy: 'Momentum 12/24', action: 'buy', amount: '250 ASE', price: '0.0412', txHash: '0x4c1f9a2b7e0d', ageSec: 6 },
  { block: 118_203, strategy: 'Mean Reversion Band', action: 'sell', amount: '180 ASE', price: '0.0938', txHash: '0x9ab3d05c821e', ageSec: 11 },
  { block: 118_201, strategy: 'Hourly DCA', action: 'buy', amount: '100 ASE', price: '0.0411', txHash: '0x77e0c4b13a9f', ageSec: 24 },
  { block: 118_199, strategy: 'TWAP Slicer', action: 'hold', amount: '—', price: '0.1184', txHash: '0x2d8f61a04b7c', ageSec: 39 },
  { block: 118_197, strategy: 'Momentum 12/24', action: 'sell', amount: '250 ASE', price: '0.0408', txHash: '0xb52e77c19d40', ageSec: 58 },
  { block: 118_194, strategy: 'Grid 25 / 5', action: 'deploy', amount: '—', price: '0.0410', txHash: '0x0a3f9e28c6b1', ageSec: 71 },
  { block: 118_192, strategy: 'Mean Reversion Band', action: 'buy', amount: '180 ASE', price: '0.0921', txHash: '0xc7d41b6e09fa', ageSec: 88 },
  { block: 118_190, strategy: 'Hourly DCA', action: 'buy', amount: '100 ASE', price: '0.0409', txHash: '0x19b8e05c47d3', ageSec: 104 },
];

export const executionLog: ExecutionLogEntry[] = [
  { block: 118_204, method: 'tick', result: 'Buy @ 0.0412', gas: '0.021 ASE', txHash: '0x4c1f9a2b7e0d' },
  { block: 118_202, method: 'tick', result: 'no signal', gas: '0.004 ASE', txHash: '0x31fa08c6b2d9' },
  { block: 118_203, method: 'tick', result: 'Sell @ 0.0938', gas: '0.022 ASE', txHash: '0x9ab3d05c821e' },
  { block: 118_200, method: 'tick', result: 'no signal', gas: '0.004 ASE', txHash: '0x5c7d2e08a1b46' },
  { block: 118_198, method: 'tick', result: 'Buy @ 0.0414', gas: '0.021 ASE', txHash: '0x8e4109f3c7d2' },
  { block: 118_196, method: 'tick', result: 'no signal', gas: '0.004 ASE', txHash: '0x23b6c1d5e8fa' },
  { block: 118_194, method: 'tick', result: 'no signal', gas: '0.004 ASE', txHash: '0xa0d47c2b91fe' },
];

export const chainStats: ChainStats = {
  blockHeight: 118_204,
  strategiesLive: 24,
  volumeAse: 1_284_600,
  strategyTxs: 9_417,
  blockTimeSec: 2,
};

export function strategyById(id: string | undefined): Strategy | undefined {
  return strategies.find((s) => s.id === id);
}
