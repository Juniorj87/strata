# Strategy Templates

Strategy contracts for the Strata platform on the Asentum blockchain. These are written in plain JavaScript following the Asentum contract format - no compiler, no build pipeline required.

## 📦 Available Templates

| Template | Logic | Execution Interval |
|----------|-------|-------------------|
| `momentum.js` | Buys on upward momentum, sells on the drop | 60s |
| `mean-reversion.js` | Sells into strength, buys back on weakness | 120s |
| `twap.js` | Slices one order across N legs | 300s |
| `grid.js` | Two-sided orders around a reference price | 60s |
| `dca.js` | Fixed notional every interval | 3600s |
| `auras-momentum-signal.js` | Reads TWAP, publishes buy/sell/hold signals | 60s |
| `auras-momentum-trader.js` | Executes trades based on momentum signals | 60s |

## 🚀 Deployment

### Manual Deployment

```bash
asentum deploy contracts/twap.js --network testnet
```

Then call `init` with its arguments (see the header comment in each file), and fund the gas escrow so the scheduled job can keep firing.

### Using the Web Deployer

The Strata web application provides a UI for deploying strategies:

```bash
npm run deploy:momentum-signal -- --pool 1 --threshold 120 --interval 60
```

## 🔧 Contract Features

### Asentum Blockchain Primitives

Each template uses Asentum's built-in features:

- **`cron.schedule()`** - Protocol-level job scheduling, no keeper required
- **`E(addr).method(args)`** - Asynchronous cross-contract calls
- **`emit(name, payload)`** - Indexed events for decision tracking
- **BLAKE3 verification** - Source code hash stored on-chain

### Key Characteristics

- **Re-entry Safety** - Asynchronous calls prevent re-entrancy attacks
- **Atomic Execution** - Failed legs revert the entire transaction
- **Public Source** - Anyone can read and verify the code
- **No Compilation** - Source code is the deployed artifact

## ⚠️ Important Notes

### Placeholder Addresses

The constants `BASE`, `POOL_TOKEN`, and `QUOTE_TOKEN` are placeholders. You must replace them with real token addresses for the pool you trade before deployment.

### Live Deployment Status

These templates have not been deployed to mainnet yet. They are written against the documented VM globals but not exercised against a live node. We recommend:

1. Test on testnet first
2. Replace placeholder addresses
3. Start with small amounts
4. Monitor execution carefully

### Funding Requirements

- **Gas Escrow** - Pre-fund with ASE tokens for scheduled executions
- **Trading Templates** - Also fund with ARC-20 tokens for trading
- **Signal Templates** - Can run on gas escrow alone

## 📚 Resources

- [Asentum Contract Documentation](https://www.asentum.com/docs/guides/writing-contracts)
- [Scheduled Calls Guide](https://www.asentum.com/docs/guides/scheduled-calls)
- [Strata README](../README.md)
- [Architecture Documentation](../docs/ARCHITECTURE.md)

## 🔍 Contract Structure

Each contract follows this pattern:

```javascript
// Configuration constants
const PARAMETER = value;

// Initialization
function init() {
  // Setup logic
}

// Main execution (called by cron)
function tick() {
  // Trading logic
  emit('decision', { data });
}
```

## 🤝 Contributing

To add a new strategy template:

1. Write the contract following the existing pattern
2. Add comprehensive comments
3. Include parameter documentation
4. Update this README
5. Test on testnet before submitting

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

---

Built for the Asentum blockchain ecosystem
