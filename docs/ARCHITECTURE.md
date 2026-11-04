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

## 🔧 Deployment Architecture

### Application Deployment

1. Build production bundle with Vite
2. Deploy to static hosting (e.g., Vercel, Netlify)
3. Configure environment variables
4. Enable production mode

### Strategy Deployment

1. Generate deterministic wallet
2. Fund wallet with ASE tokens
3. Deploy contract to chain
4. Register cron job
5. Verify BLAKE3 hash
6. Fund gas escrow

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

- Strategy backtesting
- Performance analytics dashboard
- Strategy marketplace
- Advanced order types
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

### Compass

Compass markers represent verified strategies from the same protocol snapshot. Marker details are sourced from each strategy's name, template, symbol, stop/cron state, trade count, and indexed fill timestamps. “Last execution” is the most recent indexed fill timestamp available to that strategy; “Next run” is derived from the cron record's `nextRunAt` (seconds or milliseconds). Missing chain fields are displayed as unavailable rather than fabricated. The visual clock/countdown is presentation only and does not trigger an execution.

### Analytics versus Leaderboard

Analytics is a protocol-level time-series view: it applies a selected range to indexed fill timestamps and groups executions and ASE volume into buckets, with pair activity/strategy distribution. Leaderboard is a ranking view: verified strategy rows are sorted by selected measurable values (fills, gross ASE, inventory mark, or last fill), with creator/strategy identity and links to contract detail. These are separate projections of the same underlying indexed source, not separate sources of truth. No profitability ranking is claimed without a trustworthy cost basis.

### Data limitations

Indexer coverage and timestamp availability can bound historical views. A stale snapshot may be shown after a refresh error; the UI should label it as stale. Missing timestamps cannot be reliably assigned to a time-window chart. Contract/source verification is an integrity check and is not a security audit or guarantee of strategy performance.
