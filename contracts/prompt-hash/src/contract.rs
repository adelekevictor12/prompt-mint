use super::events::Events;
use super::storage::Storage;
use super::types::{
    Bundle, BundlePurchase, ClassificationOverride, DataKey, Error, ListingConfig,
    PriceHistoryEntry, Prompt, PromptEncryptedPayload, PromptHashTrait, Purchase, ReferralCode,
    Settlement, Split, Stake, Subscription, SubscriptionConfig, ALL_CLASSIFICATIONS,
    MAX_BUNDLE_DESC_LEN, MAX_BUNDLE_ITEMS, MAX_BUNDLE_TITLE_LEN, VALID_DISCLOSURE_FLAGS,
};
use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env, String, Vec};
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::only_owner;

const DEFAULT_FEE_BPS: u32 = 500;
const MAX_FEE_BPS: u32 = 2_000; // 20% maximum platform fee safeguard (#41)
const ROYALTY_BPS: u32 = 500;
const MAX_BPS: u32 = 10_000;
const MAX_SPLITS: u32 = 16;
const MAX_TITLE_LEN: u32 = 120;
const MAX_CATEGORY_LEN: u32 = 40;
const MAX_PREVIEW_LEN: u32 = 280;
const MAX_ENCRYPTED_PROMPT_LEN: u32 = 4096;
const MAX_WRAPPED_KEY_LEN: u32 = 256;
const MAX_IMAGE_URL_LEN: u32 = 512;
const MAX_IV_LEN: u32 = 64;
const LEASE_PRICE_BPS: u32 = 4_000;
const MAX_ACCESS_EXPIRY: u64 = u64::MAX;
const EXPIRY_WARNING_SECS: u64 = 7 * 24 * 60 * 60;
const MAX_SUBSCRIPTION_DURATION_SECS: u64 = 31_536_000;
const MAX_CLASSIFICATION_LEN: u32 = 20;
const MAX_SAFETY_FLAGS_COUNT: u32 = 10;
const MAX_FLAG_LEN: u32 = 30;
const MAX_REASON_LEN: u32 = 256;
/// Highest storage schema version this contract build understands. Bump this
/// alongside adding migration logic whenever `upgrade` changes stored data shapes.
const CONTRACT_SCHEMA_VERSION: u32 = 1;
/// #42 – cooldown between proposing and confirming a contract upgrade.
const UPGRADE_COOLDOWN_SECS: u64 = 86_400; // 24 hours
/// #275 – cooldown before a creator can reclaim (unstake) their stake, in
/// seconds. Chosen as 7 days: long enough to allow moderation/reporting to run
/// before funds can leave custody, matching the platform's weekly cadence.
/// (No sibling-contract `*_LOCK_PERIOD` precedent exists to reuse.)
const STAKE_COOLDOWN_SECS: u64 = 7 * 24 * 60 * 60;

#[contract]
pub struct PromptHashContract;

#[contractimpl]
impl PromptHashTrait for PromptHashContract {
    fn __constructor(
        env: Env,
        admin: Address,
        admin_two: Address,
        admin_three: Address,
        fee_wallet: Address,
        xlm_sac: Address,
    ) -> Result<(), Error> {
        ensure(
            admin != admin_two && admin != admin_three && admin_two != admin_three,
            Error::Unauthorized,
        )?;
        ownable::set_owner(&env, &admin);
        let admin_signers = Vec::from_array(
            &env,
            [admin.clone(), admin_two.clone(), admin_three.clone()],
        );
        Storage::set_admin_signers(&env, &admin_signers);
        Storage::set_fee_wallet(&env, &fee_wallet);
        Storage::set_fee_percentage(&env, &DEFAULT_FEE_BPS);
        Storage::set_xlm_address(&env, &xlm_sac);
        Storage::set_pause_status(&env, false);
        Storage::set_schema_version(&env, CONTRACT_SCHEMA_VERSION);
        Storage::set_initialized(&env);
        env.storage().instance().extend_ttl(
            super::storage::PERSISTENT_LIFETIME_THRESHOLD,
            super::storage::PERSISTENT_BUMP_AMOUNT,
        );
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn create_prompt(
        env: Env,
        creator: Address,
        image_url: String,
        title: String,
        category: String,
        preview_text: String,
        encrypted_prompt: String,
        encryption_iv: String,
        wrapped_key: String,
        content_hash: BytesN<32>,
        listing: ListingConfig,
    ) -> Result<u128, Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        validate_prompt_fields(
            &env,
            &image_url,
            &title,
            &category,
            &preview_text,
            &encrypted_prompt,
            &encryption_iv,
            &wrapped_key,
            listing.price,
        )?;

        // Validate that the asset address implements the token interface
        validate_token_contract(&env, &listing.asset)?;

        // #49: optional listing expiry must be in the future when provided
        if listing.expires_at != 0 {
            ensure(
                listing.expires_at > env.ledger().timestamp(),
                Error::InvalidPrice,
            )?;
        }

        // #50: validate revenue splits
        validate_splits(&env, &listing.splits)?;

        // Deduplicate identical content hashes to discourage spam listings.
        let prompt_count = Storage::get_prompt_counter(&env);
        for prompt_id in 0..prompt_count {
            let prompt = Storage::require_prompt(&env, prompt_id)?;
            if prompt.content_hash == content_hash {
                return Ok(prompt.id);
            }
        }

        // #131: default classification
        let classification = String::from_str(&env, "general");
        let safety_flags: Vec<String> = Vec::new(&env);

        let prompt_id = Storage::get_prompt_counter(&env);
        let prompt = Prompt {
            id: prompt_id,
            creator: creator.clone(),
            image_url,
            title,
            category,
            preview_text,
            encrypted_prompt,
            encryption_iv,
            wrapped_key,
            content_hash,
            price_stroops: listing.price,
            asset: listing.asset.clone(),
            active: true,
            sales_count: 0,
            max_supply: 0,
            expires_at: listing.expires_at,
            splits: listing.splits,
            classification,
            safety_flags,
            encryption_version: 1,
        };

        Storage::save_prompt(&env, &prompt)?;
        Storage::set_encryption_version_counter(&env, prompt_id, 1);
        Storage::add_prompt_to_creator(&env, &creator, prompt_id);
        // #192 – record the initial listing price as the first history entry so
        // buyers can see the price a prompt launched at.
        Storage::add_price_history_entry(
            &env,
            prompt_id,
            &PriceHistoryEntry {
                previous_price: 0,
                new_price: listing.price,
                changed_at: env.ledger().timestamp(),
                seq: 1,
            },
        );
        Events::emit_prompt_created(&env, prompt_id, creator, listing.price, listing.asset);
        Ok(prompt_id)
    }

    fn set_prompt_sale_status(
        env: Env,
        creator: Address,
        prompt_id: u128,
        active: bool,
    ) -> Result<(), Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        prompt.active = active;
        Storage::update_prompt(&env, &prompt);
        Events::emit_prompt_sale_status_updated(&env, prompt_id, active);
        Ok(())
    }

    fn set_prompt_max_supply(
        env: Env,
        creator: Address,
        prompt_id: u128,
        max_supply: u64,
    ) -> Result<(), Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        prompt.max_supply = max_supply;
        Storage::update_prompt(&env, &prompt);
        Ok(())
    }

    fn update_prompt_price(
        env: Env,
        creator: Address,
        prompt_id: u128,
        price_stroops: i128,
    ) -> Result<(), Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let min_price = Storage::get_min_price(&env).unwrap_or(0);
        ensure(price_stroops > min_price, Error::InvalidPrice)?;
        if let Some(max_price) = Storage::get_max_price(&env) {
            ensure(price_stroops <= max_price, Error::InvalidPrice)?;
        }

        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        let previous_price = prompt.price_stroops;
        prompt.price_stroops = price_stroops;

        Storage::update_prompt(&env, &prompt);
        // #192 – append this change to the prompt's compact price-history log.
        let history = Storage::get_price_history(&env, prompt_id);
        // Derive the next sequence number from the most recent entry so it stays
        // monotonic even once older entries are trimmed from the compact log.
        let next_seq = if !history.is_empty() {
            history
                .get(history.len() - 1)
                .unwrap()
                .seq
                .saturating_add(1)
        } else {
            1
        };
        Storage::add_price_history_entry(
            &env,
            prompt_id,
            &PriceHistoryEntry {
                previous_price,
                new_price: price_stroops,
                changed_at: env.ledger().timestamp(),
                seq: next_seq,
            },
        );
        Events::emit_prompt_price_updated(&env, prompt_id, previous_price, price_stroops);
        Ok(())
    }

    // #192 – Return the recorded price history for a prompt, oldest first.
    fn get_price_history(env: Env, prompt_id: u128) -> Result<Vec<PriceHistoryEntry>, Error> {
        Storage::require_prompt(&env, prompt_id)?;
        Ok(Storage::get_price_history(&env, prompt_id))
    }

    fn buy_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u128,
        referral_code: Option<Bytes>,
        payment_amount_stroops: i128,
        voucher: Option<Bytes>,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        execute_buy(
            &env,
            &buyer,
            prompt_id,
            &referral_code,
            payment_amount_stroops,
            voucher,
        )
    }

    fn lease_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u128,
        lease_duration_secs: u64,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();

        ensure(prompt.active, Error::PromptInactive)?;
        ensure(prompt.creator != buyer, Error::CreatorCannotBuy)?;
        ensure(lease_duration_secs > 0, Error::InvalidPrice)?;
        ensure(
            !Storage::has_active_purchase(&env, prompt_id, &buyer, now),
            Error::AlreadyPurchased,
        )?;

        // #49: block purchase on expired listing
        if prompt.expires_at != 0 {
            ensure(prompt.expires_at >= now, Error::ListingExpired)?;
        }

        Storage::set_reentrancy_guard(&env)?;

        // Atomic increment: write sales_count before any token transfers.
        prompt.sales_count = prompt
            .sales_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        Storage::update_prompt(&env, &prompt);

        let fee_wallet = Storage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;
        let this_contract = env.current_contract_address();
        let fee_percentage = Storage::get_fee_percentage(&env);
        ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;

        let lease_price = prompt
            .price_stroops
            .checked_mul(LEASE_PRICE_BPS as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        ensure(lease_price > 0, Error::InvalidPrice)?;

        let fee_amount = lease_price
            .checked_mul(fee_percentage as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        let seller_amount = lease_price
            .checked_sub(fee_amount)
            .ok_or(Error::ArithmeticOverflow)?;

        let asset_client = token::StellarAssetClient::new(&env, &prompt.asset);

        // Pre-check buyer balance to surface a clear error instead of a raw
        // Soroban token-transfer failure when the wallet is unfunded.
        let buyer_balance: i128 = asset_client.balance(&buyer);
        ensure(
            buyer_balance >= lease_price,
            Error::InsufficientBalance,
        )?;

        asset_client.transfer_from(&this_contract, &buyer, &prompt.creator, &seller_amount);
        if fee_amount > 0 {
            asset_client.transfer_from(&this_contract, &buyer, &fee_wallet, &fee_amount);
        }

        let expires_at = now
            .checked_add(lease_duration_secs)
            .ok_or(Error::ArithmeticOverflow)?;
        Storage::grant_purchase(
            &env,
            &prompt,
            &buyer,
            lease_price,
            expires_at,
            Settlement {
                buyer_amount: lease_price,
                creator_amount: seller_amount,
                platform_amount: fee_amount,
                referrer: None,
                referrer_amount: 0,
                split_amount: 0,
            },
        );
        Storage::clear_reentrancy_guard(&env);
        Events::emit_prompt_purchased(
            &env,
            prompt_id,
            buyer,
            prompt.creator,
            lease_price,
            None,
            seller_amount,
            fee_amount,
            0,
        );
        Ok(())
    }

    // ─── Issue #49: Time-Bound Listing Expiry ────────────────────────────────

    fn extend_listing(
        env: Env,
        creator: Address,
        prompt_id: u128,
        new_expires_at: u64,
    ) -> Result<(), Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        let now = env.ledger().timestamp();
        ensure(new_expires_at > now, Error::InvalidPrice)?;

        prompt.expires_at = new_expires_at;
        Storage::update_prompt(&env, &prompt);
        Storage::clear_prompt_expiry_warning(&env, prompt_id);
        Events::emit_listing_extended(&env, prompt_id, new_expires_at);
        Ok(())
    }

    fn extend_prompt_lifetime(
        env: Env,
        creator: Address,
        prompt_id: u128,
        extension_secs: u64,
    ) -> Result<u64, Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        ensure(prompt.expires_at != 0 && extension_secs > 0, Error::InvalidPrice)?;

        let new_expires_at = prompt
            .expires_at
            .checked_add(extension_secs)
            .ok_or(Error::ArithmeticOverflow)?;
        let mut extended_prompt = prompt;
        extended_prompt.expires_at = new_expires_at;
        Storage::update_prompt(&env, &extended_prompt);
        Storage::clear_prompt_expiry_warning(&env, prompt_id);
        Events::emit_listing_extended(&env, prompt_id, new_expires_at);
        Ok(new_expires_at)
    }

    fn check_prompt_expiry(env: Env, prompt_id: u128) -> Result<bool, Error> {
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();
        let expiring_soon = prompt.expires_at > now
            && prompt.expires_at - now <= EXPIRY_WARNING_SECS;

        if expiring_soon && !Storage::has_prompt_expiry_warning(&env, prompt_id) {
            Storage::set_prompt_expiry_warning(&env, prompt_id);
            Events::emit_prompt_expiring_soon(&env, prompt_id, prompt.creator, prompt.expires_at);
        }

        Ok(expiring_soon)
    }

    // ─── Issue #51: Bulk Purchase ────────────────────────────────────────────

    fn buy_prompts_bulk(
        env: Env,
        buyer: Address,
        prompt_ids: Vec<u128>,
        payment_amounts: Vec<i128>,
        referral_code: Option<Bytes>,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        ensure(
            prompt_ids.len() == payment_amounts.len(),
            Error::InvalidPrice,
        )?;

        for i in 0..prompt_ids.len() {
            let prompt_id = prompt_ids.get(i).unwrap();
            let payment_amount = payment_amounts.get(i).unwrap();
            execute_buy(
                &env,
                &buyer,
                prompt_id,
                &referral_code,
                payment_amount,
                None,
            )?;
        }
        Ok(())
    }

    fn transfer_license(
        env: Env,
        seller: Address,
        prompt_id: u128,
        new_buyer: Address,
        resale_price: i128,
    ) -> Result<(), Error> {
        seller.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        // #271: royalty enforcement path (b). `transfer_license` already carries a
        // `resale_price` and moves value on-chain, so the creator royalty is skimmed
        // directly from the existing payment distribution below rather than in a new
        // function. A zero `resale_price` is a valid gift transfer that changes no
        // value hands, so it must be allowed WITHOUT attempting a bogus royalty
        // payment — the royalty/seller transfers below are already `> 0`-guarded.
        ensure(resale_price >= 0, Error::InvalidPaymentAmount)?;
        ensure(seller != new_buyer, Error::InvalidLicenseTransfer)?;
        new_buyer.require_auth();

        let prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();
        let mut purchase = Storage::require_purchase(&env, prompt_id, &seller)?;
        ensure(purchase.owner == seller, Error::Unauthorized)?;
        ensure(purchase.expires_at >= now, Error::LicenseNotFound)?;
        ensure(
            !Storage::has_active_purchase(&env, prompt_id, &new_buyer, now),
            Error::AlreadyPurchased,
        )?;

        Storage::set_reentrancy_guard(&env)?;

        let this_contract = env.current_contract_address();
        let asset_client = token::StellarAssetClient::new(&env, &prompt.asset);
        let royalty_amount = resale_price
            .checked_mul(ROYALTY_BPS as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        let seller_amount = resale_price
            .checked_sub(royalty_amount)
            .ok_or(Error::ArithmeticOverflow)?;

        if royalty_amount > 0 {
            asset_client.transfer_from(
                &this_contract,
                &new_buyer,
                &purchase.original_creator,
                &royalty_amount,
            );
        }
        if seller_amount > 0 {
            asset_client.transfer_from(&this_contract, &new_buyer, &seller, &seller_amount);
        }

        Storage::remove_purchase(&env, prompt_id, &seller);
        Storage::remove_prompt_from_buyer(&env, &seller, prompt_id);
        purchase.owner = new_buyer.clone();
        purchase.last_transfer_price = resale_price;
        purchase.transfer_count = purchase
            .transfer_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        purchase.last_transferred_at = now;
        Storage::save_purchase(&env, &purchase);
        Storage::add_prompt_to_buyer(&env, &new_buyer, prompt_id);
        Storage::clear_reentrancy_guard(&env);

        Events::emit_license_transferred(
            &env,
            prompt_id,
            seller,
            new_buyer,
            purchase.original_creator,
            resale_price,
            royalty_amount,
        );
        Ok(())
    }

    fn has_access(env: Env, user: Address, prompt_id: u128) -> Result<bool, Error> {
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        let now = env.ledger().timestamp();
        if prompt.creator == user || Storage::has_active_purchase(&env, prompt_id, &user, now) {
            return Ok(true);
        }
        if !Storage::is_subscription_eligible(&env, prompt_id) {
            return Ok(false);
        }
        Ok(Storage::get_subscription(&env, &user, &prompt.creator)
            .map(|subscription| now < subscription.expires_at)
            .unwrap_or(false))
    }

    fn get_prompt(env: Env, prompt_id: u128) -> Result<Prompt, Error> {
        Storage::require_prompt(&env, prompt_id)
    }

    fn get_all_prompts(env: Env) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_all_prompts(&env))
    }

    fn get_prompts_by_creator(env: Env, creator: Address) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_prompts_by_creator(&env, &creator))
    }

    fn get_prompts_by_category(env: Env, category: String) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_prompts_by_category(&env, &category))
    }

    fn get_prompts_by_buyer(env: Env, buyer: Address) -> Result<Vec<Prompt>, Error> {
        Ok(Storage::get_prompts_by_buyer(&env, &buyer))
    }

    fn get_purchase_details(env: Env, prompt_id: u128, buyer: Address) -> Result<Purchase, Error> {
        Storage::require_purchase(&env, prompt_id, &buyer)
    }

    fn configure_subscription_pass(
        env: Env,
        creator: Address,
        duration_secs: u64,
        price: i128,
        asset: Address,
        active: bool,
    ) -> Result<(), Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        ensure(
            duration_secs > 0 && duration_secs <= MAX_SUBSCRIPTION_DURATION_SECS,
            Error::InvalidSubscriptionConfig,
        )?;
        ensure(price > 0, Error::InvalidSubscriptionConfig)?;
        validate_token_contract(&env, &asset)?;
        Storage::save_subscription_config(
            &env,
            &SubscriptionConfig {
                creator: creator.clone(),
                duration_secs,
                price,
                asset: asset.clone(),
                active,
            },
        );
        Events::emit_subscription_configured(&env, creator, duration_secs, price, asset, active);
        Ok(())
    }

    fn set_subscription_eligibility(
        env: Env,
        creator: Address,
        prompt_id: u128,
        eligible: bool,
    ) -> Result<(), Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        Storage::set_subscription_eligibility(&env, prompt_id, eligible);
        Events::emit_subscription_eligibility_updated(&env, prompt_id, eligible);
        Ok(())
    }

    fn subscribe_catalog(
        env: Env,
        subscriber: Address,
        creator: Address,
        payment_amount: i128,
    ) -> Result<u64, Error> {
        subscriber.require_auth();
        ensure(
            Storage::get_subscription(&env, &subscriber, &creator).is_none(),
            Error::AlreadyPurchased,
        )?;
        settle_subscription(&env, &subscriber, &creator, payment_amount, false)
    }

    fn renew_catalog_subscription(
        env: Env,
        subscriber: Address,
        creator: Address,
        payment_amount: i128,
    ) -> Result<u64, Error> {
        subscriber.require_auth();
        settle_subscription(&env, &subscriber, &creator, payment_amount, true)
    }

    fn get_subscription(
        env: Env,
        subscriber: Address,
        creator: Address,
    ) -> Result<Subscription, Error> {
        Storage::get_subscription(&env, &subscriber, &creator).ok_or(Error::SubscriptionNotFound)
    }

    fn get_subscription_config(env: Env, creator: Address) -> Result<SubscriptionConfig, Error> {
        Storage::get_subscription_config(&env, &creator).ok_or(Error::SubscriptionNotFound)
    }

    fn is_subscription_eligible(env: Env, prompt_id: u128) -> Result<bool, Error> {
        Storage::require_prompt(&env, prompt_id)?;
        Ok(Storage::is_subscription_eligible(&env, prompt_id))
    }

    fn set_fee_percentage(
        env: Env,
        new_fee_percentage: u32,
        approver_a: Address,
        approver_b: Address,
    ) -> Result<(), Error> {
        require_admin_multisig(&env, &approver_a, &approver_b)?;
        Storage::require_no_reentrancy(&env)?;
        ensure(new_fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;
        Storage::set_fee_percentage(&env, &new_fee_percentage);
        Events::emit_fee_updated(&env, new_fee_percentage);
        Ok(())
    }

    fn set_fee_wallet(
        env: Env,
        new_fee_wallet: Address,
        approver_a: Address,
        approver_b: Address,
    ) -> Result<(), Error> {
        require_admin_multisig(&env, &approver_a, &approver_b)?;
        Storage::require_no_reentrancy(&env)?;
        ensure!(
            Storage::get_fee_wallet(&env).is_none(),
            Error::FeeWalletAlreadySet
        );
        Storage::set_fee_wallet(&env, &new_fee_wallet);
        Events::emit_fee_wallet_updated(&env, new_fee_wallet);
        Ok(())
    }

    fn get_fee_percentage(env: Env) -> u32 {
        Storage::get_fee_percentage(&env)
    }

    fn get_fee_wallet(env: Env) -> Option<Address> {
        Storage::get_fee_wallet(&env)
    }

    fn get_xlm_sac(env: Env) -> Option<Address> {
        Storage::get_xlm_address(&env)
    }

    fn set_price_bounds(
        env: Env,
        approver_a: Address,
        approver_b: Address,
        min_price: Option<i128>,
        max_price: Option<i128>,
    ) -> Result<(), Error> {
        require_admin_multisig(&env, &approver_a, &approver_b)?;
        Storage::require_no_reentrancy(&env)?;
        Storage::set_min_price(&env, min_price);
        Storage::set_max_price(&env, max_price);
        Events::emit_price_bounds_set(&env, min_price, max_price);
        Ok(())
    }

    fn get_price_bounds(env: Env) -> (Option<i128>, Option<i128>) {
        (Storage::get_min_price(&env), Storage::get_max_price(&env))
    }

    fn set_pause_status(
        env: Env,
        paused: bool,
        approver_a: Address,
        approver_b: Address,
    ) -> Result<(), Error> {
        require_admin_multisig(&env, &approver_a, &approver_b)?;
        Storage::require_no_reentrancy(&env)?;
        Storage::set_pause_status(&env, paused);
        Events::emit_contract_paused_state_changed(&env, paused);
        Ok(())
    }

    fn is_paused(env: Env) -> bool {
        Storage::is_paused(&env)
    }

    #[only_owner]
    fn set_referral_percentage(env: Env, new_referral_percentage: u32) -> Result<(), Error> {
        Storage::require_no_reentrancy(&env)?;
        ensure(
            new_referral_percentage <= MAX_BPS,
            Error::InvalidReferralPercentage,
        )?;
        Storage::set_referral_percentage(&env, new_referral_percentage);
        Ok(())
    }

    fn get_referral_percentage(env: Env) -> u32 {
        Storage::get_referral_percentage(&env)
    }

    fn register_referral_code(
        env: Env,
        referrer: Address,
        code_hash: BytesN<32>,
    ) -> Result<(), Error> {
        referrer.require_auth();
        ensure(
            Storage::get_referral_code(&env, &code_hash).is_none(),
            Error::ReferralCodeAlreadyExists,
        )?;
        let reward_bps = Storage::get_referral_percentage(&env);
        ensure(reward_bps <= MAX_BPS, Error::InvalidReferralPercentage)?;
        Storage::save_referral_code(
            &env,
            &code_hash,
            &ReferralCode {
                owner: referrer.clone(),
                reward_bps,
                active: true,
            },
        );
        Events::emit_referral_code_registered(&env, referrer, code_hash, reward_bps);
        Ok(())
    }

    fn revoke_referral_code(
        env: Env,
        referrer: Address,
        code_hash: BytesN<32>,
    ) -> Result<(), Error> {
        referrer.require_auth();
        let mut code =
            Storage::get_referral_code(&env, &code_hash).ok_or(Error::ReferralCodeNotFound)?;
        ensure(code.owner == referrer, Error::Unauthorized)?;
        code.active = false;
        Storage::save_referral_code(&env, &code_hash, &code);
        Ok(())
    }

    fn add_voucher(
        env: Env,
        creator: Address,
        prompt_id: u128,
        hashed_code: BytesN<32>,
        discount_bps: u32,
    ) -> Result<(), Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        ensure(discount_bps <= MAX_BPS, Error::InvalidDiscountPercentage)?;
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        Storage::add_voucher(&env, prompt_id, &hashed_code, discount_bps);
        Events::emit_voucher_added(&env, prompt_id, hashed_code, discount_bps);
        Ok(())
    }

    fn remove_voucher(
        env: Env,
        creator: Address,
        prompt_id: u128,
        hashed_code: BytesN<32>,
    ) -> Result<(), Error> {
        creator.require_auth();
        Storage::require_no_reentrancy(&env)?;
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        Storage::remove_voucher(&env, prompt_id, &hashed_code);
        Events::emit_voucher_removed(&env, prompt_id, hashed_code);
        Ok(())
    }

    fn propose_upgrade(
        env: Env,
        new_wasm_hash: BytesN<32>,
        approver_a: Address,
        approver_b: Address,
    ) -> Result<(), Error> {
        require_admin_multisig(&env, &approver_a, &approver_b)?;
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        // (1) Reject an invalid implementation: a zero hash is never a deployable
        //     WASM, and re-proposing the currently-deployed bytecode is a no-op.
        validate_deployable_implementation(&env, &new_wasm_hash)?;
        ensure(
            Storage::get_pending_upgrade(&env).is_none(),
            Error::UpgradeAlreadyProposed,
        )?;

        let proposed_at = env.ledger().timestamp();
        Storage::set_pending_upgrade(&env, &new_wasm_hash);
        Storage::set_upgrade_proposer(&env, &approver_a);
        Storage::set_upgrade_proposed_at(&env, proposed_at);
        Events::emit_upgrade_proposed(&env, new_wasm_hash, proposed_at);
        Ok(())
    }

    fn confirm_upgrade(env: Env, approver_a: Address, approver_b: Address) -> Result<(), Error> {
        require_admin_multisig(&env, &approver_a, &approver_b)?;
        let pending = Storage::get_pending_upgrade(&env).ok_or(Error::UpgradeNotProposed)?;
        // (timelock) Enforce the cooldown before executing the upgrade.
        let proposed_at =
            Storage::get_upgrade_proposed_at(&env).ok_or(Error::UpgradeNotProposed)?;
        let now = env.ledger().timestamp();
        ensure(
            now >= proposed_at.saturating_add(UPGRADE_COOLDOWN_SECS),
            Error::UpgradeCooldownNotElapsed,
        )?;
        // (1) Re-validate the implementation is still usable at confirmation time.
        validate_deployable_implementation(&env, &pending)?;
        // (2) Verify storage data is intact before swapping bytecode.
        validate_storage_integrity(&env)?;
        // (3) Verify no existing license holders would be broken by the upgrade.
        validate_license_integrity(&env)?;

        env.deployer().update_current_contract_wasm(pending.clone());
        env.storage().instance().extend_ttl(
            super::storage::PERSISTENT_LIFETIME_THRESHOLD,
            super::storage::PERSISTENT_BUMP_AMOUNT,
        );
        let confirmed_at = env.ledger().timestamp();
        Storage::clear_pending_upgrade(&env);
        Storage::clear_upgrade_proposer(&env);
        Storage::clear_upgrade_proposed_at(&env);
        Events::emit_upgrade_confirmed(&env, pending, confirmed_at);
        Ok(())
    }

    fn cancel_upgrade(env: Env, approver_a: Address, approver_b: Address) -> Result<(), Error> {
        require_admin_multisig(&env, &approver_a, &approver_b)?;
        let pending = Storage::get_pending_upgrade(&env).ok_or(Error::UpgradeNotProposed)?;
        Storage::clear_pending_upgrade(&env);
        Storage::clear_upgrade_proposer(&env);
        Storage::clear_upgrade_proposed_at(&env);
        Events::emit_upgrade_cancelled(&env, pending);
        Ok(())
    }

    fn get_pending_upgrade(env: Env) -> Option<BytesN<32>> {
        Storage::get_pending_upgrade(&env)
    }

    fn extend_ttl(env: Env, key: DataKey) -> Result<(), Error> {
        Storage::require_no_reentrancy(&env)?;
        Storage::extend_key_ttl(&env, &key);
        Ok(())
    }

    // ─── Bundle methods ──────────────────────────────────────────────────────

    fn create_bundle(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        image_url: String,
        prompt_ids: Vec<u128>,
        price_stroops: i128,
        asset: Address,
    ) -> Result<u128, Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;

        // Field length validation
        ensure(
            title.len() > 0 && title.len() <= MAX_BUNDLE_TITLE_LEN,
            Error::InvalidFieldLength,
        )?;
        ensure(
            description.len() <= MAX_BUNDLE_DESC_LEN,
            Error::InvalidFieldLength,
        )?;
        ensure(
            image_url.len() <= MAX_IMAGE_URL_LEN,
            Error::InvalidFieldLength,
        )?;
        ensure(price_stroops > 0, Error::InvalidPrice)?;
        // At least one item, at most MAX_BUNDLE_ITEMS
        ensure(prompt_ids.len() > 0, Error::InvalidPrice)?;
        ensure(prompt_ids.len() <= MAX_BUNDLE_ITEMS, Error::InvalidPrice)?;

        // Validate token interface through the guarded external-call helper.
        validate_token_contract(&env, &asset)?;

        // Validate every prompt: must exist, be active, and be owned by creator
        for i in 0..prompt_ids.len() {
            let pid = prompt_ids.get(i).unwrap();
            let prompt = Storage::require_prompt(&env, pid)?;
            ensure(prompt.creator == creator, Error::Unauthorized)?;
            ensure(prompt.active, Error::PromptInactive)?;
            ensure(prompt.asset == asset, Error::InvalidPrice)?;
            // Check for duplicates within the supplied list
            for j in (i + 1)..prompt_ids.len() {
                ensure(prompt_ids.get(j).unwrap() != pid, Error::InvalidPrice)?;
            }
        }

        let bundle_id = Storage::get_bundle_counter(&env);
        let bundle = Bundle {
            id: bundle_id,
            creator: creator.clone(),
            title,
            description,
            image_url,
            prompt_ids: prompt_ids.clone(),
            price_stroops,
            asset,
            active: true,
            sales_count: 0,
            created_at: env.ledger().timestamp(),
        };

        Storage::save_bundle(&env, &bundle)?;
        Storage::add_bundle_to_creator(&env, &creator, bundle_id);
        Events::emit_bundle_created(&env, bundle_id, creator, price_stroops, prompt_ids.len());
        Ok(bundle_id)
    }

    fn add_bundle_item(
        env: Env,
        creator: Address,
        bundle_id: u128,
        prompt_id: u128,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut bundle = Storage::require_bundle(&env, bundle_id)?;
        ensure(bundle.creator == creator, Error::Unauthorized)?;

        // Capacity check
        ensure(
            bundle.prompt_ids.len() < MAX_BUNDLE_ITEMS,
            Error::InvalidPrice,
        )?;

        // Prompt must exist, be active, and belong to this creator
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        ensure(prompt.active, Error::PromptInactive)?;
        ensure(prompt.asset == bundle.asset, Error::InvalidPrice)?;

        // Must not already be a member
        for i in 0..bundle.prompt_ids.len() {
            ensure(
                bundle.prompt_ids.get(i).unwrap() != prompt_id,
                Error::InvalidPrice,
            )?;
        }

        bundle.prompt_ids.push_back(prompt_id);
        Storage::update_bundle(&env, &bundle);
        Events::emit_bundle_item_added(&env, bundle_id, prompt_id);
        Ok(())
    }

    fn remove_bundle_item(
        env: Env,
        creator: Address,
        bundle_id: u128,
        prompt_id: u128,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut bundle = Storage::require_bundle(&env, bundle_id)?;
        ensure(bundle.creator == creator, Error::Unauthorized)?;

        let mut found = false;
        let mut idx = 0u32;
        while idx < bundle.prompt_ids.len() {
            if bundle.prompt_ids.get(idx).unwrap() == prompt_id {
                bundle.prompt_ids.remove(idx);
                found = true;
                break;
            }
            idx += 1;
        }
        ensure(found, Error::PromptNotFound)?;
        // Bundle must retain at least one item
        ensure(bundle.prompt_ids.len() > 0, Error::InvalidPrice)?;

        Storage::update_bundle(&env, &bundle);
        Events::emit_bundle_item_removed(&env, bundle_id, prompt_id);
        Ok(())
    }

    fn update_bundle_price(
        env: Env,
        creator: Address,
        bundle_id: u128,
        price_stroops: i128,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut bundle = Storage::require_bundle(&env, bundle_id)?;
        ensure(bundle.creator == creator, Error::Unauthorized)?;
        ensure(price_stroops > 0, Error::InvalidPrice)?;

        bundle.price_stroops = price_stroops;
        Storage::update_bundle(&env, &bundle);
        Events::emit_bundle_price_updated(&env, bundle_id, price_stroops);
        Ok(())
    }

    fn set_bundle_active(
        env: Env,
        creator: Address,
        bundle_id: u128,
        active: bool,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut bundle = Storage::require_bundle(&env, bundle_id)?;
        ensure(bundle.creator == creator, Error::Unauthorized)?;

        bundle.active = active;
        Storage::update_bundle(&env, &bundle);
        Events::emit_bundle_active_updated(&env, bundle_id, active);
        Ok(())
    }

    fn buy_bundle(
        env: Env,
        buyer: Address,
        bundle_id: u128,
        payment_amount_stroops: i128,
        referrer: Option<Address>,
    ) -> Result<(), Error> {
        buyer.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;

        let mut bundle = Storage::require_bundle(&env, bundle_id)?;
        ensure(bundle.active, Error::PromptInactive)?;
        ensure(bundle.creator != buyer, Error::CreatorCannotBuy)?;
        ensure(
            !Storage::has_bundle_purchase(&env, bundle_id, &buyer),
            Error::AlreadyPurchased,
        )?;
        ensure(
            payment_amount_stroops >= bundle.price_stroops,
            Error::InvalidPaymentAmount,
        )?;

        ensure(bundle.prompt_ids.len() > 0, Error::InvalidPrice)?;

        let now = env.ledger().timestamp();
        let mut prompts = Vec::new(&env);
        for i in 0..bundle.prompt_ids.len() {
            let prompt_id = bundle.prompt_ids.get(i).unwrap();
            let prompt = Storage::require_prompt(&env, prompt_id)?;
            ensure(prompt.creator == bundle.creator, Error::Unauthorized)?;
            ensure(prompt.asset == bundle.asset, Error::InvalidPrice)?;
            ensure(prompt.active, Error::PromptInactive)?;
            ensure(
                !Storage::has_active_purchase(&env, prompt_id, &buyer, now),
                Error::AlreadyPurchased,
            )?;
            if prompt.expires_at != 0 {
                ensure(prompt.expires_at >= now, Error::ListingExpired)?;
            }
            prompts.push_back(prompt);
        }

        // Validate referrer
        if let Some(ref r) = referrer {
            ensure(
                r != &buyer && r != &bundle.creator,
                Error::ReferrerCannotBeBuyerOrCreator,
            )?;
        }

        Storage::set_reentrancy_guard(&env)?;

        // Atomic supply enforcement: check + increment + write each prompt's
        // supply right after the guard, before any token transfers, so
        // concurrent bundle purchases cannot overshoot max_supply.
        for i in 0..prompts.len() {
            let mut prompt = prompts.get(i).unwrap();
            if prompt.max_supply > 0 {
                ensure(
                    prompt.sales_count < prompt.max_supply,
                    Error::MaxSupplyReached,
                )?;
            }
            prompt.sales_count = prompt
                .sales_count
                .checked_add(1)
                .ok_or(Error::ArithmeticOverflow)?;
            Storage::update_prompt(&env, &prompt);
            prompts.set(i, prompt);
        }

        let fee_wallet = Storage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;
        let fee_percentage = Storage::get_fee_percentage(&env);
        let referral_percentage = Storage::get_referral_percentage(&env);
        ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;
        ensure(
            referral_percentage <= MAX_BPS,
            Error::InvalidReferralPercentage,
        )?;
        let this_contract = env.current_contract_address();
        let asset_client = token::StellarAssetClient::new(&env, &bundle.asset);
        let price = bundle.price_stroops;

        // Pre-check buyer balance to surface a clear error instead of a raw
        // Soroban token-transfer failure when the wallet is unfunded.
        let buyer_balance: i128 = asset_client.balance(&buyer);
        ensure(
            buyer_balance >= price,
            Error::InsufficientBalance,
        )?;

        let fee_amount = price
            .checked_mul(fee_percentage as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;

        let referral_amount = if referrer.is_some() {
            price
                .checked_mul(referral_percentage as i128)
                .ok_or(Error::ArithmeticOverflow)?
                / MAX_BPS as i128
        } else {
            0
        };

        let creator_amount = price
            .checked_sub(fee_amount)
            .ok_or(Error::ArithmeticOverflow)?
            .checked_sub(referral_amount)
            .ok_or(Error::ArithmeticOverflow)?;
        ensure(creator_amount >= 0, Error::InvalidFeePercentage)?;

        // Route payments
        asset_client.transfer_from(&this_contract, &buyer, &bundle.creator, &creator_amount);
        if fee_amount > 0 {
            asset_client.transfer_from(&this_contract, &buyer, &fee_wallet, &fee_amount);
        }
        if let Some(ref r) = referrer {
            if referral_amount > 0 {
                asset_client.transfer_from(&this_contract, &buyer, r, &referral_amount);
            }
        }

        let item_count = prompts.len() as i128;
        let per_item_price = price / item_count;
        let price_remainder = price % item_count;
        let per_item_creator_amount = creator_amount / item_count;
        let creator_remainder = creator_amount % item_count;
        let per_item_fee_amount = fee_amount / item_count;
        let fee_remainder = fee_amount % item_count;
        let per_item_referral_amount = referral_amount / item_count;
        let referral_remainder = referral_amount % item_count;
        for i in 0..prompts.len() {
            let mut prompt = prompts.get(i).unwrap();
            let item_price = if i == 0 {
                per_item_price
                    .checked_add(price_remainder)
                    .ok_or(Error::ArithmeticOverflow)?
            } else {
                per_item_price
            };
            let item_creator_amount = if i == 0 {
                per_item_creator_amount
                    .checked_add(creator_remainder)
                    .ok_or(Error::ArithmeticOverflow)?
            } else {
                per_item_creator_amount
            };
            let item_fee_amount = if i == 0 {
                per_item_fee_amount
                    .checked_add(fee_remainder)
                    .ok_or(Error::ArithmeticOverflow)?
            } else {
                per_item_fee_amount
            };
            let item_referral_amount = if i == 0 {
                per_item_referral_amount
                    .checked_add(referral_remainder)
                    .ok_or(Error::ArithmeticOverflow)?
            } else {
                per_item_referral_amount
            };
            Storage::grant_purchase(
                &env,
                &prompt,
                &buyer,
                item_price,
                MAX_ACCESS_EXPIRY,
                Settlement {
                    buyer_amount: item_price,
                    creator_amount: item_creator_amount,
                    platform_amount: item_fee_amount,
                    referrer: referrer.clone(),
                    referrer_amount: item_referral_amount,
                    split_amount: 0,
                },
            );
        }

        // Record purchase with snapshot of current prompt_ids
        let purchase = BundlePurchase {
            bundle_id,
            owner: buyer.clone(),
            original_creator: bundle.creator.clone(),
            paid_price: price,
            purchased_at: now,
            purchased_prompt_ids: bundle.prompt_ids.clone(),
        };
        Storage::save_bundle_purchase(&env, &purchase);
        Storage::add_bundle_to_buyer(&env, &buyer, bundle_id);

        bundle.sales_count = bundle
            .sales_count
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        Storage::update_bundle(&env, &bundle);

        Storage::clear_reentrancy_guard(&env);

        Events::emit_bundle_purchased(&env, bundle_id, buyer, bundle.creator, price, referrer);
        Ok(())
    }

    fn has_bundle_access(env: Env, user: Address, bundle_id: u128) -> Result<bool, Error> {
        let bundle = Storage::require_bundle(&env, bundle_id)?;
        if bundle.creator == user {
            return Ok(true);
        }
        Ok(Storage::has_bundle_purchase(&env, bundle_id, &user))
    }

    fn get_bundle(env: Env, bundle_id: u128) -> Result<Bundle, Error> {
        Storage::require_bundle(&env, bundle_id)
    }

    fn get_all_bundles(env: Env) -> Result<Vec<Bundle>, Error> {
        Ok(Storage::get_all_bundles(&env))
    }

    fn get_bundles_by_creator(env: Env, creator: Address) -> Result<Vec<Bundle>, Error> {
        Ok(Storage::get_bundles_by_creator(&env, &creator))
    }

    fn get_bundles_by_buyer(env: Env, buyer: Address) -> Result<Vec<Bundle>, Error> {
        Ok(Storage::get_bundles_by_buyer(&env, &buyer))
    }

    fn get_schema_version(env: Env) -> u32 {
        Storage::get_schema_version(&env)
    }

    #[only_owner]
    fn migrate(env: Env, new_version: u32) -> Result<u32, Error> {
        let previous_version = Storage::get_schema_version(&env);
        ensure(new_version > previous_version, Error::VersionMismatch)?;
        ensure(
            new_version <= CONTRACT_SCHEMA_VERSION,
            Error::VersionMismatch,
        )?;

        Storage::set_schema_version(&env, new_version);
        Events::emit_schema_migrated(&env, previous_version, new_version);
        Ok(new_version)
    }

    // ─── #131: Content Classification ──────────────────────────────────────

    fn set_classification(
        env: Env,
        creator: Address,
        prompt_id: u128,
        classification: String,
        safety_flags: Vec<String>,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        validate_classification(&env, &classification)?;
        validate_safety_flags(&env, &safety_flags)?;

        prompt.classification = classification.clone();
        prompt.safety_flags = safety_flags.clone();
        Storage::update_prompt(&env, &prompt);
        Events::emit_classification_set(&env, prompt_id, classification, safety_flags);
        Ok(())
    }

    fn get_classification(env: Env, prompt_id: u128) -> Result<(String, Vec<String>), Error> {
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        Ok((prompt.classification, prompt.safety_flags))
    }

    fn set_moderator_override(
        env: Env,
        moderator: Address,
        prompt_id: u128,
        classification: String,
        safety_flags: Vec<String>,
        reason: String,
    ) -> Result<(), Error> {
        moderator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        let stored_moderator = Storage::get_moderator_address(&env).ok_or(Error::NotModerator)?;
        ensure(moderator == stored_moderator, Error::NotModerator)?;
        ensure(
            !reason.is_empty() && reason.len() <= MAX_REASON_LEN,
            Error::InvalidClassification,
        )?;
        validate_classification(&env, &classification)?;
        validate_safety_flags(&env, &safety_flags)?;

        let now = env.ledger().timestamp();
        let override_entry = ClassificationOverride {
            classifier: moderator.clone(),
            classification: classification.clone(),
            safety_flags: safety_flags.clone(),
            reason: reason.clone(),
            reviewed_at: now,
        };
        Storage::set_moderator_override(&env, prompt_id, &override_entry);
        Events::emit_classification_overridden(
            &env,
            prompt_id,
            moderator,
            classification,
            safety_flags,
            reason,
        );
        Ok(())
    }

    fn get_active_classification(
        env: Env,
        prompt_id: u128,
    ) -> Result<(String, Vec<String>), Error> {
        let prompt = Storage::require_prompt(&env, prompt_id)?;
        // Moderator override takes precedence if it exists
        if let Some(override_entry) = Storage::get_moderator_override(&env, prompt_id) {
            return Ok((override_entry.classification, override_entry.safety_flags));
        }
        Ok((prompt.classification, prompt.safety_flags))
    }

    fn get_moderator_override(env: Env, prompt_id: u128) -> Result<ClassificationOverride, Error> {
        Storage::get_moderator_override(&env, prompt_id).ok_or(Error::PromptNotFound)
    }

    #[only_owner]
    fn set_moderator_address(env: Env, admin: Address, moderator: Address) -> Result<(), Error> {
        admin.require_auth();
        Storage::set_moderator_address(&env, &moderator);
        Ok(())
    }

    // ─── Promotional Pricing ──────────────────────────────────────────────

    fn create_promotion(
        env: Env,
        creator: Address,
        prompt_id: u128,
        start_time: u64,
        end_time: u64,
        price: i128,
        asset: Address,
    ) -> Result<u128, Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;

        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        // Validate promotion time bounds
        validate_promotion_time(&env, start_time, end_time)?;

        // Validate price
        ensure(price > 0, Error::InvalidPrice)?;

        // Validate asset implements token interface
        let _ = token::Client::new(&env, &asset).decimals();

        // Check for overlapping promotions
        check_promotion_overlap(&env, prompt_id, start_time, end_time)?;

        // Generate promotion ID
        let promotion_id = Storage::get_prompt_counter(&env);

        let promotion = super::types::Promotion {
            prompt_id,
            creator: creator.clone(),
            start_time,
            end_time,
            price,
            asset: asset.clone(),
        };

        // Store the promotion
        Storage::set_active_promotion(&env, prompt_id, &promotion);
        Storage::add_promotion_to_history(&env, prompt_id, &promotion);

        // Emit event
        Events::emit_promotion_created(
            &env,
            prompt_id,
            promotion_id,
            creator,
            start_time,
            end_time,
            price,
            asset,
        );

        Ok(promotion_id)
    }

    fn cancel_promotion(env: Env, creator: Address, prompt_id: u128) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;

        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        let promotion =
            Storage::get_active_promotion(&env, prompt_id).ok_or(Error::PromotionNotFound)?;

        ensure(promotion.creator == creator, Error::UnauthorizedPromotion)?;

        // Clear the active promotion
        Storage::clear_active_promotion(&env, prompt_id);

        // Emit event
        Events::emit_promotion_cancelled(
            &env,
            prompt_id,
            promotion.prompt_id, // Using prompt_id as promotion_id for simplicity
            creator,
        );

        Ok(())
    }

    fn get_active_promotion(
        env: Env,
        prompt_id: u128,
    ) -> Result<Option<super::types::Promotion>, Error> {
        Ok(Storage::get_active_promotion(&env, prompt_id))
    }

    fn get_promotion_history(
        env: Env,
        prompt_id: u128,
    ) -> Result<Vec<super::types::Promotion>, Error> {
        Ok(Storage::get_promotion_history(&env, prompt_id))
    }

    fn get_effective_price(env: Env, prompt_id: u128) -> Result<(i128, Address, bool), Error> {
        get_effective_price_for_prompt(&env, prompt_id)
    }

    // ─── Encryption Rotation ──────────────────────────────────────────────

    fn rotate_encryption(
        env: Env,
        creator: Address,
        prompt_id: u128,
        encrypted_prompt: String,
        encryption_iv: String,
        wrapped_key: String,
        content_hash: BytesN<32>,
    ) -> Result<u32, Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;

        let mut prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        // Validate new encrypted fields
        validate_len(
            &encrypted_prompt,
            MAX_ENCRYPTED_PROMPT_LEN,
            Error::InvalidFieldLength,
        )?;
        validate_len(&wrapped_key, MAX_WRAPPED_KEY_LEN, Error::InvalidFieldLength)?;
        validate_len(&encryption_iv, MAX_IV_LEN, Error::InvalidFieldLength)?;

        let previous_version = prompt.encryption_version;

        // Archive the current encryption payload before overwriting
        let now = env.ledger().timestamp();
        let archived = PromptEncryptedPayload {
            prompt_id,
            version: previous_version,
            encrypted_prompt: prompt.encrypted_prompt.clone(),
            encryption_iv: prompt.encryption_iv.clone(),
            wrapped_key: prompt.wrapped_key.clone(),
            content_hash: prompt.content_hash.clone(),
            created_at: now,
        };
        Storage::save_encryption_version(&env, prompt_id, previous_version, &archived);

        // Update prompt with new encryption material
        let new_version = previous_version
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        prompt.encrypted_prompt = encrypted_prompt;
        prompt.encryption_iv = encryption_iv;
        prompt.wrapped_key = wrapped_key;
        prompt.content_hash = content_hash;
        prompt.encryption_version = new_version;
        Storage::update_prompt(&env, &prompt);
        Storage::set_encryption_version_counter(&env, prompt_id, new_version);

        Events::emit_encryption_rotated(&env, prompt_id, previous_version, new_version, now);
        Ok(new_version)
    }

    fn get_prompt_encryption_version(
        env: Env,
        prompt_id: u128,
        version: u32,
    ) -> Result<PromptEncryptedPayload, Error> {
        let prompt = Storage::require_prompt(&env, prompt_id)?;

        if version == prompt.encryption_version {
            // Current version is always in the Prompt struct
            return Ok(PromptEncryptedPayload {
                prompt_id,
                version,
                encrypted_prompt: prompt.encrypted_prompt,
                encryption_iv: prompt.encryption_iv,
                wrapped_key: prompt.wrapped_key,
                content_hash: prompt.content_hash,
                created_at: 0, // not stored for the current version
            });
        }

        // Archived versions
        Storage::get_encryption_version(&env, prompt_id, version)
            .ok_or(Error::EncryptionVersionNotFound)
    }

    // ─── #273: Time-based Discount Mechanics ──────────────────────────────────

    fn set_discount(
        env: Env,
        creator: Address,
        prompt_id: u128,
        discounted_price: i128,
        start_ledger: u32,
        end_ledger: u32,
    ) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;

        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        ensure(discounted_price > 0, Error::InvalidPrice)?;
        // Reuse the promotion-time error for an invalid ledger window.
        ensure(end_ledger >= start_ledger, Error::InvalidPromotionTime)?;

        let discount = Discount {
            prompt_id,
            creator: creator.clone(),
            discounted_price,
            start_ledger,
            end_ledger,
        };
        Storage::set_discount(&env, &discount);
        Events::emit_discount_set(
            &env,
            prompt_id,
            creator,
            discounted_price,
            start_ledger,
            end_ledger,
        );
        Ok(())
    }

    fn clear_discount(env: Env, creator: Address, prompt_id: u128) -> Result<(), Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;

        let prompt = Storage::require_prompt(&env, prompt_id)?;
        ensure(prompt.creator == creator, Error::Unauthorized)?;
        // Reuse the promotion-not-found error when there is nothing to clear.
        ensure(
            Storage::get_discount(&env, prompt_id).is_some(),
            Error::PromotionNotFound,
        )?;

        Storage::clear_discount(&env, prompt_id);
        Events::emit_discount_cleared(&env, prompt_id, creator);
        Ok(())
    }

    fn get_discount(env: Env, prompt_id: u128) -> Result<Option<Discount>, Error> {
        Ok(Storage::get_discount(&env, prompt_id))
    }

    // ─── #275: Creator Reputation Staking ─────────────────────────────────

    fn stake(env: Env, creator: Address, prompt_id: u128, amount: i128) -> Result<i128, Error> {
        creator.require_auth();
        ensure(!Storage::is_paused(&env), Error::ContractIsPaused)?;
        ensure(amount > 0, Error::InvalidStakeAmount)?;

        let prompt = Storage::require_prompt(&env, prompt_id)?;
        // Only the prompt's own creator can stake against it.
        ensure(prompt.creator == creator, Error::Unauthorized)?;

        // Move native XLM from the creator into contract custody.
        let xlm = Storage::get_xlm_address(&env).ok_or(Error::XlmAddressNotSet)?;
        let this_contract = env.current_contract_address();
        Storage::set_reentrancy_guard(&env)?;
        token::Client::new(&env, &xlm).transfer(&creator, &this_contract, &amount);
        Storage::clear_reentrancy_guard(&env);

        let now = env.ledger().timestamp();
        let mut stake = Storage::get_stake(&env, prompt_id).unwrap_or(Stake {
            creator: creator.clone(),
            prompt_id,
            amount: 0,
            staked_at: now,
        });
        stake.amount = stake
            .amount
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        // Reset the cooldown clock on every top-up.
        stake.staked_at = now;
        Storage::save_stake(&env, &stake);

        Events::emit_stake_added(&env, prompt_id, creator, amount, stake.amount);
        Ok(stake.amount)
    }

    #[only_owner]
    fn slash(env: Env, prompt_id: u128, amount: i128) -> Result<i128, Error> {
        ensure(amount > 0, Error::InvalidStakeAmount)?;
        let mut stake = Storage::get_stake(&env, prompt_id).ok_or(Error::StakeNotFound)?;

        // Clamp so an over-slash can never underflow the recorded stake.
        let slash_amount = if amount > stake.amount {
            stake.amount
        } else {
            amount
        };
        stake.amount = stake
            .amount
            .checked_sub(slash_amount)
            .ok_or(Error::ArithmeticOverflow)?;

        if slash_amount > 0 {
            let xlm = Storage::get_xlm_address(&env).ok_or(Error::XlmAddressNotSet)?;
            let fee_wallet = Storage::get_fee_wallet(&env).ok_or(Error::FeeWalletNotSet)?;
            let this_contract = env.current_contract_address();
            Storage::set_reentrancy_guard(&env)?;
            token::Client::new(&env, &xlm).transfer(&this_contract, &fee_wallet, &slash_amount);
            Storage::clear_reentrancy_guard(&env);
        }

        Storage::save_stake(&env, &stake);
        Events::emit_stake_slashed(&env, prompt_id, slash_amount, stake.amount);
        Ok(slash_amount)
    }

    fn unstake(env: Env, creator: Address, prompt_id: u128, amount: i128) -> Result<i128, Error> {
        creator.require_auth();
        ensure(amount > 0, Error::InvalidStakeAmount)?;

        let mut stake = Storage::get_stake(&env, prompt_id).ok_or(Error::StakeNotFound)?;
        ensure(stake.creator == creator, Error::NotStakeOwner)?;

        // Enforce the cooldown measured from the most recent top-up.
        let now = env.ledger().timestamp();
        ensure(
            now >= stake.staked_at.saturating_add(STAKE_COOLDOWN_SECS),
            Error::StakeLocked,
        )?;

        // Clamp the requested amount to whatever remains after any slashing.
        let withdraw = if amount > stake.amount {
            stake.amount
        } else {
            amount
        };
        stake.amount = stake
            .amount
            .checked_sub(withdraw)
            .ok_or(Error::ArithmeticOverflow)?;

        if withdraw > 0 {
            let xlm = Storage::get_xlm_address(&env).ok_or(Error::XlmAddressNotSet)?;
            let this_contract = env.current_contract_address();
            Storage::set_reentrancy_guard(&env)?;
            token::Client::new(&env, &xlm).transfer(&this_contract, &creator, &withdraw);
            Storage::clear_reentrancy_guard(&env);
        }

        Storage::save_stake(&env, &stake);
        Events::emit_stake_withdrawn(&env, prompt_id, creator, withdraw, stake.amount);
        Ok(withdraw)
    }

    fn get_stake(env: Env, prompt_id: u128) -> Result<Stake, Error> {
        Storage::get_stake(&env, prompt_id).ok_or(Error::StakeNotFound)
    }
}

#[contractimpl]
impl Ownable for PromptHashContract {
    fn get_owner(env: &Env) -> Option<Address> {
        ownable::get_owner(env)
    }

    fn transfer_ownership(env: &Env, new_owner: Address, live_until_ledger: u32) {
        assert_no_reentrancy(env);
        ownable::transfer_ownership(env, &new_owner, live_until_ledger);
    }

    fn accept_ownership(env: &Env) {
        assert_no_reentrancy(env);
        ownable::accept_ownership(env);
    }

    fn renounce_ownership(env: &Env) {
        assert_no_reentrancy(env);
        ownable::renounce_ownership(env);
    }
}

// ─── Core buy logic (shared by buy_prompt and buy_prompts_bulk) ──────────────

fn settle_subscription(
    env: &Env,
    subscriber: &Address,
    creator: &Address,
    payment_amount: i128,
    renewal: bool,
) -> Result<u64, Error> {
    ensure(!Storage::is_paused(env), Error::ContractIsPaused)?;
    ensure(subscriber != creator, Error::CreatorCannotBuy)?;
    let config =
        Storage::get_subscription_config(env, creator).ok_or(Error::SubscriptionNotFound)?;
    ensure(config.active, Error::SubscriptionInactive)?;
    ensure(
        payment_amount == config.price,
        Error::InvalidSubscriptionConfig,
    )?;

    let existing = Storage::get_subscription(env, subscriber, creator);
    if renewal {
        ensure(existing.is_some(), Error::SubscriptionNotFound)?;
    }

    Storage::set_reentrancy_guard(env)?;
    let fee_wallet = Storage::get_fee_wallet(env).ok_or(Error::FeeWalletNotSet)?;
    let fee_bps = Storage::get_fee_percentage(env);
    ensure(fee_bps <= MAX_BPS, Error::InvalidFeePercentage)?;
    let platform_amount = payment_amount
        .checked_mul(fee_bps as i128)
        .ok_or(Error::ArithmeticOverflow)?
        / MAX_BPS as i128;
    let creator_amount = payment_amount
        .checked_sub(platform_amount)
        .ok_or(Error::ArithmeticOverflow)?;
    let this_contract = env.current_contract_address();
    let asset_client = token::StellarAssetClient::new(env, &config.asset);
    if creator_amount > 0 {
        asset_client.transfer_from(&this_contract, subscriber, creator, &creator_amount);
    }
    if platform_amount > 0 {
        asset_client.transfer_from(&this_contract, subscriber, &fee_wallet, &platform_amount);
    }

    let now = env.ledger().timestamp();
    let base = existing
        .as_ref()
        .map(|subscription| subscription.expires_at.max(now))
        .unwrap_or(now);
    let expires_at = base
        .checked_add(config.duration_secs)
        .ok_or(Error::ArithmeticOverflow)?;
    let renewal_count = existing
        .map(|subscription| subscription.renewal_count)
        .unwrap_or(0)
        .checked_add(if renewal { 1 } else { 0 })
        .ok_or(Error::ArithmeticOverflow)?;
    Storage::save_subscription(
        env,
        &Subscription {
            creator: creator.clone(),
            subscriber: subscriber.clone(),
            expires_at,
            renewal_count,
        },
    );
    Storage::clear_reentrancy_guard(env);
    Events::emit_subscription_renewed(
        env,
        creator.clone(),
        subscriber.clone(),
        expires_at,
        payment_amount,
        renewal_count,
    );
    Ok(expires_at)
}

fn execute_buy(
    env: &Env,
    buyer: &Address,
    prompt_id: u128,
    referral_code: &Option<Bytes>,
    payment_amount_stroops: i128,
    voucher: Option<Bytes>,
) -> Result<(), Error> {
    let mut prompt = Storage::require_prompt(env, prompt_id)?;
    let now = env.ledger().timestamp();

    ensure(prompt.active, Error::PromptInactive)?;
    ensure(prompt.creator != *buyer, Error::CreatorCannotBuy)?;
    ensure(
        !Storage::has_active_purchase(env, prompt_id, buyer, now),
        Error::AlreadyPurchased,
    )?;

    // #49: block purchase on an expired listing
    if prompt.expires_at != 0 {
        ensure(prompt.expires_at >= now, Error::ListingExpired)?;
    }

    // Check for active promotion and use promotional price if applicable
    let (effective_price, _effective_asset, is_promotional) =
        get_effective_price_for_prompt(env, prompt_id)?;

    // Apply voucher discount if provided
    let mut required_price = effective_price;
    if let Some(code) = voucher {
        let hashed_raw = env.crypto().sha256(&code);
        let hashed = BytesN::from_array(env, &hashed_raw.to_array());
        if let Some(discount_bps) = Storage::get_voucher(env, prompt_id, &hashed) {
            let discount_amount = required_price
                .checked_mul(discount_bps as i128)
                .ok_or(Error::ArithmeticOverflow)?
                / MAX_BPS as i128;
            required_price = required_price
                .checked_sub(discount_amount)
                .ok_or(Error::ArithmeticOverflow)?;
            Storage::remove_voucher(env, prompt_id, &hashed);
        } else {
            return Err(Error::InvalidVoucher);
        }
    }

    // Emit promotion applied event if a promotion was used
    if is_promotional {
        if let Some(_promo) = Storage::get_active_promotion(env, prompt_id) {
            Events::emit_promotion_applied(
                env,
                prompt_id,
                prompt_id, // Using prompt_id as promotion_id for simplicity
                buyer.clone(),
                required_price,
                prompt.price_stroops,
            );
        }
    }

    ensure(
        payment_amount_stroops >= required_price,
        Error::InvalidPaymentAmount,
    )?;

    let referral = resolve_referral(env, buyer, &prompt.creator, referral_code)?;
    let referrer = referral.as_ref().map(|code| code.owner.clone());

    Storage::set_reentrancy_guard(env)?;

    // Atomic supply enforcement: check + increment + write before any token
    // transfers so concurrent transactions cannot overshoot max_supply.
    if prompt.max_supply > 0 {
        ensure(
            prompt.sales_count < prompt.max_supply,
            Error::MaxSupplyReached,
        )?;
    }
    prompt.sales_count = prompt
        .sales_count
        .checked_add(1)
        .ok_or(Error::ArithmeticOverflow)?;
    Storage::update_prompt(env, &prompt);

    let fee_wallet = Storage::get_fee_wallet(env).ok_or(Error::FeeWalletNotSet)?;
    let this_contract = env.current_contract_address();

    let fee_percentage = Storage::get_fee_percentage(env);
    ensure(fee_percentage <= MAX_BPS, Error::InvalidFeePercentage)?;

    let fee_amount = payment_amount_stroops
        .checked_mul(fee_percentage as i128)
        .ok_or(Error::ArithmeticOverflow)?
        / MAX_BPS as i128;

    let referral_amount = if let Some(code) = &referral {
        payment_amount_stroops
            .checked_mul(code.reward_bps as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128
    } else {
        0
    };

    let deductions = fee_amount
        .checked_add(referral_amount)
        .ok_or(Error::ArithmeticOverflow)?;

    // #50: accumulate split amounts (each split is a share of the full payment)
    let mut split_total: i128 = 0;
    for i in 0..prompt.splits.len() {
        let split = prompt.splits.get(i).unwrap();
        let split_amount = payment_amount_stroops
            .checked_mul(split.bps as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        split_total = split_total
            .checked_add(split_amount)
            .ok_or(Error::ArithmeticOverflow)?;
    }

    let total_deductions = deductions
        .checked_add(split_total)
        .ok_or(Error::ArithmeticOverflow)?;
    let creator_amount = payment_amount_stroops
        .checked_sub(total_deductions)
        .ok_or(Error::ArithmeticOverflow)?;

    // Guard against misconfigured splits (e.g. fee raised after creation)
    ensure(creator_amount >= 0, Error::InvalidSplits)?;

    let asset_client = token::StellarAssetClient::new(env, &prompt.asset);

    // Pre-check buyer balance to surface a clear error instead of a raw
    // Soroban token-transfer failure when the wallet is unfunded.
    let buyer_balance: i128 = asset_client.balance(buyer);
    ensure(
        buyer_balance >= payment_amount_stroops,
        Error::InsufficientBalance,
    )?;

    if creator_amount > 0 {
        asset_client.transfer_from(&this_contract, buyer, &prompt.creator, &creator_amount);
    }

    if fee_amount > 0 {
        asset_client.transfer_from(&this_contract, buyer, &fee_wallet, &fee_amount);
    }

    if let Some(ref r) = referrer {
        if referral_amount > 0 {
            asset_client.transfer_from(&this_contract, buyer, r, &referral_amount);
            Events::emit_referral_reward_paid(
                env,
                prompt_id,
                r.clone(),
                buyer.clone(),
                referral_amount,
            );
        }
    }

    // #50: distribute co-creator splits
    for i in 0..prompt.splits.len() {
        let split = prompt.splits.get(i).unwrap();
        let split_amount = payment_amount_stroops
            .checked_mul(split.bps as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / MAX_BPS as i128;
        if split_amount > 0 {
            asset_client.transfer_from(&this_contract, buyer, &split.recipient, &split_amount);
        }
    }

    Storage::grant_purchase(
        env,
        &prompt,
        buyer,
        payment_amount_stroops,
        MAX_ACCESS_EXPIRY,
        Settlement {
            buyer_amount: payment_amount_stroops,
            creator_amount,
            platform_amount: fee_amount,
            referrer: referrer.clone(),
            referrer_amount: referral_amount,
            split_amount: split_total,
        },
    );
    Storage::clear_reentrancy_guard(env);

    Events::emit_prompt_purchased(
        env,
        prompt_id,
        buyer.clone(),
        prompt.creator,
        payment_amount_stroops,
        referrer,
        creator_amount,
        fee_amount,
        referral_amount,
    );

    if payment_amount_stroops > required_price {
        let tip_amount = payment_amount_stroops
            .checked_sub(required_price)
            .ok_or(Error::ArithmeticOverflow)?;
        Events::emit_prompt_tipped(env, prompt_id, buyer.clone(), tip_amount);
    }

    Ok(())
}

fn resolve_referral(
    env: &Env,
    buyer: &Address,
    creator: &Address,
    raw_code: &Option<Bytes>,
) -> Result<Option<ReferralCode>, Error> {
    let Some(raw_code) = raw_code else {
        return Ok(None);
    };
    ensure(raw_code.len() >= 16, Error::ReferralCodeTooShort)?;
    let digest = env.crypto().sha256(raw_code);
    let code_hash = BytesN::from_array(env, &digest.to_array());
    let code = Storage::get_referral_code(env, &code_hash)
        .filter(|code| code.active)
        .ok_or(Error::ReferralCodeNotFound)?;
    ensure(
        code.owner != *buyer && code.owner != *creator,
        Error::ReferrerCannotBeBuyerOrCreator,
    )?;

    if let Some(existing) = Storage::get_referral_parent(env, buyer) {
        ensure(existing == code.owner, Error::ReferralReplay)?;
    } else {
        let mut cursor = code.owner.clone();
        for _ in 0..64 {
            ensure(cursor != *buyer, Error::CircularReferral)?;
            match Storage::get_referral_parent(env, &cursor) {
                Some(parent) => cursor = parent,
                None => break,
            }
        }
        ensure(cursor != *buyer, Error::CircularReferral)?;
        Storage::set_referral_parent(env, buyer, &code.owner);
    }
    Ok(Some(code))
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/// Validate that the sum of all split basis-points does not exceed
/// MAX_BPS minus the current platform fee, ensuring the creator always
/// receives a non-negative payout.
fn validate_splits(env: &Env, splits: &Vec<Split>) -> Result<(), Error> {
    ensure(splits.len() <= MAX_SPLITS, Error::InvalidSplits)?;
    let fee_percentage = Storage::get_fee_percentage(env);
    let mut total_bps: u32 = 0;
    for i in 0..splits.len() {
        let split = splits.get(i).unwrap();
        ensure(split.bps > 0, Error::InvalidSplits)?;
        total_bps = total_bps
            .checked_add(split.bps)
            .ok_or(Error::ArithmeticOverflow)?;
    }
    // total_bps + fee must not exceed MAX_BPS so creator always gets ≥ 0
    let total = total_bps
        .checked_add(fee_percentage)
        .ok_or(Error::ArithmeticOverflow)?;
    ensure(total <= MAX_BPS, Error::InvalidSplits)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_prompt_fields(
    env: &Env,
    image_url: &String,
    title: &String,
    category: &String,
    preview_text: &String,
    encrypted_prompt: &String,
    encryption_iv: &String,
    wrapped_key: &String,
    price_stroops: i128,
) -> Result<(), Error> {
    let min_price = Storage::get_min_price(env).unwrap_or(0);
    ensure(price_stroops > min_price, Error::InvalidPrice)?;
    if let Some(max_price) = Storage::get_max_price(env) {
        ensure(price_stroops <= max_price, Error::InvalidPrice)?;
    }
    validate_len(image_url, MAX_IMAGE_URL_LEN, Error::InvalidFieldLength)?;
    validate_len(title, MAX_TITLE_LEN, Error::InvalidFieldLength)?;
    validate_len(category, MAX_CATEGORY_LEN, Error::InvalidFieldLength)?;
    validate_len(preview_text, MAX_PREVIEW_LEN, Error::InvalidFieldLength)?;
    validate_len(
        encrypted_prompt,
        MAX_ENCRYPTED_PROMPT_LEN,
        Error::InvalidFieldLength,
    )?;
    validate_len(wrapped_key, MAX_WRAPPED_KEY_LEN, Error::InvalidFieldLength)?;
    validate_len(encryption_iv, MAX_IV_LEN, Error::InvalidFieldLength)?;
    Ok(())
}

/// Validates a field is non-empty and fits within `max_len`.
///
/// `soroban_sdk::String::len()` counts **UTF-8 bytes**, not Unicode
/// characters. Multi-byte input (e.g. emoji) therefore consumes more than one
/// unit of the limit. The frontend mirrors this exact byte-counting in
/// `src/lib/validation/listing.ts` (`utf8Length`) so the client never submits
/// a field the contract will reject (#506).
fn validate_len(value: &String, max_len: u32, error: Error) -> Result<(), Error> {
    ensure(!value.is_empty() && value.len() <= max_len, error)
}

fn ensure(condition: bool, error: Error) -> Result<(), Error> {
    if condition {
        Ok(())
    } else {
        Err(error)
    }
}

fn require_admin_multisig(
    env: &Env,
    approver_a: &Address,
    approver_b: &Address,
) -> Result<(), Error> {
    ensure(approver_a != approver_b, Error::Unauthorized)?;
    ensure(
        Storage::is_admin_signer(env, approver_a) && Storage::is_admin_signer(env, approver_b),
        Error::Unauthorized,
    )?;
    approver_a.require_auth();
    approver_b.require_auth();
    Ok(())
}

fn validate_classification(env: &Env, classification: &String) -> Result<(), Error> {
    for name in ALL_CLASSIFICATIONS {
        if classification == &String::from_str(env, name) {
            return Ok(());
        }
    }
    Err(Error::InvalidClassification)
}

fn validate_safety_flags(env: &Env, flags: &Vec<String>) -> Result<(), Error> {
    ensure(flags.len() <= MAX_SAFETY_FLAGS_COUNT, Error::InvalidDisclosureFlags)?;
    for i in 0..flags.len() {
        let flag = flags.get(i).unwrap();
        ensure(flag.len() <= MAX_FLAG_LEN, Error::InvalidDisclosureFlags)?;
        let mut recognized = false;
        for name in VALID_DISCLOSURE_FLAGS {
            if flag == String::from_str(env, name) {
                recognized = true;
                break;
            }
        }
        ensure(recognized, Error::InvalidDisclosureFlags)?;
    }
    Ok(())
}

fn validate_promotion_time(env: &Env, start_time: u64, end_time: u64) -> Result<(), Error> {
    ensure(end_time > start_time, Error::InvalidPromotionTime)?;
    ensure(
        end_time > env.ledger().timestamp(),
        Error::InvalidPromotionTime,
    )?;
    Ok(())
}

fn check_promotion_overlap(
    env: &Env,
    prompt_id: u128,
    start_time: u64,
    end_time: u64,
) -> Result<(), Error> {
    if let Some(existing) = Storage::get_active_promotion(env, prompt_id) {
        let overlaps = start_time <= existing.end_time && end_time >= existing.start_time;
        ensure(!overlaps, Error::PromotionOverlap)?;
    }
    Ok(())
}

fn get_effective_price_for_prompt(
    env: &Env,
    prompt_id: u128,
) -> Result<(i128, Address, bool), Error> {
    let prompt = Storage::require_prompt(env, prompt_id)?;
    let now = env.ledger().timestamp();
    let seq = env.ledger().sequence();

    if let Some(promo) = Storage::get_active_promotion(env, prompt_id) {
        if now >= promo.start_time && now <= promo.end_time {
            return Ok((promo.price, promo.asset, true));
        }
    }

    if let Some(discount) = Storage::get_discount(env, prompt_id) {
        if seq >= discount.start_ledger && seq <= discount.end_ledger {
            return Ok((discount.discounted_price, prompt.asset.clone(), false));
        }
    }

    Ok((prompt.price_stroops, prompt.asset, false))
}

fn validate_token_contract(env: &Env, asset: &Address) -> Result<(), Error> {
    Storage::set_reentrancy_guard(env)?;
    token::Client::new(env, asset).decimals();
    Storage::clear_reentrancy_guard(env);
    Ok(())
}

fn assert_no_reentrancy(env: &Env) {
    if Storage::require_no_reentrancy(env).is_err() {
        soroban_sdk::panic_with_error!(env, Error::ReentrancyGuard);
    }
}

// ─── #194: Contract upgrade safety helpers ───────────────────────────────────
//
// These run on-chain, immediately before `confirm_upgrade` swaps the deployed
// bytecode. Their purpose is to fail the upgrade (returning a typed `Error`
// instead of bricking the contract) when any of the three upgrade hazards would
// materialise: an unusable implementation, corrupted/vanished storage, or
// license-metadata incoherence that would break existing holders.

/// Rejects a WASM implementation that cannot possibly be deployed: a zero hash
/// (all 32 bytes zero) is never a valid uploaded WASM, so proposing/confirming
/// it would install a broken contract.
fn validate_deployable_implementation(env: &Env, new_wasm_hash: &BytesN<32>) -> Result<(), Error> {
    let zero = BytesN::from_array(env, &[0u8; 32]);
    ensure(*new_wasm_hash != zero, Error::InvalidImplementation)?;
    Ok(())
}

/// Verifies that all persistent marketplace data required by the contract is
/// still present and internally consistent before the implementation changes.
/// Guards against hazard (2) — silently losing storage data on upgrade.
fn validate_storage_integrity(env: &Env) -> Result<(), Error> {
    // Config that every subsequent operation depends on must still exist.
    ensure(
        Storage::get_fee_wallet(env).is_some(),
        Error::UpgradeStorageIntegrity,
    )?;
    ensure(
        Storage::get_xlm_address(env).is_some(),
        Error::UpgradeStorageIntegrity,
    )?;
    ensure(
        Storage::get_schema_version(env) <= CONTRACT_SCHEMA_VERSION,
        Error::VersionMismatch,
    )?;

    // Every prompt slot the counter claims to have allocated must still be
    // readable. A missing/corrupted prompt indicates the new code (or a prior
    // bad migration) would lose user data.
    let prompt_count = Storage::get_prompt_counter(env);
    for prompt_id in 0..prompt_count {
        Storage::require_prompt(env, prompt_id).map_err(|_| Error::UpgradeStorageIntegrity)?;
    }

    // Every bundle slot must still resolve to a valid bundle.
    let bundle_count = Storage::get_bundle_counter(env);
    for bundle_id in 0..bundle_count {
        Storage::require_bundle(env, bundle_id).map_err(|_| Error::UpgradeStorageIntegrity)?;
    }

    Ok(())
}

/// Verifies that license/decryption metadata remains coherent for every listing,
/// so upgrading cannot break access for creators and existing license holders.
/// Guards against hazard (3) — breaking existing license holders on upgrade.
fn validate_license_integrity(env: &Env) -> Result<(), Error> {
    let prompt_count = Storage::get_prompt_counter(env);
    for prompt_id in 0..prompt_count {
        let prompt =
            Storage::require_prompt(env, prompt_id).map_err(|_| Error::UpgradeLicenseIntegrity)?;
        // The prompt's active encryption version must match the stored
        // per-prompt version counter; a mismatch means license decryption state
        // is inconsistent and an upgrade could strand current holders.
        let counter = Storage::get_encryption_version_counter(env, prompt_id);
        if counter == 0 || counter != prompt.encryption_version {
            return Err(Error::UpgradeLicenseIntegrity);
        }
        // The prompt's payment asset must still be a valid token so that
        // license settlement and access transfers keep working after upgrade.
        validate_token_contract(env, &prompt.asset).map_err(|_| Error::UpgradeLicenseIntegrity)?;
    }
    Ok(())
}
