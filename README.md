<div align="center">

# STRATA

### Autonomous On-Chain Trading Strategies on Asentum

[![Live App](https://img.shields.io/badge/Live%20App-strata--dapp.vercel.app-00d5c8?style=for-the-badge&logo=vercel)](https://strata-dapp.vercel.app)
[![Chain](https://img.shields.io/badge/Chain-Asentum%201423%20Testnet-00d5c8?style=for-the-badge)](https://explorer.asentum.com)
[![Architecture](https://img.shields.io/badge/Architecture-100%25%20Decentralized%20·%20No%20Backend-8957e5?style=for-the-badge)](#-security--privacy)
[![Privacy](https://img.shields.io/badge/Privacy-Zero%20Data%20Collection-green?style=for-the-badge)](#-privacy-and-user-protection)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

<br/>

**Strata** is an autonomous trading protocol where strategies run directly on the blockchain as smart contracts rather than fragile off-chain bots.
Deployed once, scheduled by the blockchain protocol itself, and verified through public on-chain source code.

[🌐 Open Web App](https://strata-dapp.vercel.app) · [Protocol Contracts](#-system-contracts--network) · [How It Works](#-how-it-works) · [Trading Mechanisms](#-core-mechanisms) · [Security & Privacy](#-privacy-and-user-protection)

</div>

---

## 🔭 What is Strata?

In traditional automated trading and DeFi, running an automated strategy requires hosting an off-chain bot on a private VPS, setting up API keys, managing cron jobs, and constantly monitoring server uptime. If the server crashes or loses internet connectivity at 3:00 AM, the strategy fails.

**Strata completely changes this paradigm on the Asentum blockchain.**

On Asentum, trading logic is authored as a native JavaScript smart contract and registered with the blockchain's native **protocol cron registry**. The network's block builders trigger execution at specified block intervals natively:

- **100% On-Chain:** Strategy logic lives permanently on the blockchain.
- **Protocol-Scheduled:** Execution is triggered directly by block builders (`cron.schedule()`). No external keeper bots, VPS hosting, or keeper subscriptions.
- **DEX-Integrated:** Prices and liquidity are queried directly from the **Auras AMM** TWAP (Time-Weighted Average Price) accumulators, eliminating external oracle reliance.
- **Transparent & Auditable:** Source code is stored on-chain and verified in the browser using BLAKE3 cryptographic hashes.
- **Fully Serverless:** The web application is a static client that talks directly to the blockchain RPC without any intermediate backend servers.

---

## 🏛️ System Contracts & Network

Strata interacts with the following verified protocol contracts on the **Asentum Testnet**:

| Parameter / Contract | Address / Value | Details |
|---|---|---|
| **Network** | Asentum Testnet | Chain ID: `1423` (2s block time) |
| **Public RPC Gateway** | `https://testnet.asentum.com` | Direct CORS-enabled JSON-RPC endpoint |
| **Block Explorer** | `https://explorer.asentum.com` | Official Asentum ledger & block explorer |
| **Auras AMM Contract** | [`0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd`](https://explorer.asentum.com/address/0x63f640a9b98b6f28e06cb5cc0fce5d72b6c0eabd) | Core decentralized exchange & TWAP oracle |
| **Protocol Cron Registry** | `0x0000000000000000000000000000000000000006` | Built-in system contract for autonomous scheduling |
| **Native ASE Sentinel** | `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` | Standard identifier for the native ASE asset leg |
| **Strata Hub Contract** | [`ase1utdzul2gxdw4c60fr7fcphghlak63sjf8mqnut`](https://explorer.asentum.com/address/ase1utdzul2gxdw4c60fr7fcphghlak63sjf8mqnut) | Canonical protocol contract for strategy registration, escrow, & airdrop telemetry |
| **Protocol Deployer Wallet** | [`ase1aluuy3j3q0xc6dqmc5amjzn0x4tt9sl606h5et`](https://explorer.asentum.com/address/ase1aluuy3j3q0xc6dqmc5amjzn0x4tt9sl606h5et) | Official protocol treasury & deployer address on Asentum Testnet |

---

## ⚙️ How It Works

```
        ┌────────────────────────────────────────────────────────┐
        │                 Asentum Blockchain                     │
        │                                                        │
        │  ┌──────────────────────┐    Every N seconds           │
        │  │ Protocol Cron Engine │ ─────────────────────┐       │
        │  │ (0x00...0006)        │                      │       │
        │  └──────────────────────┘                      │       │
        │                                                ▼       │
        │                                    ┌────────────────┐  │
        │           consult(poolId)          │ Strategy       │  │
        │      ┌───────────────────────────  │ Smart Contract │  │
        │      │                             │ (JavaScript)   │  │
        │      ▼                             └───────┬────────┘  │
        │  ┌──────────────────────┐                  │           │
        │  │ Auras AMM            │                  │           │
        │  │ (0x63f6...0eabd)     │ ◄────────────────┘           │
        │  │ TWAP & Spot Reserves │    swapExactIn(token → ASE)  │
        │  └──────────────────────┘    (if trigger condition)    │
        └────────────────────────────────────────────────────────┘
```

1. **Self-Scheduling:** When a strategy contract is initialized (`init`), it calls `cron.schedule()` with its execution interval, gas escrow, and parameters.
2. **Autonomous Execution:** With every passing interval, the block builder executes the contract's `tick()` method inside the block generation cycle.
3. **Price Consultation:** The contract inspects real-time reserves and TWAP from Auras AMM via asynchronous cross-contract call (`E(AURAS).consult(poolId)`).
4. **Trigger Evaluation:** The contract computes price drift vs. configured thresholds. If conditions match, it dispatches an atomic swap (`swapExactIn`).
5. **Event Emission:** Every signal (`buy`, `sell`, `hold`) and trade fill emits an on-chain indexed event (`Signal`, `Fill`), visible across the explorer and Strata dashboard.

---

## 🛡️ Privacy and User Protection

### 🔒 Zero Wallet Data Collection
- **No Database, No Logs:** Strata does **NOT** collect, record, track, or share connected wallet addresses, balances, or transaction activities.
- **Zero Analytics / Telemetry:** No third-party trackers, Google Analytics, cookies, or user fingerprinting scripts are embedded.
- **Client-Side Only:** All blockchain queries are initiated directly from your browser to `https://testnet.asentum.com` via open CORS. There is no middleman backend or proxy server capable of recording your requests.

### 🔑 Non-Custodial Architecture
- **Keys Never Leave Your Device:** Connections occur via `@asentum/connect` using either the official Chrome extension or the Telegram wallet bot.
- **Signing Only:** The web interface never generates, accesses, requests, or stores private keys or seed phrases. Your wallet only approves and cryptographically signs transactions.
- **BLAKE3 Source Integrity:** Before interacting with or funding any strategy, the web client computes the `blake3` hash of the contract's source code and verifies it against the `codeHash` stored on the blockchain. Any tampering or bytecode divergence is immediately flagged.
- **Isolated Gas Escrow:** Strategy executions are prepaid through a dedicated gas escrow. If a user decides to deactivate a strategy, the cron job is cancelled and remaining escrow is returned.

---

## 📊 Core Strategy Archetypes

Strata supports multiple algorithmic models deployed as autonomous contracts:

| Strategy | Execution Interval | Logic & Mechanism | Funding |
|---|---|---|---|
| **Momentum Signal** | 60 sec | Evaluates AMM TWAP drift and emits on-chain trading signals (`buy` / `sell` / `hold`) | Gas Escrow only |
| **Momentum Trader** | 60 sec | Listens to TWAP momentum; automatically executes token-side swaps when threshold is reached | Gas + ARC-20 Tokens |
| **DCA (Dollar-Cost Averaging)** | 3,600 sec | Executes fixed-notional purchases at regular time intervals regardless of short-term volatility | Gas + ARC-20 Tokens |
| **Grid Trading** | 60 sec | Maintains multi-level layered buy and sell orders around a baseline price band | Gas + ARC-20 Tokens |
| **TWAP Order Slicer** | 300 sec | Breaks large order sizes into smaller discrete legs over time to minimize price impact | Gas + ARC-20 Tokens |
| **Mean Reversion** | 120 sec | Sells into overextended upward price deviations and accumulates during oversold dips | Gas + ARC-20 Tokens |

---

## 🖥️ Web Application Features

The live application at [**strata-dapp.vercel.app**](https://strata-dapp.vercel.app) provides a comprehensive terminal for on-chain automated strategies:

### 1. Live Dashboard & AMM Tape
- Real-time block heights (finalized head and tip).
- Live Auras AMM pool reserves, liquidity, and token quotes.
- Live on-chain transaction tape showing real-time swaps and strategy triggers.

![Strata Dashboard](docs/screenshots/home.png)

### 2. Strategy Registry & Hash Verifier
- Automatic discovery of on-chain strategy contracts carrying the Strata signature.
- Instant client-side **BLAKE3 source code verification** against on-chain bytecode hashes.
- Real-time monitoring of contract token balances, remaining gas escrow, and execution history.

![Strata Strategy Registry](docs/screenshots/deploy.png)

### 3. Interactive Mechanics & Visualizer (`/how`)
- Interactive threshold simulator demonstrating how price drift triggers `buy` / `hold` / `sell` signals in real time.
- Documentation of Asentum VM execution limits and cross-contract calling rules (`E()` primitives).

![Strata Mechanics](docs/screenshots/how.png)

---

## ⚖️ Bot vs. On-Chain Contract Comparison

| Feature | Centralized Trading Bot | Strata On-Chain Strategy |
|---|---|---|
| **Execution Environment** | Centralized VPS / Home PC | Directly inside blockchain block creation |
| **Uptime Guarantee** | Vulnerable to crashes, network loss, host downtime | 100% blockchain network uptime |
| **Scheduler** | Server `cron` daemon or commercial keeper | Protocol-level system registry (`cron.schedule`) |
| **Code Transparency** | Closed-source or private on a server | 100% public source code verified on-chain |
| **Tamper Resistance** | Server owner can modify logic anytime | Code is immutable once deployed |
| **Price Data Source** | External centralized APIs or private websockets | Auras AMM's native TWAP accumulators |
| **Security Risk** | API keys and private keys stored on server | Non-custodial, no server keys exist |

---

## 📄 License & Ecosystem

- **Protocol:** Built on [Asentum](https://www.asentum.com) (Chain ID `1423`).
- **DEX Venue:** [Auras AMM](https://auras.finance).
- **License:** Open source under the [MIT License](LICENSE).
- **Security Policy:** Detailed disclosure guidelines available in [SECURITY.md](SECURITY.md).
