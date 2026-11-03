// Strata template: TWAP token-to-ASE slicer for Auras AMM and AseDex.
// init(poolId, token, notionalWei, slices, ammAddress)

const AURAS_AMM = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const ASEDEX_AMM = '0xc3833b73eb30242289e533b3e97c4b72b97e24e9';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const CRON = '0x0000000000000000000000000000000000000006';

function asObject(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function assertAsePool(poolId, token, ammAddress) {
  const amm = ammAddress || (typeof storage !== 'undefined' && storage.get('ammAddress')) || AURAS_AMM;
  const pool = asObject(E(amm).getPool(String(poolId)));
  assert(pool && typeof pool === 'object', 'AMM pool not found');
  const asset = String(token).toLowerCase();
  const token0 = String(pool.token0 || '').toLowerCase();
  const token1 = String(pool.token1 || '').toLowerCase();
  assert((token0 === asset && token1 === NATIVE) || (token1 === asset && token0 === NATIVE), 'selected pool must pair this token directly with native ASE');
  assert(BigInt(pool.reserve0 || '0') > 0n && BigInt(pool.reserve1 || '0') > 0n, 'pool has no liquidity');
}

function cronJobExists(jobId) {
  const raw = E(CRON).getJob(jobId);
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'string') return JSON.parse(raw) !== null;
  return true;
}
const SLIPPAGE_BPS = 200n;

function cancelFromTick(reason) {
  E(CRON).cancel(storage.get('jobId'));
  storage.set('stopped', 'true');
  emit('AutoStopped', { reason, jobId: storage.get('jobId') || '' });
}

({
  init(poolId, token, notionalWei, slices, ammAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const total = BigInt(notionalWei);
    const count = BigInt(slices);
    assert(total > 0n, 'notional must be positive');
    assert(count >= 1n && count <= 100n, 'slices must be 1..100');
    assert(total / count > 0n, 'notional is too small for selected slices');
    assert(msg.value >= 700000n, 'cron escrow must cover at least one run (700000 wei)');
    const amm = ammAddress || AURAS_AMM;
    assertAsePool(poolId, token, amm);
    const intervalMs = 300000n;

    storage.set('owner', msg.sender);
    storage.set('poolId', String(poolId));
    storage.set('token', String(token));
    storage.set('ammAddress', String(amm));
    storage.set('notionalWei', total.toString());
    storage.set('slices', count.toString());
    storage.set('legsDone', '0');
    storage.set('remainingTokenWei', total.toString());
    storage.set('approved', 'false');
    storage.set('earned', '0');
    storage.set('stopped', 'false');

    emit('StrataDeploy', { owner: msg.sender, template: 'twap', poolId: String(poolId), intervalSec: '300', gasEscrowWei: msg.value.toString(), timestamp: chain.blockTimestamp.toString() });
    const jobId = E(CRON, { value: msg.value }).schedule(msg.contractAddress, 'tick', [], (chain.blockTimestamp + intervalMs).toString(), intervalMs.toString(), '0', '700000');
    storage.set('jobId', String(jobId));
    emit('Armed', { poolId: String(poolId), token: String(token), notionalWei: total.toString(), slices: count.toString(), jobId: String(jobId) });
    return String(jobId);
  },

  tick() {
    assert(msg.sender === CRON, 'only cron registry');
    assert(storage.get('stopped') !== 'true', 'strategy stopped');
    const ammAddress = storage.get('ammAddress') || AURAS_AMM;
    const token = storage.get('token');
    const balance = BigInt(E(token).balanceOf(msg.contractAddress));
    const total = BigInt(storage.get('notionalWei'));
    const count = BigInt(storage.get('slices'));
    const legsDone = BigInt(storage.get('legsDone') || '0');
    const leg = legsDone + 1n === count ? total - ((total / count) * (count - 1n)) : total / count;
    if (balance < leg) { cancelFromTick('token-allocation-below-next-slice'); return 'stopped'; }

    if (storage.get('approved') !== 'true') {
      E(token).approve(ammAddress, balance.toString());
      storage.set('approved', 'true');
      emit('Approved', { spender: ammAddress, amount: balance.toString() });
    }

    const poolId = storage.get('poolId');
    const expected = BigInt(E(ammAddress).quote(poolId, token, leg.toString()));
    const minOut = (expected * (10000n - SLIPPAGE_BPS)) / 10000n;
    const amountOut = BigInt(E(ammAddress).swapExactIn(poolId, token, leg.toString(), minOut.toString()));
    const earned = BigInt(storage.get('earned') || '0') + amountOut;
    storage.set('earned', earned.toString());
    const nextLeg = legsDone + 1n;
    storage.set('legsDone', nextLeg.toString());
    storage.set('remainingTokenWei', (nextLeg >= count ? 0n : total - ((total / count) * nextLeg)).toString());
    emit('Fill', { poolId, tokenIn: token, amountIn: leg.toString(), amountOut: amountOut.toString(), leg: nextLeg.toString() });
    if (nextLeg >= count) {
      cancelFromTick('twap-complete');
      emit('Completed', { legs: nextLeg.toString(), totalInput: total.toString(), totalOutput: earned.toString() });
    }
    return amountOut.toString();
  },

  stop() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    if (storage.get('stopped') !== 'true') {
      const jobId = storage.get('jobId');
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

  withdrawTokens(to) {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    assert(storage.get('stopped') === 'true', 'stop the strategy first');
    const token = storage.get('token');
    const amount = BigInt(E(token).balanceOf(msg.contractAddress));
    assert(amount > 0n, 'no tokens to withdraw');
    E(token).transfer(to || msg.sender, amount.toString());
    emit('TokensWithdrawn', { token, to: to || msg.sender, amount: amount.toString() });
    return amount.toString();
  },

  getOwner() { return storage.get('owner') || ''; },
  getConfig() { return JSON.stringify({ version: '2', template: 'twap', poolId: storage.get('poolId'), token: storage.get('token'), notionalWei: storage.get('notionalWei'), slices: storage.get('slices'), intervalSec: '300', ammAddress: storage.get('ammAddress') }); },
  getTemplate() { return 'twap'; },
  getStatus() { return JSON.stringify({ owner: storage.get('owner'), template: 'twap', poolId: storage.get('poolId'), token: storage.get('token'), stopped: storage.get('stopped'), jobId: storage.get('jobId'), legsDone: storage.get('legsDone') || '0', slices: storage.get('slices'), remainingTokenWei: storage.get('remainingTokenWei') || storage.get('notionalWei'), earned: storage.get('earned') || '0', ammAddress: storage.get('ammAddress') }); },
});
