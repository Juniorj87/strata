// Strata template: perp-grid - leveraged range grid bot for AsePad Perps.
// init(marketId, side, leverage, stepBps, levels, totalMarginWei, intervalSec, cfgAddress)
// Adds leveraged grid legs when price steps adversely and takes profit (+stepBps) on reversals.

const DEFAULT_CFG = '0x37d25f3a292f0642af72d6f161eafb18c76e16a6';
const CRON = '0x0000000000000000000000000000000000000006';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SCALE = 1000000000000000000n;
const BPS = 10000n;
const SLIPPAGE_BPS = 300n;
const CRON_GAS_LIMIT = 4500000n;

function asObj(v) { return typeof v === 'string' ? JSON.parse(v) : v; }
function min(a, b) { return a < b ? a : b; }
function activeJob(id) {
  if (!id) return false;
  const raw = E(CRON).getJob(id);
  if (raw == null) return false;
  return typeof raw === 'string' ? JSON.parse(raw) !== null : true;
}
function stopCron(reason) {
  const id = storage.get('jobId') || '';
  if (activeJob(id)) E(CRON).cancel(id);
  storage.set('stopped', 'true');
  emit('AutoStopped', { reason, jobId: id });
}
function worstPx(price, dir) {
  return (dir > 0n ? (price * (BPS + SLIPPAGE_BPS)) / BPS : (price * (BPS - SLIPPAGE_BPS)) / BPS).toString();
}
function closeAndWithdraw(cfg, mid) {
  const vault = E(cfg).module('vault');
  const engine = E(cfg).module('engine');
  const oracle = E(cfg).module('oracle');
  const pos = asObj(E(vault).position(msg.contractAddress, mid));
  const curSize = BigInt((pos && pos.sizeWei) || '0');
  if (curSize !== 0n) {
    const mk = asObj(E(oracle).mark(mid));
    assert(mk && mk.healthy === true, 'oracle unhealthy while closing position');
    const mark = BigInt(mk.price);
    E(engine).close(mid, worstPx(mark, curSize > 0n ? -1n : 1n));
    emit('Fill', {
      marketId: mid,
      side: curSize > 0n ? 'close-long' : 'close-short',
      sizeDelta: (-curSize).toString(),
      price: mark.toString(),
      reason: 'grid-close',
    });
  }
  const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
  if (free > 0n) {
    E(vault).withdraw(mid, free.toString());
    emit('VaultWithdrawn', { marketId: mid, amountWei: free.toString() });
  }
}

({
  init(marketId, side, leverage, stepBps, levels, totalMarginWei, intervalSec, cfgAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const mid = String(marketId);
    const dir = String(side).toUpperCase();
    assert(dir === 'LONG' || dir === 'SHORT', 'side must be LONG or SHORT');
    const lev = BigInt(leverage);
    const step = BigInt(stepBps);
    const count = BigInt(levels);
    const totalMargin = BigInt(totalMarginWei);
    const interval = BigInt(intervalSec || '60');
    assert(step >= 10n && step <= 5000n, 'step must be 10..5000 bps');
    assert(count >= 1n && count <= 20n, 'levels must be 1..20');
    assert(step * count < BPS, 'step multiplied by levels must stay below 10000 bps');
    assert(interval >= 60n && interval <= 86400n, 'interval must be 60..86400 seconds');
    assert(lev >= 1n && totalMargin > 0n, 'invalid leverage or margin');
    assert(msg.value >= totalMargin + CRON_GAS_LIMIT, 'init value must cover margin reserve plus cron escrow');

    const cfg = String(cfgAddress || DEFAULT_CFG).toLowerCase();
    const markets = E(cfg).module('markets');
    const vault = E(cfg).module('vault');
    const oracle = E(cfg).module('oracle');
    const mkt = asObj(E(markets).get(mid));
    assert(mkt && mkt.state === 'ACTIVE', 'perps market is not active');
    assert(String(mkt.quote || NATIVE).toLowerCase() === NATIVE, 'only native ASE margined perp markets are supported');

    const imBps = BigInt(E(cfg).marketParam(mid, 'initialMarginBps'));
    assert(lev <= BPS / imBps, 'leverage exceeds market maximum');
    const perLevelMargin = totalMargin / count;
    assert(perLevelMargin > 0n, 'margin per level is zero');
    const minNotional = BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei'));
    assert(perLevelMargin * lev >= minNotional, 'margin per level * leverage below market minimum notional');

    const mk = asObj(E(oracle).mark(mid));
    assert(mk && mk.healthy === true && BigInt(mk.price || '0') > 0n, 'oracle mark unavailable');

    E(vault, { value: totalMargin.toString() }).deposit(mid, totalMargin.toString());

    const cronEscrow = msg.value - totalMargin;
    storage.set('owner', msg.sender);
    storage.set('cfg', cfg);
    storage.set('marketId', mid);
    storage.set('poolId', String(mkt.poolId || mid));
    storage.set('token', String(mkt.token || ''));
    storage.set('side', dir);
    storage.set('leverage', lev.toString());
    storage.set('stepBps', step.toString());
    storage.set('levels', count.toString());
    storage.set('totalMarginWei', totalMargin.toString());
    storage.set('marginPerLevelWei', perLevelMargin.toString());
    storage.set('anchorPrice', String(mk.price));
    storage.set('levelStack', '[]');
    storage.set('trades', '0');
    storage.set('intervalSec', interval.toString());
    storage.set('stopped', 'false');

    const ms = interval * 1000n;
    const firstMs = ms < 60000n ? ms : 60000n;
    const id = E(CRON, { value: cronEscrow.toString() }).schedule(
      msg.contractAddress,
      'tick',
      [],
      (chain.blockTimestamp + firstMs).toString(),
      ms.toString(),
      '0',
      CRON_GAS_LIMIT.toString(),
    );
    storage.set('jobId', String(id));
    emit('StrataDeploy', {
      owner: msg.sender,
      template: 'perp-grid',
      marketId: mid,
      side: dir,
      leverage: lev.toString(),
      stepBps: step.toString(),
      levels: count.toString(),
      timestamp: chain.blockTimestamp.toString(),
    });
    return String(id);
  },

  tick() {
    assert(msg.sender === CRON, 'only cron registry');
    assert(storage.get('stopped') !== 'true', 'strategy stopped');
    const cfg = storage.get('cfg') || DEFAULT_CFG;
    const mid = storage.get('marketId');
    const dir = storage.get('side');
    const isLong = dir === 'LONG';
    const lev = BigInt(storage.get('leverage'));
    const step = BigInt(storage.get('stepBps'));
    const maxLevels = BigInt(storage.get('levels'));
    const anchor = BigInt(storage.get('anchorPrice'));
    const oracle = E(cfg).module('oracle');
    const vault = E(cfg).module('vault');
    const engine = E(cfg).module('engine');

    const mk = asObj(E(oracle).mark(mid));
    if (!mk || mk.healthy !== true) {
      emit('Signal', { signal: 'oracle-unhealthy', marketId: mid });
      return 'oracle-unhealthy';
    }
    const mark = BigInt(mk.price);
    const pos = asObj(E(vault).position(msg.contractAddress, mid));
    const curSize = BigInt((pos && pos.sizeWei) || '0');
    let stack = JSON.parse(storage.get('levelStack') || '[]');
    if (curSize === 0n && stack.length > 0) {
      stack = [];
      storage.set('levelStack', '[]');
    }

    // 1. Take-profit on the most recent active grid level if price bounced back by +step.
    if (stack.length > 0 && curSize !== 0n) {
      const top = stack[stack.length - 1];
      const topPx = BigInt(top.px);
      const tpTrigger = isLong ? (topPx * (BPS + step)) / BPS : (topPx * (BPS - step)) / BPS;
      const tpHit = isLong ? mark >= tpTrigger : mark <= tpTrigger;
      if (tpHit) {
        const reduceDir = isLong ? -1n : 1n;
        const wp = worstPx(mark, reduceDir);
        const legSz = BigInt(top.sz);
        if (stack.length === 1 || legSz >= (curSize < 0n ? -curSize : curSize)) {
          E(engine).close(mid, wp);
        } else {
          E(engine).reduce(mid, legSz.toString(), wp);
        }
        stack.pop();
        storage.set('levelStack', JSON.stringify(stack));
        const nextTrades = BigInt(storage.get('trades') || '0') + 1n;
        storage.set('trades', nextTrades.toString());
        emit('Fill', {
          marketId: mid,
          side: isLong ? 'reduce-long' : 'reduce-short',
          sizeWei: legSz.toString(),
          price: mark.toString(),
          activeLevels: String(stack.length),
          reason: 'grid-tp',
        });
        return legSz.toString();
      }
    }

    // 2. Open/increase next grid level when price moves one grid step beyond anchor.
    if (BigInt(stack.length) < maxLevels) {
      const nextIdx = BigInt(stack.length + 1);
      const entryTrigger = isLong
        ? (anchor * (BPS - step * nextIdx)) / BPS
        : (anchor * (BPS + step * nextIdx)) / BPS;
      const entryHit = isLong ? mark <= entryTrigger : mark >= entryTrigger;
      if (entryHit) {
        const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
        const legMargin = min(BigInt(storage.get('marginPerLevelWei')), (free * 9950n) / BPS);
        const minNotional = BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei'));
        const notional = legMargin * lev;
        if (legMargin > 0n && notional >= minNotional) {
          const sizeWei = (notional * SCALE) / mark;
          if (sizeWei > 0n) {
            const wp = worstPx(mark, isLong ? 1n : -1n);
            if (curSize === 0n) {
              E(engine).openMarket(mid, dir, sizeWei.toString(), wp, 'GRID');
            } else {
              E(engine).increase(mid, sizeWei.toString(), wp);
            }
            stack.push({ px: mark.toString(), sz: sizeWei.toString(), marginWei: legMargin.toString() });
            storage.set('levelStack', JSON.stringify(stack));
            const nextTrades = BigInt(storage.get('trades') || '0') + 1n;
            storage.set('trades', nextTrades.toString());
            emit('Fill', {
              marketId: mid,
              side: dir,
              marginWei: legMargin.toString(),
              sizeWei: sizeWei.toString(),
              price: mark.toString(),
              activeLevels: String(stack.length),
              reason: 'grid-entry',
            });
            return sizeWei.toString();
          }
        }
      }
    }

    emit('Signal', { signal: 'hold', marketId: mid, mark: mark.toString(), activeLevels: String(stack.length) });
    return 'hold';
  },

  closePosition() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    closeAndWithdraw(storage.get('cfg') || DEFAULT_CFG, storage.get('marketId'));
    storage.set('levelStack', '[]');
    return true;
  },

  stop() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    if (storage.get('stopped') !== 'true') stopCron('owner-emergency-stop');
    try {
      closeAndWithdraw(storage.get('cfg') || DEFAULT_CFG, storage.get('marketId'));
      storage.set('levelStack', '[]');
    } catch (_err) {
      // Cron cancelled; closePosition() remains callable when oracle recovers.
    }
    return true;
  },

  withdraw(to, amountWei) {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    assert(storage.get('stopped') === 'true', 'stop the strategy before withdrawing ASE');
    const amount = BigInt(amountWei);
    assert(amount > 0n, 'amount must be positive');
    transfer(to || msg.sender, amount);
    emit('Withdrawn', { to: to || msg.sender, amount: amount.toString() });
    return amount.toString();
  },

  getOwner() { return storage.get('owner') || ''; },
  getTemplate() { return 'perp-grid'; },
  getConfig() {
    return JSON.stringify({
      version: '1',
      template: 'perp-grid',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      side: storage.get('side'),
      leverage: storage.get('leverage'),
      stepBps: storage.get('stepBps'),
      levels: storage.get('levels'),
      totalMarginWei: storage.get('totalMarginWei'),
      marginPerLevelWei: storage.get('marginPerLevelWei'),
      intervalSec: storage.get('intervalSec'),
    });
  },
  getStatus() {
    const stack = JSON.parse(storage.get('levelStack') || '[]');
    return JSON.stringify({
      owner: storage.get('owner'),
      template: 'perp-grid',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      side: storage.get('side'),
      leverage: storage.get('leverage'),
      stopped: storage.get('stopped'),
      jobId: storage.get('jobId'),
      anchorPrice: storage.get('anchorPrice'),
      activeLevels: String(stack.length),
      levels: storage.get('levels'),
      trades: storage.get('trades') || '0',
      totalMarginWei: storage.get('totalMarginWei'),
      intervalSec: storage.get('intervalSec'),
    });
  },
});
