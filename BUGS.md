# Known Issues and Verification Notes

Last reviewed: 2026-11-27

This file records limitations that are visible from the current source tree. A feature being present in source is not proof that a live transaction has succeeded.

## Known product limitations

### Perpetual futures integration (AsePad Perps)
- **Status:** Connected via AsePad Perps contracts (`0x37d25f3a292f0642af72d6f161eafb18c76e16a6`).
- **Description:** `src/lib/perps.ts` resolves the live AsePad Perps modules (`engine`, `orders`, `liquidation`, `markets`, `vault`, `oracle`), `src/components/PerpsTerminal.tsx` and `src/components/PerpsBotBuilder.tsx` expose manual trading, direct keeper orders and six autonomous `perp-*` Cron contracts.
- **Impact:** Live-chain execution and closing flows still require Asentum testnet access and explicit wallet confirmation. Only native ASE-margined active AsePad Perps markets are supported by the `perp-*` bot contracts.

### Order-book trading is not available
- **Status:** Not implemented as an order book.
- **Description:** Advanced Trading supports AMM market swaps and supported escrowed Auras v2 limit orders. The latter are evaluated against AMM liquidity and do not use a matching engine.
- **Impact:** Do not describe the order list as a central limit order book or claim maker/taker matching.

### Scalping / sub-minute execution
- **Status:** Not supported by native Cron.
- **Description:** The official Asentum scheduled-calls guide documents a minimum recurring interval of 60,000 ms.
- **Impact:** 1m candles are supported, but they do not provide sub-minute execution or guaranteed execution at every candle boundary.

### Market data depends on the public indexer
- **Status:** External read dependency.
- **Description:** Advanced Trading uses the Auras public indexer for pairs, candles and recent fills.
- **Impact:** If the indexer is unavailable or incomplete, market data may be delayed or absent. The UI must show that state and must not fabricate missing data.

## Environment verification still required

- Run `npm ci`, `npm run typecheck`, `npm run lint` and `npm run build` in an environment with npm registry access.
- Run `npm run test:strategies` and `npm run test:trading`.
- Run read-only Asentum chain checks.
- Test wallet connection, quote refresh, market swap, Auras v2 limit-order post/cancel, strategy deployment/stop/withdraw and ARC-20 deploy/init/verification on testnet.
- Do not run real wallet-funded transactions without the wallet owner's explicit approval.

## Historical notes

Older issue descriptions claiming that strategy templates were not wired to the app, that a backend wallet database existed, or that a mean-reversion template was part of the current eight-template catalog are not current product specifications. Check `src/lib/templates.ts` and `docs/PRODUCT_GUIDE.md` for the supported template list.
