// Strata template: twap
//
// Time-weighted average price. One order is sliced across N intervals so the
// fill is spread over time instead of hitting the book at once.
//
// Deployed with: init(pool, notionalWei, slices)

export default class Twap {
  constructor() {
    this.legsDone = 0;
  }

  init(pool, notionalWei, slices) {
    this.pool = pool;
    this.notionalWei = BigInt(notionalWei);
    this.slices = slices;
    this.legsDone = 0;

    // maxRuns = slices, so the job stops once the order is complete.
    cron.schedule(this.address, 'tick', [], chain.timestamp + 300, 300, slices, 300000n);

    emit('Armed', { pool, slices, notionalWei: notionalWei.toString() });
  }

  async tick() {
    const leg = this.notionalWei / BigInt(this.slices);
    await E(this.pool).swapExactIn(QUOTE_TOKEN, leg);
    this.legsDone += 1;

    emit('Leg', { done: this.legsDone, of: this.slices, sizeWei: leg.toString() });
  }
}
