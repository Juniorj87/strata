// Strata template: perp-twap - leveraged TWAP order slicer for AsePad Perps.
// init(marketId, side, leverage, totalMarginWei, slices, intervalSec, cfgAddress)

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
      reason: 'twap-close',
    });
  }
  const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
  if (free > 0n) {
    E(vault).withdraw(mid, free.toString());
    emit('VaultWithdrawn', { marketId: mid, amountWei: free.toString() });
  }
}

({
  init(marketId, side, leverage, totalMarginWei, slices, intervalSec, cfgAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const mid = String(marketId);
    const dir = String(side).toUpperCase();
    assert(dir === 'LONG' || dir === 'SHORT', 'side must be LONG or SHORT');
    const lev = BigInt(leverage);
    const totalMargin = BigInt(totalMarginWei);
    const count = BigInt(slices);
    const interval = BigInt(intervalSec || '300');
    assert(lev >= 1n && totalMargin > 0n, 'invalid leverage or margin');
    assert(count >= 2n && count <= 100n, 'slices must be 2..100');
    assert(interval >= 60n && interval <= 86400n, 'interval must be 60..86400 seconds');
    assert(msg.value >= totalMargin + CRON_GAS_LIMIT, 'init value must cover margin plus cron escrow');

    const cfg = String(cfgAddress || DEFAULT_CFG).toLowerCase();
    const markets = E(cfg).module('markets');
    const vault = E(cfg).module('vault');
    const mkt = asObj(E(markets).get(mid));
    assert(mkt && mkt.state === 'ACTIVE', 'perps market is not active');
    assert(String(mkt.quote || NATIVE).toLowerCase() === NATIVE, 'only native ASE margined perp markets are supported');

    const imBps = BigInt(E(cfg).marketParam(mid, 'initialMarginBps'));
    assert(lev <= BPS / imBps, 'leverage exceeds market maximum');
    const sliceMargin = totalMargin / count;
    assert(sliceMargin > 0n, 'margin per slice is zero');
    assert(sliceMargin * lev >= BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei')), 'slice notional below market minimum');

    E(vault, { value: totalMargin.toString() }).deposit(mid, totalMargin.toString());

    const cronEscrow = msg.value - totalMargin;
    storage.set('owner', msg.sender);
    storage.set('cfg', cfg);
    storage.set('marketId', mid);
    storage.set('poolId', String(mkt.poolId || mid));
    storage.set('token', String(mkt.token || ''));
    storage.set('side', dir);
    storage.set('leverage', lev.toString());
    storage.set('totalMarginWei', totalMargin.toString());
    storage.set('sliceMarginWei', sliceMargin.toString());
    storage.set('spentMarginWei', '0');
    storage.set('slices', count.toString());
    storage.set('legsDone', '0');
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
      template: 'perp-twap',
      marketId: mid,
      side: dir,
      leverage: lev.toString(),
      slices: count.toString(),
      intervalSec: interval.toString(),
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
    const lev = BigInt(storage.get('leverage'));
    const slices = BigInt(storage.get('slices'));
    const done = BigInt(storage.get('legsDone') || '0');
    if (done >= slices) {
      stopCron('twap-complete');
      return 'done';
    }

    const oracle = E(cfg).module('oracle');
    const vault = E(cfg).module('vault');
    const engine = E(cfg).module('engine');
    const mk = asObj(E(oracle).mark(mid));
    if (!mk || mk.healthy !== true) {
      emit('Signal', { signal: 'oracle-unhealthy', marketId: mid });
      return 'oracle-unhealthy';
    }
    const mark = BigInt(mk.price);
    const totalMargin = BigInt(storage.get('totalMarginWei'));
    const spent = BigInt(storage.get('spentMarginWei') || '0');
    const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
    const usableFree = (free * 9950n) / BPS;
    const targetMargin = done + 1n === slices ? totalMargin - spent : BigInt(storage.get('sliceMarginWei'));
    const legMargin = min(targetMargin, usableFree);
    const minNotional = BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei'));
    const notional = legMargin * lev;
    if (legMargin <= 0n || notional < minNotional) {
      stopCron('twap-margin-exhausted');
      return 'stopped';
    }

    const pos = asObj(E(vault).position(msg.contractAddress, mid));
    const curSize = BigInt((pos && pos.sizeWei) || '0');
    const isLong = dir === 'LONG';
    const sizeWei = (notional * SCALE) / mark;
    assert(sizeWei > 0n, 'computed size is zero');
    const wp = worstPx(mark, isLong ? 1n : -1n);
    if (curSize === 0n) {
      E(engine).openMarket(mid, dir, sizeWei.toString(), wp, 'TWAP');
    } else {
      assert((curSize > 0n) === isLong, 'existing position side conflict');
      E(engine).increase(mid, sizeWei.toString(), wp);
    }

    const nextDone = done + 1n;
    storage.set('legsDone', nextDone.toString());
    storage.set('spentMarginWei', (spent + legMargin).toString());
    emit('Fill', {
      marketId: mid,
      side: dir,
      marginWei: legMargin.toString(),
      sizeWei: sizeWei.toString(),
      price: mark.toString(),
      leg: nextDone.toString(),
      slices: slices.toString(),
    });

    if (nextDone >= slices) {
      stopCron('twap-complete');
    }
    return sizeWei.toString();
  },

  closePosition() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    closeAndWithdraw(storage.get('cfg') || DEFAULT_CFG, storage.get('marketId'));
    return true;
  },

  stop() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    if (storage.get('stopped') !== 'true') stopCron('owner-emergency-stop');
    try {
      closeAndWithdraw(storage.get('cfg') || DEFAULT_CFG, storage.get('marketId'));
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
  getTemplate() { return 'perp-twap'; },
  getConfig() {
    return JSON.stringify({
      version: '1',
      template: 'perp-twap',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      side: storage.get('side'),
      leverage: storage.get('leverage'),
      totalMarginWei: storage.get('totalMarginWei'),
      slices: storage.get('slices'),
      intervalSec: storage.get('intervalSec'),
    });
  },
  getStatus() {
    return JSON.stringify({
      owner: storage.get('owner'),
      template: 'perp-twap',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      side: storage.get('side'),
      leverage: storage.get('leverage'),
      stopped: storage.get('stopped'),
      jobId: storage.get('jobId'),
      legsDone: storage.get('legsDone') || '0',
      slices: storage.get('slices'),
      spentMarginWei: storage.get('spentMarginWei') || '0',
      totalMarginWei: storage.get('totalMarginWei'),
      intervalSec: storage.get('intervalSec'),
    });
  },
});
