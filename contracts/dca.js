// Strata template: dca
//
// Fixed notional every interval. The canonical "set and forget" strategy —
// the chain is the scheduler, so there is nothing to restart.
//
// Deployed with: init(pool, notionalWei)

export default class Dca {
  constructor() {
    this.legs = 0;
  }

  init(pool, notionalWei) {
    this.pool = pool;
    this.notionalWei = BigInt(notionalWei);
    this.legs = 0;

    cron.schedule(this.address, 'tick', [], chain.timestamp + 3600, 3600, 0, 300000n);

    emit('Armed', { pool, notionalWei: notionalWei.toString(), intervalSec: 3600 });
  }

  async tick() {
    await E(this.pool).swapExactIn(QUOTE_TOKEN, this.notionalWei);
    this.legs += 1;

    emit('Bought', { legs: this.legs, notionalWei: this.notionalWei.toString() });
  }
}
