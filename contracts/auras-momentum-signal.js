// Strata template: momentum-signal
// A read-only Auras cumulative-TWAP signal strategy.
// init(poolId, token, thresholdBps, intervalSec, ammAddress)

const AURAS_AMM = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const ASEDEX_AMM = '0xc3833b73eb30242289e533b3e97c4b72b97e24e9';
const CRON = '0x0000000000000000000000000000000000000006';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function cronJobExists(jobId) {
  const raw = E(CRON).getJob(jobId);
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'string') return JSON.parse(raw) !== null;
  return true;
}

function asObject(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function consultPool(amm, poolId) {
  try {
    const raw = E(amm).consult(String(poolId));
    if (raw) return asObject(raw);
  } catch {}
  return asObject(E(amm).getPool(String(poolId)));
}

function assertAsePool(poolId, token, ammAddress) {
  const amm = ammAddress || AURAS_AMM;
  const pool = asObject(E(amm).getPool(String(poolId)));
  assert(pool && typeof pool === 'object', 'AMM pool not found');
  const asset = String(token).toLowerCase();
  const token0 = String(pool.token0 || '').toLowerCase();
  const token1 = String(pool.token1 || '').toLowerCase();
  assert((token0 === asset && token1 === NATIVE) || (token1 === asset && token0 === NATIVE), 'selected pool must pair this token directly with native ASE');
  assert(BigInt(pool.reserve0 || '0') > 0n && BigInt(pool.reserve1 || '0') > 0n, 'pool has no liquidity');
}
function tokenCumulative(poolId, token, snapshot) {
  const amm = (typeof storage !== 'undefined' && storage.get('ammAddress')) || AURAS_AMM;
  const pool = asObject(E(amm).getPool(String(poolId)));
  const asset = String(token).toLowerCase();
  const token0 = String(pool.token0 || '').toLowerCase();
  const token1 = String(pool.token1 || '').toLowerCase();
  if (token0 === asset && token1 === NATIVE) return BigInt(snapshot.price0Cumulative);
  if (token1 === asset && token0 === NATIVE) return BigInt(snapshot.price1Cumulative);
  assert(false, 'selected pool must pair this token directly with native ASE');
}

({
  init(poolId, token, thresholdBps, intervalSec, ammAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const interval = BigInt(intervalSec);
    assert(interval >= 60n && interval <= 86400n, 'interval must be 60..86400 seconds');
    const threshold = BigInt(thresholdBps);
    assert(threshold > 0n && threshold <= 10000n, 'threshold must be 1..10000 bps');
    const amm = ammAddress || AURAS_AMM;
    assertAsePool(poolId, token, amm);
    assert(msg.value >= 400000n, 'cron escrow must cover at least one run (400000 wei)');

    storage.set('owner', msg.sender);
    storage.set('poolId', String(poolId));
    storage.set('token', String(token));
    storage.set('ammAddress', String(amm));
    storage.set('thresholdBps', threshold.toString());
    storage.set('intervalSec', interval.toString());
    storage.set('ticks', '0');
    storage.set('lastCumulative', '');
    storage.set('lastTimestamp', '0');
    storage.set('lastAverage', '0');
    storage.set('stopped', 'false');

    emit('StrataDeploy', {
      owner: msg.sender,
      template: 'momentum-signal',
      poolId: String(poolId),
      intervalSec: interval.toString(),
      gasEscrowWei: msg.value.toString(),
      timestamp: chain.blockTimestamp.toString(),
    });

    const intervalMs = interval * 1000n;
    const jobId = E(CRON, { value: msg.value }).schedule(
      msg.contractAddress,
      'tick',
      [],
      (chain.blockTimestamp + intervalMs).toString(),
      intervalMs.toString(),
      '0',
      '400000',
    );
    storage.set('jobId', String(jobId));
    emit('Armed', { poolId: String(poolId), token: String(token), thresholdBps: threshold.toString(), intervalSec: interval.toString(), jobId: String(jobId) });
    return String(jobId);
  },

  tick() {
    assert(msg.sender === CRON, 'only cron registry');
    assert(storage.get('stopped') !== 'true', 'strategy stopped');
    const ammAddress = storage.get('ammAddress') || AURAS_AMM;
    const poolId = storage.get('poolId');
    const token = storage.get('token');
    const snapshot = consultPool(ammAddress, poolId);
    const cumulative = tokenCumulative(poolId, token, snapshot);
    const timestamp = BigInt(snapshot.lastTs);
    const ticks = BigInt(storage.get('ticks') || '0') + 1n;
    storage.set('ticks', ticks.toString());

    const previousCumulative = storage.get('lastCumulative');
    if (!previousCumulative) {
      storage.set('lastCumulative', cumulative.toString());
      storage.set('lastTimestamp', timestamp.toString());
      emit('Signal', { signal: 'hold', reason: 'twap-warmup', ticks: ticks.toString() });
      return 'warmup';
    }

    const elapsed = timestamp - BigInt(storage.get('lastTimestamp') || '0');
    const delta = cumulative - BigInt(previousCumulative);
    storage.set('lastCumulative', cumulative.toString());
    storage.set('lastTimestamp', timestamp.toString());
    if (elapsed <= 0n || delta <= 0n) {
      emit('Signal', { signal: 'hold', reason: 'no-twap-window', ticks: ticks.toString() });
      return 'no-window';
    }

    const average = delta / elapsed;
    const previousAverage = BigInt(storage.get('lastAverage') || '0');
    if (previousAverage === 0n) {
      storage.set('lastAverage', average.toString());
      emit('Signal', { signal: 'hold', reason: 'twap-baseline', ticks: ticks.toString() });
      return 'baseline';
    }

    const drift = ((average - previousAverage) * 10000n) / previousAverage;
    storage.set('lastAverage', average.toString());
    const threshold = BigInt(storage.get('thresholdBps'));
    const signal = drift > threshold ? 'sell' : drift < -threshold ? 'buy' : 'hold';
    emit('Signal', { signal, driftBps: drift.toString(), twapPrice: average.toString(), ticks: ticks.toString() });
    return signal;
  },

  stop() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    if (storage.get('stopped') !== 'true') {
      const jobId = storage.get('jobId');
      // Cron can remove an exhausted job and refund its remainder automatically.
      // In that case there is nothing left to cancel, but the owner must still
      // be able to mark the strategy stopped and recover its token inventory.
      const active = Boolean(jobId && cronJobExists(jobId));
      if (active) E(CRON).cancel(jobId);
      storage.set('stopped', 'true');
      emit('Stopped', { owner: msg.sender, jobId: jobId || '', cronJobActive: String(active) });
    }
    return true;
  },

  withdraw(to, amountWei) {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    const amount = BigInt(amountWei);
    assert(amount > 0n, 'amount must be positive');
    transfer(to || msg.sender, amount);
    emit('Withdrawn', { to: to || msg.sender, amount: amount.toString() });
    return amount.toString();
  },

  getOwner() { return storage.get('owner') || ''; },
  getConfig() { return JSON.stringify({ version: '1', template: 'momentum-signal', poolId: storage.get('poolId'), token: storage.get('token'), thresholdBps: storage.get('thresholdBps'), intervalSec: storage.get('intervalSec'), ammAddress: storage.get('ammAddress') || AURAS_AMM }); },
  getTemplate() { return 'momentum-signal'; },
  getStatus() {
    return JSON.stringify({ owner: storage.get('owner'), template: 'momentum-signal', poolId: storage.get('poolId'), stopped: storage.get('stopped'), jobId: storage.get('jobId'), ticks: storage.get('ticks') || '0', ammAddress: storage.get('ammAddress') || AURAS_AMM });
  },
});
