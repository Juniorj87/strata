// Strata template: strata-hub
// Canonical registry for verified, user-owned Strata strategy contracts.

function lc(value) { return String(value || '').toLowerCase(); }

({
  init() {
    assert(!storage.has('owner'), 'already initialised');
    storage.set('owner', lc(msg.sender));
    storage.set('totalStrategies', '0');
    emit('Initialized', { owner: lc(msg.sender), hubAddress: lc(msg.contractAddress), timestamp: chain.blockTimestamp.toString() });
    return true;
  },

  registerStrategy(strategyAddress, templateName, poolId) {
    const caller = lc(msg.sender);
    const strategy = lc(strategyAddress);
    const template = String(templateName || '');
    const pool = String(poolId || '1');
    assert(strategy.startsWith('0x') && strategy.length === 42, 'invalid strategy address');
    assert(['momentum-signal', 'momentum-trader', 'grid', 'twap', 'dca', 'risk-managed', 'scale', 'limit-exit'].includes(template), 'unsupported Strata template');
    assert(!storage.has('strategy:' + strategy + ':owner'), 'strategy already registered');

    // A registry entry is only created by the wallet that initialized the strategy.
    assert(lc(E(strategy).getOwner()) === caller, 'caller is not the strategy owner');
    assert(String(E(strategy).getTemplate()) === template, 'template does not match strategy source');

    storage.set('strategy:' + strategy + ':owner', caller);
    storage.set('strategy:' + strategy + ':template', template);
    storage.set('strategy:' + strategy + ':pool', pool);
    storage.set('strategy:' + strategy + ':registeredAt', chain.blockTimestamp.toString());

    const total = BigInt(storage.get('totalStrategies') || '0') + 1n;
    storage.set('totalStrategies', total.toString());
    const userCount = BigInt(storage.get('user:' + caller + ':count') || '0') + 1n;
    storage.set('user:' + caller + ':count', userCount.toString());
    storage.set('user:' + caller + ':strat:' + userCount.toString(), strategy);

    emit('StrategyRegistered', { user: caller, strategy, template, poolId: pool, totalStrategies: total.toString(), timestamp: chain.blockTimestamp.toString() });
    return true;
  },

  withdraw(to, amountWei) {
    assert(lc(msg.sender) === storage.get('owner'), 'not the hub owner');
    const amount = BigInt(amountWei);
    assert(amount > 0n, 'amount must be positive');
    transfer(to || msg.sender, amount);
    emit('Withdrawn', { to: lc(to || msg.sender), amount: amount.toString() });
    return amount.toString();
  },

  getProtocolStats() {
    return JSON.stringify({ totalStrategies: storage.get('totalStrategies') || '0', owner: storage.get('owner') || '' });
  },
  getStrategyOwner(strategyAddress) { return storage.get('strategy:' + lc(strategyAddress) + ':owner') || ''; },
  getUserStrategyCount(userAddress) { return storage.get('user:' + lc(userAddress) + ':count') || '0'; },
  getUserStrategy(userAddress, index) { return storage.get('user:' + lc(userAddress) + ':strat:' + String(index)) || ''; },
});
