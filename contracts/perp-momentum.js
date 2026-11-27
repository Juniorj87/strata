// Strata template: perp-momentum - directional long/short momentum bot for AsePad Perps.
// init(marketId, leverage, marginWei, thresholdBps, intervalSec, cfgAddress)

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
      reason: 'momentum-close',
    });
  }
  const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
  if (free > 0n) {
    E(vault).withdraw(mid, free.toString());
    emit('VaultWithdrawn', { marketId: mid, amountWei: free.toString() });
  }
}

({
  init(marketId, leverage, marginWei, thresholdBps, intervalSec, cfgAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const mid = String(marketId);
    const lev = BigInt(leverage);
    const margin = BigInt(marginWei);
    const threshold = BigInt(thresholdBps);
    const interval = BigInt(intervalSec);
    assert(lev >= 1n && margin > 0n, 'invalid leverage or margin');
    assert(threshold >= 1n && threshold <= BPS, 'threshold must be 1..10000 bps');
    assert(interval >= 60n && interval <= 86400n, 'interval must be 60..86400 seconds');
    assert(msg.value >= margin + CRON_GAS_LIMIT, 'init value must cover margin plus cron escrow');

    const cfg = String(cfgAddress || DEFAULT_CFG).toLowerCase();
    const markets = E(cfg).module('markets');
    const vault = E(cfg).module('vault');
    const oracle = E(cfg).module('oracle');
    const mkt = asObj(E(markets).get(mid));
    assert(mkt && mkt.state === 'ACTIVE', 'perps market is not active');
    assert(String(mkt.quote || NATIVE).toLowerCase() === NATIVE, 'only native ASE margined perp markets are supported');
    assert(lev <= BPS / BigInt(E(cfg).marketParam(mid, 'initialMarginBps')), 'leverage exceeds market maximum');
    assert(margin * lev >= BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei')), 'notional below market minimum');

    const mk = asObj(E(oracle).mark(mid));
    assert(mk && mk.healthy === true && BigInt(mk.price || '0') > 0n, 'oracle mark unavailable');

    E(vault, { value: margin.toString() }).deposit(mid, margin.toString());

    const cronEscrow = msg.value - margin;
    storage.set('owner', msg.sender);
    storage.set('cfg', cfg);
    storage.set('marketId', mid);
    storage.set('poolId', String(mkt.poolId || mid));
    storage.set('token', String(mkt.token || ''));
    storage.set('leverage', lev.toString());
    storage.set('marginWei', margin.toString());
    storage.set('thresholdBps', threshold.toString());
    storage.set('intervalSec', interval.toString());
    storage.set('prevMark', String(mk.price));
    storage.set('trades', '0');
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
      template: 'perp-momentum',
      marketId: mid,
      leverage: lev.toString(),
      thresholdBps: threshold.toString(),
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
    const lev = BigInt(storage.get('leverage'));
    const threshold = BigInt(storage.get('thresholdBps'));
    const oracle = E(cfg).module('oracle');
    const vault = E(cfg).module('vault');
    const engine = E(cfg).module('engine');

    const mk = asObj(E(oracle).mark(mid));
    if (!mk || mk.healthy !== true) {
      emit('Signal', { signal: 'oracle-unhealthy', marketId: mid });
      return 'oracle-unhealthy';
    }
    const mark = BigInt(mk.price);
    const prev = BigInt(storage.get('prevMark') || mark.toString());
    storage.set('prevMark', mark.toString());
    const deltaBps = prev > 0n ? ((mark - prev) * BPS) / prev : 0n;

    const pos = asObj(E(vault).position(msg.contractAddress, mid));
    const curSize = BigInt((pos && pos.sizeWei) || '0');

    if (deltaBps >= threshold) {
      if (curSize < 0n) {
        E(engine).close(mid, worstPx(mark, 1n));
        storage.set('trades', String(BigInt(storage.get('trades') || '0') + 1n));
        emit('Fill', { marketId: mid, side: 'close-short', sizeDelta: (-curSize).toString(), price: mark.toString(), deltaBps: deltaBps.toString() });
        return 'closed-short';
      }
      if (curSize === 0n) {
        const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
        const margin = min(BigInt(storage.get('marginWei')), (free * 9950n) / BPS);
        const notional = margin * lev;
        const sizeWei = (notional * SCALE) / mark;
        if (margin > 0n && notional >= BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei')) && sizeWei > 0n) {
          E(engine).openMarket(mid, 'LONG', sizeWei.toString(), worstPx(mark, 1n), 'MOMENTUM');
          storage.set('trades', String(BigInt(storage.get('trades') || '0') + 1n));
          emit('Fill', { marketId: mid, side: 'LONG', sizeWei: sizeWei.toString(), price: mark.toString(), deltaBps: deltaBps.toString() });
          return 'opened-long';
        }
      }
    } else if (deltaBps <= -threshold) {
      if (curSize > 0n) {
        E(engine).close(mid, worstPx(mark, -1n));
        storage.set('trades', String(BigInt(storage.get('trades') || '0') + 1n));
        emit('Fill', { marketId: mid, side: 'close-long', sizeDelta: (-curSize).toString(), price: mark.toString(), deltaBps: deltaBps.toString() });
        return 'closed-long';
      }
      if (curSize === 0n) {
        const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
        const margin = min(BigInt(storage.get('marginWei')), (free * 9950n) / BPS);
        const notional = margin * lev;
        const sizeWei = (notional * SCALE) / mark;
        if (margin > 0n && notional >= BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei')) && sizeWei > 0n) {
          E(engine).openMarket(mid, 'SHORT', sizeWei.toString(), worstPx(mark, -1n), 'MOMENTUM');
          storage.set('trades', String(BigInt(storage.get('trades') || '0') + 1n));
          emit('Fill', { marketId: mid, side: 'SHORT', sizeWei: sizeWei.toString(), price: mark.toString(), deltaBps: deltaBps.toString() });
          return 'opened-short';
        }
      }
    }

    emit('Signal', { signal: 'hold', marketId: mid, deltaBps: deltaBps.toString(), mark: mark.toString() });
    return 'hold';
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
  getTemplate() { return 'perp-momentum'; },
  getConfig() {
    return JSON.stringify({
      version: '1',
      template: 'perp-momentum',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      leverage: storage.get('leverage'),
      marginWei: storage.get('marginWei'),
      thresholdBps: storage.get('thresholdBps'),
      intervalSec: storage.get('intervalSec'),
    });
  },
  getStatus() {
    return JSON.stringify({
      owner: storage.get('owner'),
      template: 'perp-momentum',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      leverage: storage.get('leverage'),
      stopped: storage.get('stopped'),
      jobId: storage.get('jobId'),
      trades: storage.get('trades') || '0',
      marginWei: storage.get('marginWei'),
      thresholdBps: storage.get('thresholdBps'),
      intervalSec: storage.get('intervalSec'),
    });
  },
});
