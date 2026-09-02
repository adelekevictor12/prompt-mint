# PromptHash Stellar — Frequently Asked Questions

PromptHash Stellar is a Soroban-based marketplace for reusable AI prompt licenses. Creators publish encrypted prompt content, buyers purchase access using Stellar assets, and access is verified through the buyer's wallet and on-chain purchase state.

This FAQ covers common questions about purchasing, access, wallet recovery, pricing, refunds, fees, and troubleshooting.

---

## General

### What is PromptHash Stellar?

PromptHash Stellar is a marketplace for buying and selling reusable AI prompt licenses on Stellar.

Creators publish encrypted prompt content together with public preview information. Buyers purchase access through a Stellar wallet, and the platform verifies the buyer's wallet and on-chain entitlement before releasing the prompt.

The project uses:

* Soroban smart contracts for marketplace state and purchase rights
* Stellar wallets for authentication and transaction signing
* Client-side encryption for prompt content
* An unlock service for authenticated content delivery
* On-chain payment and fee settlement

### Do I own the prompt when I purchase it?

A purchase gives you a license/access right to the prompt rather than ownership of the creator's underlying intellectual property.

The creator remains associated with the listing, while the blockchain records the buyer's entitlement.

### Do I need an account or password?

The marketplace is wallet-based. Your Stellar wallet address is used to identify your purchase entitlement and to authorize transactions and unlock requests.

You should therefore treat access to the wallet controlling your purchased licenses as important account credentials.

---

## Buying Prompts

### How do I purchase a prompt?

The general purchase flow is:

1. Connect a supported Stellar wallet.
2. Browse the available listings.
3. Review the prompt's public preview information and price.
4. Confirm that your wallet has enough funds.
5. Approve the purchase transaction.
6. Wait for the transaction to be successfully recorded on-chain.
7. Sign the unlock challenge when you want to access the prompt.
8. The unlock service verifies your wallet and purchase entitlement before returning the decrypted content.

### What happens when I purchase a prompt?

The purchase transaction records an entitlement for the buyer on the Soroban contract and settles the payment between the creator and the configured platform fee wallet.

The prompt itself remains encrypted. The unlock flow performs an additional wallet-signature and on-chain access check before decrypting the content.

### Can I purchase the same prompt twice?

The contract checks for an existing active purchase entitlement and can reject another purchase with an `ALREADY_PURCHASED` condition.

If you believe you were charged incorrectly, keep the transaction hash and contact the project maintainers rather than submitting repeated transactions.

### What happens if a purchase transaction fails?

A failed or reverted blockchain transaction does not create a successful purchase entitlement.

If a transaction fails, do not assume that you have received access. Check the transaction status on the relevant Stellar network and retry only after confirming the cause of the failure.

If you believe funds were incorrectly affected, provide the transaction hash when reporting the problem.

### Why can't I purchase a listing?

Common reasons include:

* The listing is inactive.
* The listing has expired.
* The contract is temporarily paused.
* You do not have enough funds.
* The listing has already been purchased by your wallet.
* The wallet is connected to the wrong network.
* The listing or payment data is invalid.

The frontend maps several contract errors to user-facing messages, including paused-contract, missing-prompt, authorization, invalid-price, already-purchased, and expired-listing conditions.

---

## Access and Unlocking

### How do I access a prompt I already purchased?

Reconnect the Stellar wallet that made the purchase and open your purchased prompts/profile area.

When you request the prompt, the application obtains a short-lived challenge. Your wallet signs that challenge, and the unlock service verifies:

1. The challenge is valid.
2. The signature belongs to the connected wallet.
3. The wallet has an appropriate on-chain access entitlement.

Only after these checks does the service decrypt and return the prompt.

### Why can't I unlock a prompt I purchased?

First, make sure you are connected with the **same wallet that owns the purchase entitlement**.

Other possible causes include:

* An expired unlock challenge.
* A stale browser session.
* A network or RPC problem.
* The contract being temporarily paused.
* An incorrect wallet/network connection.
* A listing or access state problem.
* A temporary unlock-service failure.

Try requesting a new challenge and retrying the unlock operation.

### Do I lose access if the creator stops selling the prompt?

Deactivating a listing prevents new sales, but it does not by itself remove an existing purchase entitlement.

Existing access is determined by the contract's access state rather than simply by whether the listing is currently active.

### What happens if the marketplace is temporarily paused?

The contract has an administrative pause mechanism.

While paused, state-changing marketplace operations such as creating listings, purchasing, and updating listing information can fail. Read-only operations, including access checks and prompt lookups, remain available.

If the marketplace is paused, wait until normal operation resumes before retrying a purchase or other state-changing action.

### Can an existing purchaser lose access because a listing is taken down?

A takedown or dispute state does not automatically mutate an existing purchase entitlement.

However, the repository documents an emergency-suspension state that can block unlock access for existing purchasers during a serious incident.

If access is blocked after a takedown or security incident, retain your purchase transaction hash and contact the maintainers.

---

## Wallet Loss and Key Recovery

### What happens if I lose access to my wallet?

Prompt purchase rights are associated with wallet addresses.

If you lose the private key or recovery credentials for the wallet that purchased a prompt, the platform cannot simply identify you by email or username and move the entitlement to another wallet.

Your first step should be to recover the original Stellar wallet using the wallet provider's supported recovery mechanism.

### Can PromptHash recover my wallet private key?

No.

The application should never require you to provide your private key or secret recovery phrase to the platform.

Wallet recovery must be performed through your wallet provider using its own recovery mechanisms.

**Never send your secret key or recovery phrase to PromptHash maintainers or anyone claiming to provide support.**

### What if I create a new wallet after losing my old one?

A new wallet has a different Stellar address.

Because purchase access is tied to the wallet address recorded on-chain, simply connecting a new wallet does not automatically transfer your previous purchase history or access rights to it.

Recover the original wallet whenever possible.

### What is the encryption key used for a prompt?

The full prompt is encrypted before it is published. The encrypted listing contains the information required by the unlock service to process the encrypted content.

The unlock service performs key unwrapping and decryption only after verifying the buyer's authorization and on-chain access.

Users should not attempt to manually recover or extract encryption keys from the application.

### Can I recover a prompt's encryption key if my wallet is lost?

The important distinction is between **wallet recovery** and **prompt decryption**.

The platform does not use your wallet's private key as the prompt's encryption key. However, the wallet is required to prove that you are entitled to unlock the content.

If you cannot authenticate with the wallet that owns the purchase, the unlock service will not treat a different wallet as the purchaser.

Recover the original wallet first.

---

## Price Changes

### Can a creator change the price of a prompt?

Yes.

Creators can update the price of an existing listing. The contract requires the new price to be greater than zero and records the price change in the prompt's price-history data.

### What happens if the price changes after I purchase?

Changing the listing price does not retroactively change the purchase that you already made.

A buyer's completed purchase is recorded as an on-chain entitlement, while the listing's current price is used for subsequent purchases.

For example:

* You purchase a prompt for 10 XLM.
* The creator later changes the listing price to 15 XLM.
* Your completed purchase is not repriced to 15 XLM.
* A later buyer may pay 15 XLM.

### Can a creator lower the price after I purchase?

Yes.

A creator may change the current listing price. A later lower price does not automatically create a refund or price adjustment for previous purchases.

### Can I see whether a prompt's price has changed?

The contract records price-history entries containing the previous price, new price, timestamp, and sequence number.

Where the frontend exposes that information, it can be used to understand the listing's pricing history.

---

## Platform Fees

### What is the PromptHash platform fee?

The current Soroban contract initializes the platform fee to **5%**.

The fee is represented in basis points, so the default value of `500` corresponds to 5%.

### Can the platform fee change?

Yes.

The platform fee is configurable through the contract's administrative multisig.

The contract has a maximum platform-fee safeguard of **20%**.

Therefore, the 5% value is the current contract default, not an immutable lifetime fee promise.

### Who receives the platform fee?

The fee portion of a purchase is routed to the contract's configured platform fee wallet.

The remaining amount is routed according to the purchase settlement rules to the creator and any applicable configured splits.

### Does the buyer pay an additional 5% on top of the listed price?

The platform fee is calculated as part of the purchase settlement rather than being presented as a separate card-payment-style surcharge.

The exact amount paid is determined by the purchase amount accepted by the contract and the configured settlement rules.

Buyers should also maintain enough Stellar balance to cover applicable network/Soroban transaction costs and any wallet/account reserve requirements.

### Why does my wallet need more XLM than the prompt price?

A purchase may require additional balance for blockchain transaction costs and Stellar account reserve requirements.

The frontend includes a checkout balance check that considers:

* The purchase/cart total.
* A fee buffer for Soroban/network costs.
* The Stellar minimum account reserve.

Having exactly the displayed prompt price may therefore not always be sufficient to complete a transaction.

---

## Refunds and Disputes

### Can I get a refund?

Prompt purchases are blockchain transactions, so there is no general automatic refund mechanism that reverses a completed purchase through the marketplace contract.

The current contract does not expose a standard `refund` operation.

If you believe a purchase involved fraud, prohibited content, or a serious technical problem, report the issue to the maintainers with the relevant transaction hash, prompt ID, and supporting evidence.

### What should I do if the prompt content is fraudulent or does not match its listing?

The prompt includes a content hash.

During the unlock process, the decrypted content is hashed again and compared against the stored content hash. A mismatch can indicate corrupted content, an incorrect payload, or another integrity problem.

If you encounter a hash mismatch:

1. Save the transaction hash.
2. Save the prompt ID.
3. Record the error message.
4. Do not repeatedly submit purchases.
5. Report the problem with any relevant evidence.

### Does a dispute automatically refund my purchase?

No.

The repository includes a dispute/takedown lifecycle, but opening or resolving a dispute does not automatically mean that an existing purchase entitlement is refunded.

The documented dispute flow is designed to keep evidence and outcomes auditable. Any financial remedy must follow the project's actual supported resolution process.

### What happens to my access during a dispute?

A normal takedown/dispute state does not by itself mutate existing purchase entitlements.

Emergency suspension is a separate mechanism that can temporarily block unlock access to existing purchasers during a serious incident.

---

## Content and Licensing

### Can I share a purchased prompt with someone else?

Access is associated with the wallet that holds the purchase entitlement.

Do not assume that purchasing a prompt gives every other wallet access to the encrypted content.

If multiple people need access, use whatever licensing or transfer functionality the marketplace provides rather than sharing wallet credentials.

### Can a license be transferred?

The contract contains a license-transfer mechanism that can move an existing purchase entitlement from one buyer to another.

A transfer requires authorization from the existing holder and the new buyer, and the contract records the transfer.

Where a resale price is used, the contract also contains a creator royalty mechanism.

### Can I use a purchased prompt commercially?

Your purchase gives you the rights defined by the applicable prompt/license terms. A purchase should not be interpreted as automatically transferring the creator's intellectual-property rights to you.

Check the creator's listing and applicable licensing terms before using purchased content commercially.

### Can a creator edit the encrypted prompt after publishing?

The encrypted prompt content is not simply edited in place like ordinary database text.

If the creator needs to publish materially different prompt content, the safer marketplace flow is to publish a new version/listing while managing the previous listing separately.

---

## Security and Privacy

### Is the prompt stored in plaintext on-chain?

No.

The project is designed so that the full prompt is encrypted before it is stored.

Public listing information can include metadata such as the title, category, preview, price, and other listing fields, while the actual prompt payload is stored in encrypted form.

### Can the platform see my private key?

The platform should never receive your Stellar wallet private key or secret recovery phrase.

Wallet signatures are used to prove authorization without giving the application control of the wallet's private key.

### Why does the unlock service need to verify my wallet?

The unlock service is the delivery gate.

The service checks the signed challenge and verifies the wallet's on-chain entitlement before decrypting and returning the prompt.

This prevents an arbitrary wallet from requesting plaintext content merely by knowing a prompt ID.

### Are unlock challenges permanent?

No.

Unlock authentication uses short-lived challenge tokens designed to reduce replay risk.

If a challenge expires, request a new challenge and sign the new message with the correct wallet.

---

## Troubleshooting

### I connected the wrong wallet. What should I do?

Disconnect or switch to the wallet that originally purchased the prompt.

The application checks the wallet address against the on-chain access entitlement, so signing an unlock request with an unrelated wallet will not grant access.

### I am on the wrong Stellar network. Can I still access my purchase?

The wallet and application must be connected to the network containing the relevant contract and purchase state.

If the application reports a network mismatch, switch to the network configured for the deployment before attempting the purchase or unlock operation again.

### What should I include when reporting a problem?

Include as much non-sensitive diagnostic information as possible:

* Prompt ID
* Transaction hash, if a transaction was involved
* Approximate time of the problem
* Wallet/network being used
* The exact error message
* Whether the problem occurred during purchase or unlock
* Steps that reproduce the problem

**Never include your private key, secret recovery phrase, wallet seed, or other credentials.**

### What if the content hash does not match?

A hash mismatch means the content returned by the unlock flow does not match the content hash associated with the listing.

This should be treated as an integrity problem and reported rather than ignored.

### What if the marketplace says it is temporarily unavailable?

The Soroban contract has an administrative pause mechanism. During a pause, state-changing operations may be rejected while read-only marketplace state remains available.

Wait for the service to recover before retrying transactions.

---

## Quick Reference

| Question                                               | Short answer                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Can I get an automatic refund?                         | No automatic on-chain refund mechanism is currently provided.                              |
| What if I lose my wallet?                              | Recover the original wallet; access is tied to its address.                                |
| Can PromptHash recover my private key?                 | No. Never share it with anyone.                                                            |
| Can a creator change a price?                          | Yes.                                                                                       |
| Does a price change affect previous purchases?         | No, completed purchases are not repriced.                                                  |
| What is the current platform fee?                      | 5% by default in the current contract.                                                     |
| Can the platform fee change?                           | Yes, through the contract's administrative controls, subject to the contract's maximum.    |
| What is the maximum platform fee?                      | 20%.                                                                                       |
| Can deactivating a listing remove existing access?     | Deactivation stops new sales; it does not by itself remove existing purchase entitlements. |
| Why do I need to sign an unlock message?               | To prove that the wallet requesting plaintext controls the entitled address.               |
| What if my unlock challenge expires?                   | Request a fresh challenge.                                                                 |
| What if a prompt fails its content-hash check?         | Treat it as an integrity issue and report it with the prompt ID and transaction hash.      |
| Can the marketplace be paused?                         | Yes. Administrative pause controls can temporarily stop state-changing operations.         |
| Should I ever give support my seed phrase/private key? | **No. Never.**                                                                             |
