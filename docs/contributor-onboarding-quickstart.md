# Contributor Onboarding Quickstart Guide & Video Script

Welcome to PromptMint! This guide provides an end-to-end, friction-free onboarding walkthrough for new contributors, covering wallet configuration, testnet funding, local environment setup, testing workflows, and a full video walkthrough script.

---

## 1. Prerequisites & Environment Setup

Ensure you have the following installed on your development machine:

- **Node.js**: v20.x LTS or higher
- **npm** or **pnpm**: v9.x or higher
- **Rust & Cargo**: v1.80+ (for Soroban smart contract development)
- **Stellar CLI**: `stellar-cli` v22+
- **Docker & Docker Compose**: (optional, for local MongoDB / IPFS nodes)

```bash
# Clone the repository
git clone https://github.com/PromptMintLabs/prompt-mint.git
cd prompt-mint

# Install frontend dependencies
npm install

# Install server dependencies
cd server && npm install && cd ..
```

---

## 2. Stellar Testnet Wallet Setup

PromptMint integrates with Stellar wallets (Freighter, Albedo, and xBull) via the Stellar Wallets Kit.

### Step A: Install Freighter Wallet
1. Install the [Freighter Browser Extension](https://www.freighter.app/).
2. Open Freighter, click **Create New Wallet**, and store your 12-word recovery passphrase securely.
3. Set your wallet password.

### Step B: Switch Network to Testnet
1. Open the Freighter extension popup.
2. Click the Network dropdown in the top-right corner (default is `Public`).
3. Select **Testnet** (`https://soroban-testnet.stellar.org`).

---

## 3. Funding Your Testnet Wallet via Friendbot

Stellar Testnet accounts must be funded before they can submit transactions.

### Option 1: Web Interface (Stellar Laboratory)
1. Copy your public key from Freighter (starts with `G...`).
2. Visit the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator?network=testnet).
3. Paste your public address into the text box and click **Get test network lumens**.
4. Check your Freighter wallet — you will see a balance of 10,000 testnet XLM.

### Option 2: Command Line (Stellar CLI / curl)
```bash
# Using Stellar CLI:
stellar keys generate --network testnet alice --fund

# Or using curl directly to Friendbot:
curl "https://friendbot.stellar.org/?addr=YOUR_WALLET_PUBLIC_KEY"
```

---

## 4. Environment Variables Configuration

Copy the example environment files for both frontend and backend:

```bash
# 1. Root / Frontend environment
cp .env.example .env.local

# 2. Server environment
cp server/.env.example server/.env
```

Ensure your `NEXT_PUBLIC_STELLAR_NETWORK` is set to `testnet` and `NEXT_PUBLIC_RPC_URL` points to `https://soroban-testnet.stellar.org`.

---

## 5. Running the Local Development Stack

Start the client and API servers:

```bash
# Terminal 1: Run frontend dev server
npm run dev
# -> Accessible at http://localhost:3000

# Terminal 2: Run server API
cd server && npm run dev
# -> Accessible at http://localhost:4000
```

---

## 6. Running Tests & Linting

Before opening a pull request, run all verification suites:

```bash
# Frontend Unit & Component Tests
npm test

# Server Unit & Integration Tests
cd server && npm test && cd ..

# Typecheck and Linting
npm run lint
npx tsc --noEmit
```

---

## 7. Contributor Onboarding Video Script

Use this structured script to record or follow along with the onboarding video.

### **Video Title**: *PromptMint Contributor Quickstart: Zero to First PR*
**Duration**: ~3 minutes 30 seconds

| Timecode | Scene / Visual | Narration / Action |
|---|---|---|
| **0:00 - 0:25** | **Intro & Architecture Overview**<br>- Title card: PromptMint Contributor Quickstart.<br>- Architecture diagram on screen. | *"Hey everyone! Welcome to PromptMint. In this quick 3-minute video, we will walk you through setting up your local dev environment, creating and funding a Stellar testnet wallet with Friendbot, and running the full stack so you can contribute with confidence."* |
| **0:25 - 0:55** | **Cloning & Dependencies**<br>- Terminal view: cloning repo, running `npm install` in root and `server/`. | *"First, clone the PromptMint repo from GitHub and install both the client and server dependencies with npm install. PromptMint uses Next.js on the frontend and Express + TypeScript on the backend."* |
| **0:55 - 1:40** | **Wallet Setup & Testnet Funding**<br>- Browser view: Freighter extension popup.<br>- Switching network to Testnet.<br>- Navigating to Stellar Laboratory / Friendbot. | *"Next, let's configure your testnet wallet. Install the Freighter extension, create a development account, and toggle your network from Public to Testnet. Then copy your public G-address, pop over to the Stellar Laboratory Friendbot, and click 'Get test network lumens'. Within seconds, your wallet is funded with 10,000 testnet XLM."* |
| **1:40 - 2:20** | **Environment Configuration**<br>- VS Code editor view: `.env.example` to `.env.local` and `server/.env`. | *"Now configure your local environment files. Copy .env.example to .env.local for the frontend and server/.env.example to server/.env. The defaults are already pre-configured for the Stellar Soroban testnet RPC endpoint."* |
| **2:20 - 2:55** | **Running Local Stack & Connecting Wallet**<br>- Browser view: `http://localhost:3000`.<br>- Clicking 'Connect Wallet', selecting Freighter. | *"Let's fire up the local servers! Run npm run dev in your terminal and visit localhost:3000. Click 'Connect Wallet' in the top navigation bar, approve the connection in Freighter, and you're ready to test minting, prompt unlocking, and browsing listings."* |
| **2:55 - 3:30** | **Testing, Linting & Submitting PRs**<br>- Terminal view: `npm test`, `npm run lint`.<br>- GitHub Pull Request screen. | *"Before submitting your pull request, run `npm test` and `npm run lint` to verify that all CI gates pass locally. Check our open issues labeled 'good-first-issue' and join our community Discord if you have any questions. Happy hacking!"* |

---

## 8. Helpful Links & Resources
- [Stellar Developers Documentation](https://developers.stellar.org/)
- [Freighter Wallet Docs](https://docs.freighter.app/)
- [Stellar Laboratory](https://laboratory.stellar.org/)
- [PromptMint Architecture Docs](./architecture.md)
