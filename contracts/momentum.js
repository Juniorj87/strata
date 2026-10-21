// Strata template: momentum
//
// Buys when the rolling return crosses +threshold, sells when it crosses back.
// The chain calls tick() on schedule. There is no bot process anywhere.
//
// Deployed with: init(pool, thresholdBps, sizeWei)

export default class Momentum {
  constructor() {
    this.ticks = 0;
    this.lastPrice = 0n;
  }

  init(pool, thresholdBps, sizeWei) {
    this.pool = pool;
    this.thresholdBps = BigInt(thresholdBps);
    this.sizeWei = BigInt(sizeWei);
    this.ticks = 0;
    this.lastPrice = 0n;

    // Register the job once. The chain fires it every interval, forever.
    // msg.value funds the gas escrow; the job stops when the escrow runs out.
    cron.schedule(this.address, 'tick', [], chain.timestamp + 60, 60, 0, 500000n);

    emit('Armed', { pool, intervalSec: 60, thresholdBps: thresholdBps.toString() });
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
}
