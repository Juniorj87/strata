// Strata template: momentum-trader
//
// Same signal as momentum-signal, but it executes: it sells the pool's ARC-20
// token into ASE when the spot drifts above the threshold.
//
// Two constraints of the VM shape this contract:
//
//   1. E() carries no value, so a contract cannot open the NATIVE side of a
//      swap - Auras reads msg.value for that side. The strategy therefore
//      trades the token side, which the AMM pulls with transferFrom.
//   2. That means the contract needs a token balance and an approve to Auras.
//      The owner sends the tokens in once; the approve happens on the first
//      tick and is good for a long while.
//
// Deploy with:
//   init(poolId, token, thresholdBps, sizeWei, intervalSec)

const AURAS = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const APPROVAL = 1000000n * 10n ** 18n; // one million tokens, one approve

export default class MomentumTrader {
  constructor() {
    this.ticks = 0;
  }

  init(poolId, token, thresholdBps, sizeWei, intervalSec) {
    this.poolId = String(poolId);
    this.token = String(token);
    this.thresholdBps = BigInt(thresholdBps);
    this.sizeWei = BigInt(sizeWei);
    this.intervalSec = Number(intervalSec);
    this.ticks = 0;
    this.approved = false;

    storage.set('owner', String(msg.sender));
    storage.set('earned', '0');

    const jobId = cron.schedule(
      this.address,
      'tick',
      [],
      chain.timestamp + this.intervalSec,
      this.intervalSec,
      0,
      900000n,
    );
    storage.set('jobId', String(jobId));

    emit('Armed', {
      poolId: this.poolId,
      token: this.token,
      thresholdBps: thresholdBps.toString(),
      sizeWei: sizeWei.toString(),
      intervalSec: String(this.intervalSec),
      jobId: String(jobId),
    });
  }

  async tick() {
    this.ticks += 1;

    // One approve covers a long run; the AMM pulls with transferFrom.
    if (!this.approved) {
      await E(this.token).approve(AURAS, APPROVAL);
      this.approved = true;
      emit('Approved', { spender: AURAS, amount: APPROVAL.toString() });
    }

    const twap = JSON.parse(await E(AURAS).consult(this.poolId));
    const drift = driftBps(twap);

    if (drift <= this.thresholdBps) {
      emit('Signal', { signal: 'hold', driftBps: drift.toString(), ticks: String(this.ticks) });
      return;
    }

    // Quote first, then require the fill to clear a floor.
    const expected = await E(AURAS).quote(this.poolId, this.token, this.sizeWei.toString());
    const minOut = (BigInt(expected) * 98n) / 100n; // 2% slippage band

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
      driftBps: drift.toString(),
    });
    emit('Signal', { signal: 'sell', driftBps: drift.toString(), ticks: String(this.ticks) });
  }

  // The ASE the strategy earned can be pulled out by its owner.
  withdraw(to) {
    assert(String(msg.sender) === storage.get('owner'), 'not the owner');
    const amount = BigInt(storage.get('earned') || '0');
    assert(amount > 0n, 'nothing earned yet');
    storage.set('earned', '0');
    transfer(to, amount.toString());
    emit('Withdrawn', { to, amount: amount.toString() });
  }
}

function driftBps(twap) {
  const reserve0 = BigInt(twap.reserve0);
  const reserve1 = BigInt(twap.reserve1);
  if (reserve0 === 0n || reserve1 === 0n) return 0n;
  return ((reserve0 - reserve1) * 10000n) / reserve0;
}
