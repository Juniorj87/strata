// Strata template: perp-dca - leveraged recurring DCA bot for AsePad Perps.
// init(marketId, side, leverage, marginPerLegWei, totalMarginWei, intervalSec, tpBps, slBps, cfgAddress)
// msg.value must include totalMarginWei + cron escrow (>= 4500000 wei).

const DEFAULT_CFG = '0x37d25f3a292f0642af72d6f161eafb18c76e16a6';
const CRON = '0x0000000000000000000000000000000000000006';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SCALE = 1000000000000000000n;
const BPS = 10000n;
const SLIPPAGE_BPS = 300n;
const CRON_GAS_LIMIT = 4500000n;

function asObj(v) { return typeof v === 'string' ? JSON.parse(v) : v; }
function min(a, b) { return a < b ? a : b; }
function abs(v) { return v < 0n ? -v : v; }
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
    const closeDir = curSize > 0n ? -1n : 1n;
    E(engine).close(mid, worstPx(mark, closeDir));
    emit('Fill', {
      marketId: mid,
      side: curSize > 0n ? 'close-long' : 'close-short',
      sizeDelta: (-curSize).toString(),
      price: mark.toString(),
      reason: 'perp-close',
    });
  }
  const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
  if (free > 0n) {
    E(vault).withdraw(mid, free.toString());
    emit('VaultWithdrawn', { marketId: mid, amountWei: free.toString() });
  }
}

({
  init(marketId, side, leverage, marginPerLegWei, totalMarginWei, intervalSec, tpBps, slBps, cfgAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const mid = String(marketId);
    const dir = String(side).toUpperCase();
    assert(dir === 'LONG' || dir === 'SHORT', 'side must be LONG or SHORT');
    const lev = BigInt(leverage);
    const legMargin = BigInt(marginPerLegWei);
    const totalMargin = BigInt(totalMarginWei);
    const interval = BigInt(intervalSec);
    const tp = BigInt(tpBps || '0');
    const sl = BigInt(slBps || '0');
    assert(lev >= 1n, 'leverage must be at least 1x');
    assert(legMargin > 0n && totalMargin >= legMargin, 'invalid margin per leg or total margin');
    assert(interval >= 60n && interval <= 86400n, 'interval must be 60..86400 seconds');
    assert(tp >= 0n && tp <= 50000n, 'take-profit must be 0..50000 bps');
    assert(sl >= 0n && sl < BPS, 'stop-loss must be 0..9999 bps');
    assert(msg.value >= totalMargin + CRON_GAS_LIMIT, 'init value must cover margin budget plus cron escrow');

    const cfg = String(cfgAddress || DEFAULT_CFG).toLowerCase();
    const markets = E(cfg).module('markets');
    const vault = E(cfg).module('vault');
    const mkt = asObj(E(markets).get(mid));
    assert(mkt && mkt.state === 'ACTIVE', 'perps market is not active');
    const quote = String(mkt.quote || NATIVE).toLowerCase();
    assert(quote === NATIVE, 'only native ASE margined perp markets are supported');

    const imBps = BigInt(E(cfg).marketParam(mid, 'initialMarginBps'));
    const maxLev = BPS / imBps;
    assert(lev <= maxLev, 'leverage exceeds market maximum');
    const minNotional = BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei'));
    assert(legMargin * lev >= minNotional, 'margin * leverage below market minimum notional');

    E(vault, { value: totalMargin.toString() }).deposit(mid, totalMargin.toString());

    const cronEscrow = msg.value - totalMargin;
    storage.set('owner', msg.sender);
    storage.set('cfg', cfg);
    storage.set('marketId', mid);
    storage.set('poolId', String(mkt.poolId || mid));
    storage.set('token', String(mkt.token || ''));
    storage.set('side', dir);
    storage.set('leverage', lev.toString());
    storage.set('marginPerLegWei', legMargin.toString());
    storage.set('totalMarginWei', totalMargin.toString());
    storage.set('spentMarginWei', '0');
    storage.set('legs', '0');
    storage.set('intervalSec', interval.toString());
    storage.set('tpBps', tp.toString());
    storage.set('slBps', sl.toString());
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
      template: 'perp-dca',
      marketId: mid,
      side: dir,
      leverage: lev.toString(),
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
    const tp = BigInt(storage.get('tpBps') || '0');
    const sl = BigInt(storage.get('slBps') || '0');
    const oracle = E(cfg).module('oracle');
    const vault = E(cfg).module('vault');
    const engine = E(cfg).module('engine');

    const mk = asObj(E(oracle).mark(mid));
    if (!mk || mk.healthy !== true) {
      emit('Signal', { signal: 'oracle-unhealthy', marketId: mid, reason: mk ? mk.reason : 'no-mark' });
      return 'oracle-unhealthy';
    }
    const mark = BigInt(mk.price);
    const pos = asObj(E(vault).position(msg.contractAddress, mid));
    const curSize = BigInt((pos && pos.sizeWei) || '0');

    // Optional TP/SL monitor on open position.
    if (curSize !== 0n && (tp > 0n || sl > 0n)) {
      const entry = BigInt((pos && pos.entryPrice) || '0');
      if (entry > 0n) {
        const isLong = curSize > 0n;
        const tpHit = tp > 0n && (isLong ? mark >= (entry * (BPS + tp)) / BPS : mark <= (entry * (BPS - tp)) / BPS);
        const slHit = sl > 0n && (isLong ? mark <= (entry * (BPS - sl)) / BPS : mark >= (entry * (BPS + sl)) / BPS);
        if (tpHit || slHit) {
          closeAndWithdraw(cfg, mid);
          stopCron(tpHit ? 'take-profit-hit' : 'stop-loss-hit');
          return tpHit ? 'take-profit-closed' : 'stop-loss-closed';
        }
      }
    }

    const spent = BigInt(storage.get('spentMarginWei') || '0');
    const totalMargin = BigInt(storage.get('totalMarginWei'));
    const remaining = totalMargin - spent;
    if (remaining <= 0n) {
      if (tp === 0n && sl === 0n || curSize === 0n) {
        stopCron('perp-dca-budget-exhausted');
        return 'stopped';
      }
      emit('Signal', { signal: 'monitoring-exits', marketId: mid, mark: mark.toString() });
      return 'monitoring';
    }

    const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
    const usableFree = (free * 9950n) / BPS;
    const legMargin = min(BigInt(storage.get('marginPerLegWei')), min(remaining, usableFree));
    const minNotional = BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei'));
    const notional = legMargin * lev;
    if (legMargin <= 0n || notional < minNotional) {
      if (curSize === 0n || (tp === 0n && sl === 0n)) {
        stopCron('insufficient-free-margin');
        return 'stopped';
      }
      emit('Signal', { signal: 'low-margin-monitoring', marketId: mid, freeWei: free.toString() });
      return 'monitoring';
    }

    const sizeWei = (notional * SCALE) / mark;
    assert(sizeWei > 0n, 'computed size is zero');
    const isLong = dir === 'LONG';
    const wp = worstPx(mark, isLong ? 1n : -1n);
    if (curSize === 0n) {
      E(engine).openMarket(mid, dir, sizeWei.toString(), wp, 'DCA');
    } else {
      assert((curSize > 0n) === isLong, 'existing position side conflict');
      E(engine).increase(mid, sizeWei.toString(), wp);
    }

    const nextLegs = BigInt(storage.get('legs') || '0') + 1n;
    const nextSpent = spent + legMargin;
    storage.set('legs', nextLegs.toString());
    storage.set('spentMarginWei', nextSpent.toString());
    emit('Fill', {
      marketId: mid,
      side: dir,
      marginWei: legMargin.toString(),
      notionalWei: notional.toString(),
      sizeWei: sizeWei.toString(),
      price: mark.toString(),
      leg: nextLegs.toString(),
    });

    const remainingAfter = totalMargin > nextSpent ? totalMargin - nextSpent : 0n;
    const canRunAnotherLeg = remainingAfter > 0n && ((remainingAfter * 9950n) / BPS) * lev >= minNotional;
    if (!canRunAnotherLeg && tp === 0n && sl === 0n) {
      stopCron('perp-dca-budget-exhausted');
    }
    return sizeWei.toString();
  },

  closePosition() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    const cfg = storage.get('cfg') || DEFAULT_CFG;
    closeAndWithdraw(cfg, storage.get('marketId'));
    return true;
  },

  stop() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    if (storage.get('stopped') !== 'true') stopCron('owner-emergency-stop');
    try {
      closeAndWithdraw(storage.get('cfg') || DEFAULT_CFG, storage.get('marketId'));
    } catch (_err) {
      // Cron is already cancelled; owner can retry closePosition() when oracle recovers.
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
  getTemplate() { return 'perp-dca'; },
  getConfig() {
    return JSON.stringify({
      version: '1',
      template: 'perp-dca',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      side: storage.get('side'),
      leverage: storage.get('leverage'),
      marginPerLegWei: storage.get('marginPerLegWei'),
      totalMarginWei: storage.get('totalMarginWei'),
      intervalSec: storage.get('intervalSec'),
      tpBps: storage.get('tpBps'),
      slBps: storage.get('slBps'),
    });
  },
  getStatus() {
    const total = BigInt(storage.get('totalMarginWei') || '0');
    const spent = BigInt(storage.get('spentMarginWei') || '0');
    return JSON.stringify({
      owner: storage.get('owner'),
      template: 'perp-dca',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      side: storage.get('side'),
      leverage: storage.get('leverage'),
      stopped: storage.get('stopped'),
      jobId: storage.get('jobId'),
      legs: storage.get('legs') || '0',
      spentMarginWei: spent.toString(),
      totalMarginWei: total.toString(),
      marginPerLegWei: storage.get('marginPerLegWei'),
      remainingMarginWei: (total > spent ? total - spent : 0n).toString(),
      intervalSec: storage.get('intervalSec'),
      tpBps: storage.get('tpBps') || '0',
      slBps: storage.get('slBps') || '0',
    });
  },
});
