# StrataDEX product guide — 13 November 2026

## Official Asentum integration

Strata connects to the official Asentum testnet RPC at `https://explorer.asentum.com` (chain ID 1423). Wallet connection and transaction approval are handled by `@asentum/connect`; deployment scripts use `@asentum/sdk` for native Asentum signing. The RPC compatibility layer is not a substitute for native signing. Auras is Asentum's native AMM; its public indexer at `https://auras.asentum.com` supplies indexed pairs, candles and trades, while swaps and pool state remain on-chain.


This document describes the current implementation in this repository. It distinguishes live functionality from unavailable integrations.

## Product areas

| Area | Route | Current behaviour |
|---|---|---|
| Swap | `/swap` | Wallet-signed AMM swaps using live pool reads and a fresh quote. |
| Advanced Trading | `/advanced` | Indexed OHLCV charts, recent fills, AMM market swaps and supported Auras v2 escrowed limit orders. |
| Bot Builder | `/deploy` | Deploys and initializes one of the eight strategy contracts, funds its trading budget and Cron escrow, and starts the schedule. |
| Strategies | `/strategies` | Discovers and filters live strategy contracts and catalog templates. |
| Portfolio | `/portfolio` | Reads the connected wallet's strategy contracts, token balances and local history. |
| Create Token | `/create-token` | Deploys a fixed-supply ARC-20 JavaScript contract and initializes its supply to the deploying wallet. |
| Activity | `/activity` | Shows indexed, verified strategy fills and transaction references. |
| Docs | `/how` | In-app explanation of supported behaviour, costs and limits. |

## Advanced Trading

### Market data

The market adapter in `src/lib/marketData.ts` reads from the public Auras indexer at `https://auras.asentum.com`:

- `/api/pairs` for indexed pools and 24-hour market summaries.
- `/api/candles` for OHLCV buckets derived from indexed AMM Swap events.
- `/api/trades` for recent indexed fills.

Timeframes exposed by the UI:

- Native indexer buckets: 1m, 5m, 15m, 1h, 4h, 1d.
- 30m is aggregated from two 15m buckets.
- 1w is aggregated from daily buckets using UTC Monday boundaries.

Empty periods remain gaps. The app must not invent a candle, trade, volume, quote or balance when the source has no data. For pools where ASE is token0, the adapter inverts prices and converts volume to ASE-denominated values.

### Execution

- Market orders use a fresh quote from the exact AMM contract address returned for the selected live pair, a minimum-output/slippage guard and a wallet-signed transaction. The venue-wide address is only a fallback for token-picker pools without an indexed contract address.
- Native ASE input is passed to `@asentum/connect` as a decimal wei string (`amountIn.toString()`), matching its `client.call(contract, method, args, value)` API. Never pass a JavaScript `bigint` as the native-value argument.
- The selected pair's `amm` address is used consistently for pool reads, quote reads, token allowance and swap execution. This prevents the quote and write from silently targeting different deployments after an AMM redeployment.
- Limit orders are supported only where the Auras v2 limit-order module is available.
- Limit orders escrow the input asset and are evaluated against AMM pool liquidity. They are not conventional resting order-book orders and there is no matching engine.
- AseDex and unsupported legacy pools remain market-swap-only in this interface.
- The order list is a view of open escrowed AMM orders, not a central limit order book.

### Creating a bot from a market

Advanced Trading has three ticket modes: Market, Limit and Bot. The Bot mode offers strategy presets and passes the selected on-chain pool ID, venue, template and default execution interval into `/deploy`. The indexer pool key is not the on-chain pool ID; the builder must receive `chainPoolId`.

The bot schedule and chart timeframe are independent. A 1m/5m/15m chart selects the candle aggregation for visual analysis; it is not sent to the strategy contract. The execution interval controls how often Cron invokes the strategy. The builder exposes common 1m/5m/15m/1h presets where the selected template supports custom scheduling. Asentum Cron is not a high-frequency execution engine.

## Current bot templates

| Template | Default schedule | Real behaviour |
|---|---:|---|
| Momentum Signal | 60 sec | TWAP-based signal only; no trade. |
| Momentum Trader | 60 sec | Token-to-ASE sell only. |
| Grid | 60 sec | Two-sided inventory grid with token sell inventory and ASE buy reserve. |
| TWAP Slicer | 300 sec | Timed token-to-ASE atomic swaps. |
| DCA | 3,600 sec | Recurring ASE-to-token spot buys. |
| Risk-managed Trader | 300 sec | Scheduled sell-only exit logic using pool reserve price and declared cost basis for realised-loss checks. |
| Limit Sell Trigger | 60 sec | One scheduled reduce-only sell after a target is reached. |
| Scale Order | 60 sec | Scheduled reduce-only sell ladder. |

Stop-loss, take-profit and other price conditions are evaluated on scheduled runs only. They are not continuously monitored. AMM swaps use a minimum-output guard; a run can revert if the pool cannot satisfy it.

## Create Token

`src/lib/tokenFactory.ts` deploys a JavaScript ARC-20 contract and then calls its one-time `init` method. The fixed supply is minted to the deploying wallet. The UI verifies name, symbol, decimals, total supply and deployer balance with read calls after initialization.

The standard is documented by Asentum as ARC-20 (draft). Token creation does not automatically create a liquidity pool. The contract intentionally has no owner mint, tax, blacklist or pause function.

Deployment and initialization are separate transactions. If initialization fails after deployment, the app retains a recoverable draft so the user can retry initialization against the same contract instead of deploying a duplicate token.

## Wallet and privacy model

The app is a static client with no application backend or server-side user database.

- Wallet signing is delegated to `@asentum/connect`.
- Strategy records and swap history are stored in browser localStorage and scoped to the wallet.
- The optional Wallet Registry is off by default. It stores public addresses only in the current browser after the user opts in.
- Turning the registry off clears its entries.
- Private keys, seed phrases and signatures are never stored by the registry.

## Spot bots vs Perpetuals (Perps)

These are separate products and must not share execution logic or terminology:

- **Spot / AMM** swaps one asset for another from pool liquidity. It has no leverage, margin, short position or liquidation.
- **Spot bots** are the eight existing on-chain strategy templates. They act on the selected spot pool and are invoked by Asentum Cron. DCA buys spot tokens with ASE; Grid can buy and sell using funded inventories; TWAP, Momentum Trader, Risk-managed Trader, Limit Sell Trigger and Scale Order are currently sell-side spot strategies; Momentum Signal publishes a signal but does not trade.
- **Stop-loss / take-profit** are conditions inside the Risk-managed spot strategy. They are checked only when Cron runs; they are not continuously monitored and do not create a short or hedge. A stop-loss is therefore not a separate trading venue or a Perps position.
- **Perps** are leveraged derivatives with long/short positions, margin, funding and liquidation. They require a separate published venue, contract/API, mark/index prices and risk engine. This is not specifically an AseDex integration restriction: AseDex and Auras are spot AMMs, and neither is itself a perpetuals matching, margin or liquidation protocol. They are not implemented by the current spot strategy contracts.

In Advanced Trading, the Market / Limit / Bot ticket is the Spot workflow. The Perps panel is a separate, explicitly unavailable integration until a real provider is published. Never route a Perps action through an AMM swap or a spot strategy contract.

## Perpetuals

No external perpetuals venue is configured in this repository. AsePad's creator has described an external protocol in testing, including a spot-price oracle and insurance-fund mechanism, but no public contract address, ABI or API has been supplied here.

`src/lib/perps.ts` is an adapter boundary only. Long/short, leverage, margin, funding, liquidation and perp position actions remain unavailable. Spot AMM prices are not substituted for perp mark/index prices.

## Asentum Cron constraints

The official scheduled-calls guide documents recurring intervals from 60,000 ms (one minute) to one year, with a 21,000–5,000,000 gas limit per run. Missed slots are skipped rather than replayed back-to-back. A failed run is billed and the job remains scheduled. Escrow is deducted per run; when it cannot cover another run, the job is removed and remaining escrow is refunded.

See [Asentum Scheduled Calls](https://www.asentum.com/docs/guides/scheduled-calls).

## Verification status

This repository has implementation-level support for the features above, but a successful local typecheck/build and live-chain transaction test must be run in an environment with the project's npm dependencies and Asentum testnet access. Do not treat source presence as proof that a live transaction succeeded.


## Charting and TradingView

The embedded chart currently uses Strata’s own indexed Asentum/Auras trade data. EMA overlays and manually placed horizontal price levels are available; levels persist in browser localStorage per market and are not on-chain orders or shared across devices. TradingView Advanced Charts is not embedded: its full Charting Library has distribution/licensing and custom-datafeed requirements. The public TradingView widget cannot automatically consume Strata’s private in-app pool selection or guarantee the same on-chain candles. A production integration needs approved library access and a datafeed adapter; until then Strata keeps its real indexed chart rather than showing a disconnected generic market chart.
