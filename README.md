# Strata

**Trading strategies as contracts on [Asentum](https://www.asentum.com).**

Write trading logic as a JavaScript contract, deploy it once, and let the protocol schedule it.
The source is public, every fill is a transaction, and there is no bot process to keep alive.

Strata is a community build on the Asentum testnet (chain 1423). Not affiliated with the Asentum team.

---

## How it actually works on Asentum

Auras (`AuraSwap` at `0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd`) already sweeps limit orders
via the protocol cron, so Strata strategies are **adaptive**: the contract reads Auras' TWAP with
`consult()`, makes its own decision every tick, and swaps through `swapExactIn` when its
conditions hold. The chain fires the tick, no keeper exists.

Two constraints worth knowing before deploying one:

| | |
|---|---|
| Where the logic lives | On chain, source published in the explorer |
| Scheduler | Protocol cron registry, funded by a gas escrow |
| Which side it can trade | The **token side only**. Contracts receive `msg.value` only when funded; the strategy trades the ARC-20 leg and holds any native ASE it owns |
| Deployment | Plain JS source, no compiler, verified locally by BLAKE3: `blake3(source)` must equal the on-chain `codeHash` |

## Templates

Five templates live in [`contracts/`](./contracts):

- `auras-momentum-signal.js` - signal only, cheap to run, needs nothing but the cron escrow
- `auras-momentum-trader.js` - trades the token side, must be funded with ARC-20 tokens
- `twap.js`, `grid.js`, `dca.js` - execution styles on the same Auras interface

## Site

- `/` - live pool states and the real swap tape, read straight from the chain
- `/strategies` and `/strategies/:id` - on-chain registry: verified source (BLAKE3), cron job state, execution log
- `/deploy` - pick a template, set parameters, get the exact `npm run deploy:...` command
- `/how` - the model in detail, plus an interactive VM walkthrough

Wallet connect (Chrome extension or Telegram bot wallet) is wired through `@asentum/connect` -
the browser never holds a key, the wallet only signs.

## Run it

```bash
npm install
npm run dev            # http://127.0.0.1:5173
npm run build          # production build
npm run chain:check    # sanity-check every RPC surface the app uses
npm run chain:verify   # BLAKE3 verification against the live Auras contract
```

## Deploying a strategy

The deployer script runs locally, generates a fresh deterministic-seed wallet (stored in
git-ignored `.strata/seed.json`), and broadcasts to chain 1423:

```bash
npm run deploy:momentum-signal -- --pool 1 --threshold 120 --interval 60
```

0. Fund the generated wallet (address is printed by the script). Faucet: airdrop.asentum.com.
1. Run the deploy command. The script verifies after broadcasting: if the BLAKE3 hash of the
   sent source differs from the on-chain `codeHash`, the strategy is flagged unverified in the
   registry.

Trading templates additionally need the contract itself funded with ARC-20 tokens before its
first fill succeeds - the signal-only template runs on the cron escrow alone.

## Design notes

House style of the ecosystem: dark editorial, near-black canvas, one accent per product, mono for
numbers. Explorer's green, Auras' violet and Asentum AI's blue were all taken, so Strata uses
turquoise, which leaves green/red free to mean profit and loss.

## License

MIT
