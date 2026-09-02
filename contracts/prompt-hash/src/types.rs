use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN, Env, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // NB: Soroban's contract spec format caps a single `#[contracterror]`
    // enum at 50 cases. Several independently-merged features (#42 upgrade
    // authorization, #272 bundling, #275 staking) each grabbed overlapping
    // discriminants and re-declared variants that already existed elsewhere
    // in the enum, so this had drifted to 53 distinct names with duplicate
    // values. Fixed by:
    //  - dropping `InvalidRotation` (never returned by any code path —
    //    encryption-rotation validation already goes through
    //    `VersionMismatch`/`EncryptionVersionNotFound`),
    //  - merging `InvalidSubscriptionDuration` + `InvalidSubscriptionPrice`
    //    into one `InvalidSubscriptionConfig` (same consolidation pattern as
    //    `InvalidFieldLength` below — neither had a test pinned to its exact
    //    variant name),
    //  - merging `SubscriptionConfigNotFound` into `SubscriptionNotFound`
    //    (both "no subscription state for this creator" lookups; neither
    //    was asserted by name in any test).
    // Back to exactly 50, sequentially numbered.
    Unauthorized = 1,
    PromptNotFound = 2,
    CreatorCannotBuy = 3,
    PromptInactive = 4,
    AlreadyPurchased = 5,
    InvalidPrice = 6,
    InvalidFeePercentage = 7,
    // Consolidated: title/category/preview/encrypted-prompt/wrapped-key/image-url/iv
    // all used to be distinct discriminants. Soroban's contract spec format caps a
    // single `#[contracterror]` enum at 50 cases, so field-length validation now
    // shares one variant instead of one-per-field.
    InvalidFieldLength = 8,
    FeeWalletNotSet = 9,
    XlmAddressNotSet = 10,
    ArithmeticOverflow = 11,
    ReentrancyGuard = 12,
    ContractIsPaused = 13,
    ReferrerCannotBeBuyerOrCreator = 14,
    InvalidPaymentAmount = 15,
    InvalidVoucher = 16,
    InvalidReferralPercentage = 17,
    InvalidDiscountPercentage = 18,
    MaxSupplyReached = 19,
    // #50 – revenue splits
    InvalidSplits = 20,
    ListingExpired = 21,
    LicenseNotFound = 22,
    InvalidLicenseTransfer = 23,
    ReferralCodeNotFound = 24,
    ReferralCodeAlreadyExists = 25,
    ReferralCodeTooShort = 26,
    ReferralReplay = 27,
    CircularReferral = 28,
    SubscriptionNotFound = 29,
    SubscriptionInactive = 30,
    InvalidSubscriptionConfig = 31,
    // #131 – content classification
    InvalidClassification = 32,
    InvalidDisclosureFlags = 33,
    NotModerator = 34,
    // Promotional pricing
    InvalidPromotionTime = 35,
    PromotionOverlap = 36,
    PromotionNotFound = 37,
    UnauthorizedPromotion = 38,
    // Encryption rotation
    EncryptionVersionNotFound = 39,
    // Also used to guard schema migrations: reused for a stored schema
    // version newer than what the running contract code understands.
    VersionMismatch = 40,
    // #41 – platform fee safeguard
    FeeExceedsMaximum = 41,
    // #42 – two-step upgrade authorization
    UpgradeAlreadyProposed = 42,
    UpgradeNotProposed = 43,
    UpgradeCooldownNotElapsed = 44,
    // #272 – prompt bundling
    BundleNotFound = 45,
    KeyNotFound = 46,
    // #275 – creator reputation staking
    StakeNotFound = 47,
    StakeLocked = 48,
    InvalidStakeAmount = 49,
    NotStakeOwner = 50,
    // #32 – guard against the constructor/setup routine being invoked more
    // than once against an already-initialized contract instance.
    //
    // NB: this enum already has pre-existing duplicate variant names/values
    // (see the note at the top of this enum) unrelated to issue #32, so it
    // does not currently compile as-is. `51` is chosen so this new variant
    // stays unique regardless of how that separate cleanup lands.
    AlreadyInitialized = 51,
    // #194 – contract-upgrade safety checks
    /// The proposed implementation is unusable (zero hash or it equals the
    /// currently deployed bytecode), so the upgrade cannot proceed.
    InvalidImplementation = 52,
    /// On-chain storage failed integrity validation before an upgrade; the
    /// upgrade is aborted to avoid losing state.
    UpgradeStorageIntegrity = 53,
    /// The upgrade would break existing license holders; aborted before the
    /// new implementation is installed.
    UpgradeLicenseIntegrity = 54,
    /// The buyer's token balance is insufficient to cover the payment.
    InsufficientBalance = 55,
    /// set_fee_wallet was already called once; the fee wallet is immutable.
    FeeWalletAlreadySet = 56,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Prompt(u128),
    PromptCounter,
    FeePercentage,
    FeeWallet,
    XlmAddress,
    CreatorPrompts(Address),
    BuyerPrompts(Address),
    Purchase(u128, Address),
    Reentrancy,
    ReferralPercentage,
    IsPaused,
    VoucherKey(u128, BytesN<32>),
    // Bundle storage keys
    Bundle(u128),
    BundleCounter,
    CreatorBundles(Address),
    BuyerBundles(Address),
    BundlePurchase(u128, Address),
    ReferralCode(BytesN<32>),
    ReferralParent(Address),
    SubscriptionConfig(Address),
    Subscription(Address, Address),
    SubscriptionEligible(u128),
    AdminSigners,
    Initialized,
    SchemaVersion,
    PromptEncryptedPayload(u128, u32),
    PromptEncryptionVersion(u128),
    ClassificationOverride(u128),
    ModeratorAddress,
    ActivePromotion(u128),
    PromotionHistory(u128),
    CreatorStake(u128),
    PendingUpgrade,
    UpgradeProposer,
    UpgradeProposedAt,
    Discount(u128),
    // #192 – per-prompt price history log.
    PriceHistory(u128),
    MinPrice,
    MaxPrice,
}

/// #192 – A single recorded price change for a prompt.
///
/// Appended to the prompt's price-history log whenever the creator changes the
/// base listing price (and once with the prompt's initial price at creation)
/// so buyers can see how the price has trended over time.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceHistoryEntry {
    /// Price in stroops immediately before the change.
    pub previous_price: i128,
    /// Price in stroops after the change (or the initial listing price).
    pub new_price: i128,
    /// Ledger timestamp when the change was recorded.
    pub changed_at: u64,
    /// Monotonic per-prompt sequence number, starting at 1 for the initial
    /// listing price. Used to keep history entries ordered and de-duplicated.
    pub seq: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionConfig {
    pub creator: Address,
    pub duration_secs: u64,
    pub price: i128,
    pub asset: Address,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReferralCode {
    pub owner: Address,
    pub reward_bps: u32,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Subscription {
    pub creator: Address,
    pub subscriber: Address,
    /// Exclusive Unix timestamp: access is valid only while `now < expires_at`.
    pub expires_at: u64,
    pub renewal_count: u32,
}

/// Time-bounded promotional pricing for a prompt listing.
/// Only one promotion can be active at a time for a given prompt.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Promotion {
    pub prompt_id: u128,
    pub creator: Address,
    /// Unix timestamp when the promotion starts.
    pub start_time: u64,
    /// Unix timestamp when the promotion ends.
    pub end_time: u64,
    /// Promotional price in stroops.
    pub price: i128,
    /// Token contract address for the promotional price.
    pub asset: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Purchase {
    pub prompt_id: u128,
    pub original_creator: Address,
    pub owner: Address,
    pub original_price: i128,
    pub last_transfer_price: i128,
    pub transfer_count: u32,
    pub last_transferred_at: u64,
    pub expires_at: u64,
    pub settlement: Settlement,
    /// Encryption version at time of purchase. The buyer is entitled to
    /// this version's encrypted payload on unlock.
    pub encryption_version: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PricingConfig {
    pub price: i128,
    pub asset: Address,
}

/// A single revenue-split entry stored inside a prompt.
/// `bps` is the share of the full payment (in basis points) paid to `recipient`
/// before the creator receives the remainder.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Split {
    pub recipient: Address,
    pub bps: u32,
}

/// Full listing configuration passed to create_prompt.
/// Bundles pricing, optional expiry, and optional revenue splits into a single
/// parameter so the function stays within Soroban's 10-parameter limit.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingConfig {
    pub price: i128,
    pub asset: Address,
    /// Unix timestamp after which the listing can no longer be purchased.
    /// `0` means the listing never expires.
    pub expires_at: u64,
    /// Optional co-creator revenue splits (empty Vec = no splits).
    pub splits: Vec<Split>,
}

/// Canonical taxonomy for content classification.
/// Creators attest one of these categories for each listing.
/// Uses `None` variant as default (unnamed).
pub const CLASSIFICATION_GENERAL: &str = "general";
pub const CLASSIFICATION_EDUCATIONAL: &str = "educational";
pub const CLASSIFICATION_PROFESSIONAL: &str = "professional";
pub const CLASSIFICATION_CREATIVE: &str = "creative";
pub const CLASSIFICATION_TECHNICAL: &str = "technical";
pub const CLASSIFICATION_SENSITIVE: &str = "sensitive";
pub const CLASSIFICATION_RESTRICTED: &str = "restricted";

pub const ALL_CLASSIFICATIONS: &[&str] = &[
    CLASSIFICATION_GENERAL,
    CLASSIFICATION_EDUCATIONAL,
    CLASSIFICATION_PROFESSIONAL,
    CLASSIFICATION_CREATIVE,
    CLASSIFICATION_TECHNICAL,
    CLASSIFICATION_SENSITIVE,
    CLASSIFICATION_RESTRICTED,
];

/// Standard safety disclosure flags recognized by the platform.
/// Canonical values: "none", "ai-generated", "financial-advice", "medical", "legal", "political"
pub const VALID_DISCLOSURE_FLAGS: &[&str] = &[
    "none",
    "ai-generated",
    "financial-advice",
    "medical",
    "legal",
    "political",
];

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Prompt {
    pub id: u128,
    pub creator: Address,
    pub image_url: String,
    pub title: String,
    pub category: String,
    pub preview_text: String,
    pub encrypted_prompt: String,
    pub encryption_iv: String,
    pub wrapped_key: String,
    pub content_hash: BytesN<32>,
    pub price_stroops: i128,
    pub asset: Address,
    pub active: bool,
    pub sales_count: u64,
    pub max_supply: u64,
    /// Unix timestamp after which the listing can no longer be purchased.
    /// `0` means the listing never expires.
    pub expires_at: u64,
    /// Optional co-creator revenue splits applied against the full payment.
    pub splits: Vec<Split>,
    /// #131 – content classification attested by the creator
    pub classification: String,
    /// #131 – safety disclosure flags attested by the creator
    pub safety_flags: Vec<String>,
    /// Encryption version counter. Starts at 1 and increments on each rotation.
    pub encryption_version: u32,
}

/// Archived encryption payload for a prompt at a specific version.
/// Created when `rotate_encryption` stores the previous version before
/// updating to a new encryption key.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PromptEncryptedPayload {
    pub prompt_id: u128,
    pub version: u32,
    pub encrypted_prompt: String,
    pub encryption_iv: String,
    pub wrapped_key: String,
    pub content_hash: BytesN<32>,
    pub created_at: u64,
}

/// #275 – Creator reputation stake.
/// A creator stakes native XLM against one of their own prompts to signal
/// quality. Stake is held in contract custody and can be slashed by the
/// contract admin (owner) if the prompt is verified as low-quality/malicious,
/// or reclaimed by the creator after a cooldown period.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stake {
    pub creator: Address,
    pub prompt_id: u128,
    /// Currently-staked amount in stroops (net of any slashing/withdrawals).
    pub amount: i128,
    /// Ledger timestamp of the most recent stake top-up; the unstake cooldown
    /// is measured from this value.
    pub staked_at: u64,
}

/// Moderator-attested classification that overrides the creator's attestation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClassificationOverride {
    pub classifier: Address,
    pub classification: String,
    pub safety_flags: Vec<String>,
    pub reason: String,
    pub reviewed_at: u64,
}

/// Time-windowed listing discount. While the ledger sequence is inside
/// `[start_ledger, end_ledger]`, purchases use `discounted_price`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Discount {
    pub prompt_id: u128,
    pub creator: Address,
    pub discounted_price: i128,
    pub start_ledger: u32,
    pub end_ledger: u32,
}

pub trait PromptHashTrait {
    fn __constructor(
        env: Env,
        admin: Address,
        admin_two: Address,
        admin_three: Address,
        fee_wallet: Address,
        xlm_sac: Address,
    ) -> Result<(), Error>;

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
    ) -> Result<u128, Error>;

    fn set_prompt_sale_status(
        env: Env,
        creator: Address,
        prompt_id: u128,
        active: bool,
    ) -> Result<(), Error>;

    fn set_prompt_max_supply(
        env: Env,
        creator: Address,
        prompt_id: u128,
        max_supply: u64,
    ) -> Result<(), Error>;

    fn update_prompt_price(
        env: Env,
        creator: Address,
        prompt_id: u128,
        price_stroops: i128,
    ) -> Result<(), Error>;

    // #192 – Return the recorded price history for a prompt, oldest first.
    fn get_price_history(env: Env, prompt_id: u128) -> Result<Vec<PriceHistoryEntry>, Error>;

    fn buy_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u128,
        referral_code: Option<Bytes>,
        payment_amount_stroops: i128,
        voucher: Option<Bytes>,
    ) -> Result<(), Error>;

    fn lease_prompt(
        env: Env,
        buyer: Address,
        prompt_id: u128,
        lease_duration_secs: u64,
    ) -> Result<(), Error>;

    /// Push the expiry date of a listing forward. `new_expires_at` must be
    /// strictly greater than the current ledger timestamp.
    fn extend_listing(
        env: Env,
        creator: Address,
        prompt_id: u128,
        new_expires_at: u64,
    ) -> Result<(), Error>;

    /// Extend a prompt's expiry by `extension_secs` from its current expiry.
    /// A never-expiring prompt (`expires_at == 0`) cannot be extended.
    fn extend_prompt_lifetime(
        env: Env,
        creator: Address,
        prompt_id: u128,
        extension_secs: u64,
    ) -> Result<u64, Error>;

    /// Emit the expiry warning event when a prompt is within its warning
    /// window. Anyone may call this for off-chain indexing services.
    fn check_prompt_expiry(env: Env, prompt_id: u128) -> Result<bool, Error>;

    /// Purchase multiple prompts atomically in a single transaction.
    /// `prompt_ids` and `payment_amounts` must have equal length.
    /// An optional `referrer` applies to every prompt in the batch.
    /// If any individual purchase fails the entire transaction reverts.
    fn buy_prompts_bulk(
        env: Env,
        buyer: Address,
        prompt_ids: Vec<u128>,
        payment_amounts: Vec<i128>,
        referral_code: Option<Bytes>,
    ) -> Result<(), Error>;

    fn transfer_license(
        env: Env,
        seller: Address,
        prompt_id: u128,
        new_buyer: Address,
        resale_price: i128,
    ) -> Result<(), Error>;

    fn has_access(env: Env, user: Address, prompt_id: u128) -> Result<bool, Error>;
    fn get_prompt(env: Env, prompt_id: u128) -> Result<Prompt, Error>;
    fn get_all_prompts(env: Env) -> Result<Vec<Prompt>, Error>;
    fn get_prompts_by_creator(env: Env, creator: Address) -> Result<Vec<Prompt>, Error>;
    fn get_prompts_by_buyer(env: Env, buyer: Address) -> Result<Vec<Prompt>, Error>;
    fn get_prompts_by_category(env: Env, category: String) -> Result<Vec<Prompt>, Error>;
    fn get_purchase_details(env: Env, prompt_id: u128, buyer: Address) -> Result<Purchase, Error>;
    fn configure_subscription_pass(
        env: Env,
        creator: Address,
        duration_secs: u64,
        price: i128,
        asset: Address,
        active: bool,
    ) -> Result<(), Error>;
    fn set_subscription_eligibility(
        env: Env,
        creator: Address,
        prompt_id: u128,
        eligible: bool,
    ) -> Result<(), Error>;
    fn subscribe_catalog(
        env: Env,
        subscriber: Address,
        creator: Address,
        payment_amount: i128,
    ) -> Result<u64, Error>;
    fn renew_catalog_subscription(
        env: Env,
        subscriber: Address,
        creator: Address,
        payment_amount: i128,
    ) -> Result<u64, Error>;
    fn get_subscription(
        env: Env,
        subscriber: Address,
        creator: Address,
    ) -> Result<Subscription, Error>;
    fn get_subscription_config(env: Env, creator: Address) -> Result<SubscriptionConfig, Error>;
    fn is_subscription_eligible(env: Env, prompt_id: u128) -> Result<bool, Error>;
    fn set_fee_percentage(
        env: Env,
        new_fee_percentage: u32,
        approver_a: Address,
        approver_b: Address,
    ) -> Result<(), Error>;
    fn set_fee_wallet(
        env: Env,
        new_fee_wallet: Address,
        approver_a: Address,
        approver_b: Address,
    ) -> Result<(), Error>;
    fn get_fee_percentage(env: Env) -> u32;
    fn get_fee_wallet(env: Env) -> Option<Address>;
    fn set_referral_percentage(env: Env, new_referral_percentage: u32) -> Result<(), Error>;
    fn get_referral_percentage(env: Env) -> u32;
    fn set_price_bounds(env: Env, approver_a: Address, approver_b: Address, min_price: Option<i128>, max_price: Option<i128>) -> Result<(), Error>;
    fn get_price_bounds(env: Env) -> (Option<i128>, Option<i128>);
    fn register_referral_code(
        env: Env,
        referrer: Address,
        code_hash: BytesN<32>,
    ) -> Result<(), Error>;
    fn set_pause_status(
        env: Env,
        paused: bool,
        approver_a: Address,
        approver_b: Address,
    ) -> Result<(), Error>;
    fn is_paused(env: Env) -> bool;
    fn add_voucher(
        env: Env,
        creator: Address,
        prompt_id: u128,
        hashed_code: BytesN<32>,
        discount_bps: u32,
    ) -> Result<(), Error>;
    fn remove_voucher(
        env: Env,
        creator: Address,
        prompt_id: u128,
        hashed_code: BytesN<32>,
    ) -> Result<(), Error>;
    fn get_xlm_sac(env: Env) -> Option<Address>;
    /// Propose a timelocked contract upgrade. Requires 2-of-3 admin multisig.
    /// Records the pending WASM hash, the proposer (via the two approvers) and
    /// the proposal timestamp so that `confirm_upgrade` can enforce a safety
    /// cooldown and validate the existing on-chain state before deploying the
    /// new implementation.
    fn propose_upgrade(
        env: Env,
        new_wasm_hash: BytesN<32>,
        approver_a: Address,
        approver_b: Address,
    ) -> Result<(), Error>;
    /// Confirm and execute a previously proposed upgrade once the timelock
    /// cooldown has elapsed. Requires 2-of-3 admin multisig. Applies upgrade
    /// safety checks (implementation validity, storage integrity, license-holder
    /// preservation) before atomically swapping the contract bytecode.
    fn confirm_upgrade(env: Env, approver_a: Address, approver_b: Address) -> Result<(), Error>;
    /// Cancel a pending upgrade before the timelock elapses (emergency abort).
    /// Requires 2-of-3 admin multisig. Clears the pending upgrade state.
    fn cancel_upgrade(env: Env, approver_a: Address, approver_b: Address) -> Result<(), Error>;
    /// Returns the currently pending WASM hash, if any.
    fn get_pending_upgrade(env: Env) -> Option<BytesN<32>>;
    fn extend_ttl(env: Env, key: DataKey) -> Result<(), Error>;

    // ─── Bundle methods ──────────────────────────────────────────────────────

    /// Create a bundle of existing active prompts owned by `creator`.
    /// All prompt_ids must be active prompts whose `creator` field matches.
    /// `price_stroops` is the single price a buyer pays for the entire bundle.
    /// `asset` is the payment token (same restriction as individual prompts).
    fn create_bundle(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        image_url: String,
        prompt_ids: Vec<u128>,
        price_stroops: i128,
        asset: Address,
    ) -> Result<u128, Error>;

    /// Add a prompt to an existing bundle. Must be the bundle creator.
    fn add_bundle_item(
        env: Env,
        creator: Address,
        bundle_id: u128,
        prompt_id: u128,
    ) -> Result<(), Error>;

    /// Remove a prompt from a bundle. Must be the bundle creator.
    fn remove_bundle_item(
        env: Env,
        creator: Address,
        bundle_id: u128,
        prompt_id: u128,
    ) -> Result<(), Error>;

    /// Update the bundle price. Must be the bundle creator.
    fn update_bundle_price(
        env: Env,
        creator: Address,
        bundle_id: u128,
        price_stroops: i128,
    ) -> Result<(), Error>;

    /// Toggle the bundle's active state. Must be the bundle creator.
    fn set_bundle_active(
        env: Env,
        creator: Address,
        bundle_id: u128,
        active: bool,
    ) -> Result<(), Error>;

    /// Purchase a bundle atomically. Grants access to every current bundle item.
    /// `payment_amount_stroops` must be >= bundle.price_stroops.
    fn buy_bundle(
        env: Env,
        buyer: Address,
        bundle_id: u128,
        payment_amount_stroops: i128,
        referrer: Option<Address>,
    ) -> Result<(), Error>;

    /// Returns true if the user has purchased the bundle (or is the creator).
    fn has_bundle_access(env: Env, user: Address, bundle_id: u128) -> Result<bool, Error>;

    fn get_bundle(env: Env, bundle_id: u128) -> Result<Bundle, Error>;
    fn get_all_bundles(env: Env) -> Result<Vec<Bundle>, Error>;
    fn get_bundles_by_creator(env: Env, creator: Address) -> Result<Vec<Bundle>, Error>;
    fn get_bundles_by_buyer(env: Env, buyer: Address) -> Result<Vec<Bundle>, Error>;
    // ─── Contract state versioning ───────────────────────────────────────────
    /// Current schema version applied to this contract's storage. `0` means
    /// the contract predates this versioning scheme (never migrated).
    fn get_schema_version(env: Env) -> u32;
    /// Owner-only. Bumps the stored schema version after an `upgrade` that
    /// changed the shape of on-chain data. Rejects moving backwards and
    /// rejects jumping to a version this contract build doesn't know about.
    fn migrate(env: Env, new_version: u32) -> Result<u32, Error>;

    // #131 – content classification
    fn set_classification(
        env: Env,
        creator: Address,
        prompt_id: u128,
        classification: String,
        safety_flags: Vec<String>,
    ) -> Result<(), Error>;
    fn get_classification(env: Env, prompt_id: u128) -> Result<(String, Vec<String>), Error>;
    fn set_moderator_override(
        env: Env,
        moderator: Address,
        prompt_id: u128,
        classification: String,
        safety_flags: Vec<String>,
        reason: String,
    ) -> Result<(), Error>;
    fn get_active_classification(env: Env, prompt_id: u128)
        -> Result<(String, Vec<String>), Error>;
    fn get_moderator_override(env: Env, prompt_id: u128) -> Result<ClassificationOverride, Error>;
    fn set_moderator_address(env: Env, admin: Address, moderator: Address) -> Result<(), Error>;

    // Promotional pricing
    fn create_promotion(
        env: Env,
        creator: Address,
        prompt_id: u128,
        start_time: u64,
        end_time: u64,
        price: i128,
        asset: Address,
    ) -> Result<u128, Error>;

    fn cancel_promotion(env: Env, creator: Address, prompt_id: u128) -> Result<(), Error>;

    fn get_active_promotion(env: Env, prompt_id: u128) -> Result<Option<Promotion>, Error>;

    fn get_promotion_history(env: Env, prompt_id: u128) -> Result<Vec<Promotion>, Error>;

    fn get_effective_price(env: Env, prompt_id: u128) -> Result<(i128, Address, bool), Error>;

    // Encryption rotation
    fn rotate_encryption(
        env: Env,
        creator: Address,
        prompt_id: u128,
        encrypted_prompt: String,
        encryption_iv: String,
        wrapped_key: String,
        content_hash: BytesN<32>,
    ) -> Result<u32, Error>;

    fn get_prompt_encryption_version(
        env: Env,
        prompt_id: u128,
        version: u32,
    ) -> Result<PromptEncryptedPayload, Error>;

    // ─── #273: Time-based discount mechanics ──────────────────────────────────
    /// Creator-gated. Sets (or replaces) a discount window for a prompt. While
    /// `env.ledger().sequence()` is within `[start_ledger, end_ledger]`, the
    /// purchase path uses `discounted_price` instead of the base price.
    fn set_discount(
        env: Env,
        creator: Address,
        prompt_id: u128,
        discounted_price: i128,
        start_ledger: u32,
        end_ledger: u32,
    ) -> Result<(), Error>;

    /// Creator-gated early-cancel of an active/scheduled discount window.
    fn clear_discount(env: Env, creator: Address, prompt_id: u128) -> Result<(), Error>;

    fn get_discount(env: Env, prompt_id: u128) -> Result<Option<Discount>, Error>;
    // #275 – creator reputation staking
    /// Stake native XLM against one of the creator's own prompts. Moves
    /// `amount` stroops from the creator into contract custody and returns the
    /// new total staked amount for the prompt.
    fn stake(env: Env, creator: Address, prompt_id: u128, amount: i128) -> Result<i128, Error>;

    /// Admin-gated slashing of a prompt's stake (see #[only_owner]). Reduces
    /// the recorded stake and forwards the slashed stroops to the fee wallet.
    /// `amount` is clamped to the available stake so an over-slash cannot
    /// underflow. Returns the amount actually slashed.
    fn slash(env: Env, prompt_id: u128, amount: i128) -> Result<i128, Error>;

    /// Reclaim non-slashed stake after the cooldown period has elapsed. The
    /// requested `amount` is clamped to the remaining stake. Returns the amount
    /// actually returned to the creator.
    fn unstake(env: Env, creator: Address, prompt_id: u128, amount: i128) -> Result<i128, Error>;

    /// Read the current stake record for a prompt.
    fn get_stake(env: Env, prompt_id: u128) -> Result<Stake, Error>;
}

// ─── Bundle on-chain types ───────────────────────────────────────────────────

pub const MAX_BUNDLE_TITLE_LEN: u32 = 120;
pub const MAX_BUNDLE_DESC_LEN: u32 = 512;
pub const MAX_BUNDLE_ITEMS: u32 = 20;

/// On-chain bundle record. prompt_ids stores the current set of member prompts.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bundle {
    pub id: u128,
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub image_url: String,
    /// Current set of member prompt IDs. Capped at MAX_BUNDLE_ITEMS.
    pub prompt_ids: Vec<u128>,
    pub price_stroops: i128,
    pub asset: Address,
    pub active: bool,
    pub sales_count: u64,
    pub created_at: u64,
}

/// Per-buyer bundle purchase record. Records the snapshot of prompt_ids that
/// were current at time of purchase so the unlock layer can serve each one.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundlePurchase {
    pub bundle_id: u128,
    pub owner: Address,
    pub original_creator: Address,
    pub paid_price: i128,
    pub purchased_at: u64,
    /// Snapshot of prompt IDs that were in the bundle when purchased.
    pub purchased_prompt_ids: Vec<u128>,
}
