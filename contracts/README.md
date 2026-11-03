# Strata Strategy Contracts

These files use the current Asentum JavaScript contract format: a single source script whose last expression is a parenthesized object literal. Contract methods are synchronous. State is stored as strings through `storage`; cross-contract calls use `E(address).method(...)` and return directly.

## Templates

| Contract | Behaviour | Schedule | Trading |
|---|---|---:|---|
| `auras-momentum-signal.js` | Reads consecutive cumulative-TWAP windows and emits buy/sell/hold signals | Configurable, 60–86,400 seconds | No |
| `auras-momentum-trader.js` | Sells a fixed ARC-20 token amount into ASE when upward TWAP drift exceeds the threshold | Configurable, minimum 60 seconds | Token → ASE only |
| `grid.js` | Two-sided one-shot grid with separately funded ASE buy reserve and ARC-20 sell inventory | 60 seconds | ASE → token and token → ASE |
| `twap.js` | Sells a total token amount over a finite number of timed slices | 300 seconds, finite slices | Token → ASE only |
| `dca.js` | Recurring ASE-funded token purchases until the total budget is exhausted | Configurable, 60–86,400 seconds | ASE → token |
| `strata-hub.js` | Registers strategies only after reading owner and template from the strategy contract | On demand | — |

Grid uses one-time price levels around the deployment reference price. Each level executes at most once; it does not continuously recenter. DCA spends a prefunded ASE balance at the configured interval. Both use atomic Auras swaps and 2% minimum-output protection.

## Network addresses

- **Auras AMM:** `ase1v0myp2de3dhj3crvkhxqlnjaw2mvp64a9efkpl` / `0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd`
- **AseDex Exchange:** `ase1cwpnkultxqjz9z09xwe7jlztw2uhuf8fklhzsm` / `0xc3833b73eb30242289e533b3e97c4b72b97e24e9`
- **Cron Registry:** `ase1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqxgkr943` / `0x0000000000000000000000000000000000000006`
- **Strata Hub:** `ase1utdzul2gxdw4c60fr7fcphghlak63sjf8mqnut`

The AMM and AURA token are separate contracts. Strategy swaps, pool reads and quotes must target the AMM address.

## Lifecycle and safety

1. `init(...)` is guarded against repeat initialization and schedules `tick()` through the Cron Registry, forwarding the attached ASE as job escrow.
2. Scheduled `tick()` methods require `msg.sender` to equal the Cron Registry. This prevents arbitrary wallets from directly triggering trades.
3. Trading strategies approve the selected token to Auras and sell only the configured token amount. They stop the job when the remaining inventory cannot cover another trade; TWAP also stops when all configured slices are complete.
4. Owners can call `stop()` to cancel an active cron job. If Cron has already removed it after escrow exhaustion, `stop()` still marks the strategy as stopped so the owner can recover remaining ARC-20. The registry refunds unspent escrow to the strategy contract. Owners can withdraw the strategy's ASE balance with `withdraw(to, amountWei)` and reclaim remaining ARC-20 with `withdrawTokens(to)` after stopping. Cron requires at least 60,000 ms between recurring runs and escrow sufficient for one run's gas limit.

The actual swap call surface and each token's compatibility still require `validate_contract` / testnet simulation against the current Auras AMM source. A source hash match proves what code is deployed; it does not prove the strategy is economically safe or profitable.

## Deploy

```powershell
npm ci
npm run deploy:momentum-signal -- --pool 1 --token <TOKEN_HEX> --threshold 120 --interval 60 --escrow 0.05
npm run deploy:grid -- --pool 1 --token <TOKEN_HEX> --size 250 --budget 5000 --decimals 18 --levels 5 --escrow 0.05
```

The CLI uses `.strata/seed.json` or `STRATA_SEED`. Keep the seed private and never put it in a shared archive.

## Official references

- [Asentum Writing Contracts](https://www.asentum.com/docs/guides/writing-contracts)
- [Asentum Scheduled Contract Calls](https://www.asentum.com/docs/guides/scheduled-calls)
- [Auras ecosystem page](https://www.asentum.com/ecosystem/auras)
- [Strata README](../README.md)
