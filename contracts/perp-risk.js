// Strata template: perp-risk - leveraged position with on-chain Stop-Loss, Take-Profit & Trailing Drawdown for AsePad Perps.
// init(marketId, side, leverage, marginWei, stopLossBps, takeProfitBps, maxDrawdownBps, intervalSec, cfgAddress)

const DEFAULT_CFG = '0x37d25f3a292f0642af72d6f161eafb18c76e16a6';
const CRON = '0x0000000000000000000000000000000000000006';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SCALE = 1000000000000000000n;
const BPS = 10000n;
const SLIPPAGE_BPS = 300n;
const CRON_GAS_LIMIT = 4500000n;

function asObj(v) { return typeof v === 'string' ? JSON.parse(v) : v; }
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
function closeAndWithdraw(cfg, mid, reason) {
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
      reason: reason || 'risk-exit',
    });
  }
  const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
  if (free > 0n) {
    E(vault).withdraw(mid, free.toString());
    emit('VaultWithdrawn', { marketId: mid, amountWei: free.toString() });
  }
}

({
  init(marketId, side, leverage, marginWei, stopLossBps, takeProfitBps, maxDrawdownBps, intervalSec, cfgAddress) {
    assert(!storage.has('owner'), 'already initialised');
    const mid = String(marketId);
    const dir = String(side).toUpperCase();
    assert(dir === 'LONG' || dir === 'SHORT', 'side must be LONG or SHORT');
    const lev = BigInt(leverage);
    const margin = BigInt(marginWei);
    const sl = BigInt(stopLossBps || '0');
    const tp = BigInt(takeProfitBps || '0');
    const dd = BigInt(maxDrawdownBps || '0');
    const interval = BigInt(intervalSec);
    assert(lev >= 1n && margin > 0n, 'invalid leverage or margin');
    assert(sl >= 0n && sl < BPS, 'stop-loss must be 0..9999 bps');
    assert(tp >= 0n && tp <= 50000n, 'take-profit must be 0..50000 bps');
    assert(dd >= 0n && dd < BPS, 'max drawdown must be 0..9999 bps');
    assert(sl > 0n || tp > 0n || dd > 0n, 'enable at least one risk exit guard');
    assert(interval >= 60n && interval <= 86400n, 'interval must be 60..86400 seconds');
    assert(msg.value >= margin + CRON_GAS_LIMIT, 'init value must cover margin plus cron escrow');

    const cfg = String(cfgAddress || DEFAULT_CFG).toLowerCase();
    const markets = E(cfg).module('markets');
    const vault = E(cfg).module('vault');
    const mkt = asObj(E(markets).get(mid));
    assert(mkt && mkt.state === 'ACTIVE', 'perps market is not active');
    assert(String(mkt.quote || NATIVE).toLowerCase() === NATIVE, 'only native ASE margined perp markets are supported');

    const imBps = BigInt(E(cfg).marketParam(mid, 'initialMarginBps'));
    assert(lev <= BPS / imBps, 'leverage exceeds market maximum');
    assert(margin * lev >= BigInt(E(cfg).marketParam(mid, 'minOrderNotionalWei')), 'notional below market minimum');

    E(vault, { value: margin.toString() }).deposit(mid, margin.toString());

    const cronEscrow = msg.value - margin;
    storage.set('owner', msg.sender);
    storage.set('cfg', cfg);
    storage.set('marketId', mid);
    storage.set('poolId', String(mkt.poolId || mid));
    storage.set('token', String(mkt.token || ''));
    storage.set('side', dir);
    storage.set('leverage', lev.toString());
    storage.set('marginWei', margin.toString());
    storage.set('stopLossBps', sl.toString());
    storage.set('takeProfitBps', tp.toString());
    storage.set('maxDrawdownBps', dd.toString());
    storage.set('intervalSec', interval.toString());
    storage.set('entered', 'false');
    storage.set('legs', '0');
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
      template: 'perp-risk',
      marketId: mid,
      side: dir,
      leverage: lev.toString(),
      stopLossBps: sl.toString(),
      takeProfitBps: tp.toString(),
      maxDrawdownBps: dd.toString(),
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
    const sl = BigInt(storage.get('stopLossBps') || '0');
    const tp = BigInt(storage.get('takeProfitBps') || '0');
    const dd = BigInt(storage.get('maxDrawdownBps') || '0');
    const oracle = E(cfg).module('oracle');
    const vault = E(cfg).module('vault');
    const engine = E(cfg).module('engine');

    const mk = asObj(E(oracle).mark(mid));
    if (!mk || mk.healthy !== true) {
      emit('Signal', { signal: 'oracle-unhealthy', marketId: mid });
      return 'oracle-unhealthy';
    }
    const mark = BigInt(mk.price);

    if (storage.get('entered') !== 'true') {
      const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
      const margin = (BigInt(storage.get('marginWei')) < (free * 9950n) / BPS)
        ? BigInt(storage.get('marginWei'))
        : (free * 9950n) / BPS;
      const notional = margin * lev;
      const sizeWei = (notional * SCALE) / mark;
      assert(sizeWei > 0n, 'computed size is zero');
      const isLong = dir === 'LONG';
      E(engine).openMarket(mid, dir, sizeWei.toString(), worstPx(mark, isLong ? 1n : -1n), 'RISK');
      storage.set('entered', 'true');
      storage.set('entryPrice', mark.toString());
      storage.set('bestPrice', mark.toString());
      storage.set('legs', '1');
      emit('Fill', {
        marketId: mid,
        side: dir,
        marginWei: margin.toString(),
        notionalWei: notional.toString(),
        sizeWei: sizeWei.toString(),
        price: mark.toString(),
        reason: 'risk-entry',
      });
      return sizeWei.toString();
    }

    const pos = asObj(E(vault).position(msg.contractAddress, mid));
    const curSize = BigInt((pos && pos.sizeWei) || '0');
    if (curSize === 0n) {
      const free = BigInt(E(vault).freeCollateral(msg.contractAddress, mid) || '0');
      if (free > 0n) E(vault).withdraw(mid, free.toString());
      stopCron('position-already-closed');
      return 'closed';
    }

    const isLong = curSize > 0n;
    const entry = BigInt((pos && pos.entryPrice) || storage.get('entryPrice') || '0');
    let best = BigInt(storage.get('bestPrice') || entry.toString());
    if (isLong ? mark > best : mark < best) {
      best = mark;
      storage.set('bestPrice', best.toString());
    }

    let reason = '';
    if (sl > 0n && (isLong ? mark <= (entry * (BPS - sl)) / BPS : mark >= (entry * (BPS + sl)) / BPS)) {
      reason = 'stop-loss';
    } else if (tp > 0n && (isLong ? mark >= (entry * (BPS + tp)) / BPS : mark <= (entry * (BPS - tp)) / BPS)) {
      reason = 'take-profit';
    } else if (dd > 0n && (isLong ? mark <= (best * (BPS - dd)) / BPS : mark >= (best * (BPS + dd)) / BPS)) {
      reason = 'trailing-drawdown';
    }

    if (reason) {
      closeAndWithdraw(cfg, mid, reason);
      storage.set('legs', String(BigInt(storage.get('legs') || '1') + 1n));
      stopCron(reason);
      return reason;
    }

    emit('Signal', { signal: 'guarding', marketId: mid, mark: mark.toString(), best: best.toString() });
    return 'guarding';
  },

  closePosition() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    closeAndWithdraw(storage.get('cfg') || DEFAULT_CFG, storage.get('marketId'), 'owner-close');
    return true;
  },

  stop() {
    assert(msg.sender === storage.get('owner'), 'not the owner');
    if (storage.get('stopped') !== 'true') stopCron('owner-emergency-stop');
    try {
      closeAndWithdraw(storage.get('cfg') || DEFAULT_CFG, storage.get('marketId'), 'owner-stop');
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
  getTemplate() { return 'perp-risk'; },
  getConfig() {
    return JSON.stringify({
      version: '1',
      template: 'perp-risk',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      side: storage.get('side'),
      leverage: storage.get('leverage'),
      marginWei: storage.get('marginWei'),
      stopLossBps: storage.get('stopLossBps'),
      takeProfitBps: storage.get('takeProfitBps'),
      maxDrawdownBps: storage.get('maxDrawdownBps'),
      intervalSec: storage.get('intervalSec'),
    });
  },
  getStatus() {
    return JSON.stringify({
      owner: storage.get('owner'),
      template: 'perp-risk',
      venue: 'asepad-perps',
      cfg: storage.get('cfg') || DEFAULT_CFG,
      marketId: storage.get('marketId'),
      poolId: storage.get('poolId'),
      token: storage.get('token'),
      side: storage.get('side'),
      leverage: storage.get('leverage'),
      stopped: storage.get('stopped'),
      jobId: storage.get('jobId'),
      entered: storage.get('entered'),
      legs: storage.get('legs') || '0',
      entryPrice: storage.get('entryPrice') || '0',
      bestPrice: storage.get('bestPrice') || '0',
      stopLossBps: storage.get('stopLossBps'),
      takeProfitBps: storage.get('takeProfitBps'),
      maxDrawdownBps: storage.get('maxDrawdownBps'),
      intervalSec: storage.get('intervalSec'),
    });
  },
});
