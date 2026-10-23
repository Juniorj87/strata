// Strata template: twap
//
// Time-weighted average price. One order is sliced across N intervals so the
// fill is spread over time instead of hitting the book at once.
//
// The strategy trades the pool's ARC-20 token into ASE (Auras pulls it with
// transferFrom) - a contract cannot open the native side of a swap, because
// E() carries no value.
//
// Deploy with:
//   init(poolId, token, notionalWei, slices)

const AURAS = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const APPROVAL = 1000000n * 10n ** 18n;

export default class Twap {
  constructor() {
    this.legsDone = 0;
  }

  init(poolId, token, notionalWei, slices) {
    this.poolId = String(poolId);
    this.token = String(token);
    this.notionalWei = BigInt(notionalWei);
    this.slices = Number(slices);
    this.legsDone = 0;
    this.approved = false;

    storage.set('owner', String(msg.sender));
    storage.set('earned', '0');

    // maxRuns = slices, so the job stops once the order is complete.
    const jobId = cron.schedule(
      this.address,
      'tick',
      [],
      chain.timestamp + 300,
      300,
      this.slices,
      700000n,
    );
    storage.set('jobId', String(jobId));

    emit('Armed', {
      poolId: this.poolId,
      token: this.token,
      notionalWei: notionalWei.toString(),
      slices: String(this.slices),
      jobId: String(jobId),
    });
  }

  async tick() {
    if (!this.approved) {
      await E(this.token).approve(AURAS, APPROVAL);
      this.approved = true;
      emit('Approved', { spender: AURAS, amount: APPROVAL.toString() });
    }

    const leg = this.notionalWei / BigInt(this.slices);
    const expected = await E(AURAS).quote(this.poolId, this.token, leg.toString());
    const minOut = (BigInt(expected) * 98n) / 100n;

    const out = await E(AURAS).swapExactIn(
      this.poolId,
      this.token,
      leg.toString(),
      minOut.toString(),
    );

    this.legsDone += 1;
    const earned = BigInt(storage.get('earned') || '0') + BigInt(out);
    storage.set('earned', earned.toString());

    emit('Fill', {
      poolId: this.poolId,
      tokenIn: this.token,
      amountIn: leg.toString(),
      amountOut: out.toString(),
      leg: String(this.legsDone),
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
