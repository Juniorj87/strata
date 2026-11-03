// Strata Marketplace registry.
// A wallet may publish only a strategy contract it owns. Listings are public,
// editable by the strategy owner, and can be delisted without deleting history.

function lc(value) { return String(value || '').toLowerCase(); }
function asObject(value) { return typeof value === 'string' ? JSON.parse(value) : value; }

({
  init() {
    assert(!storage.has('owner'), 'already initialised');
    storage.set('owner', lc(msg.sender));
    storage.set('listingCount', '0');
    emit('MarketplaceInitialized', { owner: lc(msg.sender), marketplace: lc(msg.contractAddress) });
    return true;
  },

  publishStrategy(strategyAddress, title, description, tags) {
    const strategy = lc(strategyAddress);
    const caller = lc(msg.sender);
    const name = String(title || '').trim();
    const summary = String(description || '').trim();
    assert(strategy.startsWith('0x') && strategy.length === 42, 'invalid strategy address');
    assert(name.length >= 3 && name.length <= 60, 'title must be 3..60 characters');
    assert(summary.length <= 280, 'description must be at most 280 characters');
    assert(lc(E(strategy).getOwner()) === caller, 'only the strategy owner can publish it');
    const template = String(E(strategy).getTemplate() || '');
    assert(['momentum-signal', 'momentum-trader', 'grid', 'twap', 'dca', 'risk-managed', 'scale', 'limit-exit'].includes(template), 'unsupported strategy template');
    const rawConfig = E(strategy).getConfig();
    const config = asObject(rawConfig);
    assert(config && String(config.version) === '1' && String(config.template) === template, 'strategy config is missing or unsupported; deploy the latest Strata template');
    const existing = storage.get('listing:' + strategy);
    let index = existing ? Number(existing) : -1;
    if (index < 0) {
      index = Number(storage.get('listingCount') || '0');
      storage.set('listing:' + strategy, String(index));
      storage.set('listingAddress:' + index, strategy);
      storage.set('listingCount', String(index + 1));
    }
    const cleanTags = String(tags || '').slice(0, 120);
    storage.set('entry:' + strategy, JSON.stringify({ strategy, owner: caller, template, title: name, description: summary, tags: cleanTags, config, active: true, updatedAt: chain.blockTimestamp.toString() }));
    emit('StrategyPublished', { strategy, owner: caller, template, title: name, updatedAt: chain.blockTimestamp.toString() });
    return String(index);
  },

  unpublishStrategy(strategyAddress) {
    const strategy = lc(strategyAddress);
    const raw = storage.get('entry:' + strategy);
    assert(raw, 'listing not found');
    const entry = asObject(raw);
    assert(entry.owner === lc(msg.sender), 'only the publisher can unpublish');
    entry.active = false;
    entry.updatedAt = chain.blockTimestamp.toString();
    storage.set('entry:' + strategy, JSON.stringify(entry));
    emit('StrategyUnpublished', { strategy, owner: lc(msg.sender), updatedAt: chain.blockTimestamp.toString() });
    return true;
  },

  getListingCount() { return storage.get('listingCount') || '0'; },
  getListingAt(index) {
    const strategy = storage.get('listingAddress:' + String(index));
    if (!strategy) return '';
    return storage.get('entry:' + strategy) || '';
  },
  getListing(strategyAddress) { return storage.get('entry:' + lc(strategyAddress)) || ''; },
  getOwner() { return storage.get('owner') || ''; },
});
