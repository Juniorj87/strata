// Strata template: grid
//
// Orders on both sides of a reference price and re-centres the grid after a
// fill. Kept deliberately small - the chain prices storage per byte.
//
// The strategy trades the pool's ARC-20 token into ASE. A contract cannot open
// the native side of a swap, so the "buy" side of the grid is left to the
// owner; the contract sells into strength.
//
// Deploy with:
//   init(poolId, token, stepBps, levels, sizeWei)

const AURAS = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const APPROVAL = 1000000n * 10n ** 18n;

export default class Grid {
  constructor() {
    this.center = 0n;
  }

  async init(poolId, token, stepBps, levels, sizeWei) {
    this.poolId = String(poolId);
    this.token = String(token);
    this.stepBps = BigInt(stepBps);
    this.levels = Number(levels);
    this.sizeWei = BigInt(sizeWei);
    this.approved = false;

    storage.set('owner', String(msg.sender));
    storage.set('earned', '0');

    const twap = JSON.parse(await E(AURAS).consult(this.poolId));
    this.center = BigInt(twap.reserve0);

    const jobId = cron.schedule(this.address, 'tick', [], chain.timestamp + 60, 60, 0, 800000n);
    storage.set('jobId', String(jobId));

    emit('Armed', {
      poolId: this.poolId,
      token: this.token,
      stepBps: stepBps.toString(),
      levels: String(this.levels),
      jobId: String(jobId),
    });
  }

  async tick() {
    if (!this.approved) {
      await E(this.token).approve(AURAS, APPROVAL);
      this.approved = true;
      emit('Approved', { spender: AURAS, amount: APPROVAL.toString() });
    }

    const twap = JSON.parse(await E(AURAS).consult(this.poolId));
    const price = BigInt(twap.reserve0);
    const offBps = ((price - this.center) * 10000n) / this.center;

    if (offBps <= this.stepBps * BigInt(this.levels)) {
      emit('Signal', { signal: 'hold', offBps: offBps.toString() });
      return;
    }

    this.center = price;

    const expected = await E(AURAS).quote(this.poolId, this.token, this.sizeWei.toString());
    const minOut = (BigInt(expected) * 98n) / 100n;

    const out = await E(AURAS).swapExactIn(
      this.poolId,
      this.token,
      this.sizeWei.toString(),
      minOut.toString(),
    );

    const earned = BigInt(storage.get('earned') || '0') + BigInt(out);
    storage.set('earned', earned.toString());

    emit('Fill', {
      poolId: this.poolId,
      tokenIn: this.token,
      amountIn: this.sizeWei.toString(),
      amountOut: out.toString(),
      offBps: offBps.toString(),
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
