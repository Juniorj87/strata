// Strata template: scale order (Auras price-triggered scale-out) for Auras AMM and AseDex.
// Splits a token inventory into sell levels. This is an on-chain scheduled
// price trigger, not a resting order-book limit order. Spot-only, reduce-only.
// init(poolId, token, budgetWei, sizePerLevelWei, decimals, targetUpsideBps, levels, intervalSec, ammAddress)

const AURAS_AMM = '0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd';
const ASEDEX_AMM = '0xc3833b73eb30242289e533b3e97c4b72b97e24e9';
const CRON = '0x0000000000000000000000000000000000000006';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const BPS = 10000n;
const SLIPPAGE_BPS = 200n;

function asObject(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function min(a, b) { return a < b ? a : b; }
function activeJob(jobId) {
  if (!jobId) return false;
  const raw = E(CRON).getJob(jobId);
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'string') return JSON.parse(raw) !== null;
  return true;
}
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
function stopCron(reason) {
  const jobId = storage.get('jobId') || '';
  if (activeJob(jobId)) E(CRON).cancel(jobId);
  storage.set('stopped', 'true');
  emit('Stopped', { reason, jobId, timestamp: chain.blockTimestamp.toString() });
}
function executeLeg(amount, level, ammAddress) {
  const token = storage.get('token');
  const poolId = storage.get('poolId');
  E(token).approve(ammAddress, amount.toString());
  const expected = BigInt(E(ammAddress).quote(poolId, token, amount.toString()));
  assert(expected > 0n, 'quote returned zero');
  const minOut = expected * (BPS - SLIPPAGE_BPS) / BPS;
  const amountOut = BigInt(E(ammAddress).swapExactIn(poolId, token, amount.toString(), minOut.toString()));
  const sold = BigInt(storage.get('soldWei') || '0') + amount;
  const earned = BigInt(storage.get('earnedAseWei') || '0') + amountOut;
  storage.set('soldWei', sold.toString());
  storage.set('earnedAseWei', earned.toString());
  emit('Fill', { poolId, tokenIn: token, amountIn: amount.toString(), amountOut: amountOut.toString(), level: String(level), reason: 'scale-level' });
}

({
  init(poolId, token, budgetWei, sizePerLevelWei, decimals, targetUpsideBps, levels, intervalSec, ammAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const budget = BigInt(budgetWei);
    const size = BigInt(sizePerLevelWei);
    const tokenDecimals = BigInt(decimals);
    const upside = BigInt(targetUpsideBps);
    const count = BigInt(levels);
    const interval = BigInt(intervalSec);
    assert(budget > 0n && size > 0n, 'budget and size must be positive');
    assert(count >= 1n && count <= 20n, 'levels must be 1..20');
    assert(size * count <= budget, 'budget must cover every scale level');
    assert(tokenDecimals >= 0n && tokenDecimals <= 18n, 'invalid token decimals');
    assert(upside > 0n && upside <= 50000n, 'target upside must be 1..50000 bps');
    assert(interval >= 60n && interval <= 86400n, 'interval must be 60..86400 seconds');
    assert(msg.value >= 800000n, 'cron escrow must cover one run (800000 wei)');
    const amm = ammAddress || AURAS_AMM;
    const startPrice = spotPrice(poolId, token, Number(tokenDecimals), amm);
    const targetPrice = startPrice * (BPS + upside) / BPS;

    storage.set('owner', msg.sender);
    storage.set('poolId', String(poolId));
    storage.set('token', String(token));
    storage.set('ammAddress', String(amm));
    storage.set('budgetWei', budget.toString());
    storage.set('sizePerLevelWei', size.toString());
    storage.set('tokenDecimals', tokenDecimals.toString());
    storage.set('targetUpsideBps', upside.toString());
    storage.set('startPriceAseWei', startPrice.toString());
    storage.set('targetPriceAseWei', targetPrice.toString());
    storage.set('levels', count.toString());
    storage.set('completedLevels', '0');
    storage.set('intervalSec', interval.toString());
    storage.set('soldWei', '0');
    storage.set('earnedAseWei', '0');
    storage.set('approved', 'false');
    storage.set('stopped', 'false');
    emit('StrataDeploy', { owner: msg.sender, template: 'scale', poolId: String(poolId), intervalSec: interval.toString(), gasEscrowWei: msg.value.toString(), timestamp: chain.blockTimestamp.toString() });
    const intervalMs = interval * 1000n;
    const jobId = E(CRON, { value: msg.value }).schedule(msg.contractAddress, 'tick', [], (chain.blockTimestamp + intervalMs).toString(), intervalMs.toString(), '0', '800000');
    storage.set('jobId', String(jobId));
    emit('Armed', { poolId: String(poolId), token: String(token), levels: count.toString(), intervalSec: interval.toString(), startPriceAseWei: startPrice.toString(), targetPriceAseWei: targetPrice.toString(), jobId: String(jobId) });
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
    const start = BigInt(storage.get('startPriceAseWei'));
    const target = BigInt(storage.get('targetPriceAseWei'));
    const levels = BigInt(storage.get('levels'));
    let completed = BigInt(storage.get('completedLevels') || '0');
    let budgetLeft = BigInt(storage.get('budgetWei')) - BigInt(storage.get('soldWei') || '0');
    let balance = BigInt(E(token).balanceOf(msg.contractAddress));
    if (balance <= 0n || budgetLeft <= 0n) { stopCron('inventory-exhausted'); return 'stopped'; }
    if (completed < levels && balance > 0n && budgetLeft > 0n) {
      const triggerPrice = start + ((target - start) * (completed + 1n) / levels);
      if (price >= triggerPrice) {
        const amount = min(BigInt(storage.get('sizePerLevelWei')), min(balance, budgetLeft));
        if (amount > 0n) {
          executeLeg(amount, completed + 1n, ammAddress);
          completed += 1n;
          storage.set('completedLevels', completed.toString());
        }
      }
    }
    if (completed >= levels || BigInt(E(token).balanceOf(msg.contractAddress)) <= 0n || BigInt(storage.get('soldWei')) >= BigInt(storage.get('budgetWei'))) {
      stopCron('scale-complete');
    }
    emit('ScaleCheck', { priceAseWei: price.toString(), completedLevels: completed.toString(), levels: levels.toString() });
    return completed.toString();
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
  getConfig() { return JSON.stringify({ version: '2', template: 'scale', poolId: storage.get('poolId'), token: storage.get('token'), budgetWei: storage.get('budgetWei'), sizePerLevelWei: storage.get('sizePerLevelWei'), decimals: storage.get('tokenDecimals'), targetUpsideBps: storage.get('targetUpsideBps'), levels: storage.get('levels'), intervalSec: storage.get('intervalSec'), ammAddress: storage.get('ammAddress') }); },
  getTemplate() { return 'scale'; },
  getStatus() {
    return JSON.stringify({ owner: storage.get('owner'), template: 'scale', poolId: storage.get('poolId'), token: storage.get('token'), stopped: storage.get('stopped'), jobId: storage.get('jobId'), completedLevels: storage.get('completedLevels') || '0', levels: storage.get('levels'), soldWei: storage.get('soldWei') || '0', earnedAseWei: storage.get('earnedAseWei') || '0', startPriceAseWei: storage.get('startPriceAseWei'), targetPriceAseWei: storage.get('targetPriceAseWei'), ammAddress: storage.get('ammAddress') });
  },
});
