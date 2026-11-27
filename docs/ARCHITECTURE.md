# Strata Architecture

This document describes the architecture of the Strata trading strategy platform on the Asentum blockchain.

## 🏗️ System Overview

Strata consists of three main components:

1. **Smart Contracts** - JavaScript-based trading strategies deployed on-chain
2. **Web Application** - React-based frontend for strategy management
3. **Deployment Scripts** - Tooling for deploying strategies to the blockchain

## 📦 Component Architecture

### Smart Contracts

Strata contracts are written in plain JavaScript and deployed directly to the Asentum blockchain. Key characteristics:

- **No compilation required** - Source code is stored on-chain as-is
- **BLAKE3 verification** - Hash verification ensures code integrity
- **Cron scheduling** - Protocol-level job registry for execution
- **TWAP oracle** - Uses AMM's built-in price accumulator

#### Contract Structure

```javascript
// Example contract structure
const STORAGE_KEY = 'strategy:data';

function init() {
  // Initialization logic
  storage.set(STORAGE_KEY, JSON.stringify({
    initialized: true,
    owner: msg.sender
  }));
}

function tick() {
  // Main execution logic called by cron
  const data = JSON.parse(storage.get(STORAGE_KEY));
  // Trading logic here
  emit('tick', { timestamp: block.timestamp });
}
```

### Web Application

The web application is built with:
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **React Router** - Client-side routing
- **Asentum Connect Kit** - Wallet integration

#### Directory Structure

```
src/
├── components/    # Reusable UI components
├── config/        # Configuration files
├── lib/           # Utility libraries
├── pages/         # Page components
├── App.tsx        # Main application component
├── main.tsx       # Application entry point
├── styles.css     # Global styles
└── types.ts       # TypeScript type definitions
```

### Deployment Scripts

TypeScript scripts for deploying strategies:
- `deploy.ts` - Main deployment script
- `check-chain.ts` - RPC surface validation
- `check-verify.ts` - BLAKE3 verification

## 🔐 Security Architecture

### On-Chain Security

1. **Source Verification**
   - BLAKE3 hash of source code stored on-chain
   - Verification before funding strategies
   - Flagged if hash mismatch detected

2. **Re-entry Protection**
   - Asynchronous cross-contract calls
   - Failed legs revert entire transaction
   - No re-entry possible mid-execution

3. **Gas Escrow**
   - Pre-funded gas for scheduled executions
   - Kill switch refunds remaining escrow
   - Prevents runaway gas consumption

### Client-Side Security

1. **Wallet Integration**
   - Browser never holds private keys
   - Wallet only signs transactions
   - Uses Asentum connect kit

2. **Seed Management**
   - Deterministic seed generation
   - Stored in git-ignored `.strata/seed.json`
   - User must manually fund generated wallet

## 🔄 Data Flow

### Strategy Deployment Flow

```
User selects template
    ↓
User configures parameters
    ↓
Deploy script generates wallet
    ↓
User funds wallet address
    ↓
Deploy script broadcasts transaction
    ↓
BLAKE3 hash verification
    ↓
Strategy deployed to chain
    ↓
Cron scheduling registered
```

### Strategy Execution Flow

```
Cron trigger fires
    ↓
Strategy contract called
    ↓
Read TWAP from AMM
    ↓
Evaluate trading conditions
    ↓
Execute swap if conditions met
    ↓
Emit decision event
    ↓
Update on-chain state
```

### Web Application Data Flow

```
User requests data
    ↓
App queries blockchain RPC
    ↓
RPC returns pool/strategy data
    ↓
App displays data in UI
    ↓
User initiates action
    ↓
Wallet signs transaction
    ↓
Transaction broadcast to chain
```

## 🗄️ Storage Architecture

### On-Chain Storage

Strategy contracts use the Asentum storage API:

```javascript
storage.set('key', 'value');
const value = storage.get('key');
```

Storage keys follow naming conventions:
- `strategy:data` - Strategy configuration
- `strategy:state` - Current state
- `strategy:history` - Execution history

### Client-Side Storage

Web application uses:
- React state for UI state
- Local storage for preferences
- Session storage for temporary data

## 🌐 Network Architecture

### Blockchain Interaction

The application interacts with the Asentum blockchain through:
- **RPC endpoints** - For reading chain data
- **Wallet connection** - For signing transactions
- **Block explorer** - For transaction verification

### Supported Networks

- **Mainnet** - Production environment (Chain ID: 1423)
- **Testnet** - Development and testing

## 🧪 Testing Architecture

### Contract Testing

- Syntax validation with Node.js `--check`
- BLAKE3 hash verification
- Testnet deployment testing

### Application Testing

- Linting with oxlint
- TypeScript type checking
- Build verification
- Manual testing of deployment flow

## 📊 Monitoring

### On-Chain Monitoring

- Strategy execution events
- Cron job status
- Gas consumption tracking
- Transaction success/failure rates

### Application Monitoring

- RPC call success rates
- Wallet connection status
- Error tracking
- Performance metrics

## 🔧 Hosting & Strategy Lifecycle

### Hosting model

Strata is a static Vite/React client. The production bundle contains no backend, database or server-side wallet state; all chain reads and writes happen in the browser, and signing is delegated to the connected Asentum wallet. The app is served from the linked Vercel project with an SPA rewrite to `index.html`, so client routes work on refresh. The same build can also be served by any static host.

### Strategy lifecycle

1. The owner wallet deploys a strategy contract from the browser.
2. The owner calls `init()` to store the rules, arm the cron job and fund its gas escrow.
3. Non-DCA templates receive their token allocation in a wallet-signed transfer.
4. The browser verifies the deployed source hash and records the contract locally.
5. Cron executes `tick()` on schedule; the owner can stop the bot and withdraw remaining funds at any time.

## 🚀 Performance Considerations

### Contract Performance

- Minimize storage operations
- Batch operations where possible
- Use efficient algorithms
- Limit gas consumption

### Application Performance

- Lazy load components
- Optimize bundle size
- Cache blockchain data
- Debounce API calls

## 🔮 Future Architecture

### Planned Enhancements

- Strategy backtesting and paper simulation
- Native order-book integration, if an Asentum venue exposes a matching engine
- Perpetuals integration after an external provider publishes contracts/API and risk specifications
- Multi-chain support

---

For more information, see:
- [README.md](../README.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [Asentum Documentation](https://www.asentum.com/docs)

## Protocol statistics, status semantics, and provenance

The public dashboard is a read-only projection of Asentum chain data. The shared accounting implementation is `src/lib/protocol.ts`; contract discovery and status fields are supplied by `src/lib/registry.ts`, while RPC/indexer access is implemented in `src/lib/rpc.ts`. UI pages should consume this shared snapshot rather than independently deriving totals.

### Strategy status buckets

For verified strategies, the dashboard uses mutually exclusive status buckets:

- **Active / scheduled:** `cron !== null` and `stopped !== true`.
- **Paused:** `stopped === true`, regardless of whether a cron record remains attached.
- **Idle:** verified total minus active minus paused (a contract with no active schedule and not explicitly stopped).

Thus `Total Bots = Active + Paused + Idle`. “Scheduled” is the active scheduled subset, not a count of paused contracts with a stale cron reference. Unverified discoveries are not included in these verified bot counts.

### Executions and gross ASE

Execution counts and ASE amounts are sourced from verified contract swap/fill events and contract accounting fields. The shared protocol snapshot aggregates strategy `trades`, indexed fill receipts, `realisedWei`, `spentAseWei`, and `markValueAseWei`; token quantities retain their own token decimals and are not summed across assets. **Gross ASE received is gross token-to-ASE proceeds, not net profit or ROI.** It excludes a verified cost basis and must not be labeled as profit. Open inventory is a live AMM quote and can change with pool prices and liquidity.

### Analytics versus Leaderboard

Analytics is a protocol-level time-series view: it applies a selected range to indexed fill timestamps and groups executions and ASE volume into buckets, with pair activity/strategy distribution. Leaderboard is a ranking view: verified strategy rows are sorted by selected measurable values (fills, gross ASE, inventory mark, or last fill), with creator/strategy identity and links to contract detail. These are separate projections of the same underlying indexed source, not separate sources of truth. No profitability ranking is claimed without a trustworthy cost basis.

### Data limitations

Indexer coverage and timestamp availability can bound historical views. A stale snapshot may be shown after a refresh error; the UI should label it as stale. Missing timestamps cannot be reliably assigned to a time-window chart. Contract/source verification is an integrity check and is not a security audit or guarantee of strategy performance.


## Current trading surfaces (2026-11-13)

The current UI separates simple spot swaps (`/swap`), the manual trading workspace (`/advanced`) and contract automation (`/deploy`).

Advanced Trading reads indexed pairs, OHLCV candles and recent fills through `src/lib/marketData.ts`. Market swaps use the on-chain AMM quote/swap path. The Auras v2 limit-order adapter is isolated in `src/lib/limitOrders.ts`; its escrowed AMM orders are not a conventional order book. Market selection is carried into the bot builder using the on-chain `chainPoolId` and venue, not the indexer's display key.

The chart exposes 1m, 5m, 15m, 30m, 1h, 4h, 1d and 1w. The 30m and 1w views are aggregated from indexed source buckets. Missing intervals remain empty; no synthetic prices are generated. The chart timeframe is not the bot execution interval. Asentum Cron's documented minimum recurring interval is one minute.

`src/lib/tokenFactory.ts` deploys a fixed-supply ARC-20 contract and initializes it in a separate wallet-signed transaction. `src/lib/walletRegistry.ts` is an opt-in, browser-local registry of public wallet addresses; it does not upload addresses to a server.

`src/lib/perps.ts` connects to the live AsePad Perps config registry (`0x37d25f3a292f0642af72d6f161eafb18c76e16a6`), dynamically resolving `engine`, `orders`, `liquidation`, `markets`, `vault` and `oracle`. Manual perps trading lives in `src/components/PerpsTerminal.tsx`, and the guided builder for both autonomous `perp-*` Cron contracts and direct `perps.asepad.fun` keeper orders lives in `src/components/PerpsBotBuilder.tsx`.

See [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md) for the current feature matrix and behaviour boundaries.
