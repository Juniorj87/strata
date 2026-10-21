# Strata

**Trading strategies as contracts on [Asentum](https://www.asentum.com).**

Write trading logic as a JavaScript contract, deploy it once, and let the protocol schedule it.
The source is public, every fill is a transaction, and there is no bot process to keep alive.

Strata is a community build on the Asentum testnet (chain 1423). Not affiliated with the Asentum team.

---

## Why this exists on Asentum

Asentum runs contracts in a hardened JavaScript sandbox and schedules them **at the protocol level**
(`cron.schedule`), with a two-second block target. Cross-contract calls are asynchronous, so a
strategy cannot be re-entered mid-execution.

That combination makes a category possible which is awkward elsewhere:

| | Off-chain bot | Strata (on-chain strategy) |
|---|---|---|
| Where the logic lives | On a server you control | On chain, source published |
| Runs when your laptop sleeps | No | Yes — the chain fires it |
| Scheduler | cron job or bot keeper | Protocol cron registry |
| Cost to stay alive | Hosting + API keys | Gas escrow per job |
| Audit before you trust it | Ask the operator | Read the source in the explorer |
| Kill switch | Kill the process | Cancel the scheduled job |
| History | Off-chain, yours to trust | Every call is a transaction |

The same primitives are documented by the Asentum team in
[Scheduled Contract Calls](https://www.asentum.com/docs/guides/scheduled-calls).

## What a strategy contract looks like

```js
// A strategy is a contract. It schedules itself, then trades.
export default class Twap {
  init(pool, notionalWei) {
    this.pool = pool;
    this.notionalWei = BigInt(notionalWei);

    // The chain fires this every hour. No keeper. No server.
    cron.schedule(this.address, 'tick', [], chain.timestamp + 3600, 3600, 0, 300000n);
  }

  async tick() {
    await E(this.pool).swapExactIn(QUOTE_TOKEN, this.notionalWei / 6n);
    emit('Leg', { filled: true });
  }
}
```

Templates included: **momentum**, **mean reversion**, **TWAP**, **grid**, **DCA**.

## Pages

- `/` — what the model is, how it works, live strategy tape, bot-vs-contract comparison
- `/strategies` — registry with filters and sorting
- `/strategies/:id` — equity curve, on-chain source, schedule, execution log
- `/deploy` — pick a template, set parameters, review the gas estimate

## Run it

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # production build
npm run lint     # oxlint
```

Stack: Vite + React + TypeScript, one hand-written CSS file, no UI framework, no chart library.
TypeScript is required by the template — the app itself is plain React.

## Status

The interface is complete and runs on mock data (`src/data/mock.ts`). Everything marked
**demo mode** in the deployer is simulated — no wallet is connected and nothing is broadcast.

Next slices, in order:

1. Replace the mock registry with a JSON-RPC reader against `https://explorer.asentum.com`
   (chain 1423) — contracts, events, cron jobs, balances.
2. Read strategy source and `codeHash` straight from the explorer, so the source panel is the
   deployed source rather than a copy.
3. Sign the deploy with the Asentum wallet extension (`@asentum/connect`) and broadcast to
   chain 1423.
4. Index on-chain fills to compute P&L instead of trusting the dashboard.

## Design notes

House style of the ecosystem: dark editorial, near-black canvas, one accent per product, mono for
numbers. Explorer's green, Auras' violet and Asentum AI's blue were all taken, so Strata uses
turquoise — which leaves green/red free to mean profit and loss.

## License

MIT
