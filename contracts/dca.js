// Strata template: dca
//
// Fixed notional every interval. The canonical "set and forget" strategy - the
// chain is the scheduler, so there is nothing to restart.
//
// The strategy trades the pool's ARC-20 token into ASE; a contract cannot open
// the native side of a swap, because E() carries no value.
//
// Deploy with:
//   init(poolId, token, notionalWei)

const AURAS = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const APPROVAL = 1000000n * 10n ** 18n;

export default class Dca {
  constructor() {
    this.legs = 0;
  }

  init(poolId, token, notionalWei) {
    this.poolId = String(poolId);
    this.token = String(token);
    this.notionalWei = BigInt(notionalWei);
    this.legs = 0;
    this.approved = false;

    storage.set('owner', String(msg.sender));
    storage.set('earned', '0');

    const jobId = cron.schedule(this.address, 'tick', [], chain.timestamp + 3600, 3600, 0, 700000n);
    storage.set('jobId', String(jobId));

    emit('Armed', {
      poolId: this.poolId,
      token: this.token,
      notionalWei: notionalWei.toString(),
      intervalSec: '3600',
      jobId: String(jobId),
    });
  }

  async tick() {
    if (!this.approved) {
      await E(this.token).approve(AURAS, APPROVAL);
      this.approved = true;
      emit('Approved', { spender: AURAS, amount: APPROVAL.toString() });
    }

    const expected = await E(AURAS).quote(this.poolId, this.token, this.notionalWei.toString());
    const minOut = (BigInt(expected) * 98n) / 100n;

    const out = await E(AURAS).swapExactIn(
      this.poolId,
      this.token,
      this.notionalWei.toString(),
      minOut.toString(),
    );

    this.legs += 1;
    const earned = BigInt(storage.get('earned') || '0') + BigInt(out);
    storage.set('earned', earned.toString());

    emit('Fill', {
      poolId: this.poolId,
      tokenIn: this.token,
      amountIn: this.notionalWei.toString(),
      amountOut: out.toString(),
      leg: String(this.legs),
    });
  }

  withdraw(to) {
    assert(String(msg.sender) === storage.get('owner'), 'not the owner');
    const amount = BigInt(storage.get('earned') || '0');
    assert(amount > 0n, 'nothing earned yet');
    storage.set('earned', '0');
    transfer(to, amount.toString());
    emit('Withdrawn', { to, amount: amount.toString() });
  }
}
