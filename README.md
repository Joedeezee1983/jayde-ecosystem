# JayDe Ecosystem

**AI-powered blockchain marketplace built on Base.**

JayDe Ecosystem is a decentralized marketplace where creators, freelancers, and buyers transact in `$JAYDE` — a native ERC-20 token secured by smart contract escrow. Every trade is trustless: funds lock on-chain when a buyer commits and only release when they confirm delivery, or are returned via the dispute system. AI tooling (roadmap) will automate listing generation, fraud detection, and price discovery on top of this foundation.

---

## Contracts

### `JayDeToken` — `$JAYDE` ERC-20
The native currency of the ecosystem. Fixed supply of **1,000,000,000 JAYDE** minted at deployment — no inflation, no further minting. Implements ERC-20Burnable (deflationary mechanics) and ERC-20Permit (gasless approvals for escrow interactions via EIP-2612).

### `JayDeEscrow`
Trustless escrow for JAYDE-denominated trades. Funds lock in the contract when a buyer creates a trade and release only on explicit buyer confirmation. Either party can raise a dispute, freezing the trade for owner arbitration. A configurable fee (default 2.5%, max 10%) is taken from the seller's payout on completion.

| Function | Who | What |
|---|---|---|
| `createTrade(seller, amount)` | Buyer | Locks JAYDE in escrow |
| `completeTrade(tradeId)` | Buyer | Releases funds to seller minus fee |
| `refundTrade(tradeId)` | Buyer or Owner | Returns full amount to buyer |
| `disputeTrade(tradeId)` | Buyer or Seller | Freezes trade for arbitration |

### `JayDeMarketplace`
On-chain listing registry that composes with `JayDeEscrow` via a **proxy buyer pattern** — the marketplace holds the escrow buyer role so listings remain fully composable without modifying the escrow contract. Sellers post listings with a title, JAYDE price, and IPFS hash (image + description). Buyers purchase in one transaction; the marketplace routes funds through escrow automatically.

| Function | Who | What |
|---|---|---|
| `createListing(title, price, ipfsHash)` | Seller | Registers a listing on-chain |
| `deactivateListing(listingId)` | Seller | Removes listing from market |
| `purchaseListing(listingId)` | Buyer | Locks funds, creates escrow trade |
| `confirmDelivery(purchaseId)` | Buyer | Releases funds to seller |
| `requestRefund(purchaseId)` | Buyer | Returns funds to buyer |
| `disputePurchase(purchaseId)` | Buyer or Seller | Escalates to owner arbitration |
| `resolveDisputeForBuyer(purchaseId)` | Owner | Arbitrates in buyer's favour |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contracts | Solidity `^0.8.24`, EVM target: Cancun |
| Contract framework | [Hardhat](https://hardhat.org/) `^2.22` |
| Language | TypeScript |
| Contract standards | [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) `v5` |
| Target network | [Base](https://base.org/) (Ethereum L2) |
| Testing | Hardhat + Chai + Ethers.js `v6` |
| Type generation | TypeChain (`ethers-v6`) |
| Media storage | IPFS (CID stored on-chain in listings) |

---

## Local Setup

**Requirements:** Node.js 18+, npm

```bash
# 1. Clone the repo
git clone https://github.com/Joedeezee1983/jayde-ecosystem.git
cd jayde-ecosystem

# 2. Install dependencies
npm install

# 3. Copy env template and fill in keys (optional for local testing)
cp .env.example .env

# 4. Compile contracts
npm run compile

# 5. Run the full test suite (94 tests)
npm test
```

### Deploy locally

```bash
# Start a local Hardhat node in one terminal
npx hardhat node

# Deploy in another terminal
npm run deploy:local
```

Deployed addresses are saved to `deployments/deployments.json`, keyed by network name. Each subsequent deploy to a new network appends without overwriting prior entries.

### Deploy to Base Sepolia (testnet)

Fill in `.env`:
```
DEPLOYER_PRIVATE_KEY=your_private_key
SEPOLIA_RPC_URL=https://sepolia.base.org
ETHERSCAN_API_KEY=your_basescan_key
```

Then add Base Sepolia to `hardhat.config.ts` and run:
```bash
npx hardhat run scripts/deploy.ts --network baseSepolia
```

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Private key of the deploying wallet |
| `SEPOLIA_RPC_URL` | RPC endpoint for Sepolia testnet |
| `MAINNET_RPC_URL` | RPC endpoint for mainnet / Base mainnet |
| `ETHERSCAN_API_KEY` | Basescan API key for contract verification |

> Never commit a funded private key. The `.env` file is gitignored.

---

## Test Coverage

```
JayDeToken       5 tests   — supply, name/symbol, transfer, burn
JayDeEscrow     33 tests   — happy path, refunds, disputes, access control, edge cases
JayDeMarketplace 56 tests  — listing CRUD, purchase flow, delivery, refunds, disputes, access control
─────────────────────────
Total           94 tests   — all passing
```

---

## Roadmap

### Phase 1 — Foundation ✅
- [x] `$JAYDE` ERC-20 token (1B fixed supply, burnable, permit)
- [x] `JayDeEscrow` — trustless trade settlement
- [x] `JayDeMarketplace` — on-chain listing registry
- [x] Full TypeScript test suite (94 tests)

### Phase 2 — Marketplace UI
- [ ] Next.js frontend — browse listings, purchase with MetaMask / Coinbase Wallet
- [ ] IPFS upload flow — drag-and-drop listing image + description pinned to IPFS
- [ ] Seller dashboard — manage listings, track trade status
- [ ] Buyer dashboard — active purchases, dispute controls

### Phase 3 — $JAYDE Token Launch
- [ ] Tokenomics finalisation — vesting schedules, team allocation, liquidity pool
- [ ] Base mainnet deployment and Basescan verification
- [ ] DEX liquidity provision (Uniswap v3 on Base)
- [ ] Token listing and community distribution

### Phase 4 — AI Integration
- [ ] AI listing assistant — generate titles, descriptions, and IPFS metadata from a prompt
- [ ] Fraud detection — flag suspicious trades and repeat dispute actors
- [ ] Price oracle — AI-suggested fair pricing based on category and market data
- [ ] Automated dispute evidence summarisation for arbitrators

### Phase 5 — JayDe Bank
- [ ] JAYDE savings vaults — earn yield by locking tokens
- [ ] Lending against escrowed trades — borrow against locked collateral
- [ ] Revenue sharing — fee distribution to staked JAYDE holders
- [ ] Cross-chain bridge to Ethereum mainnet

---

## License

MIT — see [LICENSE](LICENSE) for details.
