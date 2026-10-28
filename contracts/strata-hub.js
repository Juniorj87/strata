// Strata template: strata-hub
/* eslint-disable no-unused-expressions */
//
// Strata Protocol: Canonical Strategy Hub & Ecosystem Registry
//
// Central registry for autonomous on-chain strategies, user escrow balances,
// and execution telemetry on the Asentum blockchain.
//
// Integrates with the Auras AMM (0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd)
// and the Asentum Protocol Cron Engine (0x0000000000000000000000000000000000000006).

function lc(a) {
  return String(a || '').toLowerCase();
}

({
  init() {
    storage.set('owner', lc(msg.sender));
    storage.set('self', lc(msg.contractAddress));
    storage.set('totalStrategies', '0');
    storage.set('totalPokes', '0');
    storage.set('totalEscrowDeposited', '0');

    emit('Initialized', {
      owner: lc(msg.sender),
      hubAddress: lc(msg.contractAddress),
      timestamp: String(chain.timestamp),
    });
    return true;
  },

  /**
   * Register an autonomous strategy contract with Strata Protocol.
   * Emits an on-chain event indexed for Asentum ecosystem and airdrop XP tracking.
   */
  registerStrategy(strategyAddress, templateName, poolId) {
    const caller = lc(msg.sender);
    const strategy = lc(strategyAddress);
    const template = String(templateName || 'custom');
    const pool = String(poolId || '1');

    storage.set('strategy:' + strategy + ':owner', caller);
    storage.set('strategy:' + strategy + ':template', template);
    storage.set('strategy:' + strategy + ':pool', pool);
    storage.set('strategy:' + strategy + ':registeredAt', String(chain.timestamp));

    const total = BigInt(storage.get('totalStrategies') || '0') + 1n;
    storage.set('totalStrategies', total.toString());

    const userCount = BigInt(storage.get('user:' + caller + ':count') || '0') + 1n;
    storage.set('user:' + caller + ':count', userCount.toString());
    storage.set('user:' + caller + ':strat:' + userCount.toString(), strategy);

    emit('StrategyRegistered', {
      user: caller,
      strategy,
      template,
      poolId: pool,
      totalStrategies: total.toString(),
      timestamp: String(chain.timestamp),
    });

    return true;
  },

  /**
   * Fund or top up gas escrow for an autonomous strategy.
   * Accepts native ASE (msg.value) and emits an on-chain event.
   */
  depositEscrow(strategyAddress) {
    const caller = lc(msg.sender);
    const strategy = lc(strategyAddress);
    const amount = BigInt(msg.value || 0n);

    assert(amount > 0n, 'Must send native ASE to deposit escrow');

    const currentStratEscrow = BigInt(storage.get('strategy:' + strategy + ':escrow') || '0') + amount;
    storage.set('strategy:' + strategy + ':escrow', currentStratEscrow.toString());

    const totalEscrow = BigInt(storage.get('totalEscrowDeposited') || '0') + amount;
    storage.set('totalEscrowDeposited', totalEscrow.toString());

    emit('EscrowDeposited', {
      user: caller,
      strategy,
      amount: amount.toString(),
      totalEscrow: currentStratEscrow.toString(),
      timestamp: String(chain.timestamp),
    });

    return true;
  },

  /**
   * Poke / trigger an execution tick on an armed strategy.
   * Invokes tick() on the strategy and logs the user action.
   */
  async pokeStrategy(strategyAddress) {
    const caller = lc(msg.sender);
    const strategy = lc(strategyAddress);

    await E(strategy).tick();

    const pokes = BigInt(storage.get('totalPokes') || '0') + 1n;
    storage.set('totalPokes', pokes.toString());

    emit('StrategyPoked', {
      caller,
      strategy,
      totalPokes: pokes.toString(),
      timestamp: String(chain.timestamp),
    });

    return true;
  },

  /** Read-only views for dApp and explorer */
  getProtocolStats() {
    return JSON.stringify({
      totalStrategies: storage.get('totalStrategies') || '0',
      totalPokes: storage.get('totalPokes') || '0',
      totalEscrowDeposited: storage.get('totalEscrowDeposited') || '0',
      owner: storage.get('owner') || '',
    });
  },

  getStrategyOwner(strategyAddress) {
    return storage.get('strategy:' + lc(strategyAddress) + ':owner') || '';
  },

  getUserStrategyCount(userAddress) {
    return storage.get('user:' + lc(userAddress) + ':count') || '0';
  },
})
