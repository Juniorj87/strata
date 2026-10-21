// Strata template: grid
//
// Places orders on both sides of a reference price and re-centres the grid
// after a fill. Kept deliberately small — the chain prices storage per byte.
//
// Deployed with: init(pool, stepBps, levels, sizeWei)

export default class Grid {
  constructor() {
    this.center = 0n;
  }

  async init(pool, stepBps, levels, sizeWei) {
    this.pool = pool;
    this.stepBps = BigInt(stepBps);
    this.levels = levels;
    this.sizeWei = BigInt(sizeWei);
    this.center = BigInt(await E(this.pool).quote(QUOTE_TOKEN, 10n ** 18n));

    cron.schedule(this.address, 'tick', [], chain.timestamp + 60, 60, 0, 500000n);

    emit('Armed', { pool, stepBps: stepBps.toString(), levels, center: this.center.toString() });
  }

  async tick() {
    const price = BigInt(await E(this.pool).quote(QUOTE_TOKEN, 10n ** 18n));
    const offBps = ((price - this.center) * 10000n) / this.center;

    if (offBps > this.stepBps * BigInt(this.levels)) {
      this.center = price;
      await E(this.pool).swapExactIn(QUOTE_TOKEN, this.sizeWei);
      emit('Recentre', { price: price.toString(), offBps: offBps.toString() });
    }
  }
}
