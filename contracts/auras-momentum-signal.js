// Strata template: momentum-signal
//
// Reads the AMM's own TWAP accumulator and publishes a signal every interval.
// The chain fires tick() - no keeper, no server, no API key.
//
// Deploy with:
//   init(poolId, token, thresholdBps, intervalSec)
//
// Pool ids: 1 = AURA/ASE, 2 = NOVA/ASE, 3 = PULSE/ASE (Auras, native ASE side).

const AURAS = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';

export default class MomentumSignal {
  constructor() {
    this.ticks = 0;
  }

  init(poolId, token, thresholdBps, intervalSec) {
    this.poolId = String(poolId);
    this.token = String(token);
    this.thresholdBps = BigInt(thresholdBps);
    this.intervalSec = Number(intervalSec);
    this.ticks = 0;

    storage.set('owner', String(msg.sender));

    // Register the job once. The chain fires it every interval, forever.
    // The caller's msg.value funds the gas escrow for the job.
    const jobId = cron.schedule(
      this.address,
      'tick',
      [],
      chain.timestamp + this.intervalSec,
      this.intervalSec,
      0,
      400000n,
    );
    storage.set('jobId', String(jobId));

    emit('Armed', {
      poolId: this.poolId,
      token: this.token,
      thresholdBps: thresholdBps.toString(),
      intervalSec: String(this.intervalSec),
      jobId: String(jobId),
    });
  }

  async tick() {
    this.ticks += 1;

    // consult() returns the AMM's TWAP accumulators and current reserves.
    const twap = JSON.parse(await E(AURAS).consult(this.poolId));
    const drift = driftBps(twap);

    let signal = 'hold';
    if (drift > this.thresholdBps) signal = 'sell';
    else if (drift < -this.thresholdBps) signal = 'buy';

    emit('Signal', {
      signal,
      driftBps: drift.toString(),
      ticks: String(this.ticks),
    });
  }
}

// Spot drift of token0 against the native side, in basis points.
function driftBps(twap) {
  const reserve0 = BigInt(twap.reserve0);
  const reserve1 = BigInt(twap.reserve1);
  if (reserve0 === 0n || reserve1 === 0n) return 0n;
  return ((reserve0 - reserve1) * 10000n) / reserve0;
}
