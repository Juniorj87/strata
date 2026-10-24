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
