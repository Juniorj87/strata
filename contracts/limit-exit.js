// Strata template: limit sell trigger for Auras and AseDex spot pools.
// This is a scheduled price trigger, not a resting order-book limit order.
// One reduce-only token -> ASE sell executes after the pool spot reaches target.
// init(poolId, token, sizeWei, budgetWei, decimals, targetUpsideBps, intervalSec, ammAddress)

const AURAS_AMM = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const ASEDEX_AMM = '0xc3833b73eb30242289e533b3e97c4b72b97e24e9';
const CRON = '0x0000000000000000000000000000000000000006';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const BPS = 10000n;
const SLIPPAGE_BPS = 200n;

function asObject(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function spotPrice(poolId, token, decimals, ammAddress) {
  const amm = ammAddress || (typeof storage !== 'undefined' && storage.get('ammAddress')) || AURAS_AMM;
  const pool = asObject(E(amm).getPool(String(poolId)));
  assert(pool && typeof pool === 'object', 'AMM pool not found');
  const asset = String(token).toLowerCase();
  const token0 = String(pool.token0 || '').toLowerCase();
  const token1 = String(pool.token1 || '').toLowerCase();
  const reserve0 = BigInt(pool.reserve0 || '0');
  const reserve1 = BigInt(pool.reserve1 || '0');
  let tokenReserve;
  let aseReserve;
  if (token0 === asset && token1 === NATIVE) {
    tokenReserve = reserve0;
    aseReserve = reserve1;
  } else if (token1 === asset && token0 === NATIVE) {
    tokenReserve = reserve1;
    aseReserve = reserve0;
  } else {
    assert(false, 'selected pool must pair this token directly with native ASE');
  }
  assert(tokenReserve > 0n && aseReserve > 0n, 'pool has no liquidity');
  return (aseReserve * (10n ** BigInt(decimals))) / tokenReserve;
}
function min(a, b) { return a < b ? a : b; }
function activeJob(jobId) {
  if (!jobId) return false;
  const raw = E(CRON).getJob(jobId);
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'string') return JSON.parse(raw) !== null;
  return true;
}
function stopCron(reason) {
  const jobId = storage.get('jobId') || '';
  if (activeJob(jobId)) E(CRON).cancel(jobId);
  storage.set('stopped', 'true');
  emit('Stopped', { reason, jobId, timestamp: chain.blockTimestamp.toString() });
}

({
  init(poolId, token, sizeWei, budgetWei, decimals, targetUpsideBps, intervalSec, ammAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const size = BigInt(sizeWei);
    const budget = BigInt(budgetWei);
    const tokenDecimals = BigInt(decimals);
    const upside = BigInt(targetUpsideBps);
    const interval = BigInt(intervalSec);
    assert(size > 0n && budget >= size, 'budget must cover one limit sell size');
    assert(tokenDecimals >= 0n && tokenDecimals <= 18n, 'invalid token decimals');
    assert(upside > 0n && upside <= 50000n, 'target must be 1..50000 bps above current price');
    assert(interval >= 60n && interval <= 86400n, 'interval must be 60..86400 seconds');
    assert(msg.value >= 750000n, 'cron escrow must cover one run (750000 wei)');

    const amm = ammAddress || AURAS_AMM;
    const referencePrice = spotPrice(poolId, token, Number(tokenDecimals), amm);
    const targetPrice = referencePrice * (BPS + upside) / BPS;
    storage.set('owner', msg.sender);
    storage.set('poolId', String(poolId));
    storage.set('token', String(token));
    storage.set('ammAddress', String(amm));
    storage.set('sizeWei', size.toString());
    storage.set('budgetWei', budget.toString());
    storage.set('tokenDecimals', tokenDecimals.toString());
    storage.set('referencePriceAseWei', referencePrice.toString());
    storage.set('targetPriceAseWei', targetPrice.toString());
    storage.set('targetUpsideBps', upside.toString());
    storage.set('intervalSec', interval.toString());
    storage.set('soldWei', '0');
    storage.set('earnedAseWei', '0');
    storage.set('stopped', 'false');

    emit('StrataDeploy', { owner: msg.sender, template: 'limit-exit', poolId: String(poolId), intervalSec: interval.toString(), gasEscrowWei: msg.value.toString(), timestamp: chain.blockTimestamp.toString() });
    const intervalMs = interval * 1000n;
    const jobId = E(CRON, { value: msg.value }).schedule(msg.contractAddress, 'tick', [], (chain.blockTimestamp + intervalMs).toString(), intervalMs.toString(), '0', '750000');
    storage.set('jobId', String(jobId));
    emit('Armed', { poolId: String(poolId), token: String(token), jobId: String(jobId), targetPriceAseWei: targetPrice.toString(), sizeWei: size.toString(), budgetWei: budget.toString(), intervalSec: interval.toString() });
    return String(jobId);
  },

  tick() {
    assert(msg.sender === CRON, 'only cron registry');
    assert(storage.get('stopped') !== 'true', 'strategy stopped');
    const ammAddress = storage.get('ammAddress') || AURAS_AMM;
    const poolId = storage.get('poolId');
    const token = storage.get('token');
    const decimals = Number(storage.get('tokenDecimals'));
    const price = spotPrice(poolId, token, decimals, ammAddress);
    const target = BigInt(storage.get('targetPriceAseWei'));
    if (price < target) {
      emit('LimitWaiting', { priceAseWei: price.toString(), targetPriceAseWei: target.toString(), timestamp: chain.blockTimestamp.toString() });
      return 'waiting';
    }

    const budgetLeft = BigInt(storage.get('budgetWei')) - BigInt(storage.get('soldWei') || '0');
    const balance = BigInt(E(token).balanceOf(msg.contractAddress));
    const amount = min(BigInt(storage.get('sizeWei')), min(budgetLeft, balance));
    if (amount <= 0n) {
      stopCron('inventory-or-budget-exhausted');
      return 'stopped';
    }

    E(token).approve(ammAddress, amount.toString());
    const expected = BigInt(E(ammAddress).quote(poolId, token, amount.toString()));
    assert(expected > 0n, 'quote returned zero');
    const minOut = expected * (BPS - SLIPPAGE_BPS) / BPS;
    const amountOut = BigInt(E(ammAddress).swapExactIn(poolId, token, amount.toString(), minOut.toString()));
    const sold = BigInt(storage.get('soldWei') || '0') + amount;
    const earned = BigInt(storage.get('earnedAseWei') || '0') + amountOut;
    storage.set('soldWei', sold.toString());
    storage.set('earnedAseWei', earned.toString());
    emit('Fill', { poolId, tokenIn: token, amountIn: amount.toString(), amountOut: amountOut.toString(), reason: 'limit-target-reached', targetPriceAseWei: target.toString(), executionPriceAseWei: price.toString() });
    stopCron('limit-target-filled');
    return amountOut.toString();
  },

  stop() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    if (storage.get('stopped') !== 'true') stopCron('owner-emergency-stop');
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
  getConfig() { return JSON.stringify({ version: '2', template: 'limit-exit', poolId: storage.get('poolId'), token: storage.get('token'), sizeWei: storage.get('sizeWei'), budgetWei: storage.get('budgetWei'), decimals: storage.get('tokenDecimals'), targetUpsideBps: storage.get('targetUpsideBps'), intervalSec: storage.get('intervalSec'), ammAddress: storage.get('ammAddress') }); },
  getTemplate() { return 'limit-exit'; },
  getStatus() {
    return JSON.stringify({ owner: storage.get('owner'), template: 'limit-exit', poolId: storage.get('poolId'), token: storage.get('token'), stopped: storage.get('stopped'), jobId: storage.get('jobId'), targetPriceAseWei: storage.get('targetPriceAseWei'), soldWei: storage.get('soldWei') || '0', earnedAseWei: storage.get('earnedAseWei') || '0', ammAddress: storage.get('ammAddress') });
  },
});
