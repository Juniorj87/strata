# Strategy templates

Five strategy contracts in the Asentum contract format — plain JavaScript, no compiler, no
imports. Each one schedules itself with `cron.schedule(...)` and trades through an AMM pool
with `E(pool).swapExactIn(...)`.

| File | Logic | Cadence |
|---|---|---|
| `momentum.js` | Buys on upward momentum, sells on the drop | 60s |
| `mean-reversion.js` | Sells into strength, buys back on weakness | 120s |
| `twap.js` | Slices one order across N legs | 300s |
| `grid.js` | Two-sided orders around a reference price | 60s |
| `dca.js` | Fixed notional every interval | 3600s |

## Deploying one

```bash
asentum deploy contracts/twap.js --network testnet
```

Then call `init` with its arguments (see the header comment in each file), and fund the gas
escrow so the scheduled job can keep firing.

## What the chain gives you

- `cron.schedule(this.address, 'tick', [], when, interval, maxRuns, gasLimit)` — the chain
  fires the job; there is no keeper to run and nothing to keep alive.
- `E(addr).method(args)` — cross-contract calls are asynchronous, so a strategy cannot be
  re-entered mid-execution and a failed leg reverts the whole tick.
- `emit(name, payload)` — every decision is an indexed event, which is what the registry and
  the P&L indexer read.
- The deployed source *is* the artifact. Anyone can read it in the explorer and verify the
  BLAKE3 hash before funding it.

## Status

These templates have not been deployed yet — they are written against the documented VM
globals but not exercised against a live node. The constants `BASE`, `POOL_TOKEN` and
`QUOTE_TOKEN` are placeholders for the pool's token addresses and must be replaced with the
real ones for the pool you trade.

Contract docs: https://www.asentum.com/docs/guides/writing-contracts
Scheduled calls: https://www.asentum.com/docs/guides/scheduled-calls
