// Strata template: risk-managed trader
// Auras spot sell strategy with explicit budget, stop-loss, take-profit,
// peak-price drawdown and realised daily-loss controls.
// init(poolId, token, sizeWei, budgetWei, decimals, costBasisAseWeiPerToken,
//      dailyLossLimitAseWei, stopLossBps, takeProfitBps, maxDrawdownBps, intervalSec)

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
function readPrice(poolId, token, decimals, ammAddress) {
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
  // ASE wei per one whole token; correct whichever side the token occupies.
  return (aseReserve * (10n ** BigInt(decimals))) / tokenReserve;
}
function resetDailyLedger() {
  const day = (BigInt(chain.blockTimestamp) / 86400000n).toString();
  if (storage.get('riskDay') !== day) {
    storage.set('riskDay', day);
    storage.set('dailyPnlAseWei', '0');
  }
}
function stopCron(reason) {
  const jobId = storage.get('jobId') || '';
  if (activeJob(jobId)) E(CRON).cancel(jobId);
  storage.set('stopped', 'true');
  emit('RiskStop', { reason, jobId, timestamp: chain.blockTimestamp.toString() });
}
function executeSell(amount, reason, ammAddress) {
  if (amount <= 0n) return 0n;
  const amm = ammAddress || storage.get('ammAddress') || AURAS_AMM;
  const token = storage.get('token');
  const poolId = storage.get('poolId');
  // Refresh the allowance before each swap; ARC-20 allowance is consumed by swapExactIn.
  E(token).approve(amm, amount.toString());
  const expected = BigInt(E(amm).quote(poolId, token, amount.toString()));
  assert(expected > 0n, 'quote returned zero');
  const minOut = (expected * (BPS - SLIPPAGE_BPS)) / BPS;
  const amountOut = BigInt(E(amm).swapExactIn(poolId, token, amount.toString(), minOut.toString()));
  const earned = BigInt(storage.get('earnedAseWei') || '0') + amountOut;
  const sold = BigInt(storage.get('soldTokenWei') || '0') + amount;
  const costBasis = BigInt(storage.get('costBasisAseWeiPerToken') || '0');
  const decimals = BigInt(storage.get('tokenDecimals') || '18');
  const cost = (amount * costBasis) / (10n ** decimals);
  resetDailyLedger();
  const dailyPnl = BigInt(storage.get('dailyPnlAseWei') || '0') + amountOut - cost;
  storage.set('earnedAseWei', earned.toString());
  storage.set('soldTokenWei', sold.toString());
  storage.set('dailyPnlAseWei', dailyPnl.toString());
  emit('Fill', {
    poolId, tokenIn: token, amountIn: amount.toString(), amountOut: amountOut.toString(),
    estimatedCostAseWei: cost.toString(), realisedPnlAseWei: (amountOut - cost).toString(), reason,
  });
  return amountOut;
}
function riskReason(currentPrice) {
  const costBasis = BigInt(storage.get('costBasisAseWeiPerToken') || '0');
  const stopLoss = BigInt(storage.get('stopLossBps') || '0');
  const takeProfit = BigInt(storage.get('takeProfitBps') || '0');
  const maxDrawdown = BigInt(storage.get('maxDrawdownBps') || '0');
  let peak = BigInt(storage.get('peakPriceAseWei') || costBasis.toString());
  if (currentPrice > peak) {
    peak = currentPrice;
    storage.set('peakPriceAseWei', peak.toString());
  }
  if (stopLoss > 0n && currentPrice * BPS <= costBasis * (BPS - stopLoss)) return 'stop-loss';
  if (takeProfit > 0n && currentPrice * BPS >= costBasis * (BPS + takeProfit)) return 'take-profit';
  if (maxDrawdown > 0n && peak > 0n && currentPrice * BPS <= peak * (BPS - maxDrawdown)) return 'max-drawdown';
  return '';
}

({
  init(poolId, token, sizeWei, budgetWei, decimals, costBasisAseWeiPerToken, dailyLossLimitAseWei, stopLossBps, takeProfitBps, maxDrawdownBps, intervalSec, ammAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const size = BigInt(sizeWei);
    const budget = BigInt(budgetWei);
    const tokenDecimals = BigInt(decimals);
    const interval = BigInt(intervalSec);
    const costBasis = BigInt(costBasisAseWeiPerToken);
    const dailyLimit = BigInt(dailyLossLimitAseWei);
    const stopLoss = BigInt(stopLossBps);
    const takeProfit = BigInt(takeProfitBps);
    const drawdown = BigInt(maxDrawdownBps);
    assert(size > 0n && budget >= size, 'invalid size or budget');
    assert(tokenDecimals >= 0n && tokenDecimals <= 18n, 'invalid token decimals');
    assert(interval >= 60n && interval <= 86400n, 'interval must be 60..86400 seconds');
    assert(costBasis > 0n, 'average token cost basis is required');
    assert(dailyLimit >= 0n, 'daily loss limit cannot be negative');
    assert(stopLoss >= 0n && stopLoss < BPS, 'stop loss must be 0..9999 bps');
    assert(takeProfit >= 0n && takeProfit <= 50000n, 'take profit must be 0..50000 bps');
    assert(drawdown >= 0n && drawdown < BPS, 'max drawdown must be 0..9999 bps');
    assert(stopLoss > 0n || takeProfit > 0n || drawdown > 0n || dailyLimit > 0n, 'enable at least one risk guard');
    assert(msg.value >= 900000n, 'cron escrow must cover one run (900000 wei)');
    const amm = ammAddress || AURAS_AMM;
    const initialPrice = readPrice(poolId, token, Number(tokenDecimals), amm);

    storage.set('owner', msg.sender);
    storage.set('poolId', String(poolId));
    storage.set('token', String(token));
    storage.set('ammAddress', String(amm));
    storage.set('sizeWei', size.toString());
    storage.set('budgetWei', budget.toString());
    storage.set('tokenDecimals', tokenDecimals.toString());
    storage.set('intervalSec', interval.toString());
    storage.set('costBasisAseWeiPerToken', costBasis.toString());
    storage.set('dailyLossLimitAseWei', dailyLimit.toString());
    storage.set('stopLossBps', stopLoss.toString());
    storage.set('takeProfitBps', takeProfit.toString());
    storage.set('maxDrawdownBps', drawdown.toString());
    storage.set('initialPriceAseWei', initialPrice.toString());
    storage.set('peakPriceAseWei', initialPrice.toString());
    storage.set('soldTokenWei', '0');
    storage.set('earnedAseWei', '0');
    storage.set('dailyPnlAseWei', '0');
    storage.set('riskDay', (BigInt(chain.blockTimestamp) / 86400000n).toString());
    storage.set('approved', 'false');
    storage.set('stopped', 'false');
    emit('StrataDeploy', { owner: msg.sender, template: 'risk-managed', poolId: String(poolId), intervalSec: interval.toString(), gasEscrowWei: msg.value.toString(), timestamp: chain.blockTimestamp.toString() });
    const intervalMs = interval * 1000n;
    const jobId = E(CRON, { value: msg.value }).schedule(msg.contractAddress, 'tick', [], (chain.blockTimestamp + intervalMs).toString(), intervalMs.toString(), '0', '900000');
    storage.set('jobId', String(jobId));
    emit('Armed', { poolId: String(poolId), token: String(token), jobId: String(jobId), intervalSec: interval.toString(), sizeWei: size.toString(), budgetWei: budget.toString() });
    emit('RiskConfigured', { costBasisAseWeiPerToken: costBasis.toString(), dailyLossLimitAseWei: dailyLimit.toString(), stopLossBps: stopLoss.toString(), takeProfitBps: takeProfit.toString(), maxDrawdownBps: drawdown.toString() });
    return String(jobId);
  },

  tick() {
    assert(msg.sender === CRON, 'only cron registry');
    assert(storage.get('stopped') !== 'true', 'strategy stopped');
    const token = storage.get('token');
    const poolId = storage.get('poolId');
    const decimals = Number(storage.get('tokenDecimals'));
    const ammAddress = storage.get('ammAddress') || AURAS_AMM;
    const currentPrice = readPrice(poolId, token, decimals, ammAddress);
    const trigger = riskReason(currentPrice);
    const sold = BigInt(storage.get('soldTokenWei') || '0');
    const budgetLeft = BigInt(storage.get('budgetWei')) - sold;
    const balance = BigInt(E(token).balanceOf(msg.contractAddress));
    const available = min(balance, budgetLeft);

    // Latch the exit condition and liquidate at most one configured trade size
    // per Cron run. A failed swap reverts the whole tick and Cron can retry;
    // a successful partial exit keeps the schedule alive until the allocation
    // is exhausted, even if the spot price later rebounds.
    const pendingExit = storage.get('pendingExitReason') || '';
    const exitReason = pendingExit || trigger;
    if (exitReason) {
      if (!pendingExit) storage.set('pendingExitReason', exitReason);
      if (available <= 0n) {
        stopCron(exitReason);
        return 'stopped';
      }
      const exitSize = min(BigInt(storage.get('sizeWei')), available);
      executeSell(exitSize, exitReason, ammAddress);
      if (balance <= exitSize || budgetLeft <= exitSize) stopCron(exitReason);
      return exitReason;
    }
    if (available <= 0n) {
      stopCron('position-budget-exhausted');
      return 'stopped';
    }

    const amount = min(BigInt(storage.get('sizeWei')), available);
    const expected = BigInt(E(ammAddress).quote(poolId, token, amount.toString()));
    const cost = (amount * BigInt(storage.get('costBasisAseWeiPerToken'))) / (10n ** BigInt(decimals));
    resetDailyLedger();
    const projectedDailyPnl = BigInt(storage.get('dailyPnlAseWei') || '0') + expected - cost;
    const dailyLimit = BigInt(storage.get('dailyLossLimitAseWei') || '0');
    if (dailyLimit > 0n && projectedDailyPnl <= -dailyLimit) {
      stopCron('daily-realised-loss-limit');
      return 'daily-realised-loss-limit';
    }

    executeSell(amount, 'scheduled', ammAddress);
    if (dailyLimit > 0n && BigInt(storage.get('dailyPnlAseWei') || '0') <= -dailyLimit) {
      stopCron('daily-realised-loss-limit');
      return 'daily-realised-loss-limit';
    }
    if (BigInt(storage.get('soldTokenWei') || '0') >= BigInt(storage.get('budgetWei'))) stopCron('position-budget-exhausted');
    return amount.toString();
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
  getConfig() { return JSON.stringify({ version: '1', template: 'risk-managed', poolId: storage.get('poolId'), token: storage.get('token'), sizeWei: storage.get('sizeWei'), budgetWei: storage.get('budgetWei'), decimals: storage.get('tokenDecimals'), costBasisAseWeiPerToken: storage.get('costBasisAseWeiPerToken'), dailyLossLimitAseWei: storage.get('dailyLossLimitAseWei'), stopLossBps: storage.get('stopLossBps'), takeProfitBps: storage.get('takeProfitBps'), maxDrawdownBps: storage.get('maxDrawdownBps'), intervalSec: storage.get('intervalSec'), ammAddress: storage.get('ammAddress') || AURAS_AMM }); },
  getTemplate() { return 'risk-managed'; },
  getStatus() {
    return JSON.stringify({ owner: storage.get('owner'), template: 'risk-managed', poolId: storage.get('poolId'), token: storage.get('token'), stopped: storage.get('stopped'), jobId: storage.get('jobId'), soldTokenWei: storage.get('soldTokenWei') || '0', earnedAseWei: storage.get('earnedAseWei') || '0', dailyPnlAseWei: storage.get('dailyPnlAseWei') || '0', costBasisAseWeiPerToken: storage.get('costBasisAseWeiPerToken'), dailyLossLimitAseWei: storage.get('dailyLossLimitAseWei'), stopLossBps: storage.get('stopLossBps'), takeProfitBps: storage.get('takeProfitBps'), maxDrawdownBps: storage.get('maxDrawdownBps'), pendingExitReason: storage.get('pendingExitReason') || '', ammAddress: storage.get('ammAddress') || AURAS_AMM });
  },
});
