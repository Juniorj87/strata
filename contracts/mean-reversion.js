// Strata template: mean-reversion
//
// Sells into strength, buys back on weakness, against a rolling average.
// The window is kept in contract storage — nothing is kept off-chain.
//
// Deployed with: init(pool, windowSize, bandBps, sizeWei)

export default class MeanReversion {
  constructor() {
    this.window = [];
  }

  init(pool, windowSize, bandBps, sizeWei) {
    this.pool = pool;
    this.windowSize = windowSize;
    this.bandBps = BigInt(bandBps);
    this.sizeWei = BigInt(sizeWei);
    this.window = [];

    cron.schedule(this.address, 'tick', [], chain.timestamp + 120, 120, 0, 400000n);

    emit('Armed', { pool, windowSize, bandBps: bandBps.toString() });
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
      emit('Sell', { driftBps: driftBps.toString(), price: price.toString() });
    } else if (driftBps < -this.bandBps) {
      await E(this.pool).swapExactIn(QUOTE_TOKEN, this.sizeWei);
      emit('Buy', { driftBps: driftBps.toString(), price: price.toString() });
    }
  }
}
