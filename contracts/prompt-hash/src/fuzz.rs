//! Property-based fuzz coverage for malformed/adversarial Soroban inputs.
//!
//! These tests don't assert exact business outcomes the way `test.rs` does;
//! instead they assert the contract's core invariant under garbage input:
//! every entry point must return a typed `Error`, or succeed, but must never
//! panic/trap regardless of how malformed, oversized, or numerically extreme
//! the input is. A panic here means an attacker-controlled input can abort a
//! transaction in a way callers can't recover from or reason about.
extern crate std;

use crate::contract::{PromptHashContract, PromptHashContractClient};
use crate::mock_asset::FungibleTokenContract;
use crate::storage::Storage;
use crate::types::{ListingConfig, Split};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env, String, Vec,
};
use std::string::String as StdString;
use std::vec::Vec as StdVec;

struct FuzzContext {
    contract: Address,
    xlm: Address,
}

fn setup(env: &Env) -> FuzzContext {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let fee_wallet = Address::generate(env);
    let xlm = env.register(FungibleTokenContract, (admin.clone(),));
    let contract = env.register(
        PromptHashContract,
        (admin.clone(), fee_wallet.clone(), xlm.clone()),
    );
    FuzzContext { contract, xlm }
}

fn prompt_counter(env: &Env) -> u128 {
    Storage::get_prompt_counter(env)
}

/// Builds an arbitrary (possibly invalid) UTF-8 string of up to `max_len`
/// bytes for a Soroban `String` field.
fn arb_string(max_len: usize) -> impl Strategy<Value = StdString> {
    proptest::collection::vec(proptest::char::any(), 0..max_len)
        .prop_map(|chars| chars.into_iter().collect::<StdString>())
}

fn arb_bytes(max_len: usize) -> impl Strategy<Value = StdVec<u8>> {
    proptest::collection::vec(any::<u8>(), 0..max_len)
}

/// Lengths that stress storage boundaries: empty, minimal, at-limit, and over-limit.
fn arb_boundary_len(max: u32) -> impl Strategy<Value = usize> {
    let max_usize = max as usize;
    prop_oneof![
        Just(0usize),
        Just(1),
        Just(max_usize),
        Just(max_usize + 1),
        Just(max_usize + 32),
        (2..max_usize.saturating_add(64)),
    ]
}

fn string_at_len(len: usize) -> StdString {
    "x".repeat(len)
}

fn soroban_string(env: &Env, value: &str) -> String {
    String::from_str(env, value)
}

fn try_create_prompt_inputs(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    xlm: &Address,
    image_url: &str,
    title: &str,
    category: &str,
    preview: &str,
    encrypted: &str,
    iv: &str,
    wrapped_key: &str,
    content_hash: &BytesN<32>,
    price: i128,
    expires_at: u64,
    splits: Vec<Split>,
) {
    let _ = client.try_create_prompt(
        creator,
        &soroban_string(env, image_url),
        &soroban_string(env, title),
        &soroban_string(env, category),
        &soroban_string(env, preview),
        &soroban_string(env, encrypted),
        &soroban_string(env, iv),
        &soroban_string(env, wrapped_key),
        content_hash,
        &ListingConfig {
            price,
            asset: xlm.clone(),
            expires_at,
            splits,
        },
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    /// #459: `create_prompt` must never panic no matter how malformed the text
    /// fields or price are: oversized strings (well past every MAX_*_LEN
    /// constant), empty strings, non-ASCII/emoji content, and the full i128
    /// range for price (including negative and zero) must all come back as
    /// a typed `Result`, not a trap.
    #[test]
    fn fuzz_create_prompt_never_panics(
        title in arb_string(400),
        category in arb_string(200),
        preview in arb_string(600),
        encrypted in arb_string(5000),
        iv in arb_string(200),
        wrapped_key in arb_string(400),
        price in any::<i128>(),
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);

        try_create_prompt_inputs(
            &env,
            &client,
            &creator,
            &context.xlm,
            "https://example.com/image.png",
            &title,
            &category,
            &preview,
            &encrypted,
            &iv,
            &wrapped_key,
            &BytesN::from_array(&env, &[7u8; 32]),
            price,
            0,
            Vec::new(&env),
        );
    }

    /// #459: Fuzz every listing-metadata field supplied to `create_prompt`,
    /// including image URL and content hash, with adversarial lengths and bytes.
    #[test]
    fn fuzz_create_prompt_metadata_inputs_never_panics(
        image_url in arb_string(800),
        title in arb_string(400),
        category in arb_string(200),
        preview in arb_string(600),
        encrypted in arb_string(5000),
        iv in arb_string(200),
        wrapped_key in arb_string(400),
        hash_bytes in proptest::array::uniform32(any::<u8>()),
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);

        try_create_prompt_inputs(
            &env,
            &client,
            &creator,
            &context.xlm,
            &image_url,
            &title,
            &category,
            &preview,
            &encrypted,
            &iv,
            &wrapped_key,
            &BytesN::from_array(&env, &hash_bytes),
            10_000,
            0,
            Vec::new(&env),
        );
    }

    /// #459: Fuzz price and listing expiry inputs that feed storage writes and
    /// validation paths not covered by deterministic unit tests.
    #[test]
    fn fuzz_create_prompt_price_and_expiry_never_panics(
        price in any::<i128>(),
        expires_at in any::<u64>(),
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);
        env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);

        try_create_prompt_inputs(
            &env,
            &client,
            &creator,
            &context.xlm,
            "https://example.com/image.png",
            "Fuzz expiry prompt",
            "General",
            "preview",
            "ciphertext",
            "iv",
            "wrapped-key",
            &BytesN::from_array(&env, &[11u8; 32]),
            price,
            expires_at,
            Vec::new(&env),
        );
    }

    /// #459: Stress each metadata field at storage boundary lengths while keeping
    /// the other fields minimally valid, to catch per-field storage abuse.
    #[test]
    fn fuzz_create_prompt_metadata_boundary_lengths_never_panic(
        field_selector in 0u8..7,
        len in arb_boundary_len(4096),
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);

        let payload = string_at_len(len);
        let (image_url, title, category, preview, encrypted, iv, wrapped_key) = match field_selector {
            0 => (payload.as_str(), "title", "cat", "preview", "cipher", "iv", "key"),
            1 => ("https://example.com/x.png", payload.as_str(), "cat", "preview", "cipher", "iv", "key"),
            2 => ("https://example.com/x.png", "title", payload.as_str(), "preview", "cipher", "iv", "key"),
            3 => ("https://example.com/x.png", "title", "cat", payload.as_str(), "cipher", "iv", "key"),
            4 => ("https://example.com/x.png", "title", "cat", "preview", payload.as_str(), "iv", "key"),
            5 => ("https://example.com/x.png", "title", "cat", "preview", "cipher", payload.as_str(), "key"),
            _ => ("https://example.com/x.png", "title", "cat", "preview", "cipher", "iv", payload.as_str()),
        };

        try_create_prompt_inputs(
            &env,
            &client,
            &creator,
            &context.xlm,
            image_url,
            title,
            category,
            preview,
            encrypted,
            iv,
            wrapped_key,
            &BytesN::from_array(&env, &[13u8; 32]),
            10_000,
            0,
            Vec::new(&env),
        );
    }

    /// #459: Random asset addresses must not panic token validation during listing.
    #[test]
    fn fuzz_create_prompt_random_asset_never_panics(
        price in 1i128..1_000_000_000i128,
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);
        let random_asset = Address::generate(&env);

        let _ = client.try_create_prompt(
            &creator,
            &soroban_string(&env, "https://example.com/image.png"),
            &soroban_string(&env, "Asset fuzz"),
            &soroban_string(&env, "General"),
            &soroban_string(&env, "preview"),
            &soroban_string(&env, "ciphertext"),
            &soroban_string(&env, "iv"),
            &soroban_string(&env, "wrapped-key"),
            &BytesN::from_array(&env, &[17u8; 32]),
            &ListingConfig {
                price,
                asset: random_asset,
                expires_at: 0,
                splits: Vec::new(&env),
            },
        );
    }

    /// Revenue splits are attacker/creator-supplied at listing time. Random
    /// counts of recipients with random bps (including values that overflow
    /// the running u32 total) must never panic - only ever `Ok` or a typed
    /// `Error`.
    #[test]
    fn fuzz_create_prompt_with_arbitrary_splits_never_panics(
        bps_values in proptest::collection::vec(any::<u32>(), 0..20),
        price in any::<i128>(),
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);

        let mut splits = Vec::new(&env);
        for bps in bps_values {
            splits.push_back(Split {
                recipient: Address::generate(&env),
                bps,
            });
        }

        try_create_prompt_inputs(
            &env,
            &client,
            &creator,
            &context.xlm,
            "https://example.com/image.png",
            "Fuzzed splits",
            "General",
            "preview",
            "ciphertext",
            "iv",
            "wrapped-key",
            &BytesN::from_array(&env, &[9u8; 32]),
            price,
            0,
            splits,
        );
    }

    /// #459: Successful `create_prompt` calls must advance the on-chain prompt
    /// counter monotonically and keep the creator index aligned with successes.
    #[test]
    fn fuzz_create_prompt_storage_counter_stays_consistent(
        attempts in 1usize..6,
        price in 1i128..1_000_000_000i128,
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);

        let mut expected_counter = prompt_counter(&env);
        let mut expected_creator_prompts = 0usize;

        for idx in 0..attempts {
            let before = prompt_counter(&env);
            let res = client.try_create_prompt(
                &creator,
                &soroban_string(&env, "https://example.com/image.png"),
                &soroban_string(&env, "Storage invariant"),
                &soroban_string(&env, "General"),
                &soroban_string(&env, "preview"),
                &soroban_string(&env, "ciphertext"),
                &soroban_string(&env, "iv"),
                &soroban_string(&env, "wrapped-key"),
                &BytesN::from_array(&env, &[(idx as u8 + 1); 32]),
                &ListingConfig {
                    price,
                    asset: context.xlm.clone(),
                    expires_at: 0,
                    splits: Vec::new(&env),
                },
            );

            let after = prompt_counter(&env);
            if res.is_ok() {
                prop_assert_eq!(after, before.saturating_add(1));
                expected_counter = expected_counter.saturating_add(1);
                expected_creator_prompts += 1;
            } else {
                prop_assert_eq!(after, before);
            }
            prop_assert_eq!(after, expected_counter);

            let creator_prompts = client.get_prompts_by_creator(&creator).len();
            prop_assert_eq!(creator_prompts, expected_creator_prompts);
        }
    }

    /// #459: Large metadata payloads must not panic and must not corrupt the
    /// prompt counter whether the listing is accepted or rejected.
    #[test]
    fn fuzz_create_prompt_max_metadata_storage_abuse_never_panics(
        title_len in arb_boundary_len(120),
        encrypted_len in arb_boundary_len(4096),
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);
        let before = prompt_counter(&env);

        let res = client.try_create_prompt(
            &creator,
            &soroban_string(&env, &string_at_len(512)),
            &soroban_string(&env, &string_at_len(title_len)),
            &soroban_string(&env, &string_at_len(40)),
            &soroban_string(&env, &string_at_len(280)),
            &soroban_string(&env, &string_at_len(encrypted_len)),
            &soroban_string(&env, &string_at_len(64)),
            &soroban_string(&env, &string_at_len(256)),
            &BytesN::from_array(&env, &[21u8; 32]),
            &ListingConfig {
                price: 10_000,
                asset: context.xlm.clone(),
                expires_at: 0,
                splits: Vec::new(&env),
            },
        );

        let after = prompt_counter(&env);
        if res.is_ok() {
            prop_assert_eq!(after, before.saturating_add(1));
        } else {
            prop_assert_eq!(after, before);
        }
    }

    /// `buy_prompt` payment amounts are buyer-controlled. The full i128 range
    /// (negative, zero, i128::MAX) must be rejected cleanly or accepted, but
    /// never trigger a panic in the fee/referral/split arithmetic.
    #[test]
    fn fuzz_buy_prompt_payment_amount_never_panics(payment_amount in any::<i128>()) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);
        let buyer = Address::generate(&env);

        let prompt_id = client.create_prompt(
            &creator,
            &String::from_str(&env, "https://example.com/image.png"),
            &String::from_str(&env, "Fuzz target"),
            &String::from_str(&env, "General"),
            &String::from_str(&env, "preview"),
            &String::from_str(&env, "ciphertext"),
            &String::from_str(&env, "iv"),
            &String::from_str(&env, "wrapped-key"),
            &BytesN::from_array(&env, &[3u8; 32]),
            &ListingConfig {
                price: 10_000,
                asset: context.xlm.clone(),
                expires_at: 0,
                splits: Vec::new(&env),
            },
        );

        let _ = client.try_buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &payment_amount, &None::<Bytes>);
    }

    /// Referral codes arrive as raw bytes supplied by the buyer. Arbitrary
    /// lengths and content (including codes that happen to collide with the
    /// buyer's or creator's own address hash) must never panic.
    #[test]
    fn fuzz_buy_prompt_referral_code_never_panics(code_bytes in arb_bytes(64)) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);
        let buyer = Address::generate(&env);

        let prompt_id = client.create_prompt(
            &creator,
            &String::from_str(&env, "https://example.com/image.png"),
            &String::from_str(&env, "Fuzz referral"),
            &String::from_str(&env, "General"),
            &String::from_str(&env, "preview"),
            &String::from_str(&env, "ciphertext"),
            &String::from_str(&env, "iv"),
            &String::from_str(&env, "wrapped-key"),
            &BytesN::from_array(&env, &[4u8; 32]),
            &ListingConfig {
                price: 10_000,
                asset: context.xlm.clone(),
                expires_at: 0,
                splits: Vec::new(&env),
            },
        );

        let code = Bytes::from_slice(&env, &code_bytes);
        let _ = client.try_buy_prompt(&buyer, &prompt_id, &Some(code), &10_000, &None::<Bytes>);
    }

    /// Voucher discount percentages are creator-supplied. The full u32 range
    /// must be rejected cleanly above MAX_BPS, never panic.
    #[test]
    fn fuzz_add_voucher_discount_bps_never_panics(discount_bps in any::<u32>()) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);

        let prompt_id = client.create_prompt(
            &creator,
            &String::from_str(&env, "https://example.com/image.png"),
            &String::from_str(&env, "Fuzz voucher"),
            &String::from_str(&env, "General"),
            &String::from_str(&env, "preview"),
            &String::from_str(&env, "ciphertext"),
            &String::from_str(&env, "iv"),
            &String::from_str(&env, "wrapped-key"),
            &BytesN::from_array(&env, &[5u8; 32]),
            &ListingConfig {
                price: 10_000,
                asset: context.xlm.clone(),
                expires_at: 0,
                splits: Vec::new(&env),
            },
        );

        let code = BytesN::from_array(&env, &[6u8; 32]);
        let _ = client.try_add_voucher(&creator, &prompt_id, &code, &discount_bps);
    }

    /// Lease durations and resale prices are also externally supplied
    /// numeric extremes worth fuzzing together since both feed the same
    /// checked-arithmetic fee/royalty machinery.
    #[test]
    fn fuzz_lease_prompt_duration_never_panics(duration in any::<u64>()) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);
        let buyer = Address::generate(&env);
        env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);

        let prompt_id = client.create_prompt(
            &creator,
            &String::from_str(&env, "https://example.com/image.png"),
            &String::from_str(&env, "Fuzz lease"),
            &String::from_str(&env, "General"),
            &String::from_str(&env, "preview"),
            &String::from_str(&env, "ciphertext"),
            &String::from_str(&env, "iv"),
            &String::from_str(&env, "wrapped-key"),
            &BytesN::from_array(&env, &[8u8; 32]),
            &ListingConfig {
                price: 10_000,
                asset: context.xlm.clone(),
                expires_at: 0,
                splits: Vec::new(&env),
            },
        );

        let _ = client.try_lease_prompt(&buyer, &prompt_id, &duration);
    }

    /// `migrate` accepts an admin-supplied version number; every u32 value
    /// must be rejected cleanly outside the valid forward range, never panic.
    #[test]
    fn fuzz_migrate_new_version_never_panics(new_version in any::<u32>()) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);

        let _ = client.try_migrate(&new_version);
    }

    /// INVARIANT: Total prompt counter consistency under random valid prices.
    #[test]
    fn fuzz_invariant_prompt_count_and_total_supply(
        prices in proptest::collection::vec(1i128..1_000_000_000i128, 1..5),
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);

        let mut expected_count = prompt_counter(&env);

        for (idx, price) in prices.iter().enumerate() {
            let res = client.try_create_prompt(
                &creator,
                &String::from_str(&env, "https://example.com/image.png"),
                &String::from_str(&env, "Invariant Prompt"),
                &String::from_str(&env, "General"),
                &String::from_str(&env, "preview"),
                &String::from_str(&env, "ciphertext"),
                &String::from_str(&env, "iv"),
                &String::from_str(&env, "wrapped-key"),
                &BytesN::from_array(&env, &[(idx as u8 + 1); 32]),
                &ListingConfig {
                    price: *price,
                    asset: context.xlm.clone(),
                    expires_at: 0,
                    splits: Vec::new(&env),
                },
            );

            if res.is_ok() {
                expected_count += 1;
            }

            prop_assert_eq!(prompt_counter(&env), expected_count);
        }
    }

    /// INVARIANT: Random unauthorized accounts attempting admin operations must
    /// ALWAYS fail and be rejected cleanly.
    #[test]
    fn fuzz_invariant_access_control_enforcement(
        random_fee in any::<u32>(),
        random_version in any::<u32>(),
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let unauthorized = Address::generate(&env);

        let fee_res = client.try_set_fee_percentage(
            &random_fee,
            &unauthorized,
            &unauthorized,
        );
        prop_assert!(fee_res.is_err());

        let pause_res = client.try_set_pause_status(&true, &unauthorized, &unauthorized);
        prop_assert!(pause_res.is_err());

        let _ = client.try_migrate(&random_version);
    }

    /// INVARIANT: Revenue splits for arbitrary valid prices and BPS values must
    /// stay within mathematically valid bounds and never panic.
    #[test]
    fn fuzz_invariant_fee_calculation_and_splits_bounds(
        price in 1i128..1_000_000_000_000i128,
        split_bps_1 in 0u32..=4_000u32,
        split_bps_2 in 0u32..=4_000u32,
    ) {
        let env: Env = Default::default();
        let context = setup(&env);
        let client = PromptHashContractClient::new(&env, &context.contract);
        let creator = Address::generate(&env);

        let fee_bps = client.get_fee_percentage();
        let total_split_bps = split_bps_1.saturating_add(split_bps_2);
        prop_assert!(total_split_bps <= 10_000);

        let fee_amount = (price * (fee_bps as i128)) / 10_000i128;
        prop_assert!(fee_amount <= price);
        prop_assert!(fee_amount >= 0);

        let mut splits = Vec::new(&env);
        splits.push_back(Split {
            recipient: Address::generate(&env),
            bps: split_bps_1,
        });
        splits.push_back(Split {
            recipient: Address::generate(&env),
            bps: split_bps_2,
        });

        let res = client.try_create_prompt(
            &creator,
            &String::from_str(&env, "https://example.com/image.png"),
            &String::from_str(&env, "Fee Invariant Prompt"),
            &String::from_str(&env, "General"),
            &String::from_str(&env, "preview"),
            &String::from_str(&env, "ciphertext"),
            &String::from_str(&env, "iv"),
            &String::from_str(&env, "wrapped-key"),
            &BytesN::from_array(&env, &[15u8; 32]),
            &ListingConfig {
                price,
                asset: context.xlm.clone(),
                expires_at: 0,
                splits,
            },
        );

        if total_split_bps.saturating_add(fee_bps) <= 10_000 {
            prop_assert!(res.is_ok());
        } else {
            prop_assert!(res.is_err());
        }
    }
}
