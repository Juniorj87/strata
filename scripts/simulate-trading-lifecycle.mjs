import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AMM = '0xcc1c9029cfe92004bca76c013cef2fdaa75351a2';
const CRON = '0x0000000000000000000000000000000000000006';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TOKEN = '0x1111111111111111111111111111111111111111';
const OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CONTRACT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_DECIMALS = 6;
const UNIT = 10n ** 18n;

function makePool(tokenIs0 = true, priceAseWei = 5_000_000_000_000_000n) {
  const tokenReserve = 1_000n * (10n ** BigInt(TOKEN_DECIMALS));
  const aseReserve = (priceAseWei * tokenReserve) / (10n ** BigInt(TOKEN_DECIMALS));
  return {
    id: '7',
    token0: tokenIs0 ? TOKEN : NATIVE,
    token1: tokenIs0 ? NATIVE : TOKEN,
    reserve0: (tokenIs0 ? tokenReserve : aseReserve).toString(),
    reserve1: (tokenIs0 ? aseReserve : tokenReserve).toString(),
    price0Cumulative: '1000000000000000000',
    price1Cumulative: '2000000000000000000',
    lastTs: '1700000000000',
  };
}

function setPoolPrice(pool, priceAseWei) {
  const tokenIs0 = pool.token0.toLowerCase() === TOKEN;
  const tokenReserve = 1_000n * (10n ** BigInt(TOKEN_DECIMALS));
  const aseReserve = (priceAseWei * tokenReserve) / (10n ** BigInt(TOKEN_DECIMALS));
  pool.reserve0 = (tokenIs0 ? tokenReserve : aseReserve).toString();
  pool.reserve1 = (tokenIs0 ? aseReserve : tokenReserve).toString();
}

function createRuntime(contractName, pool, options = {}) {
  const store = new Map();
  const events = [];
  const jobs = new Map();
  const trades = [];
  const state = {
    tokenBalance: BigInt(options.tokenBalance ?? 0),
    nativeBalance: 0n,
    aseEarned: 0n,
    allowance: 0n,
  };
  let nextJob = 1;
  let failSwapsRemaining = Number(options.failSwaps ?? 0);
  const storage = {
    has: (key) => store.has(String(key)),
    get: (key) => store.get(String(key)),
    set: (key, value) => store.set(String(key), String(value)),
  };
  const ctx = {
    storage,
    msg: { sender: OWNER, contractAddress: CONTRACT, value: 0n },
    chain: { blockTimestamp: 1_700_000_000_000n },
    assert(condition, message = 'assertion failed') { if (!condition) throw new Error(message); },
    emit(name, args) { events.push({ name, args }); },
    transfer(_to, amount) {
      const value = BigInt(amount);
      assert.ok(state.nativeBalance >= value, 'native balance too low in harness');
      state.nativeBalance -= value;
    },
    E(address, callOptions = {}) {
      const target = String(address).toLowerCase();
      if (target === AMM) {
        return {
          getPool() { return JSON.stringify(pool); },
          consult() { return JSON.stringify(pool); },
          quote(_poolId, tokenIn, amountIn) {
            assert.ok([TOKEN, NATIVE].includes(String(tokenIn).toLowerCase()), 'unsupported token in AMM quote');
            const amount = BigInt(amountIn);
            return (String(tokenIn).toLowerCase() === NATIVE ? amount * 2n : amount * 3n).toString();
          },
          swapExactIn(_poolId, tokenIn, amountIn, minOut) {
            if (failSwapsRemaining > 0) { failSwapsRemaining -= 1; throw new Error('simulated transient swap failure'); }
            const input = BigInt(amountIn);
            const nativeIn = String(tokenIn).toLowerCase() === NATIVE;
            const output = nativeIn ? input * 2n : input * 3n;
            assert.ok(output >= BigInt(minOut), 'minimum output not met');
            if (nativeIn) {
              assert.equal(BigInt(callOptions.value ?? 0), input, 'native swap value mismatch');
              assert.ok(state.nativeBalance >= input, 'not enough native ASE budget');
              state.nativeBalance -= input;
              state.tokenBalance += output;
            } else {
              assert.ok(state.tokenBalance >= input, 'not enough token inventory');
              state.tokenBalance -= input;
              state.aseEarned += output;
            }
            trades.push({ tokenIn: nativeIn ? NATIVE : TOKEN, amountIn: input, amountOut: output });
            return output.toString();
          },
        };
      }
      if (target === CRON) {
        return {
          schedule(_target, _method, _args, _nextRunAt, _interval, maxRuns, gasLimit) {
            const id = String(nextJob++);
            jobs.set(id, { id, maxRuns: String(maxRuns), gasLimit: String(gasLimit) });
            state.nativeBalance -= BigInt(callOptions.value ?? 0);
            return id;
          },
          getJob(id) { return jobs.has(String(id)) ? JSON.stringify(jobs.get(String(id))) : null; },
          cancel(id) { jobs.delete(String(id)); return true; },
        };
      }
      if (target === TOKEN) {
        return {
          balanceOf() { return state.tokenBalance.toString(); },
          approve(_spender, amount) { state.allowance = BigInt(amount); return true; },
          transfer(_to, amount) { const n = BigInt(amount); assert.ok(state.tokenBalance >= n); state.tokenBalance -= n; return true; },
        };
      }
      throw new Error(`unexpected contract call: ${address}`);
    },
  };
  const source = readFileSync(resolve(ROOT, 'contracts', `${contractName}.js`), 'utf8');
  const contract = vm.runInNewContext(source, ctx, { filename: `${contractName}.js` });
  function setSender(sender, value = 0n) { ctx.msg.sender = sender; ctx.msg.value = BigInt(value); }
  function status() { return JSON.parse(contract.getStatus()); }
  // Model chain transaction atomicity: a reverted contract call must not leave
  // storage, balances, events, trades or Cron changes behind.
  function transact(method, ...args) {
    const storageSnapshot = new Map(store);
    const jobsSnapshot = new Map(jobs);
    const stateSnapshot = { ...state };
    const eventLength = events.length;
    const tradeLength = trades.length;
    try { return contract[method](...args); }
    catch (error) {
      store.clear(); for (const [key, value] of storageSnapshot) store.set(key, value);
      jobs.clear(); for (const [key, value] of jobsSnapshot) jobs.set(key, value);
      Object.assign(state, stateSnapshot);
      events.length = eventLength;
      trades.length = tradeLength;
      throw error;
    }
  }
  return { contract, state, events, jobs, trades, store, ctx, setSender, status, transact };
}

function initPriceTemplate(name, tokenIs0) {
  const pool = makePool(tokenIs0);
  const runtime = createRuntime(name, pool);
  runtime.state.nativeBalance = 100n * UNIT;
  runtime.setSender(OWNER, 100n * UNIT);
  if (name === 'grid') runtime.contract.init('7', TOKEN, '100', '2', '100', '200', String(UNIT), String(2n * UNIT), String(TOKEN_DECIMALS));
  if (name === 'risk-managed') runtime.contract.init('7', TOKEN, '10', '20', String(TOKEN_DECIMALS), String(UNIT), String(UNIT), '500', '1000', '800', '300');
  if (name === 'scale') runtime.contract.init('7', TOKEN, '60', '20', String(TOKEN_DECIMALS), '1000', '3', '300');
  if (name === 'limit-exit') runtime.contract.init('7', TOKEN, '20', '60', String(TOKEN_DECIMALS), '1000', '300');
  return runtime;
}

// Price-triggered strategies must read the same ASE/token price whichever
// canonical side ordering Auras returned for the pool.
for (const name of ['grid', 'risk-managed', 'scale', 'limit-exit']) {
  const forward = initPriceTemplate(name, true);
  const reverse = initPriceTemplate(name, false);
  const key = name === 'grid' ? 'center' : name === 'risk-managed' ? 'initialPriceAseWei' : name === 'scale' ? 'startPriceAseWei' : 'referencePriceAseWei';
  assert.equal(forward.store.get(key), '5000000000000000', `${name}: token0 price`);
  assert.equal(reverse.store.get(key), '5000000000000000', `${name}: token1 price`);
}

// Momentum Signal resolves local pool/token state before reading the cumulative side.
for (const tokenIs0 of [true, false]) {
  const pool = makePool(tokenIs0);
  const signal = createRuntime('auras-momentum-signal', pool);
  signal.state.nativeBalance = 400_000n;
  signal.setSender(OWNER, 400_000n);
  signal.contract.init('7', TOKEN, '100', '60');
  const expectedKey = tokenIs0 ? 'price0Cumulative' : 'price1Cumulative';
  signal.setSender(CRON);
  signal.transact('tick');
  assert.equal(signal.store.get('lastCumulative'), pool[expectedKey], 'Momentum Signal reads the ARC-20 cumulative side');
  pool[expectedKey] = (BigInt(pool[expectedKey]) + 60_000_000n).toString();
  pool.lastTs = (BigInt(pool.lastTs) + 60_000n).toString();
  signal.setSender(CRON);
  signal.transact('tick');
  pool[expectedKey] = (BigInt(pool[expectedKey]) + 120_000_000n).toString();
  pool.lastTs = (BigInt(pool.lastTs) + 60_000n).toString();
  signal.setSender(CRON);
  signal.transact('tick');
  assert.equal(signal.events.filter((event) => event.name === 'Signal').at(-1).args.signal, 'sell', 'Momentum Signal evaluates cumulative TWAP drift');
}

// Grid can execute both buy and sell directions and caps the sell reserve.
for (const tokenIs0 of [true, false]) {
  const pool = makePool(tokenIs0);
  const grid = createRuntime('grid', pool, { tokenBalance: 200n });
  const buyBudget = 2n * UNIT;
  grid.state.nativeBalance = buyBudget + 800_000n;
  grid.setSender(OWNER, buyBudget + 800_000n);
  grid.contract.init('7', TOKEN, '100', '2', '100', '200', String(UNIT), String(buyBudget), String(TOKEN_DECIMALS));
  setPoolPrice(pool, 4_000_000_000_000_000n);
  grid.setSender(CRON);
  grid.transact('tick');
  assert.equal(grid.events.filter((e) => e.name === 'Fill' && e.args.side === 'buy').length, 1, 'Grid buy should execute');
  setPoolPrice(pool, 7_000_000_000_000_000n);
  grid.setSender(CRON);
  grid.transact('tick');
  assert.equal(grid.events.filter((e) => e.name === 'Fill' && e.args.side === 'sell').length, 1, 'Grid sell should execute');
  assert.equal(grid.status().sellSpentWei, '100', 'Grid sell budget tracked');
}

// A failed post-init token funding should stop the Grid at its first scheduled tick.
{
  const pool = makePool(true);
  const grid = createRuntime('grid', pool, { tokenBalance: 0n });
  const buyBudget = 2n * UNIT;
  grid.state.nativeBalance = buyBudget + 800_000n;
  grid.setSender(OWNER, buyBudget + 800_000n);
  grid.contract.init('7', TOKEN, '100', '2', '100', '200', String(UNIT), String(buyBudget), String(TOKEN_DECIMALS));
  grid.setSender(CRON);
  assert.equal(grid.transact('tick'), 'stopped');
  assert.equal(grid.status().stopped, 'true');
  assert.equal(grid.jobs.size, 0, 'underfunded Grid cancels Cron');
}

// DCA spends the exact budget, including a smaller final buy, then cancels.
{
  const pool = makePool(false);
  const dca = createRuntime('dca', pool);
  const budget = 25n * UNIT;
  dca.state.nativeBalance = budget + 700_000n;
  dca.setSender(OWNER, budget + 700_000n);
  dca.contract.init('7', TOKEN, String(10n * UNIT), String(budget), '60');
  const job = dca.status().jobId;
  const amounts = [];
  for (let i = 0; i < 3; i += 1) {
    dca.setSender(CRON);
    dca.transact('tick');
    amounts.push(dca.trades.at(-1).amountIn.toString());
    dca.ctx.chain.blockTimestamp += 60_000n;
  }
  assert.deepEqual(amounts, [String(10n * UNIT), String(10n * UNIT), String(5n * UNIT)]);
  assert.equal(dca.status().spentAseWei, String(budget));
  assert.equal(dca.status().legs, '3');
  assert.equal(dca.status().stopped, 'true');
  assert.equal(dca.jobs.has(job), false, 'DCA cancels Cron after exhausting budget');
}

// TWAP retries are left to Cron on revert: maxRuns=0 and only success completion cancels.
{
  const pool = makePool(true);
  const twap = createRuntime('twap', pool, { tokenBalance: 1_000n, failSwaps: 1 });
  twap.state.nativeBalance = 900_000n;
  twap.setSender(OWNER, 900_000n);
  twap.contract.init('7', TOKEN, '1000', '3');
  const job = twap.status().jobId;
  assert.equal(twap.jobs.get(job).maxRuns, '0', 'TWAP keeps retry budget independent of max-run count');
  const amounts = [];
  twap.setSender(CRON);
  assert.throws(() => twap.transact('tick'), /simulated transient swap failure/);
  assert.equal(twap.status().legsDone, '0', 'failed TWAP leg rolls back');
  assert.equal(twap.status().stopped, 'false', 'failed TWAP leg remains retryable');
  assert.ok(twap.jobs.has(job), 'failed TWAP leg keeps the Cron job');
  for (let i = 0; i < 3; i += 1) {
    twap.setSender(CRON);
    twap.transact('tick');
    amounts.push(twap.trades.at(-1).amountIn.toString());
  }
  assert.deepEqual(amounts, ['333', '333', '334']);
  assert.equal(twap.status().remainingTokenWei, '0');
  assert.equal(twap.status().stopped, 'true');
  assert.equal(twap.jobs.has(job), false, 'TWAP self-cancels after final successful slice');
}

// Risk Manager latches an exit trigger and honours the maximum trade size.
{
  const pool = makePool(false);
  const position = 20n * (10n ** BigInt(TOKEN_DECIMALS));
  const orderSize = 10n * (10n ** BigInt(TOKEN_DECIMALS));
  const risk = createRuntime('risk-managed', pool, { tokenBalance: position });
  risk.state.nativeBalance = 900_000n;
  risk.setSender(OWNER, 900_000n);
  risk.contract.init('7', TOKEN, String(orderSize), String(position), String(TOKEN_DECIMALS), '5000000000000000', '0', '500', '0', '0', '300');
  setPoolPrice(pool, 4_500_000_000_000_000n);
  risk.setSender(CRON);
  risk.transact('tick');
  assert.equal(risk.status().pendingExitReason, 'stop-loss');
  assert.equal(risk.status().soldTokenWei, String(orderSize), 'risk exit is capped at maximum trade size');
  assert.equal(risk.status().stopped, 'false', 'risk exit continues while allocation remains');
  setPoolPrice(pool, 8_000_000_000_000_000n); // a price rebound must not cancel a latched exit
  risk.setSender(CRON);
  risk.transact('tick');
  assert.equal(risk.status().soldTokenWei, String(position));
  assert.equal(risk.status().stopped, 'true', 'risk exit cancels after the declared allocation is sold');
}

// Take-profit and sampled drawdown each latch the staged exit independently.
for (const rule of ['take-profit', 'max-drawdown']) {
  const pool = makePool(true);
  const position = 20n * (10n ** BigInt(TOKEN_DECIMALS));
  const orderSize = 10n * (10n ** BigInt(TOKEN_DECIMALS));
  const risk = createRuntime('risk-managed', pool, { tokenBalance: position });
  risk.state.nativeBalance = 900_000n;
  risk.setSender(OWNER, 900_000n);
  const takeProfit = rule === 'take-profit' ? '1000' : '0';
  const maxDrawdown = rule === 'max-drawdown' ? '800' : '0';
  const costBasis = rule === 'take-profit' ? '5000000000000000' : String(UNIT);
  risk.contract.init('7', TOKEN, String(orderSize), String(position), String(TOKEN_DECIMALS), costBasis, '0', '0', takeProfit, maxDrawdown, '300');
  setPoolPrice(pool, rule === 'take-profit' ? 5_600_000_000_000_000n : 4_500_000_000_000_000n);
  risk.setSender(CRON);
  risk.transact('tick');
  assert.equal(risk.status().pendingExitReason, rule, `${rule} should latch the staged exit`);
  assert.equal(risk.status().soldTokenWei, String(orderSize), `${rule} exits no more than one trade size per tick`);
}

// Daily realised-loss cap pauses the strategy before an additional losing sale.
{
  const pool = makePool(false);
  const position = 20n * (10n ** BigInt(TOKEN_DECIMALS));
  const orderSize = 10n * (10n ** BigInt(TOKEN_DECIMALS));
  const risk = createRuntime('risk-managed', pool, { tokenBalance: position });
  risk.state.nativeBalance = 900_000n;
  risk.setSender(OWNER, 900_000n);
  risk.contract.init('7', TOKEN, String(orderSize), String(position), String(TOKEN_DECIMALS), String(5n * UNIT), String(UNIT), '0', '0', '0', '300');
  risk.setSender(CRON);
  assert.equal(risk.transact('tick'), 'daily-realised-loss-limit');
  assert.equal(risk.status().stopped, 'true');
  assert.equal(risk.status().soldTokenWei, '0', 'daily loss guard stops new sells rather than liquidating inventory');
  assert.equal(risk.state.tokenBalance, position, 'owner inventory remains recoverable after pause');
}

// Scale only runs one swap even when current price has crossed every ladder step.
{
  const pool = makePool(false);
  const scale = createRuntime('scale', pool, { tokenBalance: 60n });
  scale.state.nativeBalance = 900_000n;
  scale.setSender(OWNER, 900_000n);
  scale.contract.init('7', TOKEN, '60', '20', String(TOKEN_DECIMALS), '1000', '3', '300');
  setPoolPrice(pool, 9_000_000_000_000_000n);
  scale.setSender(CRON);
  scale.transact('tick');
  assert.equal(scale.events.filter((e) => e.name === 'Fill').length, 1, 'Scale is limited to one fill per tick');
  assert.equal(scale.status().completedLevels, '1');
}

// Static guards for accounting completeness and pool-side-aware pool listing.
const registry = readFileSync(resolve(ROOT, 'src/lib/registry.ts'), 'utf8');
const pnl = readFileSync(resolve(ROOT, 'src/components/StrategyPnlPanel.tsx'), 'utf8');
const rpc = readFileSync(resolve(ROOT, 'src/lib/rpc.ts'), 'utf8');
assert.match(registry, /historyComplete: Boolean\([\s\S]*accounting\.receiptsResolved[\s\S]*!accounting\.capped[\s\S]*fills\.length >= contractTrades[\s\S]*transferHistoryComplete[\s\S]*\)/);
assert.match(registry, /getAddressTransfers\(hex, 100\)/);
assert.match(pnl, /strategy\.historyComplete && strategy\.fillEvents\.length === strategy\.trades/);
assert.match(pnl, /strategy\.tokenTransfers/);
assert.match(pnl, /unmatchedOutbound/);
assert.match(rpc, /const isAsePair = \(t0 === NATIVE && t1 !== NATIVE\) \|\| \(t1 === NATIVE && t0 !== NATIVE\)/);
assert.match(registry, /const amt = 10n \*\* BigInt\(tokenDecimals\)/);

// ── AsePad Perps contract simulation harness ─────────────────────────────────
const PERPS_CFG = '0x37d25f3a292f0642af72d6f161eafb18c76e16a6';
const PERPS_MARKETS = '0x71c380f6e384af3513a194e3fde97a2c9991e77d';
const PERPS_VAULT = '0x1449cbdaf9e42f45b7d5c655ad6322b79d02123a';
const PERPS_ENGINE = '0x36fc2b3b9a705f78cb5a560b057c4daeaa9b3325';
const PERPS_ORACLE = '0xd5267504381a2160ff9a64f2f2b97cb174963e20';

function createPerpRuntime(contractName, initialMark = 2n * UNIT) {
  const store = new Map();
  const events = [];
  const jobs = new Map();
  const engineOps = [];
  let nextJob = 1;
  const market = {
    mark: BigInt(initialMark),
    healthy: true,
    collateral: 0n,
    usedMargin: 0n,
    sizeWei: 0n,
    entryPrice: 0n,
    nativeBalance: 0n,
    withdrawnToOwner: 0n,
  };
  const storage = {
    has: (key) => store.has(String(key)),
    get: (key) => store.get(String(key)),
    set: (key, value) => store.set(String(key), String(value)),
  };
  const ctx = {
    storage,
    msg: { sender: OWNER, contractAddress: CONTRACT, value: 0n },
    chain: { blockTimestamp: 1_700_000_000_000n },
    assert(condition, message = 'assertion failed') { if (!condition) throw new Error(message); },
    emit(name, args) { events.push({ name, args }); },
    transfer(_to, amount) {
      const value = BigInt(amount);
      assert.ok(market.nativeBalance >= value, 'contract ASE balance too low');
      market.nativeBalance -= value;
      market.withdrawnToOwner += value;
    },
    E(address, callOptions = {}) {
      const target = String(address).toLowerCase();
      if (target === PERPS_CFG) {
        return {
          module(name) {
            if (name === 'markets') return PERPS_MARKETS;
            if (name === 'vault') return PERPS_VAULT;
            if (name === 'engine') return PERPS_ENGINE;
            if (name === 'oracle') return PERPS_ORACLE;
            throw new Error(`unknown perps module ${name}`);
          },
          marketParam(_mid, key) {
            if (key === 'initialMarginBps') return '1000'; // 10x max
            if (key === 'minOrderNotionalWei') return String(UNIT / 10n);
            return '0';
          },
        };
      }
      if (target === PERPS_MARKETS) {
        return {
          get(mid) {
            return JSON.stringify({ id: String(mid), state: 'ACTIVE', quote: NATIVE, poolId: '1', token: TOKEN });
          },
        };
      }
      if (target === PERPS_ORACLE) {
        return {
          mark() { return JSON.stringify({ healthy: market.healthy, price: market.mark.toString() }); },
        };
      }
      if (target === PERPS_VAULT) {
        return {
          deposit(_mid, amountWei) {
            const amt = BigInt(amountWei);
            assert.equal(BigInt(callOptions.value ?? 0), amt, 'vault deposit value mismatch');
            assert.ok(market.nativeBalance >= amt, 'insufficient native balance for deposit');
            market.nativeBalance -= amt;
            market.collateral += amt;
          },
          withdraw(_mid, amountWei) {
            const amt = BigInt(amountWei);
            const free = market.collateral > market.usedMargin ? market.collateral - market.usedMargin : 0n;
            assert.ok(amt <= free, 'cannot withdraw locked margin');
            market.collateral -= amt;
            market.nativeBalance += amt;
          },
          freeCollateral() {
            const free = market.collateral > market.usedMargin ? market.collateral - market.usedMargin : 0n;
            return free.toString();
          },
          position() {
            return JSON.stringify({ sizeWei: market.sizeWei.toString(), entryPrice: market.entryPrice.toString() });
          },
        };
      }
      if (target === PERPS_ENGINE) {
        return {
          openMarket(_mid, side, sizeWei, _worstPx, tag) {
            const sz = BigInt(sizeWei);
            const isLong = String(side).toUpperCase() === 'LONG';
            market.sizeWei = isLong ? sz : -sz;
            market.entryPrice = market.mark;
            const notional = (sz * market.mark) / UNIT;
            market.usedMargin += notional / 3n;
            engineOps.push({ op: 'openMarket', side, sizeWei: sz, tag });
          },
          increase(_mid, sizeWei) {
            const sz = BigInt(sizeWei);
            market.sizeWei += market.sizeWei >= 0n ? sz : -sz;
            const notional = (sz * market.mark) / UNIT;
            market.usedMargin += notional / 3n;
            engineOps.push({ op: 'increase', sizeWei: sz });
          },
          reduce(_mid, sizeWei) {
            const sz = BigInt(sizeWei);
            const abs = market.sizeWei < 0n ? -market.sizeWei : market.sizeWei;
            const nextAbs = abs > sz ? abs - sz : 0n;
            market.sizeWei = market.sizeWei >= 0n ? nextAbs : -nextAbs;
            if (nextAbs === 0n) market.usedMargin = 0n;
            else market.usedMargin = market.usedMargin / 2n;
            engineOps.push({ op: 'reduce', sizeWei: sz });
          },
          close() {
            market.sizeWei = 0n;
            market.usedMargin = 0n;
            engineOps.push({ op: 'close' });
          },
        };
      }
      if (target === CRON) {
        return {
          schedule(_target, _method, _args, _nextRunAt, _interval, maxRuns, gasLimit) {
            const id = String(nextJob++);
            jobs.set(id, { id, maxRuns: String(maxRuns), gasLimit: String(gasLimit) });
            market.nativeBalance -= BigInt(callOptions.value ?? 0);
            return id;
          },
          getJob(id) { return jobs.has(String(id)) ? JSON.stringify(jobs.get(String(id))) : null; },
          cancel(id) { jobs.delete(String(id)); return true; },
        };
      }
      throw new Error(`unexpected perp contract call: ${address}`);
    },
  };
  const source = readFileSync(resolve(ROOT, 'contracts', `${contractName}.js`), 'utf8');
  const contract = vm.runInNewContext(source, ctx, { filename: `${contractName}.js` });
  function setSender(sender, value = 0n) {
    ctx.msg.sender = sender;
    ctx.msg.value = BigInt(value);
    if (sender !== CRON) market.nativeBalance += BigInt(value);
  }
  function status() { return JSON.parse(contract.getStatus()); }
  return { contract, market, events, jobs, engineOps, store, ctx, setSender, status };
}

// Perp DCA: executes 2 legs up to totalMarginWei, auto-stops Cron, then owner closes position & withdraws.
{
  const perpDca = createPerpRuntime('perp-dca');
  const legMargin = UNIT;
  const totalMargin = 2n * UNIT;
  const escrow = 5_000_000n;
  perpDca.setSender(OWNER, totalMargin + escrow);
  perpDca.contract.init('1', 'LONG', '3', String(legMargin), String(totalMargin), '300', '0', '0', PERPS_CFG);
  perpDca.setSender(CRON);
  perpDca.contract.tick();
  perpDca.setSender(CRON);
  perpDca.contract.tick();
  assert.equal(perpDca.status().legs, '2');
  assert.equal(perpDca.status().stopped, 'true');
  assert.equal(perpDca.jobs.size, 0);
  assert.ok(perpDca.market.sizeWei > 0n, 'Perp DCA opened LONG position');
  perpDca.setSender(OWNER);
  perpDca.contract.closePosition();
  assert.equal(perpDca.market.sizeWei, 0n);
  assert.equal(perpDca.market.collateral, 0n);
  perpDca.contract.withdraw(OWNER, String(perpDca.market.nativeBalance));
  assert.equal(perpDca.market.withdrawnToOwner, totalMargin);
}

// Perp Trigger: waits until target dip is reached, opens LONG, then closes on take-profit.
{
  const perpTrigger = createPerpRuntime('perp-trigger', 2n * UNIT);
  const margin = 2n * UNIT;
  perpTrigger.setSender(OWNER, margin + 5_000_000n);
  perpTrigger.contract.init('1', 'LONG', '3', String(margin), '500', 'below', '60', '1000', '500', PERPS_CFG);
  perpTrigger.setSender(CRON);
  assert.equal(perpTrigger.contract.tick(), 'waiting');
  perpTrigger.market.mark = (2n * UNIT * 94n) / 100n; // -6% dip crosses 5% below trigger
  perpTrigger.setSender(CRON);
  perpTrigger.contract.tick();
  assert.equal(perpTrigger.status().entered, 'true');
  assert.ok(perpTrigger.market.sizeWei > 0n);
  perpTrigger.market.mark = (perpTrigger.market.entryPrice * 112n) / 100n; // +12% hits 10% TP
  perpTrigger.setSender(CRON);
  assert.equal(perpTrigger.contract.tick(), 'take-profit-closed');
  assert.equal(perpTrigger.status().stopped, 'true');
  assert.equal(perpTrigger.market.sizeWei, 0n);
}

// Perp Grid: scales in on adverse step and reduces on +step rebound.
{
  const perpGrid = createPerpRuntime('perp-grid', 2n * UNIT);
  perpGrid.setSender(OWNER, 4n * UNIT + 5_000_000n);
  perpGrid.contract.init('1', 'LONG', '3', '200', '4', String(4n * UNIT), '60', PERPS_CFG);
  perpGrid.market.mark = (2n * UNIT * 97n) / 100n; // -3% hits first -2% level
  perpGrid.setSender(CRON);
  perpGrid.contract.tick();
  assert.equal(perpGrid.status().activeLevels, '1');
  perpGrid.market.mark = (2n * UNIT * 100n) / 100n; // +3% above entry hits +2% TP
  perpGrid.setSender(CRON);
  perpGrid.contract.tick();
  assert.equal(perpGrid.status().activeLevels, '0');
  assert.equal(perpGrid.market.sizeWei, 0n);
}

// Perp Risk: opens guarded position, tracks bestPrice, exits on trailing drawdown.
{
  const perpRisk = createPerpRuntime('perp-risk', 2n * UNIT);
  perpRisk.setSender(OWNER, 2n * UNIT + 5_000_000n);
  perpRisk.contract.init('1', 'LONG', '3', String(2n * UNIT), '500', '2000', '500', '60', PERPS_CFG);
  perpRisk.setSender(CRON);
  perpRisk.contract.tick();
  assert.equal(perpRisk.status().entered, 'true');
  perpRisk.market.mark = (2n * UNIT * 110n) / 100n; // new peak
  perpRisk.setSender(CRON);
  assert.equal(perpRisk.contract.tick(), 'guarding');
  perpRisk.market.mark = (2n * UNIT * 104n) / 100n; // >5% drop from 2.2 peak
  perpRisk.setSender(CRON);
  assert.equal(perpRisk.contract.tick(), 'trailing-drawdown');
  assert.equal(perpRisk.status().stopped, 'true');
  assert.equal(perpRisk.market.sizeWei, 0n);
}

// Perp TWAP: executes all slices and cancels Cron on completion.
{
  const perpTwap = createPerpRuntime('perp-twap', 2n * UNIT);
  perpTwap.setSender(OWNER, 3n * UNIT + 5_000_000n);
  perpTwap.contract.init('1', 'SHORT', '2', String(3n * UNIT), '3', '300', PERPS_CFG);
  for (let i = 0; i < 3; i += 1) {
    perpTwap.setSender(CRON);
    perpTwap.contract.tick();
  }
  assert.equal(perpTwap.status().legsDone, '3');
  assert.equal(perpTwap.status().stopped, 'true');
  assert.equal(perpTwap.jobs.size, 0);
  assert.ok(perpTwap.market.sizeWei < 0n, 'Perp TWAP opened SHORT position');
}

// Perp Momentum: opens LONG on upward move and closes on downward reversal.
{
  const perpMom = createPerpRuntime('perp-momentum', 2n * UNIT);
  perpMom.setSender(OWNER, 2n * UNIT + 5_000_000n);
  perpMom.contract.init('1', '3', String(2n * UNIT), '200', '60', PERPS_CFG);
  perpMom.market.mark = (2n * UNIT * 103n) / 100n; // +3% >= 200 bps
  perpMom.setSender(CRON);
  assert.equal(perpMom.contract.tick(), 'opened-long');
  assert.ok(perpMom.market.sizeWei > 0n);
  perpMom.market.mark = (perpMom.market.mark * 97n) / 100n; // -3% <= -200 bps
  perpMom.setSender(CRON);
  assert.equal(perpMom.contract.tick(), 'closed-long');
  assert.equal(perpMom.market.sizeWei, 0n);
}

console.log('Trading lifecycle simulation: PASS');
console.log('• Price normalization: both pool orientations across Grid, Risk Manager, Scale and Limit Trigger');
console.log('• Momentum Signal: correct cumulative-price side and a complete three-tick TWAP signal cycle');
console.log('• Grid: buy + sell path, sell budget cap, and underfunded startup stop');
console.log('• DCA: 10 + 10 + 5 ASE legs consume exact budget and cancel Cron');
console.log('• TWAP: failed-swap rollback + retry, 333 + 333 + 334 slices, cancel after success');
console.log('• Risk Manager: latched stop-loss / take-profit / drawdown exits, per-run size cap and daily-loss pause');
console.log('• Scale: one bounded swap per Cron tick');
console.log('• PnL: incomplete indexed event ranges cannot be shown as complete net PnL');
console.log('• AsePad Perps: perp-dca, perp-trigger, perp-grid, perp-risk, perp-twap & perp-momentum lifecycles');
