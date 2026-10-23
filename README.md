# Strata

**Adaptive trading strategies as contracts.** Write trading logic as a JavaScript contract, deploy it once, and let the chain schedule it. The source is public, every fill is a transaction, and there is no bot process to keep alive.

![Strata home screen](docs/screenshots/home.png)

## What it is

Strata is a web app plus a set of contract templates. A strategy is not a bot running on someone's server - it is a contract deployed on chain. The contract schedules its own `tick`, reads the AMM's own TWAP accumulator, and swaps through the pool when its conditions hold. The chain fires the tick; nothing has to stay online.

## How a strategy works

A strategy is a card-like contract with three parts:

1. **Write** - plain JavaScript. Top-level functions, a storage map, one event per decision. No Solidity, no ABI, no build pipeline.
2. **Deploy** - the source itself goes on chain and is what runs, forever. Anyone can read it in the explorer and verify its BLAKE3 hash before funding it.
3. **Run** - `cron.schedule()` registers a job in the protocol registry. Every interval the chain executes the call and settles the trade. No keeper, no server, no API keys to rotate.

### Mechanics

- **Scheduler** - protocol-level cron registry, funded by a gas escrow you prepay.
- **Price data** - the AMM's own TWAP accumulator (`consult()`). No oracle contract, no API key.
- **Trading side** - the token (ARC-20) leg only. The contract trades the token side and holds any native it already owns; it receives `msg.value` only when funded.
- **Audit** - source plus BLAKE3 hash on chain. `blake3(source)` must equal the on-chain `codeHash`, otherwise the strategy is flagged unverified.
- **Kill switch** - cancel the scheduled job and refund the remaining escrow.
- **Re-entry safety** - cross-contract calls are asynchronous, so a strategy cannot be re-entered mid-execution and a failed leg reverts the whole tick.

### Templates

Five templates live in [`contracts/`](./contracts):

| File | Logic | Cadence |
|---|---|---|
| `auras-momentum-signal.js` | Reads TWAP, publishes buy/sell/hold signal | 60s |
| `auras-momentum-trader.js` | Trades the token side on momentum | 60s |
| `twap.js` | Slices one order across N legs | 300s |
| `grid.js` | Two-sided orders around a reference price | 60s |
| `dca.js` | Fixed notional every interval | 3600s |

`mean-reversion.js` and `momentum.js` are also available as simpler variants.

## The site

- `/` - live pool states and the real swap tape, read straight from the chain
- `/strategies` and `/strategies/:address` - on-chain registry: verified source (BLAKE3), cron job state, execution log
- `/deploy` - pick a template, set parameters, get the exact deploy command, connect an Asentum wallet
- `/how` - the model in detail, plus an interactive VM walkthrough

Wallet connection (Chrome extension or Telegram bot wallet) goes through the Asentum connect kit - the browser never holds a key, the wallet only signs.

## Run it locally

```bash
npm install
npm run dev            # http://127.0.0.1:5173
npm run build          # production build
npm run chain:check    # sanity-check every RPC surface the app uses
npm run chain:verify   # BLAKE3 verification against the live Auras contract
```

## Deploying a strategy

The deployer runs locally, generates a fresh deterministic-seed wallet (stored in git-ignored `.strata/seed.json`), and broadcasts to chain 1423:

```bash
npm run deploy:momentum-signal -- --pool 1 --threshold 120 --interval 60
```

0. Fund the generated wallet (address is printed by the script).
1. Run the deploy command. The script verifies after broadcasting: if the BLAKE3 hash of the sent source differs from the on-chain `codeHash`, the strategy is flagged unverified in the registry.

Trading templates additionally need the contract itself funded with ARC-20 tokens before its first fill succeeds - the signal-only template runs on the cron escrow alone.

## Design notes

House style of the ecosystem: dark editorial, near-black canvas, one accent per product, mono for numbers. Strata uses turquoise, which leaves green and red free to mean profit and loss.

## Contributors

- [@Juniorj87](https://github.com/Juniorj87)

## License

MIT
