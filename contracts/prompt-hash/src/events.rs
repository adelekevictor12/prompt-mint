use soroban_sdk::{contractevent, Address, Env, String, Vec};

#[contractevent]
struct PromptCreated {
    #[topic]
    pub prompt_id: u128,
    pub creator: Address,
    pub price_stroops: i128,
    pub asset: Address,
}

#[contractevent]
struct PromptSaleStatusUpdated {
    #[topic]
    pub prompt_id: u128,
    pub active: bool,
}

#[contractevent]
struct PromptPriceUpdated {
    #[topic]
    pub prompt_id: u128,
    /// Price in stroops before the change.
    pub previous_price: i128,
    /// Price in stroops after the change.
    pub price_stroops: i128,
}

#[contractevent]
struct PriceBoundsSet {
    pub min_price: Option<i128>,
    pub max_price: Option<i128>,
}

#[contractevent]
struct PromptPurchased {
    #[topic]
    pub prompt_id: u128,
    pub buyer: Address,
    pub creator: Address,
    pub price_stroops: i128,
    pub referrer: Option<Address>,
    pub creator_amount: i128,
    pub platform_amount: i128,
    pub referrer_amount: i128,
}

// ─── #274: Referral tracking events ──────────────────────────────────────
#[contractevent]
struct ReferralCodeRegistered {
    #[topic]
    pub referrer: Address,
    pub code_hash: soroban_sdk::BytesN<32>,
    pub reward_bps: u32,
}

#[contractevent]
struct ReferralRewardPaid {
    #[topic]
    pub prompt_id: u128,
    pub referrer: Address,
    pub buyer: Address,
    pub reward_amount: i128,
}

#[contractevent]
struct LicenseTransferred {
    #[topic]
    pub prompt_id: u128,
    pub seller: Address,
    pub buyer: Address,
    pub creator: Address,
    pub resale_price: i128,
    pub royalty_amount: i128,
}

#[contractevent]
struct PromptTipped {
    #[topic]
    pub prompt_id: u128,
    pub buyer: Address,
    pub amount_tipped: i128,
}

#[contractevent]
struct VoucherAdded {
    #[topic]
    pub prompt_id: u128,
    pub hashed_code: soroban_sdk::BytesN<32>,
    pub discount_bps: u32,
}

#[contractevent]
struct VoucherRemoved {
    #[topic]
    pub prompt_id: u128,
    pub hashed_code: soroban_sdk::BytesN<32>,
}

#[contractevent]
struct ContractPausedStateChanged {
    pub is_paused: bool,
}

#[contractevent]
struct SchemaMigrated {
    pub previous_version: u32,
    pub new_version: u32,
}

#[contractevent]
struct FeeUpdated {
    #[topic]
    pub new_fee_percentage: u32,
}

#[contractevent]
struct FeeWalletUpdated {
    #[topic]
    pub new_fee_wallet: Address,
}

#[contractevent]
struct ListingExtended {
    #[topic]
    pub prompt_id: u128,
    pub new_expires_at: u64,
}

#[contractevent]
struct PromptExpiringSoon {
    #[topic]
    pub prompt_id: u128,
    pub creator: Address,
    pub expires_at: u64,
}

#[contractevent]
struct SubscriptionConfigured {
    #[topic]
    pub creator: Address,
    pub duration_secs: u64,
    pub price: i128,
    pub asset: Address,
    pub active: bool,
}

#[contractevent]
struct SubscriptionEligibilityUpdated {
    #[topic]
    pub prompt_id: u128,
    pub eligible: bool,
}

#[contractevent]
struct SubscriptionRenewed {
    #[topic]
    pub creator: Address,
    pub subscriber: Address,
    pub expires_at: u64,
    pub paid_amount: i128,
    pub renewal_count: u32,
}

pub struct Events;

impl Events {
    pub fn emit_prompt_created(
        env: &Env,
        prompt_id: u128,
        creator: Address,
        price_stroops: i128,
        asset: Address,
    ) {
        PromptCreated {
            prompt_id,
            creator,
            price_stroops,
            asset,
        }
        .publish(env);
    }

    pub fn emit_prompt_sale_status_updated(env: &Env, prompt_id: u128, active: bool) {
        PromptSaleStatusUpdated { prompt_id, active }.publish(env);
    }

    pub fn emit_prompt_price_updated(
        env: &Env,
        prompt_id: u128,
        previous_price: i128,
        price_stroops: i128,
    ) {
        PromptPriceUpdated {
            prompt_id,
            previous_price,
            price_stroops,
        }
        .publish(env);
    }

    pub fn emit_price_bounds_set(env: &Env, min_price: Option<i128>, max_price: Option<i128>) {
        PriceBoundsSet {
            min_price,
            max_price,
        }
        .publish(env);
    }

    pub fn emit_prompt_purchased(
        env: &Env,
        prompt_id: u128,
        buyer: Address,
        creator: Address,
        price_stroops: i128,
        referrer: Option<Address>,
        creator_amount: i128,
        platform_amount: i128,
        referrer_amount: i128,
    ) {
        PromptPurchased {
            prompt_id,
            buyer,
            creator,
            price_stroops,
            referrer,
            creator_amount,
            platform_amount,
            referrer_amount,
        }
        .publish(env);
    }

    // ─── #274: Referral tracking events ───────────────────────────────────
    pub fn emit_referral_code_registered(
        env: &Env,
        referrer: Address,
        code_hash: soroban_sdk::BytesN<32>,
        reward_bps: u32,
    ) {
        ReferralCodeRegistered {
            referrer,
            code_hash,
            reward_bps,
        }
        .publish(env);
    }

    pub fn emit_referral_reward_paid(
        env: &Env,
        prompt_id: u128,
        referrer: Address,
        buyer: Address,
        reward_amount: i128,
    ) {
        ReferralRewardPaid {
            prompt_id,
            referrer,
            buyer,
            reward_amount,
        }
        .publish(env);
    }

    pub fn emit_license_transferred(
        env: &Env,
        prompt_id: u128,
        seller: Address,
        buyer: Address,
        creator: Address,
        resale_price: i128,
        royalty_amount: i128,
    ) {
        LicenseTransferred {
            prompt_id,
            seller,
            buyer,
            creator,
            resale_price,
            royalty_amount,
        }
        .publish(env);
    }

    pub fn emit_prompt_tipped(env: &Env, prompt_id: u128, buyer: Address, amount_tipped: i128) {
        PromptTipped {
            prompt_id,
            buyer,
            amount_tipped,
        }
        .publish(env);
    }

    pub fn emit_voucher_added(
        env: &Env,
        prompt_id: u128,
        hashed_code: soroban_sdk::BytesN<32>,
        discount_bps: u32,
    ) {
        VoucherAdded {
            prompt_id,
            hashed_code,
            discount_bps,
        }
        .publish(env);
    }

    pub fn emit_voucher_removed(env: &Env, prompt_id: u128, hashed_code: soroban_sdk::BytesN<32>) {
        VoucherRemoved {
            prompt_id,
            hashed_code,
        }
        .publish(env);
    }

    pub fn emit_contract_paused_state_changed(env: &Env, is_paused: bool) {
        ContractPausedStateChanged { is_paused }.publish(env);
    }

    pub fn emit_schema_migrated(env: &Env, previous_version: u32, new_version: u32) {
        SchemaMigrated {
            previous_version,
            new_version,
        }
        .publish(env);
    }

    pub fn emit_fee_updated(env: &Env, new_fee_percentage: u32) {
        FeeUpdated { new_fee_percentage }.publish(env);
    }

    pub fn emit_fee_wallet_updated(env: &Env, new_fee_wallet: Address) {
        FeeWalletUpdated { new_fee_wallet }.publish(env);
    }

    pub fn emit_listing_extended(env: &Env, prompt_id: u128, new_expires_at: u64) {
        ListingExtended {
            prompt_id,
            new_expires_at,
        }
        .publish(env);
    }

    pub fn emit_prompt_expiring_soon(
        env: &Env,
        prompt_id: u128,
        creator: Address,
        expires_at: u64,
    ) {
        PromptExpiringSoon {
            prompt_id,
            creator,
            expires_at,
        }
        .publish(env);
    }

    pub fn emit_subscription_configured(
        env: &Env,
        creator: Address,
        duration_secs: u64,
        price: i128,
        asset: Address,
        active: bool,
    ) {
        SubscriptionConfigured {
            creator,
            duration_secs,
            price,
            asset,
            active,
        }
        .publish(env);
    }

    pub fn emit_subscription_eligibility_updated(env: &Env, prompt_id: u128, eligible: bool) {
        SubscriptionEligibilityUpdated {
            prompt_id,
            eligible,
        }
        .publish(env);
    }

    pub fn emit_subscription_renewed(
        env: &Env,
        creator: Address,
        subscriber: Address,
        expires_at: u64,
        paid_amount: i128,
        renewal_count: u32,
    ) {
        SubscriptionRenewed {
            creator,
            subscriber,
            expires_at,
            paid_amount,
            renewal_count,
        }
        .publish(env);
    }

    // ─── #131: Content Classification Events ────────────────────────────────

    pub fn emit_classification_set(
        env: &Env,
        prompt_id: u128,
        classification: String,
        safety_flags: Vec<String>,
    ) {
        ClassificationSet {
            prompt_id,
            classification,
            safety_flags,
        }
        .publish(env);
    }

    pub fn emit_classification_overridden(
        env: &Env,
        prompt_id: u128,
        moderator: Address,
        classification: String,
        safety_flags: Vec<String>,
        reason: String,
    ) {
        ClassificationOverridden {
            prompt_id,
            moderator,
            classification,
            safety_flags,
            reason,
        }
        .publish(env);
    }
}

// ─── Promotional Pricing Events ──────────────────────────────────────────

#[contractevent]
struct ClassificationSet {
    #[topic]
    pub prompt_id: u128,
    pub classification: String,
    pub safety_flags: Vec<String>,
}

#[contractevent]
struct ClassificationOverridden {
    #[topic]
    pub prompt_id: u128,
    pub moderator: Address,
    pub classification: String,
    pub safety_flags: Vec<String>,
    pub reason: String,
}

// ─── Encryption Rotation Events ──────────────────────────────────────────

#[contractevent]
struct EncryptionRotated {
    #[topic]
    pub prompt_id: u128,
    pub previous_version: u32,
    pub new_version: u32,
    pub rotated_at: u64,
}

// ─── Promotional Pricing Events ──────────────────────────────────────────

#[contractevent]
struct PromotionCreated {
    #[topic]
    pub prompt_id: u128,
    pub promotion_id: u128,
    pub creator: Address,
    pub start_time: u64,
    pub end_time: u64,
    pub price: i128,
    pub asset: Address,
}

#[contractevent]
struct PromotionCancelled {
    #[topic]
    pub prompt_id: u128,
    pub promotion_id: u128,
    pub creator: Address,
}

#[contractevent]
struct PromotionApplied {
    #[topic]
    pub prompt_id: u128,
    pub promotion_id: u128,
    pub buyer: Address,
    pub effective_price: i128,
    pub original_price: i128,
}

// ─── #275: Creator Reputation Staking Events ─────────────────────────────

#[contractevent]
struct StakeAdded {
    #[topic]
    pub prompt_id: u128,
    pub creator: Address,
    pub amount: i128,
    pub total_staked: i128,
}

#[contractevent]
struct StakeSlashed {
    #[topic]
    pub prompt_id: u128,
    pub slashed_amount: i128,
    pub remaining_staked: i128,
}

#[contractevent]
struct StakeWithdrawn {
    #[topic]
    pub prompt_id: u128,
    pub creator: Address,
    pub amount: i128,
    pub remaining_staked: i128,
}

// ─── Upgrade Authorization Events (#42) ───────────────────────────────

#[contractevent]
struct UpgradeProposed {
    #[topic]
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
    pub proposed_at: u64,
}

#[contractevent]
struct UpgradeConfirmed {
    #[topic]
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
    pub confirmed_at: u64,
}

#[contractevent]
struct UpgradeCancelled {
    #[topic]
    pub cancelled_wasm_hash: soroban_sdk::BytesN<32>,
}

// NB: `Events` is already declared earlier in this file; this is an additional
// `impl Events` block (multiple impl blocks for one type are valid Rust). The
// duplicate `pub struct Events;` that previously sat here has been removed to
// keep the crate compiling.
impl Events {
    pub fn emit_promotion_created(
        env: &Env,
        prompt_id: u128,
        promotion_id: u128,
        creator: Address,
        start_time: u64,
        end_time: u64,
        price: i128,
        asset: Address,
    ) {
        PromotionCreated {
            prompt_id,
            promotion_id,
            creator,
            start_time,
            end_time,
            price,
            asset,
        }
        .publish(env);
    }

    pub fn emit_promotion_cancelled(
        env: &Env,
        prompt_id: u128,
        promotion_id: u128,
        creator: Address,
    ) {
        PromotionCancelled {
            prompt_id,
            promotion_id,
            creator,
        }
        .publish(env);
    }

    pub fn emit_promotion_applied(
        env: &Env,
        prompt_id: u128,
        promotion_id: u128,
        buyer: Address,
        effective_price: i128,
        original_price: i128,
    ) {
        PromotionApplied {
            prompt_id,
            promotion_id,
            buyer,
            effective_price,
            original_price,
        }
        .publish(env);
    }

    // ─── Encryption Rotation ──────────────────────────────────────────────

    pub fn emit_encryption_rotated(
        env: &Env,
        prompt_id: u128,
        previous_version: u32,
        new_version: u32,
        rotated_at: u64,
    ) {
        EncryptionRotated {
            prompt_id,
            previous_version,
            new_version,
            rotated_at,
        }
        .publish(env);
    }

    // ─── #275: Creator Reputation Staking ─────────────────────────────────

    pub fn emit_stake_added(
        env: &Env,
        prompt_id: u128,
        creator: Address,
        amount: i128,
        total_staked: i128,
    ) {
        StakeAdded {
            prompt_id,
            creator,
            amount,
            total_staked,
        }
        .publish(env);
    }

    pub fn emit_stake_slashed(
        env: &Env,
        prompt_id: u128,
        slashed_amount: i128,
        remaining_staked: i128,
    ) {
        StakeSlashed {
            prompt_id,
            slashed_amount,
            remaining_staked,
        }
        .publish(env);
    }

    pub fn emit_stake_withdrawn(
        env: &Env,
        prompt_id: u128,
        creator: Address,
        amount: i128,
        remaining_staked: i128,
    ) {
        StakeWithdrawn {
            prompt_id,
            creator,
            amount,
            remaining_staked,
        }
        .publish(env);
    }

    // ─── Upgrade Authorization (#42) ──────────────────────────────────────

    pub fn emit_upgrade_proposed(
        env: &Env,
        new_wasm_hash: soroban_sdk::BytesN<32>,
        proposed_at: u64,
    ) {
        UpgradeProposed {
            new_wasm_hash,
            proposed_at,
        }
        .publish(env);
    }

    pub fn emit_upgrade_confirmed(
        env: &Env,
        new_wasm_hash: soroban_sdk::BytesN<32>,
        confirmed_at: u64,
    ) {
        UpgradeConfirmed {
            new_wasm_hash,
            confirmed_at,
        }
        .publish(env);
    }

    pub fn emit_upgrade_cancelled(env: &Env, cancelled_wasm_hash: soroban_sdk::BytesN<32>) {
        UpgradeCancelled {
            cancelled_wasm_hash,
        }
        .publish(env);
    }
}

// ─── #273: Time-based Discount Events ─────────────────────────────────────

#[contractevent]
struct DiscountSet {
    #[topic]
    pub prompt_id: u128,
    pub creator: Address,
    pub discounted_price: i128,
    pub start_ledger: u32,
    pub end_ledger: u32,
}

#[contractevent]
struct DiscountCleared {
    #[topic]
    pub prompt_id: u128,
    pub creator: Address,
}

impl Events {
    // ─── #273: Time-based Discounts ────────────────────────────────────────

    pub fn emit_discount_set(
        env: &Env,
        prompt_id: u128,
        creator: Address,
        discounted_price: i128,
        start_ledger: u32,
        end_ledger: u32,
    ) {
        DiscountSet {
            prompt_id,
            creator,
            discounted_price,
            start_ledger,
            end_ledger,
        }
        .publish(env);
    }

    pub fn emit_discount_cleared(env: &Env, prompt_id: u128, creator: Address) {
        DiscountCleared { prompt_id, creator }.publish(env);
    }
}

// ─── Bundle events ───────────────────────────────────────────────────────────

#[contractevent]
struct BundleCreated {
    #[topic]
    pub bundle_id: u128,
    pub creator: Address,
    pub price_stroops: i128,
    pub item_count: u32,
}

#[contractevent]
struct BundlePurchased {
    #[topic]
    pub bundle_id: u128,
    pub buyer: Address,
    pub creator: Address,
    pub price_stroops: i128,
    pub referrer: Option<Address>,
}

#[contractevent]
struct BundlePriceUpdated {
    #[topic]
    pub bundle_id: u128,
    pub price_stroops: i128,
}

#[contractevent]
struct BundleActiveUpdated {
    #[topic]
    pub bundle_id: u128,
    pub active: bool,
}

#[contractevent]
struct BundleItemAdded {
    #[topic]
    pub bundle_id: u128,
    pub prompt_id: u128,
}

#[contractevent]
struct BundleItemRemoved {
    #[topic]
    pub bundle_id: u128,
    pub prompt_id: u128,
}

impl Events {
    pub fn emit_bundle_created(
        env: &Env,
        bundle_id: u128,
        creator: Address,
        price_stroops: i128,
        item_count: u32,
    ) {
        BundleCreated {
            bundle_id,
            creator,
            price_stroops,
            item_count,
        }
        .publish(env);
    }

    pub fn emit_bundle_purchased(
        env: &Env,
        bundle_id: u128,
        buyer: Address,
        creator: Address,
        price_stroops: i128,
        referrer: Option<Address>,
    ) {
        BundlePurchased {
            bundle_id,
            buyer,
            creator,
            price_stroops,
            referrer,
        }
        .publish(env);
    }

    pub fn emit_bundle_price_updated(env: &Env, bundle_id: u128, price_stroops: i128) {
        BundlePriceUpdated {
            bundle_id,
            price_stroops,
        }
        .publish(env);
    }

    pub fn emit_bundle_active_updated(env: &Env, bundle_id: u128, active: bool) {
        BundleActiveUpdated { bundle_id, active }.publish(env);
    }

    pub fn emit_bundle_item_added(env: &Env, bundle_id: u128, prompt_id: u128) {
        BundleItemAdded {
            bundle_id,
            prompt_id,
        }
        .publish(env);
    }

    pub fn emit_bundle_item_removed(env: &Env, bundle_id: u128, prompt_id: u128) {
        BundleItemRemoved {
            bundle_id,
            prompt_id,
        }
        .publish(env);
    }
}
