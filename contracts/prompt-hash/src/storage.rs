use super::types::{
    Bundle, BundlePurchase, ClassificationOverride, DataKey, Discount, Error, PriceHistoryEntry,
    Prompt, PromptEncryptedPayload, Purchase, ReferralCode, Settlement, Stake, Subscription,
    SubscriptionConfig,
};
use soroban_sdk::{token, Address, BytesN, Env, Vec};

pub const DAY_IN_LEDGERS: u32 = 17280;
pub const PERSISTENT_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;

/// #192 – Maximum number of price-history entries retained per prompt so the
/// compact history log in contract storage stays bounded in size.
pub const MAX_PRICE_HISTORY_LEN: u32 = 20;

pub struct Storage;

fn ensure(condition: bool, error: Error) -> Result<(), Error> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}

impl Storage {
    pub fn set_admin_signers(env: &Env, signers: &Vec<Address>) {
        let key = DataKey::AdminSigners;
        env.storage().persistent().set(&key, signers);
        Self::extend_key_ttl(env, &key);
    }

    pub fn is_admin_signer(env: &Env, signer: &Address) -> bool {
        let key = DataKey::AdminSigners;
        let signers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        for index in 0..signers.len() {
            if signers.get(index).unwrap() == signer.clone() {
                return true;
            }
        }
        false
    }

    pub fn get_min_price(env: &Env) -> Option<i128> {
        let key = DataKey::MinPrice;
        let value = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        value
    }

    pub fn set_min_price(env: &Env, price: Option<i128>) {
        let key = DataKey::MinPrice;
        if let Some(p) = price {
            env.storage().persistent().set(&key, &p);
            Self::extend_key_ttl(env, &key);
        } else {
            env.storage().persistent().remove(&key);
        }
    }

    pub fn get_max_price(env: &Env) -> Option<i128> {
        let key = DataKey::MaxPrice;
        let value = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        value
    }

    pub fn set_max_price(env: &Env, price: Option<i128>) {
        let key = DataKey::MaxPrice;
        if let Some(p) = price {
            env.storage().persistent().set(&key, &p);
            Self::extend_key_ttl(env, &key);
        } else {
            env.storage().persistent().remove(&key);
        }
    }

    pub fn extend_key_ttl(env: &Env, key: &DataKey) {
        if env.storage().persistent().has(key) {
            env.storage().persistent().extend_ttl(
                key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
    }

    pub fn save_prompt(env: &Env, prompt: &Prompt) -> Result<(), Error> {
        let key = DataKey::Prompt(prompt.id);
        env.storage().persistent().set(&key, prompt);
        Self::extend_key_ttl(env, &key);

        let counter_key = DataKey::PromptCounter;
        let next_prompt_id = prompt.id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        env.storage()
            .persistent()
            .set(&counter_key, &next_prompt_id);
        Self::extend_key_ttl(env, &counter_key);
        Ok(())
    }

    pub fn get_prompt(env: &Env, prompt_id: u128) -> Option<Prompt> {
        let key = DataKey::Prompt(prompt_id);
        if let Some(prompt) = env.storage().persistent().get(&key) {
            Self::extend_key_ttl(env, &key);
            Some(prompt)
        } else {
            None
        }
    }

    pub fn require_prompt(env: &Env, prompt_id: u128) -> Result<Prompt, Error> {
        Self::get_prompt(env, prompt_id).ok_or(Error::PromptNotFound)
    }

    pub fn update_prompt(env: &Env, prompt: &Prompt) {
        let key = DataKey::Prompt(prompt.id);
        env.storage().persistent().set(&key, prompt);
        Self::extend_key_ttl(env, &key);
    }

    pub fn has_prompt_expiry_warning(env: &Env, prompt_id: u128) -> bool {
        let key = DataKey::PromptExpiryWarning(prompt_id);
        env.storage().persistent().has(&key)
    }

    pub fn set_prompt_expiry_warning(env: &Env, prompt_id: u128) {
        let key = DataKey::PromptExpiryWarning(prompt_id);
        env.storage().persistent().set(&key, &true);
        Self::extend_key_ttl(env, &key);
    }

    pub fn clear_prompt_expiry_warning(env: &Env, prompt_id: u128) {
        let key = DataKey::PromptExpiryWarning(prompt_id);
        env.storage().persistent().remove(&key);
    }

    pub fn get_prompt_counter(env: &Env) -> u128 {
        let key = DataKey::PromptCounter;
        let count = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        count
    }

    pub fn get_all_prompts(env: &Env) -> Vec<Prompt> {
        let prompt_count = Self::get_prompt_counter(env);
        let now = env.ledger().timestamp();
        let mut prompts = Vec::new(env);
        for prompt_id in 0..prompt_count {
            if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                // Skip expired listings (expires_at == 0 means never expires)
                if prompt.expires_at == 0 || prompt.expires_at >= now {
                    prompts.push_back(prompt);
                }
            }
        }
        prompts
    }

    pub fn get_prompts_by_category(env: &Env, category: &String) -> Vec<Prompt> {
        let prompt_count = Self::get_prompt_counter(env);
        let now = env.ledger().timestamp();
        let mut prompts = Vec::new(env);
        for prompt_id in 0..prompt_count {
            if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                if (prompt.expires_at == 0 || prompt.expires_at >= now)
                    && prompt.category == category.clone()
                {
                    prompts.push_back(prompt);
                }
            }
        }
        prompts
    }

    pub fn get_prompts_by_creator(env: &Env, creator: &Address) -> Vec<Prompt> {
        let key = DataKey::CreatorPrompts(creator.clone());
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        Self::prompts_from_ids(env, ids)
    }

    pub fn get_prompts_by_buyer(env: &Env, buyer: &Address) -> Vec<Prompt> {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        Self::prompts_from_ids(env, ids)
    }

    fn prompts_from_ids(env: &Env, ids: Vec<u128>) -> Vec<Prompt> {
        let mut prompts = Vec::new(env);
        for index in 0..ids.len() {
            let prompt_id = ids.get(index).unwrap();
            if let Some(prompt) = Self::get_prompt(env, prompt_id) {
                prompts.push_back(prompt);
            }
        }
        prompts
    }

    pub fn add_prompt_to_creator(env: &Env, creator: &Address, prompt_id: u128) {
        let key = DataKey::CreatorPrompts(creator.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn add_prompt_to_buyer(env: &Env, buyer: &Address, prompt_id: u128) {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        for index in 0..ids.len() {
            if ids.get(index).unwrap() == prompt_id {
                Self::extend_key_ttl(env, &key);
                return;
            }
        }
        ids.push_back(prompt_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn remove_prompt_from_buyer(env: &Env, buyer: &Address, prompt_id: u128) {
        let key = DataKey::BuyerPrompts(buyer.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        let mut index = 0;
        while index < ids.len() {
            if ids.get(index).unwrap() == prompt_id {
                ids.remove(index);
            } else {
                index = match index.checked_add(1) {
                    Some(next) => next,
                    None => break,
                };
            }
        }
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_purchase(env: &Env, prompt_id: u128, buyer: &Address) -> Option<Purchase> {
        let key = DataKey::Purchase(prompt_id, buyer.clone());
        let purchase = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        purchase
    }

    pub fn has_active_purchase(env: &Env, prompt_id: u128, buyer: &Address, now: u64) -> bool {
        Self::get_purchase(env, prompt_id, buyer)
            .map(|purchase| purchase.expires_at >= now)
            .unwrap_or(false)
    }

    pub fn save_purchase(env: &Env, purchase: &Purchase) {
        let key = DataKey::Purchase(purchase.prompt_id, purchase.owner.clone());
        env.storage().persistent().set(&key, purchase);
        Self::extend_key_ttl(env, &key);
    }

    pub fn remove_purchase(env: &Env, prompt_id: u128, owner: &Address) {
        let key = DataKey::Purchase(prompt_id, owner.clone());
        env.storage().persistent().remove(&key);
    }

    pub fn require_purchase(
        env: &Env,
        prompt_id: u128,
        owner: &Address,
    ) -> Result<Purchase, Error> {
        Self::get_purchase(env, prompt_id, owner).ok_or(Error::LicenseNotFound)
    }

    pub fn save_subscription_config(env: &Env, config: &SubscriptionConfig) {
        let key = DataKey::SubscriptionConfig(config.creator.clone());
        env.storage().persistent().set(&key, config);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_subscription_config(env: &Env, creator: &Address) -> Option<SubscriptionConfig> {
        let key = DataKey::SubscriptionConfig(creator.clone());
        let config = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        config
    }

    pub fn save_subscription(env: &Env, subscription: &Subscription) {
        let key = DataKey::Subscription(
            subscription.subscriber.clone(),
            subscription.creator.clone(),
        );
        env.storage().persistent().set(&key, subscription);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_subscription(
        env: &Env,
        subscriber: &Address,
        creator: &Address,
    ) -> Option<Subscription> {
        let key = DataKey::Subscription(subscriber.clone(), creator.clone());
        let subscription = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        subscription
    }

    pub fn set_subscription_eligibility(env: &Env, prompt_id: u128, eligible: bool) {
        let key = DataKey::SubscriptionEligible(prompt_id);
        env.storage().persistent().set(&key, &eligible);
        Self::extend_key_ttl(env, &key);
    }

    pub fn is_subscription_eligible(env: &Env, prompt_id: u128) -> bool {
        let key = DataKey::SubscriptionEligible(prompt_id);
        let eligible = env.storage().persistent().get(&key).unwrap_or(false);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        eligible
    }

    pub fn grant_purchase(
        env: &Env,
        prompt: &Prompt,
        buyer: &Address,
        paid_price: i128,
        expires_at: u64,
        settlement: Settlement,
    ) {
        let key = DataKey::Purchase(prompt.id, buyer.clone());
        let purchase = Purchase {
            prompt_id: prompt.id,
            original_creator: prompt.creator.clone(),
            owner: buyer.clone(),
            original_price: paid_price,
            last_transfer_price: 0,
            transfer_count: 0,
            last_transferred_at: 0,
            expires_at,
            settlement,
            encryption_version: prompt.encryption_version,
        };
        env.storage().persistent().set(&key, &purchase);
        Self::extend_key_ttl(env, &key);
        Self::add_prompt_to_buyer(env, buyer, prompt.id);
    }

    // ─── Encryption Rotation ──────────────────────────────────────────────

    /// Save an archived encrypted payload for a given version.
    pub fn save_encryption_version(
        env: &Env,
        prompt_id: u128,
        version: u32,
        payload: &PromptEncryptedPayload,
    ) {
        let key = DataKey::PromptEncryptedPayload(prompt_id, version);
        env.storage().persistent().set(&key, payload);
        Self::extend_key_ttl(env, &key);
    }

    /// Retrieve an archived encrypted payload for a given version.
    pub fn get_encryption_version(
        env: &Env,
        prompt_id: u128,
        version: u32,
    ) -> Option<PromptEncryptedPayload> {
        let key = DataKey::PromptEncryptedPayload(prompt_id, version);
        let payload: Option<PromptEncryptedPayload> = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        payload
    }

    /// Get the current encryption version counter for a prompt.
    pub fn get_encryption_version_counter(env: &Env, prompt_id: u128) -> u32 {
        let key = DataKey::PromptEncryptionVersion(prompt_id);
        let counter: Option<u32> = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        counter.unwrap_or(0)
    }

    /// Set (increment) the encryption version counter for a prompt.
    pub fn set_encryption_version_counter(env: &Env, prompt_id: u128, version: u32) {
        let key = DataKey::PromptEncryptionVersion(prompt_id);
        env.storage().persistent().set(&key, &version);
        Self::extend_key_ttl(env, &key);
    }

    pub fn set_fee_percentage(env: &Env, fee_percentage: &u32) {
        let key = DataKey::FeePercentage;
        env.storage().persistent().set(&key, fee_percentage);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_fee_percentage(env: &Env) -> u32 {
        let key = DataKey::FeePercentage;
        let fee = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        fee
    }

    pub fn set_fee_wallet(env: &Env, fee_wallet: &Address) {
        let key = DataKey::FeeWallet;
        env.storage().persistent().set(&key, fee_wallet);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_fee_wallet(env: &Env) -> Option<Address> {
        let key = DataKey::FeeWallet;
        let wallet = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        wallet
    }

    pub fn set_xlm_address(env: &Env, xlm_address: &Address) {
        let key = DataKey::XlmAddress;
        env.storage().persistent().set(&key, xlm_address);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_xlm_address(env: &Env) -> Option<Address> {
        let key = DataKey::XlmAddress;
        let addr = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        addr
    }

    pub fn get_stellar_asset_contract(
        env: &'_ Env,
    ) -> Result<token::StellarAssetClient<'_>, Error> {
        let contract_id = Self::get_xlm_address(env).ok_or(Error::XlmAddressNotSet)?;
        Ok(token::StellarAssetClient::new(env, &contract_id))
    }

    pub fn set_reentrancy_guard(env: &Env) -> Result<(), Error> {
        let key = DataKey::Reentrancy;
        Self::require_no_reentrancy(env)?;
        env.storage().persistent().set(&key, &true);
        Self::extend_key_ttl(env, &key);
        Ok(())
    }

    pub fn require_no_reentrancy(env: &Env) -> Result<(), Error> {
        let key = DataKey::Reentrancy;
        let entered = env
            .storage()
            .persistent()
            .get::<_, bool>(&key)
            .unwrap_or(false);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        ensure(!entered, Error::ReentrancyGuard)
    }

    pub fn clear_reentrancy_guard(env: &Env) {
        let key = DataKey::Reentrancy;
        env.storage().persistent().set(&key, &false);
        Self::extend_key_ttl(env, &key);
    }

    pub fn set_referral_percentage(env: &Env, percentage: u32) {
        let key = DataKey::ReferralPercentage;
        env.storage().persistent().set(&key, &percentage);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_referral_percentage(env: &Env) -> u32 {
        let key = DataKey::ReferralPercentage;
        let fee = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        fee
    }

    pub fn get_referral_code(env: &Env, code_hash: &BytesN<32>) -> Option<ReferralCode> {
        let key = DataKey::ReferralCode(code_hash.clone());
        let code = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        code
    }

    pub fn save_referral_code(env: &Env, code_hash: &BytesN<32>, code: &ReferralCode) {
        let key = DataKey::ReferralCode(code_hash.clone());
        env.storage().persistent().set(&key, code);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_referral_parent(env: &Env, buyer: &Address) -> Option<Address> {
        let key = DataKey::ReferralParent(buyer.clone());
        let parent = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        parent
    }

    pub fn set_referral_parent(env: &Env, buyer: &Address, referrer: &Address) {
        let key = DataKey::ReferralParent(buyer.clone());
        env.storage().persistent().set(&key, referrer);
        Self::extend_key_ttl(env, &key);
    }

    /// #32 – records that contract setup (`__constructor`) has completed, so
    /// callers can detect and reject an attempt to run it again.
    pub fn set_initialized(env: &Env) {
        let key = DataKey::Initialized;
        env.storage().persistent().set(&key, &true);
        Self::extend_key_ttl(env, &key);
    }

    /// #32 – true once `__constructor` has run for this contract instance.
    pub fn is_initialized(env: &Env) -> bool {
        let key = DataKey::Initialized;
        let initialized = env.storage().persistent().get(&key).unwrap_or(false);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        initialized
    }

    pub fn set_pause_status(env: &Env, is_paused: bool) {
        let key = DataKey::IsPaused;
        env.storage().persistent().set(&key, &is_paused);
        Self::extend_key_ttl(env, &key);
    }

    pub fn is_paused(env: &Env) -> bool {
        let key = DataKey::IsPaused;
        let p = env.storage().persistent().get(&key).unwrap_or(false);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        p
    }

    pub fn add_voucher(env: &Env, prompt_id: u128, hashed_code: &BytesN<32>, discount_bps: u32) {
        let key = DataKey::VoucherKey(prompt_id, hashed_code.clone());
        env.storage().persistent().set(&key, &discount_bps);
        Self::extend_key_ttl(env, &key);
    }

    pub fn remove_voucher(env: &Env, prompt_id: u128, hashed_code: &BytesN<32>) {
        let key = DataKey::VoucherKey(prompt_id, hashed_code.clone());
        env.storage().persistent().remove(&key);
    }

    pub fn get_voucher(env: &Env, prompt_id: u128, hashed_code: &BytesN<32>) -> Option<u32> {
        let key = DataKey::VoucherKey(prompt_id, hashed_code.clone());
        let discount = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        discount
    }

    // ─── #131: Content Classification ───────────────────────────────────────

    pub fn set_moderator_override(
        env: &Env,
        prompt_id: u128,
        override_entry: &ClassificationOverride,
    ) {
        let key = DataKey::ClassificationOverride(prompt_id);
        env.storage().persistent().set(&key, override_entry);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_moderator_override(env: &Env, prompt_id: u128) -> Option<ClassificationOverride> {
        let key = DataKey::ClassificationOverride(prompt_id);
        let override_entry = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        override_entry
    }

    pub fn set_moderator_address(env: &Env, moderator: &Address) {
        let key = DataKey::ModeratorAddress;
        env.storage().persistent().set(&key, moderator);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_moderator_address(env: &Env) -> Option<Address> {
        let key = DataKey::ModeratorAddress;
        let addr = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        addr
    }

    // ─── #272: Prompt Bundles ──────────────────────────────────────────────

    pub fn get_bundle_counter(env: &Env) -> u128 {
        let key = DataKey::BundleCounter;
        let count = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        count
    }

    pub fn save_bundle(env: &Env, bundle: &Bundle) -> Result<(), Error> {
        let key = DataKey::Bundle(bundle.id);
        env.storage().persistent().set(&key, bundle);
        Self::extend_key_ttl(env, &key);

        let counter_key = DataKey::BundleCounter;
        let next_id = bundle.id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        env.storage().persistent().set(&counter_key, &next_id);
        Self::extend_key_ttl(env, &counter_key);
        Ok(())
    }

    pub fn get_bundle(env: &Env, bundle_id: u128) -> Option<Bundle> {
        let key = DataKey::Bundle(bundle_id);
        let bundle = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        bundle
    }

    // ─── Promotional Pricing ──────────────────────────────────────────────

    pub fn set_active_promotion(env: &Env, prompt_id: u128, promotion: &super::types::Promotion) {
        let key = DataKey::ActivePromotion(prompt_id);
        env.storage().persistent().set(&key, promotion);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_active_promotion(env: &Env, prompt_id: u128) -> Option<super::types::Promotion> {
        let key = DataKey::ActivePromotion(prompt_id);
        let promotion = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        promotion
    }

    pub fn clear_active_promotion(env: &Env, prompt_id: u128) {
        let key = DataKey::ActivePromotion(prompt_id);
        env.storage().persistent().remove(&key);
    }

    pub fn add_promotion_to_history(
        env: &Env,
        prompt_id: u128,
        promotion: &super::types::Promotion,
    ) {
        let key = DataKey::PromotionHistory(prompt_id);
        let mut history: Vec<super::types::Promotion> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        history.push_back(promotion.clone());
        env.storage().persistent().set(&key, &history);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_promotion_history(env: &Env, prompt_id: u128) -> Vec<super::types::Promotion> {
        let key = DataKey::PromotionHistory(prompt_id);
        let history: Vec<super::types::Promotion> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        history
    }

    pub fn get_promotion_counter(env: &Env) -> u128 {
        let key = DataKey::PromptCounter; // Reuse prompt counter for promotion IDs
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    // ─── #192: Per-prompt Price History ────────────────────────────────────

    /// Append an entry to a prompt's compact price-history log. The log is
    /// capped at `MAX_PRICE_HISTORY_LEN` entries, dropping the oldest entries
    /// once the cap is exceeded.
    pub fn add_price_history_entry(
        env: &Env,
        prompt_id: u128,
        entry: &PriceHistoryEntry,
    ) {
        let key = DataKey::PriceHistory(prompt_id);
        let mut history: Vec<PriceHistoryEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        history.push_back(entry.clone());
        // Keep the log compact: drop the oldest entries once over the cap.
        if history.len() > MAX_PRICE_HISTORY_LEN {
            let to_remove = history.len() - MAX_PRICE_HISTORY_LEN;
            for _ in 0..to_remove {
                history.remove(0);
            }
        }
        env.storage().persistent().set(&key, &history);
        Self::extend_key_ttl(env, &key);
    }

    /// Return the recorded price history for a prompt, oldest first.
    pub fn get_price_history(env: &Env, prompt_id: u128) -> Vec<PriceHistoryEntry> {
        let key = DataKey::PriceHistory(prompt_id);
        let history: Vec<PriceHistoryEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        history
    }

    // ─── #275: Creator Reputation Staking ─────────────────────────────────

    pub fn get_stake(env: &Env, prompt_id: u128) -> Option<Stake> {
        let key = DataKey::CreatorStake(prompt_id);
        let stake = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        stake
    }

    pub fn save_stake(env: &Env, stake: &Stake) {
        let key = DataKey::CreatorStake(stake.prompt_id);
        env.storage().persistent().set(&key, stake);
        Self::extend_key_ttl(env, &key);
    }

    // ─── Upgrade Authorization (#42) ──────────────────────────────────────

    pub fn set_pending_upgrade(env: &Env, wasm_hash: &BytesN<32>) {
        let key = DataKey::PendingUpgrade;
        env.storage().persistent().set(&key, wasm_hash);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_pending_upgrade(env: &Env) -> Option<BytesN<32>> {
        let key = DataKey::PendingUpgrade;
        let hash: Option<BytesN<32>> = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        hash
    }

    pub fn clear_pending_upgrade(env: &Env) {
        let key = DataKey::PendingUpgrade;
        env.storage().persistent().remove(&key);
    }

    pub fn set_upgrade_proposer(env: &Env, proposer: &Address) {
        let key = DataKey::UpgradeProposer;
        env.storage().persistent().set(&key, proposer);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_upgrade_proposer(env: &Env) -> Option<Address> {
        let key = DataKey::UpgradeProposer;
        let proposer: Option<Address> = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        proposer
    }

    pub fn clear_upgrade_proposer(env: &Env) {
        let key = DataKey::UpgradeProposer;
        env.storage().persistent().remove(&key);
    }

    pub fn set_upgrade_proposed_at(env: &Env, timestamp: u64) {
        let key = DataKey::UpgradeProposedAt;
        env.storage().persistent().set(&key, &timestamp);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_upgrade_proposed_at(env: &Env) -> Option<u64> {
        let key = DataKey::UpgradeProposedAt;
        let ts: Option<u64> = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        ts
    }

    pub fn clear_upgrade_proposed_at(env: &Env) {
        let key = DataKey::UpgradeProposedAt;
        env.storage().persistent().remove(&key);
    }

    // ─── Contract State Versioning ─────────────────────────────────────────

    /// Schema version stored on-chain. `0` means the key was never written,
    /// which covers contract state that predates this versioning scheme.
    pub fn get_schema_version(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0)
    }

    pub fn set_schema_version(env: &Env, version: u32) {
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &version);
    }
    // ─── #273: Time-based Discounts ────────────────────────────────────────

    pub fn set_discount(env: &Env, discount: &Discount) {
        let key = DataKey::Discount(discount.prompt_id);
        env.storage().persistent().set(&key, discount);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_discount(env: &Env, prompt_id: u128) -> Option<Discount> {
        let key = DataKey::Discount(prompt_id);
        let discount = env.storage().persistent().get(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        discount
    }

    pub fn clear_discount(env: &Env, prompt_id: u128) {
        let key = DataKey::Discount(prompt_id);
        env.storage().persistent().remove(&key);
    }
}

// ─── Bundle storage ──────────────────────────────────────────────────────────

impl Storage {
    // ── Counter ──────────────────────────────────────────────────────────────

    pub fn get_bundle_counter(env: &Env) -> u128 {
        let key = DataKey::BundleCounter;
        let count: u128 = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        count
    }

    fn increment_bundle_counter(env: &Env, bundle_id: u128) -> Result<(), Error> {
        let key = DataKey::BundleCounter;
        let next = bundle_id.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
        env.storage().persistent().set(&key, &next);
        Self::extend_key_ttl(env, &key);
        Ok(())
    }

    // ── CRUD ─────────────────────────────────────────────────────────────────

    pub fn save_bundle(env: &Env, bundle: &Bundle) -> Result<(), Error> {
        let key = DataKey::Bundle(bundle.id);
        env.storage().persistent().set(&key, bundle);
        Self::extend_key_ttl(env, &key);
        Self::increment_bundle_counter(env, bundle.id)
    }

    pub fn get_bundle(env: &Env, bundle_id: u128) -> Option<Bundle> {
        let key = DataKey::Bundle(bundle_id);
        if let Some(b) = env.storage().persistent().get::<_, Bundle>(&key) {
            Self::extend_key_ttl(env, &key);
            Some(b)
        } else {
            None
        }
    }

    pub fn require_bundle(env: &Env, bundle_id: u128) -> Result<Bundle, Error> {
        Self::get_bundle(env, bundle_id).ok_or(Error::BundleNotFound)
    }

    pub fn update_bundle(env: &Env, bundle: &Bundle) {
        let key = DataKey::Bundle(bundle.id);
        env.storage().persistent().set(&key, bundle);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_all_bundles(env: &Env) -> Vec<Bundle> {
        let count = Self::get_bundle_counter(env);
        let mut out = Vec::new(env);
        for id in 0..count {
            if let Some(b) = Self::get_bundle(env, id) {
                out.push_back(b);
            }
        }
        out
    }

    // ── Creator / buyer index ─────────────────────────────────────────────────

    pub fn add_bundle_to_creator(env: &Env, creator: &Address, bundle_id: u128) {
        let key = DataKey::CreatorBundles(creator.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        ids.push_back(bundle_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_bundles_by_creator(env: &Env, creator: &Address) -> Vec<Bundle> {
        let key = DataKey::CreatorBundles(creator.clone());
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        Self::bundles_from_ids(env, ids)
    }

    pub fn add_bundle_to_buyer(env: &Env, buyer: &Address, bundle_id: u128) {
        let key = DataKey::BuyerBundles(buyer.clone());
        let mut ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        // idempotent
        for i in 0..ids.len() {
            if ids.get(i).unwrap() == bundle_id {
                Self::extend_key_ttl(env, &key);
                return;
            }
        }
        ids.push_back(bundle_id);
        env.storage().persistent().set(&key, &ids);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_bundles_by_buyer(env: &Env, buyer: &Address) -> Vec<Bundle> {
        let key = DataKey::BuyerBundles(buyer.clone());
        let ids: Vec<u128> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        Self::bundles_from_ids(env, ids)
    }

    fn bundles_from_ids(env: &Env, ids: Vec<u128>) -> Vec<Bundle> {
        let mut out = Vec::new(env);
        for i in 0..ids.len() {
            if let Some(b) = Self::get_bundle(env, ids.get(i).unwrap()) {
                out.push_back(b);
            }
        }
        out
    }

    // ── Bundle purchase record ────────────────────────────────────────────────

    pub fn save_bundle_purchase(env: &Env, purchase: &BundlePurchase) {
        let key = DataKey::BundlePurchase(purchase.bundle_id, purchase.owner.clone());
        env.storage().persistent().set(&key, purchase);
        Self::extend_key_ttl(env, &key);
    }

    pub fn get_bundle_purchase(
        env: &Env,
        bundle_id: u128,
        buyer: &Address,
    ) -> Option<BundlePurchase> {
        let key = DataKey::BundlePurchase(bundle_id, buyer.clone());
        let p = env.storage().persistent().get::<_, BundlePurchase>(&key);
        if env.storage().persistent().has(&key) {
            Self::extend_key_ttl(env, &key);
        }
        p
    }

    pub fn has_bundle_purchase(env: &Env, bundle_id: u128, buyer: &Address) -> bool {
        Self::get_bundle_purchase(env, bundle_id, buyer).is_some()
    }
}
