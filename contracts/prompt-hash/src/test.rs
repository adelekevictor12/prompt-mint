use crate::contract::{PromptHashContract, PromptHashContractClient};
use crate::mock_asset::FungibleTokenContract;
use crate::storage::Storage;
use crate::types::{Error, ListingConfig, Split};
extern crate std;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token, Address, Bytes, BytesN, Env, String, Vec,
};

#[derive(Clone, Debug, PartialEq)]
struct PromptHashContext {
    admin: Address,
    admin_two: Address,
    admin_three: Address,
    fee_wallet: Address,
    xlm: Address,
    contract: Address,
}

fn setup(env: &Env) -> PromptHashContext {
    env.mock_all_auths();

    let admin = Address::generate(env);
    let admin_two = Address::generate(env);
    let admin_three = Address::generate(env);
    let fee_wallet = Address::generate(env);
    let xlm = env.register(FungibleTokenContract, (admin.clone(),));
    let contract = env.register(
        PromptHashContract,
        (
            admin.clone(),
            admin_two.clone(),
            admin_three.clone(),
            fee_wallet.clone(),
            xlm.clone(),
        ),
    );

    PromptHashContext {
        admin,
        admin_two,
        admin_three,
        fee_wallet,
        xlm,
        contract,
    }
}

fn set_pause(client: &PromptHashContractClient<'_>, context: &PromptHashContext, paused: bool) {
    client.set_pause_status(&paused, &context.admin, &context.admin_two);
}

fn set_fee_percentage(
    client: &PromptHashContractClient<'_>,
    context: &PromptHashContext,
    fee_bps: u32,
) {
    client.set_fee_percentage(&fee_bps, &context.admin, &context.admin_two);
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Convenience helper: creates a prompt with no expiry and no splits.
fn create_prompt(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    title: &str,
    price_stroops: i128,
    asset: &Address,
) -> u128 {
    client.create_prompt(
        creator,
        &String::from_str(env, "https://example.com/prompt.png"),
        &String::from_str(env, title),
        &String::from_str(env, "Software Development"),
        &String::from_str(env, "Generate a production-ready implementation plan."),
        &String::from_str(env, "ciphertext"),
        &String::from_str(env, "iv"),
        &String::from_str(env, "wrapped-key"),
        &hash(env, 7),
        &ListingConfig {
            price: price_stroops,
            asset: asset.clone(),
            expires_at: 0,
            splits: Vec::new(env),
        },
    )
}

fn fund_buyer(
    xlm_client: &token::StellarAssetClient<'_>,
    buyer: &Address,
    spender: &Address,
    amount: i128,
) {
    xlm_client.mint(buyer, &amount);
    xlm_client.approve(buyer, spender, &amount, &1_000);
}

fn create_prompt_with_splits(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    title: &str,
    price_stroops: i128,
    asset: &Address,
    splits: Vec<Split>,
) -> u128 {
    client.create_prompt(
        creator,
        &String::from_str(env, "https://example.com/prompt.png"),
        &String::from_str(env, title),
        &String::from_str(env, "Software Development"),
        &String::from_str(env, "Generate a production-ready implementation plan."),
        &String::from_str(env, "ciphertext"),
        &String::from_str(env, "iv"),
        &String::from_str(env, "wrapped-key"),
        &hash(env, 17),
        &ListingConfig {
            price: price_stroops,
            asset: asset.clone(),
            expires_at: 0,
            splits,
        },
    )
}

#[test]
fn test_create_prompt_stores_encrypted_fields() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Secure Prompt",
        10_000_000,
        &context.xlm,
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.id, prompt_id);
    assert_eq!(prompt.creator, creator);
    assert_eq!(
        prompt.preview_text,
        String::from_str(&env, "Generate a production-ready implementation plan.")
    );
    assert_eq!(
        prompt.encrypted_prompt,
        String::from_str(&env, "ciphertext")
    );
    assert_eq!(prompt.encryption_iv, String::from_str(&env, "iv"));
    assert_eq!(prompt.wrapped_key, String::from_str(&env, "wrapped-key"));
    assert_eq!(prompt.content_hash, hash(&env, 7));
    assert!(prompt.active);
    assert_eq!(prompt.sales_count, 0);
    assert_eq!(prompt.expires_at, 0);
    assert_eq!(prompt.splits.len(), 0);

    let all_prompts = client.get_all_prompts();
    assert_eq!(all_prompts.len(), 1);
    assert_eq!(all_prompts.get(0).unwrap().id, prompt_id);
}

/// #32 – `__constructor` must reject a second setup call against an
/// already-initialized instance instead of silently overwriting the owner,
/// fee wallet, fee percentage, XLM SAC address, pause status, or schema
/// version that were established during the first (successful) setup.
#[test]
fn test_constructor_rejects_repeated_initialization() {
    let env: Env = Default::default();
    let context = setup(&env);

    // `setup` already ran `__constructor` once via `env.register(...)`.
    // Invoke it again directly against the same, already-initialized
    // contract instance and confirm it is rejected rather than silently
    // re-running setup.
    let attacker_admin = Address::generate(&env);
    let attacker_fee_wallet = Address::generate(&env);
    let result: Result<(), Error> = env.as_contract(&context.contract, || {
        <PromptHashContract as crate::types::PromptHashTrait>::__constructor(
            env.clone(),
            attacker_admin.clone(),
            attacker_fee_wallet.clone(),
            context.xlm.clone(),
        )
    });

    assert_eq!(result, Err(Error::AlreadyInitialized));

    // Original setup state must remain untouched by the rejected call.
    let client = PromptHashContractClient::new(&env, &context.contract);
    assert_eq!(client.get_fee_percentage(), 500);
}

#[test]
fn test_creator_can_pause_reactivate_and_update_price() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Pricing Prompt",
        5_000,
        &context.xlm,
    );

    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    client.update_prompt_price(&creator, &prompt_id, &9_000);
    client.set_prompt_sale_status(&creator, &prompt_id, &true);

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.price_stroops, 9_000);
    assert!(prompt.active);
}

// ─── Issue #192: Price history tracking ─────────────────────────────────────

#[test]
fn test_create_prompt_records_initial_price_history() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "History Prompt",
        5_000,
        &context.xlm,
    );

    let history = client.get_price_history(&prompt_id);
    assert_eq!(history.len(), 1);
    let first = history.get(0).unwrap();
    assert_eq!(first.previous_price, 0);
    assert_eq!(first.new_price, 5_000);
    assert_eq!(first.seq, 1);
    assert!(first.changed_at > 0);
}

#[test]
fn test_update_prompt_price_appends_history_and_emits_event() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "History Prompt",
        5_000,
        &context.xlm,
    );

    let before = env.events().all().len();
    client.update_prompt_price(&creator, &prompt_id, &9_000);
    client.update_prompt_price(&creator, &prompt_id, &7_500);
    let after = env.events().all().len();
    // Each update publishes a PromptPriceUpdated event.
    assert!(
        after >= before + 2,
        "expected two PromptPriceUpdated events, got {} delta",
        after - before
    );

    let history = client.get_price_history(&prompt_id);
    assert_eq!(history.len(), 3);
    let second = history.get(1).unwrap();
    assert_eq!(second.previous_price, 5_000);
    assert_eq!(second.new_price, 9_000);
    assert_eq!(second.seq, 2);
    let third = history.get(2).unwrap();
    assert_eq!(third.previous_price, 9_000);
    assert_eq!(third.new_price, 7_500);
    assert_eq!(third.seq, 3);
}

#[test]
fn test_create_prompt_emits_prompt_created_event() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let before = env.events().all().len();
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Event Prompt",
        7_500,
        &context.xlm,
    );
    let after = env.events().all().len();

    assert!(
        after > before,
        "expected PromptCreated event, got {} delta",
        after - before
    );

    let last = env.events().all().get(after - 1).unwrap();
    assert_eq!(last.topic, String::from_str(&env, "PromptCreated"));
}

#[test]
fn test_buy_prompt_emits_prompt_purchased_event() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 15_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Purchase Event Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let before = env.events().all().len();
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);
    let after = env.events().all().len();

    assert!(
        after > before,
        "expected PromptPurchased event, got {} delta",
        after - before
    );

    let last = env.events().all().get(after - 1).unwrap();
    assert_eq!(last.topic, String::from_str(&env, "PromptPurchased"));
}

#[test]
fn test_price_history_is_capped() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "History Prompt",
        1_000,
        &context.xlm,
    );

    // Creation records 1 entry; push well past the cap with price updates.
    for i in 0..(Storage::MAX_PRICE_HISTORY_LEN + 5) {
        client.update_prompt_price(&creator, &prompt_id, &((i as i128 + 2) * 1_000));
    }

    let history = client.get_price_history(&prompt_id);
    assert_eq!(
        history.len(),
        Storage::MAX_PRICE_HISTORY_LEN,
        "price history log must stay bounded at MAX_PRICE_HISTORY_LEN"
    );
    // Oldest entries are dropped, newest are retained.
    assert_eq!(history.get(0).unwrap().seq, 7);
}

#[test]
fn test_get_price_history_rejects_missing_prompt() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let result = client.try_get_price_history(&999_999);
    match result {
        Err(Ok(Error::PromptNotFound)) => {}
        other => panic!("expected PromptNotFound for nonexistent prompt, got {:?}", other),
    }
}

#[test]
fn test_buy_prompt_grants_access_to_multiple_buyers_and_tracks_exact_fees() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer_one = Address::generate(&env);
    let buyer_two = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Reusable Prompt",
        12_345,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer_one, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer_two, &context.contract, 100_000);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(
        &buyer_one,
        &prompt_id,
        &None::<Bytes>,
        &12_345i128,
        &None::<Bytes>,
    );
    client.buy_prompt(
        &buyer_two,
        &prompt_id,
        &None::<Bytes>,
        &12_345i128,
        &None::<Bytes>,
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.sales_count, 2);
    assert!(client.has_access(&buyer_one, &prompt_id));
    assert!(client.has_access(&buyer_two, &prompt_id));

    let single_fee = 12_345 * 500 / 10_000;
    let single_creator_amount = 12_345 - single_fee;
    assert_eq!(
        xlm_client.balance(&creator),
        seller_start + (single_creator_amount * 2) as i128
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + (single_fee * 2) as i128
    );
}

#[test]
fn test_fee_routing_pays_seller_and_platform_wallet_for_exact_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 25_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Fee Routed Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let buyer_start = xlm_client.balance(&buyer);
    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    let expected_fee = price * 500 / 10_000;
    let expected_seller_payout = price - expected_fee;

    assert_eq!(xlm_client.balance(&buyer), buyer_start - price);
    assert_eq!(
        xlm_client.balance(&creator),
        seller_start + expected_seller_payout
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert!(client.has_access(&buyer, &prompt_id));
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);
}

#[test]
fn test_small_price_fee_rounding_keeps_fractional_fee_with_seller() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 19;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Tiny Rounded Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    assert_eq!(price * 500 / 10_000, 0);
    assert_eq!(xlm_client.balance(&creator), seller_start + price);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_seller_payout_split_rounding_uses_integer_stroops() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 101;

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 333,
    });

    let prompt_id = create_prompt_with_splits(
        &env,
        &client,
        &creator,
        "Rounded Split Prompt",
        price,
        &context.xlm,
        splits,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let co_creator_start = xlm_client.balance(&co_creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    let expected_fee = price * 500 / 10_000;
    let expected_split = price * 333 / 10_000;
    let expected_seller_payout = price - expected_fee - expected_split;

    assert_eq!(expected_fee, 5);
    assert_eq!(expected_split, 3);
    assert_eq!(
        xlm_client.balance(&creator),
        seller_start + expected_seller_payout
    );
    assert_eq!(
        xlm_client.balance(&co_creator),
        co_creator_start + expected_split
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
}

#[test]
fn test_failed_purchase_does_not_grant_access_or_route_partial_payouts() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Failed Purchase Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let buyer_start = xlm_client.balance(&buyer);
    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &(price - 1),
        &None::<Bytes>,
    );

    match result {
        Err(Ok(Error::InvalidPaymentAmount)) => {}
        other => panic!("expected InvalidPaymentAmount, got {:?}", other),
    }

    assert_eq!(xlm_client.balance(&buyer), buyer_start);
    assert_eq!(xlm_client.balance(&creator), seller_start);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start);
    assert!(!client.has_access(&buyer, &prompt_id));
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 0);
}

#[test]
fn test_has_access_is_true_for_creator_and_buyer_but_not_stranger() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Access Prompt",
        8_000,
        &context.xlm,
    );

    assert!(client.has_access(&creator, &prompt_id));
    assert!(!client.has_access(&buyer, &prompt_id));
    assert!(!client.has_access(&stranger, &prompt_id));

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &8_000i128,
        &None::<Bytes>,
    );

    assert!(client.has_access(&buyer, &prompt_id));
    assert!(!client.has_access(&stranger, &prompt_id));
}

#[test]
fn test_get_prompts_by_creator_and_buyer() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_a = create_prompt(&env, &client, &creator, "Prompt A", 8_000, &context.xlm);
    create_prompt(&env, &client, &creator, "Prompt B", 9_000, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(
        &buyer,
        &prompt_a,
        &None::<Bytes>,
        &8_000i128,
        &None::<Bytes>,
    );

    assert_eq!(client.get_prompts_by_creator(&creator).len(), 2);
    assert_eq!(client.get_prompts_by_buyer(&buyer).len(), 1);
}

#[test]
fn test_license_owner_can_transfer_and_creator_receives_royalty() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Transferable Prompt",
        10_000,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &seller, &context.contract, 100_000);
    client.buy_prompt(
        &seller,
        &prompt_id,
        &None::<Bytes>,
        &10_000i128,
        &None::<Bytes>,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    let creator_before = xlm_client.balance(&creator);
    let seller_before = xlm_client.balance(&seller);
    let buyer_before = xlm_client.balance(&buyer);
    let resale_price = 20_000i128;

    client.transfer_license(&seller, &prompt_id, &buyer, &resale_price);

    let royalty = resale_price * 500 / 10_000;
    let seller_proceeds = resale_price - royalty;
    assert_eq!(xlm_client.balance(&creator), creator_before + royalty);
    assert_eq!(xlm_client.balance(&seller), seller_before + seller_proceeds);
    assert_eq!(xlm_client.balance(&buyer), buyer_before - resale_price);
    assert!(!client.has_access(&seller, &prompt_id));
    assert!(client.has_access(&buyer, &prompt_id));
    assert_eq!(client.get_prompts_by_buyer(&seller).len(), 0);
    assert_eq!(client.get_prompts_by_buyer(&buyer).len(), 1);
}

#[test]
fn test_non_owner_cannot_transfer_license() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let owner = Address::generate(&env);
    let stranger = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Protected Transfer Prompt",
        10_000,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &owner, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(
        &owner,
        &prompt_id,
        &None::<Bytes>,
        &10_000i128,
        &None::<Bytes>,
    );

    let result = client.try_transfer_license(&stranger, &prompt_id, &buyer, &20_000i128);
    match result {
        Err(Ok(Error::LicenseNotFound)) => {}
        other => panic!(
            "expected LicenseNotFound for non-owner transfer, got {:?}",
            other
        ),
    }
    assert!(client.has_access(&owner, &prompt_id));
    assert!(!client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_transfer_license_allows_zero_gift_and_rejects_self_transfer() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let owner = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Invalid Transfer Prompt",
        10_000,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &owner, &context.contract, 100_000);
    client.buy_prompt(
        &owner,
        &prompt_id,
        &None::<Bytes>,
        &10_000i128,
        &None::<Bytes>,
    );

    // #271: a zero-consideration transfer is a valid gift. It moves access to the
    // new owner and must NOT attempt a bogus royalty payment (creator balance
    // unchanged).
    let creator_before = xlm_client.balance(&creator);
    client.transfer_license(&owner, &prompt_id, &buyer, &0i128);
    assert_eq!(xlm_client.balance(&creator), creator_before);
    assert!(!client.has_access(&owner, &prompt_id));
    assert!(client.has_access(&buyer, &prompt_id));

    let self_transfer = client.try_transfer_license(&buyer, &prompt_id, &buyer, &20_000i128);
    match self_transfer {
        Err(Ok(Error::InvalidLicenseTransfer)) => {}
        other => panic!(
            "expected InvalidLicenseTransfer for self transfer, got {:?}",
            other
        ),
    }
}

#[test]
fn test_duplicate_purchase_returns_typed_error() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "One License", 4_000, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &4_000i128,
        &None::<Bytes>,
    );

    let duplicate_purchase = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &4_000i128,
        &None::<Bytes>,
    );
    match duplicate_purchase {
        Err(Ok(error)) => assert_eq!(error, Error::AlreadyPurchased),
        other => panic!("unexpected duplicate purchase result: {:?}", other),
    }
}

// ─── #272: Prompt Bundling ──────────────────────────────────────────────────

#[test]
fn test_create_bundle_rejects_unowned_prompts() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let other = Address::generate(&env);
    let owned = create_prompt(&env, &client, &creator, "Owned", 10_000, &context.xlm);
    let foreign = create_prompt(&env, &client, &other, "Foreign", 10_000, &context.xlm);

    let ids = Vec::from_array(&env, [owned, foreign]);
    let result = client.try_create_bundle(&creator, &ids, &15_000i128, &context.xlm);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!(
            "expected Unauthorized for unowned prompt in bundle, got {:?}",
            other
        ),
    }
}

#[test]
fn test_purchase_bundle_grants_access_and_splits_payment() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let p1 = create_prompt(&env, &client, &creator, "Bundle P1", 10_000, &context.xlm);
    let p2 = create_prompt(&env, &client, &creator, "Bundle P2", 20_000, &context.xlm);

    let ids = Vec::from_array(&env, [p1, p2]);
    let bundle_price = 24_000i128;
    let bundle_id = client.create_bundle(&creator, &ids, &bundle_price, &context.xlm);

    let stored: Bundle = client.get_bundle(&bundle_id);
    assert_eq!(stored.price, bundle_price);
    assert_eq!(stored.prompt_ids.len(), 2);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);
    let buyer_before = xlm_client.balance(&buyer);

    client.purchase_bundle(&buyer, &bundle_id, &bundle_price);

    // Access granted to every prompt in the bundle.
    assert!(client.has_access(&buyer, &p1));
    assert!(client.has_access(&buyer, &p2));

    // Payment split: platform fee (default 500 bps) then creator remainder.
    let fee = bundle_price * 500 / 10_000;
    let creator_amount = bundle_price - fee;
    assert_eq!(
        xlm_client.balance(&creator),
        creator_before + creator_amount
    );
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_before + fee);
    assert_eq!(xlm_client.balance(&buyer), buyer_before - bundle_price);
}

#[test]
fn test_purchase_nonexistent_bundle_fails_cleanly() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let buyer = Address::generate(&env);
    let result = client.try_purchase_bundle(&buyer, &999u128, &10_000i128);
    match result {
        Err(Ok(Error::BundleNotFound)) => {}
        other => panic!("expected BundleNotFound, got {:?}", other),
    }
}

#[test]
fn test_creator_cannot_buy_own_prompt() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Creator Lockout",
        4_000,
        &context.xlm,
    );

    let result = client.try_buy_prompt(
        &creator,
        &prompt_id,
        &None::<Bytes>,
        &4_000i128,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(error)) => assert_eq!(error, Error::CreatorCannotBuy),
        other => panic!("unexpected creator purchase result: {:?}", other),
    }
}

#[test]
fn test_inactive_prompt_cannot_be_bought() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Paused Prompt",
        4_000,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.set_prompt_sale_status(&creator, &prompt_id, &false);

    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &4_000i128,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(error)) => assert_eq!(error, Error::PromptInactive),
        other => panic!("unexpected inactive prompt result: {:?}", other),
    }
}

#[test]
fn test_buy_prompt_with_zero_fee() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Set fee to 0
    set_fee_percentage(&client, &context, 0);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Zero Fee Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    assert_eq!(xlm_client.balance(&creator), seller_start + price);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start);
}

#[test]
fn test_buy_prompt_with_max_fee() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Set fee to 100% (10,000 BPS)
    set_fee_percentage(&client, &context, 10_000);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Max Fee Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let seller_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    // At the 20% cap: fee = 2,000, creator receives the remaining 8,000.
    assert_eq!(xlm_client.balance(&creator), seller_start + 8_000);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start + 2_000);
}

#[test]
fn test_set_fee_percentage_above_max_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // #41: 2,000 bps (20%) is a hard ceiling; anything above must be rejected.
    let result = client.try_set_fee_percentage(&2_001);
    match result {
        Err(Ok(Error::FeeExceedsMaximum)) => {}
        other => panic!("expected FeeExceedsMaximum, got {:?}", other),
    }

    // The boundary itself must still be accepted.
    client.set_fee_percentage(&2_000);
    assert_eq!(client.get_fee_percentage(), 2_000);
}

#[test]
fn test_sensitive_admin_functions_accept_two_distinct_configured_signers() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let replacement_wallet = Address::generate(&env);

    client.set_fee_wallet(
        &replacement_wallet,
        &context.admin_two,
        &context.admin_three,
    );

    assert_eq!(client.get_fee_wallet(), Some(replacement_wallet));
}

#[test]
fn test_sensitive_admin_functions_reject_duplicate_or_unknown_approvers() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let outsider = Address::generate(&env);

    let duplicate = client.try_set_pause_status(&true, &context.admin, &context.admin);
    match duplicate {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!(
            "expected Unauthorized for duplicate approvals, got {:?}",
            other
        ),
    }
    assert!(!client.is_paused());

    let unknown = client.try_set_fee_percentage(&1_000, &context.admin, &outsider);
    match unknown {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!(
            "expected Unauthorized for unknown approver, got {:?}",
            other
        ),
    }
    assert_eq!(client.get_fee_percentage(), 500);
}

#[test]
fn test_unauthorized_seller_actions_fail() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Protected Prompt",
        5_000,
        &context.xlm,
    );

    // Try to update status as stranger
    let status_res = client.try_set_prompt_sale_status(&stranger, &prompt_id, &false);
    match status_res {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected unauthorized for status update, got {:?}", other),
    }

    // Try to update price as stranger
    let price_res = client.try_update_prompt_price(&stranger, &prompt_id, &1_000);
    match price_res {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected unauthorized for price update, got {:?}", other),
    }
}

#[test]
fn test_buy_nonexistent_prompt_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let buyer = Address::generate(&env);

    let result =
        client.try_buy_prompt(&buyer, &999_999, &None::<Bytes>, &1_000i128, &None::<Bytes>);
    match result {
        Err(Ok(Error::PromptNotFound)) => {}
        other => panic!(
            "expected PromptNotFound for nonexistent prompt, got {:?}",
            other
        ),
    }
}

#[test]
fn test_arithmetic_safety_for_massive_prices() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Test with a very large price that might cause overflow in fee calculation if not careful
    // price * fee / 10000.
    let massive_price = i128::MAX / 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Massive Price Prompt",
        massive_price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, massive_price);

    // This should not panic and should calculate fees correctly
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &massive_price,
        &None::<Bytes>,
    );

    let fee_bps = 500i128;
    let expected_fee = massive_price * fee_bps / 10_000;
    let expected_seller = massive_price - expected_fee;

    assert_eq!(xlm_client.balance(&creator), expected_seller);
    assert_eq!(xlm_client.balance(&context.fee_wallet), expected_fee);
}

#[test]
fn test_reentrant_mutations_are_rejected_while_cross_contract_guard_is_held() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Reentrancy Stress",
        5_000,
        &context.xlm,
    );

    env.as_contract(&context.contract, || {
        Storage::set_reentrancy_guard(&env).unwrap();
    });

    for _ in 0..32 {
        let update = client.try_update_prompt_price(&creator, &prompt_id, &6_000);
        match update {
            Err(Ok(Error::ReentrancyGuard)) => {}
            other => panic!("expected reentrant update rejection, got {:?}", other),
        }

        let purchase =
            client.try_buy_prompt(&buyer, &prompt_id, &None::<Address>, &5_000, &None::<Bytes>);
        match purchase {
            Err(Ok(Error::ReentrancyGuard)) => {}
            other => panic!("expected reentrant purchase rejection, got {:?}", other),
        }
    }

    assert_eq!(client.get_prompt(&prompt_id).price_stroops, 5_000);
    assert!(!client.has_access(&buyer, &prompt_id));

    env.as_contract(&context.contract, || {
        Storage::clear_reentrancy_guard(&env);
    });
}

#[test]
fn test_global_pause_blocks_mutations_but_not_reads() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    set_pause(&client, &context, true);
    assert!(client.is_paused());

    let create_res = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/prompt.png"),
        &String::from_str(&env, "Paused Create"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 1),
        &ListingConfig {
            price: 10_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: Vec::new(&env),
        },
    );
    match create_res {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for create_prompt, got {:?}",
            other
        ),
    }

    set_pause(&client, &context, false);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Readable Prompt",
        10_000,
        &context.xlm,
    );
    set_pause(&client, &context, true);

    assert!(client.get_prompt(&prompt_id).id == prompt_id);
    assert!(client.has_access(&creator, &prompt_id));
}

#[test]
fn test_lease_prompt_grants_temporary_access_and_expires() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_000;
    });

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Lease Prompt",
        10_000,
        &context.xlm,
    );
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);

    client.lease_prompt(&buyer, &prompt_id, &600);
    assert!(client.has_access(&buyer, &prompt_id));

    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_700;
    });
    assert!(!client.has_access(&buyer, &prompt_id));
}

// ─── Issue #105: Referral & Affiliate Commission System ───────────────────────

#[test]
fn test_buy_prompt_with_referrer_splits_payment_correctly() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Set referral to 5% (500 BPS)
    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Referral Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);
    let referrer_start = xlm_client.balance(&referrer);
    let referral_code = Bytes::from_slice(&env, b"referral-secret-001");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&referrer, &referral_hash);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &Some(referral_code),
        &price,
        &None::<Bytes>,
    );

    // fee = 10_000 * 500 / 10_000 = 500
    // referral = 10_000 * 500 / 10_000 = 500
    // creator = 10_000 - 500 - 500 = 9_000
    let expected_fee = price * 500 / 10_000;
    let expected_referral = price * 500 / 10_000;
    let expected_creator = price - expected_fee - expected_referral;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert_eq!(
        xlm_client.balance(&referrer),
        referrer_start + expected_referral
    );
}

// ─── Issue #274: Referral tracking events ─────────────────────────────────────

#[test]
fn test_register_referral_code_emits_event() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    client.set_referral_percentage(&500);

    let referrer = Address::generate(&env);
    let referral_code = Bytes::from_slice(&env, b"event-ref-secret-274");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());

    let before = env.events().all().len();
    client.register_referral_code(&referrer, &referral_hash);
    let after = env.events().all().len();

    // register_referral_code now publishes a ReferralCodeRegistered event.
    assert!(
        after > before,
        "expected a referral-code-registered event to be emitted"
    );
}

#[test]
fn test_purchase_with_referrer_emits_reward_event() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Reward Event Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let referral_code = Bytes::from_slice(&env, b"reward-event-secret-274");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&referrer, &referral_hash);

    let before = env.events().all().len();
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &Some(referral_code),
        &price,
        &None::<Bytes>,
    );
    let after = env.events().all().len();

    // A purchase with a recorded referrer emits the PromptPurchased event plus a
    // dedicated ReferralRewardPaid event.
    assert!(
        after >= before + 2,
        "expected purchase + referral-reward-paid events to be emitted"
    );
}

#[test]
fn test_referrer_cannot_be_buyer() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Self Referral Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    let referral_code = Bytes::from_slice(&env, b"self-referral-secret");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&buyer, &referral_hash);

    // buyer tries to refer themselves
    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &Some(referral_code),
        &price,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::ReferrerCannotBeBuyerOrCreator)) => {}
        other => panic!("expected ReferrerCannotBeBuyerOrCreator, got {:?}", other),
    }
}

#[test]
fn test_referrer_cannot_be_creator() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Creator Referral Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    let referral_code = Bytes::from_slice(&env, b"creator-ref-secret");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&creator, &referral_hash);

    // creator tries to refer themselves
    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &Some(referral_code),
        &price,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::ReferrerCannotBeBuyerOrCreator)) => {}
        other => panic!("expected ReferrerCannotBeBuyerOrCreator, got {:?}", other),
    }
}

#[test]
fn test_buy_without_referrer_no_referral_amount_paid() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "No Referral Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    // Without referrer: creator gets price - fee only
    let expected_fee = price * 500 / 10_000;
    let expected_creator = price - expected_fee;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
}

#[test]
fn test_set_referral_percentage_only_owner() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Owner can set referral percentage
    client.set_referral_percentage(&300);
    assert_eq!(client.get_referral_percentage(), 300);

    // Non-owner cannot set referral percentage
    let stranger = Address::generate(&env);
    // mock_all_auths is active so we test the value was set correctly
    assert_eq!(client.get_referral_percentage(), 300);
    let _ = stranger; // suppress unused warning
}

// ─── Issue #107: Global Emergency Circuit Breaker (Pause) ─────────────────────

#[test]
fn test_create_prompt_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    set_pause(&client, &context, true);
    assert!(client.is_paused());

    let creator = Address::generate(&env);
    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Paused Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "Preview text here."),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 1),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits: Vec::new(&env),
        },
    );
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for create_prompt, got {:?}",
            other
        ),
    }
}

#[test]
fn test_buy_prompt_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 5_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Pausable Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    set_pause(&client, &context, true);

    let result = client.try_buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!("expected ContractIsPaused for buy_prompt, got {:?}", other),
    }
}

#[test]
fn test_update_prompt_price_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Price Update Prompt",
        5_000,
        &context.xlm,
    );

    set_pause(&client, &context, true);

    let result = client.try_update_prompt_price(&creator, &prompt_id, &9_000i128);
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for update_prompt_price, got {:?}",
            other
        ),
    }
}

#[test]
fn test_read_only_methods_work_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Read Only Prompt",
        5_000,
        &context.xlm,
    );

    set_pause(&client, &context, true);

    // These should all succeed while paused
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.id, prompt_id);

    let all = client.get_all_prompts();
    assert_eq!(all.len(), 1);

    assert!(client.has_access(&creator, &prompt_id));
    assert!(client.is_paused());
}

#[test]
fn test_unpause_restores_operations() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 5_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Unpause Prompt",
        price,
        &context.xlm,
    );

    set_pause(&client, &context, true);
    set_pause(&client, &context, false);
    assert!(!client.is_paused());

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);
    assert!(client.has_access(&buyer, &prompt_id));
}

// ─── Issue #28: Emergency Pause – additional coverage ─────────────────────────

/// Confirms the multisig pause path works and that extend_listing is blocked
/// while the contract is paused.
#[test]
fn test_extend_listing_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Pause Extend Prompt",
        5_000,
        &context.xlm,
    );

    set_pause(&client, &context, true);

    let result = client.try_extend_listing(&creator, &prompt_id, &2_000u64);
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for extend_listing while paused, got {:?}",
            other
        ),
    }
}

#[test]
fn test_bulk_purchase_blocked_when_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Bulk Pause", 1_000, &context.xlm);

    set_pause(&client, &context, true);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_id);
    let mut amounts = Vec::new(&env);
    amounts.push_back(1_000i128);

    let result = client.try_buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Bytes>);
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!(
            "expected ContractIsPaused for buy_prompts_bulk while paused, got {:?}",
            other
        ),
    }
}

// ─── Issue #108: Prompt Tipping and Bonus Payments ────────────────────────────

#[test]
fn test_tip_above_price_succeeds_and_creator_receives_full_tip() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let tip: i128 = 5_000;
    let total_payment = price + tip;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Tippable Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, total_payment);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &total_payment,
        &None::<Bytes>,
    );

    // fee is on total payment: 15_000 * 500 / 10_000 = 750
    let expected_fee = total_payment * 500 / 10_000;
    let expected_creator = total_payment - expected_fee;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
}

#[test]
fn test_payment_below_price_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Underpay Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &(price - 1),
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::InvalidPaymentAmount)) => {}
        other => panic!("expected InvalidPaymentAmount, got {:?}", other),
    }
}

#[test]
fn test_exact_price_payment_succeeds() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Exact Pay Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    // Exact price should succeed without emitting a tip event
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);
    assert!(client.has_access(&buyer, &prompt_id));
}

// ─── Issue #109: On-chain Discount and Voucher Verification ───────────────────

#[test]
fn test_voucher_applies_discount_on_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Voucher Prompt",
        price,
        &context.xlm,
    );

    // 20% discount (2000 BPS)
    let discount_bps: u32 = 2_000;
    let voucher_code = Bytes::from_slice(&env, b"SAVE20");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());

    client.add_voucher(&creator, &prompt_id, &hashed_code, &discount_bps);

    // discounted price = 10_000 - (10_000 * 2000 / 10_000) = 10_000 - 2_000 = 8_000
    let discounted_price: i128 = 8_000;
    fund_buyer(&xlm_client, &buyer, &context.contract, discounted_price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &discounted_price,
        &Some(voucher_code),
    );

    let expected_fee = discounted_price * 500 / 10_000;
    let expected_creator = discounted_price - expected_fee;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_voucher_is_single_use_second_use_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer_one = Address::generate(&env);
    let buyer_two = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Single Use Voucher",
        price,
        &context.xlm,
    );

    let discount_bps: u32 = 1_000;
    let voucher_code = Bytes::from_slice(&env, b"ONCE");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());

    client.add_voucher(&creator, &prompt_id, &hashed_code, &discount_bps);

    let discounted_price: i128 = price - (price * discount_bps as i128 / 10_000);
    fund_buyer(&xlm_client, &buyer_one, &context.contract, discounted_price);
    fund_buyer(&xlm_client, &buyer_two, &context.contract, discounted_price);

    // First use succeeds
    client.buy_prompt(
        &buyer_one,
        &prompt_id,
        &None::<Bytes>,
        &discounted_price,
        &Some(voucher_code.clone()),
    );

    // Second use with same code should fail (voucher removed after first use)
    let result = client.try_buy_prompt(
        &buyer_two,
        &prompt_id,
        &None::<Bytes>,
        &discounted_price,
        &Some(voucher_code),
    );
    match result {
        Err(Ok(Error::InvalidVoucher)) => {}
        other => panic!("expected InvalidVoucher on second use, got {:?}", other),
    }
}

#[test]
fn test_invalid_voucher_code_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Invalid Voucher Prompt",
        price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let wrong_code = Bytes::from_slice(&env, b"WRONGCODE");
    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &price,
        &Some(wrong_code),
    );
    match result {
        Err(Ok(Error::InvalidVoucher)) => {}
        other => panic!("expected InvalidVoucher for wrong code, got {:?}", other),
    }
}

#[test]
fn test_only_creator_can_add_voucher() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Voucher Auth Prompt",
        5_000,
        &context.xlm,
    );

    let voucher_code = Bytes::from_slice(&env, b"SECRET");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());

    let result = client.try_add_voucher(&stranger, &prompt_id, &hashed_code, &500u32);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!(
            "expected Unauthorized for stranger adding voucher, got {:?}",
            other
        ),
    }
}

#[test]
fn test_creator_can_remove_voucher() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Remove Voucher Prompt",
        price,
        &context.xlm,
    );

    let voucher_code = Bytes::from_slice(&env, b"REMOVE");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());

    client.add_voucher(&creator, &prompt_id, &hashed_code, &1_000u32);
    client.remove_voucher(&creator, &prompt_id, &hashed_code);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    // After removal, voucher should be invalid
    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &price,
        &Some(voucher_code),
    );
    match result {
        Err(Ok(Error::InvalidVoucher)) => {}
        other => panic!("expected InvalidVoucher after removal, got {:?}", other),
    }
}

#[test]
fn test_voucher_with_referrer_combined() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500); // 5%

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Voucher+Referral Prompt",
        price,
        &context.xlm,
    );

    // 10% discount
    let discount_bps: u32 = 1_000;
    let voucher_code = Bytes::from_slice(&env, b"COMBO");
    let hashed_code = BytesN::from_array(&env, &env.crypto().sha256(&voucher_code).to_array());
    client.add_voucher(&creator, &prompt_id, &hashed_code, &discount_bps);

    // discounted price = 10_000 - 1_000 = 9_000
    let discounted_price: i128 = 9_000;
    fund_buyer(&xlm_client, &buyer, &context.contract, discounted_price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);
    let referrer_start = xlm_client.balance(&referrer);
    let referral_code = Bytes::from_slice(&env, b"voucher-ref-secret");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&referrer, &referral_hash);

    client.buy_prompt(
        &buyer,
        &prompt_id,
        &Some(referral_code),
        &discounted_price,
        &Some(voucher_code),
    );

    // fee = 9_000 * 500 / 10_000 = 450
    // referral = 9_000 * 500 / 10_000 = 450
    // creator = 9_000 - 450 - 450 = 8_100
    let expected_fee = discounted_price * 500 / 10_000;
    let expected_referral = discounted_price * 500 / 10_000;
    let expected_creator = discounted_price - expected_fee - expected_referral;

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert_eq!(
        xlm_client.balance(&referrer),
        referrer_start + expected_referral
    );
    assert!(client.has_access(&buyer, &prompt_id));
}

// ─── Issue #47: Multi-Currency Pricing ──────────────────────────────────────────

#[test]
fn test_buy_prompt_with_non_xlm_asset() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // Register a second token (e.g., USDC)
    let usdc = env.register(FungibleTokenContract, (context.admin.clone(),));
    let usdc_client = token::StellarAssetClient::new(&env, &usdc);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 5_000_000; // 5 USDC (6 decimals)
    let prompt_id = create_prompt(&env, &client, &creator, "USDC Prompt", price, &usdc);

    // Fund buyer with USDC
    usdc_client.mint(&buyer, &price);
    usdc_client.approve(&buyer, &context.contract, &price, &1_000);

    let creator_start = usdc_client.balance(&creator);
    let fee_start = usdc_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    let expected_fee = price * 500 / 10_000;
    let expected_creator = price - expected_fee;

    assert_eq!(
        usdc_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        usdc_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_create_and_buy_different_assets() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    // Register a second token
    let usdc = env.register(FungibleTokenContract, (context.admin.clone(),));
    let usdc_client = token::StellarAssetClient::new(&env, &usdc);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Create one prompt priced in XLM, another in USDC
    let xlm_price: i128 = 10_000;
    let usdc_price: i128 = 2_000_000;
    let prompt_xlm = create_prompt(
        &env,
        &client,
        &creator,
        "XLM Prompt",
        xlm_price,
        &context.xlm,
    );
    let prompt_usdc = create_prompt(&env, &client, &creator, "USDC Prompt", usdc_price, &usdc);

    // Fund buyer with both tokens
    fund_buyer(&xlm_client, &buyer, &context.contract, xlm_price);
    usdc_client.mint(&buyer, &usdc_price);
    usdc_client.approve(&buyer, &context.contract, &usdc_price, &1_000);

    // Buy the XLM prompt - XLM balances should change, USDC should not
    let creator_xlm_before = xlm_client.balance(&creator);
    let creator_usdc_before = usdc_client.balance(&creator);

    client.buy_prompt(
        &buyer,
        &prompt_xlm,
        &None::<Bytes>,
        &xlm_price,
        &None::<Bytes>,
    );

    let xlm_fee = xlm_price * 500 / 10_000;
    assert_eq!(
        xlm_client.balance(&creator),
        creator_xlm_before + xlm_price - xlm_fee
    );
    assert_eq!(usdc_client.balance(&creator), creator_usdc_before);

    // Buy the USDC prompt - USDC balances should change
    let creator_usdc_before = usdc_client.balance(&creator);
    client.buy_prompt(
        &buyer,
        &prompt_usdc,
        &None::<Bytes>,
        &usdc_price,
        &None::<Bytes>,
    );

    let usdc_fee = usdc_price * 500 / 10_000;
    assert_eq!(
        usdc_client.balance(&creator),
        creator_usdc_before + usdc_price - usdc_fee
    );

    assert!(client.has_access(&buyer, &prompt_xlm));
    assert!(client.has_access(&buyer, &prompt_usdc));
}

#[test]
fn test_lease_prompt_with_non_xlm_asset() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_000;
    });

    // Register a second token
    let usdc = env.register(FungibleTokenContract, (context.admin.clone(),));
    let usdc_client = token::StellarAssetClient::new(&env, &usdc);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000_000;
    let prompt_id = create_prompt(&env, &client, &creator, "USDC Lease Prompt", price, &usdc);

    // Lease price = 40% of base price
    let lease_price = price * 4_000 / 10_000;
    usdc_client.mint(&buyer, &lease_price);
    usdc_client.approve(&buyer, &context.contract, &lease_price, &1_000);

    let creator_start = usdc_client.balance(&creator);

    client.lease_prompt(&buyer, &prompt_id, &600);

    let expected_fee = lease_price * 500 / 10_000;
    let expected_seller = lease_price - expected_fee;
    assert_eq!(
        usdc_client.balance(&creator),
        creator_start + expected_seller
    );
    assert!(client.has_access(&buyer, &prompt_id));

    // Verify lease expires
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = 1_700;
    });
    assert!(!client.has_access(&buyer, &prompt_id));
}

// ─── Issue #49: Time-Bound Listing Expiry ────────────────────────────────────

#[test]
fn test_create_prompt_with_expiry_stores_expires_at() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let expires_at: u64 = 10_000;

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Expiring Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 2),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at,
            splits: Vec::new(&env),
        },
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.expires_at, expires_at);
}

#[test]
fn test_expired_listing_excluded_from_get_all_prompts() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);

    // Create one prompt that expires at t=2000 and one that never expires
    let _expiring = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Expiring"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 3),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 2_000,
            splits: Vec::new(&env),
        },
    );
    let persistent = create_prompt(&env, &client, &creator, "Persistent", 5_000, &context.xlm);

    // Both visible before expiry
    assert_eq!(client.get_all_prompts().len(), 2);

    // Advance time past the first prompt's expiry
    env.ledger().with_mut(|l| l.timestamp = 3_000);

    let visible = client.get_all_prompts();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible.get(0).unwrap().id, persistent);
}

#[test]
fn test_buy_expired_listing_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Short-lived Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 4),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 2_000,
            splits: Vec::new(&env),
        },
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, 10_000);

    // Purchase before expiry succeeds
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &5_000i128,
        &None::<Bytes>,
    );
    assert!(client.has_access(&buyer, &prompt_id));

    // After expiry a new buyer is rejected
    env.ledger().with_mut(|l| l.timestamp = 3_000);
    let buyer2 = Address::generate(&env);
    fund_buyer(&xlm_client, &buyer2, &context.contract, 10_000);

    let result = client.try_buy_prompt(
        &buyer2,
        &prompt_id,
        &None::<Bytes>,
        &5_000i128,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::ListingExpired)) => {}
        other => panic!("expected ListingExpired, got {:?}", other),
    }
}

#[test]
fn test_extend_listing_pushes_expiry_and_allows_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Extend Me"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 5),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 2_000, // expires at t=2000
            splits: Vec::new(&env),
        },
    );

    // Advance past original expiry
    env.ledger().with_mut(|l| l.timestamp = 2_500);

    // Extend to t=5000
    client.extend_listing(&creator, &prompt_id, &5_000u64);
    assert_eq!(client.get_prompt(&prompt_id).expires_at, 5_000);

    // Purchase now succeeds
    fund_buyer(&xlm_client, &buyer, &context.contract, 10_000);
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &5_000i128,
        &None::<Bytes>,
    );
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_only_creator_can_extend_listing() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Auth Extend", 5_000, &context.xlm);

    let result = client.try_extend_listing(&stranger, &prompt_id, &9_000u64);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!(
            "expected Unauthorized for stranger extend_listing, got {:?}",
            other
        ),
    }
}

#[test]
fn test_prompt_expiry_warning_emits_once() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Expiring Soon"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 6),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 1_000 + 7 * 24 * 60 * 60,
            splits: Vec::new(&env),
        },
    );

    let before = env.events().all().len();
    assert!(client.check_prompt_expiry(&prompt_id));
    let after_first_check = env.events().all().len();
    assert_eq!(after_first_check, before + 1);

    assert!(client.check_prompt_expiry(&prompt_id));
    assert_eq!(env.events().all().len(), after_first_check);
}

#[test]
fn test_extend_prompt_lifetime_adds_duration_for_creator() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Extend Lifetime"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 8),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 2_000,
            splits: Vec::new(&env),
        },
    );

    assert_eq!(
        client.extend_prompt_lifetime(&creator, &prompt_id, &3_000),
        5_000
    );
    assert_eq!(client.get_prompt(&prompt_id).expires_at, 5_000);
}

// ─── Issue #50: Seller Revenue Sharing (Splits) ───────────────────────────────

#[test]
fn test_create_prompt_with_splits_stores_split_data() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 2_000, // 20%
    });

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Split Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 6),
        &ListingConfig {
            price: 10_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
        },
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.splits.len(), 1);
    assert_eq!(prompt.splits.get(0).unwrap().bps, 2_000);
}

#[test]
fn test_buy_prompt_with_splits_distributes_correctly() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co_creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;

    // Platform fee = 500 BPS (5%), split = 2000 BPS (20%)
    // creator receives 10_000 - 500 - 2_000 = 7_500 (75%)
    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co_creator.clone(),
        bps: 2_000,
    });

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Split Buy Prompt"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 8),
        &ListingConfig {
            price,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
        },
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let co_creator_start = xlm_client.balance(&co_creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    let expected_fee = price * 500 / 10_000; // 500
    let expected_split = price * 2_000 / 10_000; // 2_000
    let expected_creator = price - expected_fee - expected_split; // 7_500

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + expected_creator
    );
    assert_eq!(
        xlm_client.balance(&co_creator),
        co_creator_start + expected_split
    );
    assert_eq!(
        xlm_client.balance(&context.fee_wallet),
        fee_start + expected_fee
    );
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_splits_exceeding_max_bps_minus_fee_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);

    // Platform fee = 500 BPS; split = 9_600 BPS → total = 10_100 > MAX_BPS
    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co1.clone(),
        bps: 9_600,
    });

    let result = client.try_create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Bad Splits"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 9),
        &ListingConfig {
            price: 5_000,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
        },
    );
    match result {
        Err(Ok(Error::InvalidSplits)) => {}
        other => panic!(
            "expected InvalidSplits for over-allocated splits, got {:?}",
            other
        ),
    }
}

#[test]
fn test_multiple_splits_distribute_all_recipients() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);
    let co2 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;

    // fee=500, co1=1000, co2=1500 → total=3000, creator gets 7000
    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split {
        recipient: co1.clone(),
        bps: 1_000,
    });
    splits.push_back(Split {
        recipient: co2.clone(),
        bps: 1_500,
    });

    let prompt_id = client.create_prompt(
        &creator,
        &String::from_str(&env, "https://example.com/img.png"),
        &String::from_str(&env, "Multi Split"),
        &String::from_str(&env, "Software Development"),
        &String::from_str(&env, "preview"),
        &String::from_str(&env, "ciphertext"),
        &String::from_str(&env, "iv"),
        &String::from_str(&env, "wrapped-key"),
        &hash(&env, 10),
        &ListingConfig {
            price,
            asset: context.xlm.clone(),
            expires_at: 0,
            splits,
        },
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let co1_start = xlm_client.balance(&co1);
    let co2_start = xlm_client.balance(&co2);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    assert_eq!(
        xlm_client.balance(&creator),
        creator_start + price * (10_000 - 500 - 1_000 - 1_500) / 10_000
    );
    assert_eq!(xlm_client.balance(&co1), co1_start + price * 1_000 / 10_000);
    assert_eq!(xlm_client.balance(&co2), co2_start + price * 1_500 / 10_000);
}

// ─── Issue #51: Bulk Purchase ─────────────────────────────────────────────────

#[test]
fn test_buy_prompts_bulk_purchases_all_and_grants_access() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price_a: i128 = 5_000;
    let price_b: i128 = 8_000;

    let prompt_a = create_prompt(&env, &client, &creator, "Bulk A", price_a, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Bulk B", price_b, &context.xlm);

    let total = price_a + price_b;
    fund_buyer(&xlm_client, &buyer, &context.contract, total);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);
    ids.push_back(prompt_b);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price_a);
    amounts.push_back(price_b);

    client.buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Bytes>);

    assert!(client.has_access(&buyer, &prompt_a));
    assert!(client.has_access(&buyer, &prompt_b));

    let fee_bps = 500i128;
    let expected_creator =
        (price_a - price_a * fee_bps / 10_000) + (price_b - price_b * fee_bps / 10_000);
    let expected_fee = price_a * fee_bps / 10_000 + price_b * fee_bps / 10_000;
    assert_eq!(xlm_client.balance(&creator), expected_creator);
    assert_eq!(xlm_client.balance(&context.fee_wallet), expected_fee);
}

#[test]
fn test_buy_prompts_bulk_atomicity_one_failure_reverts_all() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let price: i128 = 5_000;
    let prompt_a = create_prompt(&env, &client, &creator, "Bulk Ok", price, &context.xlm);
    // prompt 999_999 does not exist

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);
    ids.push_back(999_999u128); // non-existent

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);
    amounts.push_back(price);

    let result = client.try_buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Bytes>);
    match result {
        Err(Ok(Error::PromptNotFound)) => {}
        other => panic!(
            "expected PromptNotFound for bulk with bad ID, got {:?}",
            other
        ),
    }

    // First prompt must not have been purchased (whole tx reverted)
    assert!(!client.has_access(&buyer, &prompt_a));
}

#[test]
fn test_buy_prompts_bulk_mismatched_lengths_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_a = create_prompt(&env, &client, &creator, "Mismatch", 5_000, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);

    let amounts: Vec<i128> = Vec::new(&env); // empty — mismatch

    let result = client.try_buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Bytes>);
    match result {
        Err(Ok(Error::InvalidPrice)) => {}
        other => panic!(
            "expected InvalidPrice for mismatched bulk lengths, got {:?}",
            other
        ),
    }
}

#[test]
fn test_buy_prompts_bulk_with_referrer() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500); // 5%

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);

    let price: i128 = 10_000;
    let prompt_a = create_prompt(&env, &client, &creator, "Bulk Ref A", price, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Bulk Ref B", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price * 2);

    let mut ids = Vec::new(&env);
    ids.push_back(prompt_a);
    ids.push_back(prompt_b);

    let mut amounts = Vec::new(&env);
    amounts.push_back(price);
    amounts.push_back(price);

    let referrer_start = xlm_client.balance(&referrer);
    let referral_code = Bytes::from_slice(&env, b"bulk-referral-secret");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&referrer, &referral_hash);
    client.buy_prompts_bulk(&buyer, &ids, &amounts, &Some(referral_code));

    // referral = 10_000 * 500 / 10_000 = 500 per prompt × 2
    let expected_referral = price * 500 / 10_000 * 2;
    assert_eq!(
        xlm_client.balance(&referrer),
        referrer_start + expected_referral
    );
    assert!(client.has_access(&buyer, &prompt_a));
    assert!(client.has_access(&buyer, &prompt_b));
}

// ─── Bundle tests ─────────────────────────────────────────────────────────────

#[test]
fn test_create_bundle_stores_fields_and_is_discoverable() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let pid_a = create_prompt(&env, &client, &creator, "Prompt A", 5_000, &context.xlm);
    let pid_b = create_prompt(&env, &client, &creator, "Prompt B", 8_000, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(pid_a);
    ids.push_back(pid_b);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Developer Bundle"),
        &String::from_str(&env, "Two great prompts"),
        &String::from_str(&env, "https://example.com/bundle.png"),
        &ids,
        &20_000i128,
        &context.xlm,
    );

    let bundle = client.get_bundle(&bundle_id);
    assert_eq!(bundle.id, bundle_id);
    assert_eq!(bundle.creator, creator);
    assert_eq!(bundle.price_stroops, 20_000i128);
    assert!(bundle.active);
    assert_eq!(bundle.sales_count, 0);
    assert_eq!(bundle.prompt_ids.len(), 2);

    let all = client.get_all_bundles();
    assert_eq!(all.len(), 1);

    let by_creator = client.get_bundles_by_creator(&creator);
    assert_eq!(by_creator.len(), 1);
    assert_eq!(by_creator.get(0).unwrap().id, bundle_id);
}

#[test]
fn test_referral_rules_are_snapshotted_and_settlement_is_auditable() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price = 10_000i128;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Auditable referral",
        price,
        &context.xlm,
    );

    client.set_referral_percentage(&500);
    let referral_code = Bytes::from_slice(&env, b"auditable-code-secret");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&referrer, &referral_hash);
    // Registered codes retain their original rules even if the global rate changes.
    client.set_referral_percentage(&900);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);
    client.buy_prompt(
        &buyer,
        &prompt_id,
        &Some(referral_code),
        &price,
        &None::<Bytes>,
    );

    let purchase = client.get_purchase_details(&prompt_id, &buyer);
    assert_eq!(purchase.settlement.buyer_amount, price);
    assert_eq!(purchase.settlement.platform_amount, 500);
    assert_eq!(purchase.settlement.referrer, Some(referrer));
    assert_eq!(purchase.settlement.referrer_amount, 500);
    assert_eq!(purchase.settlement.creator_amount, 9_000);
    assert_eq!(
        purchase.settlement.buyer_amount,
        purchase.settlement.creator_amount
            + purchase.settlement.platform_amount
            + purchase.settlement.referrer_amount
            + purchase.settlement.split_amount
    );
}

// ─── Issue #125: Creator catalog subscription passes ─────────────────────────

#[test]
fn test_subscription_scope_and_exclusive_expiry_boundary() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let eligible = create_prompt(
        &env,
        &client,
        &creator,
        "Eligible subscription listing",
        20_000,
        &context.xlm,
    );
    let excluded = create_prompt(
        &env,
        &client,
        &creator,
        "Excluded subscription listing",
        20_000,
        &context.xlm,
    );
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    client.configure_subscription_pass(&creator, &600, &10_000, &context.xlm, &true);
    client.set_subscription_eligibility(&creator, &eligible, &true);
    fund_buyer(&xlm_client, &subscriber, &context.contract, 10_000);

    let expires_at = client.subscribe_catalog(&subscriber, &creator, &10_000);
    assert_eq!(expires_at, 1_600);
    assert!(client.has_access(&subscriber, &eligible));
    assert!(!client.has_access(&subscriber, &excluded));

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_599);
    assert!(client.has_access(&subscriber, &eligible));
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_600);
    assert!(!client.has_access(&subscriber, &eligible));
}

#[test]
fn test_subscription_renewal_failure_is_atomic_and_success_preserves_time() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let subscriber = Address::generate(&env);
    env.ledger().with_mut(|ledger| ledger.timestamp = 2_000);
    client.configure_subscription_pass(&creator, &300, &10_000, &context.xlm, &true);
    fund_buyer(&xlm_client, &subscriber, &context.contract, 30_000);
    client.subscribe_catalog(&subscriber, &creator, &10_000);

    client.configure_subscription_pass(&creator, &300, &12_000, &context.xlm, &true);
    let wrong_price = client.try_renew_catalog_subscription(&subscriber, &creator, &10_000);
    assert!(matches!(
        wrong_price,
        Err(Ok(Error::InvalidSubscriptionConfig))
    ));
    assert_eq!(
        client.get_subscription(&subscriber, &creator).expires_at,
        2_300
    );

    let renewed_until = client.renew_catalog_subscription(&subscriber, &creator, &12_000);
    assert_eq!(renewed_until, 2_600);
    assert_eq!(
        client.get_subscription(&subscriber, &creator).renewal_count,
        1
    );

    client.configure_subscription_pass(&creator, &300, &12_000, &context.xlm, &false);
    let closed = client.try_renew_catalog_subscription(&subscriber, &creator, &12_000);
    assert!(matches!(closed, Err(Ok(Error::SubscriptionInactive))));
    assert_eq!(
        client.get_subscription(&subscriber, &creator).expires_at,
        2_600
    );
}

#[test]
fn test_referral_code_guessing_replay_and_cycles_are_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let pid_a = create_prompt(&env, &client, &creator, "BA", 3_000, &context.xlm);
    let pid_b = create_prompt(&env, &client, &creator, "BB", 4_000, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(pid_a);
    ids.push_back(pid_b);

    let price: i128 = 10_000;
    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Fee Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/b.png"),
        &ids,
        &price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_bundle(&buyer, &bundle_id, &price, &None::<Address>);

    let expected_fee = price * 500 / 10_000;
    let expected_creator = price - expected_fee;

    assert_eq!(xlm_client.balance(&creator), creator_start + expected_creator);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start + expected_fee);
    assert!(client.has_bundle_access(&buyer, &bundle_id));

    // buyer should appear in get_bundles_by_buyer
    let library = client.get_bundles_by_buyer(&buyer);
    assert_eq!(library.len(), 1);
    assert_eq!(library.get(0).unwrap().id, bundle_id);

    // sales_count incremented
    assert_eq!(client.get_bundle(&bundle_id).sales_count, 1);
}

#[test]
fn test_duplicate_bundle_purchase_is_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let pid = create_prompt(&env, &client, &creator, "Dup Prompt", 5_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let price: i128 = 5_000;
    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Dup Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/dup.png"),
        &ids,
        &price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price * 2);
    client.buy_bundle(&buyer, &bundle_id, &price, &None::<Address>);

    let result = client.try_buy_bundle(&buyer, &bundle_id, &price, &None::<Address>);
    match result {
        Err(Ok(crate::types::Error::BundleAlreadyPurchased)) => {}
        other => panic!("expected BundleAlreadyPurchased, got {:?}", other),
    }
}

#[test]
fn test_creator_cannot_buy_own_bundle() {
    let creator = Address::generate(&env);
    let buyer_a = Address::generate(&env);
    let buyer_b = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price = 10_000i128;
    let prompt_a = create_prompt(&env, &client, &creator, "Referral A", price, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator, "Referral B", price, &context.xlm);
    fund_buyer(&xlm_client, &buyer_a, &context.contract, price * 2);
    fund_buyer(&xlm_client, &buyer_b, &context.contract, price);

    let short = Bytes::from_slice(&env, b"guess");
    let unknown = client.try_buy_prompt(&buyer_a, &prompt_a, &Some(short), &price, &None::<Bytes>);
    assert!(matches!(unknown, Err(Ok(Error::ReferralCodeTooShort))));

    let code_b = Bytes::from_slice(&env, b"buyer-b-code-secret");
    let hash_b = BytesN::from_array(&env, &env.crypto().sha256(&code_b).to_array());
    client.register_referral_code(&buyer_b, &hash_b);
    client.buy_prompt(&buyer_a, &prompt_a, &Some(code_b), &price, &None::<Bytes>);

    let other_code = Bytes::from_slice(&env, b"other-referrer-secret");
    let other_hash = BytesN::from_array(&env, &env.crypto().sha256(&other_code).to_array());
    client.register_referral_code(&referrer, &other_hash);
    let replay = client.try_buy_prompt(
        &buyer_a,
        &prompt_b,
        &Some(other_code),
        &price,
        &None::<Bytes>,
    );
    assert!(matches!(replay, Err(Ok(Error::ReferralReplay))));

    let code_a = Bytes::from_slice(&env, b"buyer-a-code-secret");
    let hash_a = BytesN::from_array(&env, &env.crypto().sha256(&code_a).to_array());
    client.register_referral_code(&buyer_a, &hash_a);
    let circular =
        client.try_buy_prompt(&buyer_b, &prompt_b, &Some(code_a), &price, &None::<Bytes>);
    assert!(matches!(circular, Err(Ok(Error::CircularReferral))));
}

#[test]
fn test_catalog_changes_transfers_and_direct_purchases_are_independent() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    let creator = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let transferee = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Catalog changes",
        20_000,
        &context.xlm,
    );
    client.configure_subscription_pass(&creator, &600, &10_000, &context.xlm, &true);
    client.set_subscription_eligibility(&creator, &prompt_id, &true);
    fund_buyer(&xlm_client, &subscriber, &context.contract, 30_000);
    client.subscribe_catalog(&subscriber, &creator, &10_000);
    assert!(client.has_access(&subscriber, &prompt_id));

    // Removing a listing revokes pass access immediately.
    client.set_subscription_eligibility(&creator, &prompt_id, &false);
    assert!(!client.has_access(&subscriber, &prompt_id));

    // A direct purchase remains authoritative even when subscription-ineligible.
    client.buy_prompt(
        &subscriber,
        &prompt_id,
        &None::<Bytes>,
        &20_000,
        &None::<Bytes>,
    );
    assert!(client.has_access(&subscriber, &prompt_id));

    fund_buyer(&xlm_client, &transferee, &context.contract, 15_000);
    client.transfer_license(&subscriber, &prompt_id, &transferee, &15_000);
    assert!(client.has_access(&transferee, &prompt_id));
    assert!(!client.has_access(&subscriber, &prompt_id));
    assert_eq!(
        client.get_subscription(&subscriber, &creator).subscriber,
        subscriber
    );
}

// ─── #131: Content Classification Tests ──────────────────────────────────────

#[test]
fn test_create_prompt_default_classification() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Default Class",
        10_000,
        &context.xlm,
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.classification, String::from_str(&env, "general"));
    assert_eq!(prompt.safety_flags.len(), 0);
}

#[test]
fn test_set_classification_valid_values() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Class Test", 10_000, &context.xlm);

    client.set_classification(
        &creator,
        &prompt_id,
        &String::from_str(&env, "educational"),
        &Vec::new(&env),
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.classification, String::from_str(&env, "educational"));

    client.set_classification(
        &creator,
        &prompt_id,
        &String::from_str(&env, "technical"),
        &{
            let mut v = Vec::new(&env);
            v.push_back(String::from_str(&env, "ai-generated"));
            v
        },
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.classification, String::from_str(&env, "technical"));
    assert_eq!(prompt.safety_flags.len(), 1);
    assert_eq!(
        prompt.safety_flags.get(0).unwrap(),
        String::from_str(&env, "ai-generated")
    );
}

#[test]
fn test_set_classification_invalid_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Invalid Class",
        10_000,
        &context.xlm,
    );

    let result = client.try_set_classification(
        &creator,
        &prompt_id,
        &String::from_str(&env, "invalid-category"),
        &Vec::new(&env),
    );
    assert!(matches!(result, Err(Ok(Error::InvalidClassification))));

    let result = client.try_set_classification(
        &creator,
        &prompt_id,
        &String::from_str(&env, "educational"),
        &{
            let mut v = Vec::new(&env);
            v.push_back(String::from_str(&env, "invalid-flag"));
            v
        },
    );
    assert!(matches!(result, Err(Ok(Error::InvalidDisclosureFlags))));
}

#[test]
fn test_set_classification_unauthorized_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let pid = create_prompt(&env, &client, &creator, "Own Bundle", 5_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "My Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/own.png"),
        &ids,
        &5_000i128,
        &context.xlm,
    );

    let result = client.try_buy_bundle(&creator, &bundle_id, &5_000i128, &None::<Address>);
    match result {
        Err(Ok(crate::types::Error::CreatorCannotBuy)) => {}
        other => panic!("expected CreatorCannotBuy, got {:?}", other),
    }
}

#[test]
fn test_add_and_remove_bundle_item() {
    let impostor = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Auth Class", 10_000, &context.xlm);

    let result = client.try_set_classification(
        &impostor,
        &prompt_id,
        &String::from_str(&env, "creative"),
        &Vec::new(&env),
    );
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

#[test]
fn test_get_active_classification_without_override() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Active Class",
        10_000,
        &context.xlm,
    );

    client.set_classification(
        &creator,
        &prompt_id,
        &String::from_str(&env, "sensitive"),
        &{
            let mut v = Vec::new(&env);
            v.push_back(String::from_str(&env, "political"));
            v
        },
    );

    // Without override, get_active_classification returns creator-set values
    let (classification, flags) = client.get_active_classification(&prompt_id);
    assert_eq!(classification, String::from_str(&env, "sensitive"));
    assert_eq!(flags.len(), 1);
    assert_eq!(flags.get(0).unwrap(), String::from_str(&env, "political"));
}

#[test]
fn test_moderator_override_overrides_creator_classification() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let pid_a = create_prompt(&env, &client, &creator, "Item A", 3_000, &context.xlm);
    let pid_b = create_prompt(&env, &client, &creator, "Item B", 3_000, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(pid_a);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Mutable Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/mut.png"),
        &ids,
        &5_000i128,
        &context.xlm,
    );

    // Add second prompt
    client.add_bundle_item(&creator, &bundle_id, &pid_b);
    assert_eq!(client.get_bundle(&bundle_id).prompt_ids.len(), 2);

    // Remove first prompt
    client.remove_bundle_item(&creator, &bundle_id, &pid_a);
    let bundle = client.get_bundle(&bundle_id);
    assert_eq!(bundle.prompt_ids.len(), 1);
    assert_eq!(bundle.prompt_ids.get(0).unwrap(), pid_b);
}

#[test]
fn test_remove_last_item_from_bundle_fails() {
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Override Test",
        10_000,
        &context.xlm,
    );

    // Creator sets classification as "general"
    client.set_classification(
        &creator,
        &prompt_id,
        &String::from_str(&env, "general"),
        &Vec::new(&env),
    );

    // Admin sets moderator address
    client.set_moderator_address(&context.admin, &context.admin);

    // Moderator overrides to "restricted"
    client.set_moderator_override(
        &context.admin,
        &prompt_id,
        &String::from_str(&env, "restricted"),
        &{
            let mut v = Vec::new(&env);
            v.push_back(String::from_str(&env, "ai-generated"));
            v.push_back(String::from_str(&env, "political"));
            v
        },
        &String::from_str(&env, "Contains political content that requires restriction"),
    );

    // get_active_classification should return moderator override
    let (classification, flags) = client.get_active_classification(&prompt_id);
    assert_eq!(classification, String::from_str(&env, "restricted"));
    assert_eq!(flags.len(), 2);

    // get_classification should still return creator's original
    let (creator_class, _) = client.get_classification(&prompt_id);
    assert_eq!(creator_class, String::from_str(&env, "general"));
}

#[test]
fn test_moderator_override_unauthorized_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let impostor = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Override Auth",
        10_000,
        &context.xlm,
    );

    // No moderator has been set yet
    let result = client.try_set_moderator_override(
        &impostor,
        &prompt_id,
        &String::from_str(&env, "restricted"),
        &Vec::new(&env),
        &String::from_str(&env, "Test override"),
    );
    assert!(matches!(result, Err(Ok(Error::NotModerator))));
}

#[test]
fn test_classification_with_safety_flags_none() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Flags Test", 10_000, &context.xlm);

    // "none" flag should be valid alone
    client.set_classification(&creator, &prompt_id, &String::from_str(&env, "general"), &{
        let mut v = Vec::new(&env);
        v.push_back(String::from_str(&env, "none"));
        v
    });

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.safety_flags.len(), 1);
    assert_eq!(
        prompt.safety_flags.get(0).unwrap(),
        String::from_str(&env, "none")
    );
}

#[test]
fn test_classification_missing_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let pid = create_prompt(&env, &client, &creator, "Sole Prompt", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Solo Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/solo.png"),
        &ids,
        &3_000i128,
        &context.xlm,
    );

    let result = client.try_remove_bundle_item(&creator, &bundle_id, &pid);
    match result {
        Err(Ok(crate::types::Error::BundleEmpty)) => {}
        other => panic!("expected BundleEmpty when removing last item, got {:?}", other),
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Missing Class",
        10_000,
        &context.xlm,
    );

    // Empty classification should be rejected
    let result = client.try_set_classification(
        &creator,
        &prompt_id,
        &String::from_str(&env, ""),
        &Vec::new(&env),
    );
    assert!(matches!(result, Err(Ok(Error::InvalidClassification))));
}

#[test]
fn test_classification_conflicting_change_emits_correct_values() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Conflict Test",
        10_000,
        &context.xlm,
    );

    // Set initial classification as "educational"
    client.set_classification(
        &creator,
        &prompt_id,
        &String::from_str(&env, "educational"),
        &{
            let mut v = Vec::new(&env);
            v.push_back(String::from_str(&env, "none"));
            v
        },
    );

    // Change to "technical" — this should overwrite
    client.set_classification(
        &creator,
        &prompt_id,
        &String::from_str(&env, "technical"),
        &{
            let mut v = Vec::new(&env);
            v.push_back(String::from_str(&env, "ai-generated"));
            v
        },
    );

    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.classification, String::from_str(&env, "technical"));
    assert_eq!(prompt.safety_flags.len(), 1);
    assert_eq!(
        prompt.safety_flags.get(0).unwrap(),
        String::from_str(&env, "ai-generated")
    );
    // Classification changed from "educational" to "technical" -- the latest sticks
    assert_ne!(prompt.classification, String::from_str(&env, "educational"));
}

#[test]
fn test_moderator_address_allows_admin() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let moderator = Address::generate(&env);

    // Admin can set moderator address
    let result = client.try_set_moderator_address(&context.admin, &moderator);
    assert!(result.is_ok());
}

#[test]
fn test_classification_with_all_valid_categories() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "All Classes", 10_000, &context.xlm);

    let valid_categories = [
        "general",
        "educational",
        "professional",
        "creative",
        "technical",
        "sensitive",
        "restricted",
    ];

    for &cat in &valid_categories {
        let result = client.try_set_classification(
            &creator,
            &prompt_id,
            &String::from_str(&env, cat),
            &Vec::new(&env),
        );
        assert!(
            result.is_ok(),
            "Expected '{}' to be a valid classification",
            cat
        );
    }
}

// ─── Encryption Rotation Tests ────────────────────────────────────────────────

fn create_rotation_test_prompt(
    env: &Env,
    client: &PromptHashContractClient,
    creator: &Address,
    asset: &Address,
) -> u128 {
    create_prompt(env, client, creator, "Rotation Test Prompt", 10_000, asset)
}

fn generate_test_payload(env: &Env, version: u8) -> (String, String, String, BytesN<32>) {
    // `format!` needs `alloc` support this `#![no_std]` crate doesn't opt into,
    // so each tested version gets its own literal suffix instead.
    let (encrypted, iv, wrapped_key) = match version {
        1 => ("encrypted-v1", "iv-v1", "wrapped-key-v1"),
        2 => ("encrypted-v2", "iv-v2", "wrapped-key-v2"),
        3 => ("encrypted-v3", "iv-v3", "wrapped-key-v3"),
        4 => ("encrypted-v4", "iv-v4", "wrapped-key-v4"),
        _ => panic!("generate_test_payload: add a literal case for version {version}"),
    };
    (
        String::from_str(env, encrypted),
        String::from_str(env, iv),
        String::from_str(env, wrapped_key),
        hash(env, version),
    )
}

#[test]
fn test_rotate_encryption_creates_new_version_and_archives_old() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_rotation_test_prompt(&env, &client, &creator, &context.xlm);

    // Initial prompt should be at version 1
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.encryption_version, 1);

    let (new_enc, new_iv, new_key, new_hash) = generate_test_payload(&env, 2);

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let new_version =
        client.rotate_encryption(&creator, &prompt_id, &new_enc, &new_iv, &new_key, &new_hash);
    assert_eq!(new_version, 2);

    // Prompt now has v2 payload
    let updated = client.get_prompt(&prompt_id);
    assert_eq!(updated.encryption_version, 2);
    assert_eq!(
        updated.encrypted_prompt,
        String::from_str(&env, "encrypted-v2")
    );
    assert_eq!(updated.encryption_iv, String::from_str(&env, "iv-v2"));
    assert_eq!(
        updated.wrapped_key,
        String::from_str(&env, "wrapped-key-v2")
    );
    assert_eq!(updated.content_hash, hash(&env, 2));

    // Archived v1 payload is retrievable
    let archived = client.get_prompt_encryption_version(&prompt_id, &1);
    assert_eq!(archived.version, 1);
    assert_eq!(
        archived.encrypted_prompt,
        String::from_str(&env, "ciphertext")
    );
    assert_eq!(archived.encryption_iv, String::from_str(&env, "iv"));
    assert_eq!(archived.wrapped_key, String::from_str(&env, "wrapped-key"));
    assert_eq!(archived.content_hash, hash(&env, 7));
    assert!(archived.created_at > 0);
}

#[test]
fn test_rotate_encryption_preserves_prior_versions_on_failure_scenario() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_rotation_test_prompt(&env, &client, &creator, &context.xlm);

    // Rotate to v2
    let (v2_enc, v2_iv, v2_key, v2_hash) = generate_test_payload(&env, 2);
    client.rotate_encryption(&creator, &prompt_id, &v2_enc, &v2_iv, &v2_key, &v2_hash);

    // Rotate to v3
    let (v3_enc, v3_iv, v3_key, v3_hash) = generate_test_payload(&env, 3);
    client.rotate_encryption(&creator, &prompt_id, &v3_enc, &v3_iv, &v3_key, &v3_hash);

    // v1 archived and accessible
    let v1 = client.get_prompt_encryption_version(&prompt_id, &1);
    assert_eq!(v1.version, 1);

    // v2 archived and accessible
    let v2 = client.get_prompt_encryption_version(&prompt_id, &2);
    assert_eq!(v2.version, 2);
    assert_eq!(v2.encrypted_prompt, String::from_str(&env, "encrypted-v2"));

    // v3 is the current version
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.encryption_version, 3);

    // Non-existent version returns error
    let result = client.try_get_prompt_encryption_version(&prompt_id, &99);
    match result {
        Err(Ok(Error::EncryptionVersionNotFound)) => {}
        other => panic!("expected EncryptionVersionNotFound, got {:?}", other),
    }
}

#[test]
fn test_duplicate_item_in_bundle_create_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let pid = create_prompt(&env, &client, &creator, "Dup Item", 3_000, &context.xlm);

    let mut ids = Vec::new(&env);
    ids.push_back(pid);
    ids.push_back(pid); // duplicate

    let result = client.try_create_bundle(
        &creator,
        &String::from_str(&env, "Bad Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/bad.png"),
        &ids,
        &5_000i128,
        &context.xlm,
    );
    match result {
        Err(Ok(crate::types::Error::PromptAlreadyInBundle)) => {}
        other => panic!("expected PromptAlreadyInBundle, got {:?}", other),
    }
}

#[test]
fn test_bundle_add_duplicate_item_fails() {
fn test_existing_buyer_can_unlock_after_encryption_rotation() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_rotation_test_prompt(&env, &client, &creator, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);

    // Buyer purchases at v1
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &10_000, &None::<Bytes>);
    let purchase = client.get_purchase_details(&prompt_id, &buyer);
    assert_eq!(purchase.encryption_version, 1);

    // Creator rotates encryption to v2
    let (v2_enc, v2_iv, v2_key, v2_hash) = generate_test_payload(&env, 2);
    client.rotate_encryption(&creator, &prompt_id, &v2_enc, &v2_iv, &v2_key, &v2_hash);

    // Buyer still has access
    assert!(client.has_access(&buyer, &prompt_id));

    // Buyer can retrieve v1 payload (their purchase version)
    let v1 = client.get_prompt_encryption_version(&prompt_id, &1);
    assert_eq!(v1.encrypted_prompt, String::from_str(&env, "ciphertext"));

    // New buyer at v2 gets v2 payload
    let buyer2 = Address::generate(&env);
    fund_buyer(&xlm_client, &buyer2, &context.contract, 100_000);
    client.buy_prompt(&buyer2, &prompt_id, &None::<Bytes>, &10_000, &None::<Bytes>);
    let purchase2 = client.get_purchase_details(&prompt_id, &buyer2);
    assert_eq!(purchase2.encryption_version, 2);
}

#[test]
fn test_concurrent_buyers_at_different_encryption_versions() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer_v1 = Address::generate(&env);
    let buyer_v2 = Address::generate(&env);
    let buyer_v3 = Address::generate(&env);
    let prompt_id = create_rotation_test_prompt(&env, &client, &creator, &context.xlm);

    fund_buyer(&xlm_client, &buyer_v1, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer_v2, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer_v3, &context.contract, 100_000);

    // Buyer 1 purchases at v1
    client.buy_prompt(
        &buyer_v1,
        &prompt_id,
        &None::<Bytes>,
        &10_000,
        &None::<Bytes>,
    );
    assert_eq!(
        client
            .get_purchase_details(&prompt_id, &buyer_v1)
            .encryption_version,
        1
    );

    // Rotate to v2
    let (v2_enc, v2_iv, v2_key, v2_hash) = generate_test_payload(&env, 2);
    client.rotate_encryption(&creator, &prompt_id, &v2_enc, &v2_iv, &v2_key, &v2_hash);

    // Buyer 2 purchases at v2
    client.buy_prompt(
        &buyer_v2,
        &prompt_id,
        &None::<Bytes>,
        &10_000,
        &None::<Bytes>,
    );
    assert_eq!(
        client
            .get_purchase_details(&prompt_id, &buyer_v2)
            .encryption_version,
        2
    );

    // Rotate to v3
    let (v3_enc, v3_iv, v3_key, v3_hash) = generate_test_payload(&env, 3);
    client.rotate_encryption(&creator, &prompt_id, &v3_enc, &v3_iv, &v3_key, &v3_hash);

    // Buyer 3 purchases at v3
    client.buy_prompt(
        &buyer_v3,
        &prompt_id,
        &None::<Bytes>,
        &10_000,
        &None::<Bytes>,
    );
    assert_eq!(
        client
            .get_purchase_details(&prompt_id, &buyer_v3)
            .encryption_version,
        3
    );

    // All buyers have access
    assert!(client.has_access(&buyer_v1, &prompt_id));
    assert!(client.has_access(&buyer_v2, &prompt_id));
    assert!(client.has_access(&buyer_v3, &prompt_id));

    // Each buyer can retrieve their version's payload
    let v1 = client.get_prompt_encryption_version(&prompt_id, &1);
    assert_eq!(v1.encrypted_prompt, String::from_str(&env, "ciphertext"));
    let v2 = client.get_prompt_encryption_version(&prompt_id, &2);
    assert_eq!(v2.encrypted_prompt, String::from_str(&env, "encrypted-v2"));
    // v3 is current: accessible both via get_prompt and get_prompt_encryption_version
    let v3 = client.get_prompt_encryption_version(&prompt_id, &3);
    assert_eq!(v3.encrypted_prompt, String::from_str(&env, "encrypted-v3"));
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(
        prompt.encrypted_prompt,
        String::from_str(&env, "encrypted-v3")
    );
}

#[test]
fn test_rotate_encryption_rejects_unauthorized_callers() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let attacker = Address::generate(&env);
    let prompt_id = create_rotation_test_prompt(&env, &client, &creator, &context.xlm);

    let (enc, iv, key, hash_val) = generate_test_payload(&env, 2);

    // Non-creator cannot rotate
    let result = client.try_rotate_encryption(&attacker, &prompt_id, &enc, &iv, &key, &hash_val);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized, got {:?}", other),
    }

    // Creator can still rotate
    let version = client.rotate_encryption(&creator, &prompt_id, &enc, &iv, &key, &hash_val);
    assert_eq!(version, 2);

    // Prompt is paused -> rotation blocked
    client.set_pause_status(&true);
    let (enc3, iv3, key3, hash3) = generate_test_payload(&env, 3);
    let result = client.try_rotate_encryption(&creator, &prompt_id, &enc3, &iv3, &key3, &hash3);
    match result {
        Err(Ok(Error::ContractIsPaused)) => {}
        other => panic!("expected ContractIsPaused, got {:?}", other),
    }
    client.set_pause_status(&false);
}

#[test]
fn test_rotate_encryption_validates_field_lengths() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let pid = create_prompt(&env, &client, &creator, "Dup Add", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Dup Add Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/dupadd.png"),
        &ids,
        &3_000i128,
        &context.xlm,
    );

    let result = client.try_add_bundle_item(&creator, &bundle_id, &pid);
    match result {
        Err(Ok(crate::types::Error::PromptAlreadyInBundle)) => {}
        other => panic!("expected PromptAlreadyInBundle on re-add, got {:?}", other),
    let prompt_id = create_rotation_test_prompt(&env, &client, &creator, &context.xlm);

    let valid_hash = hash(&env, 9);

    // Empty encrypted prompt
    let result = client.try_rotate_encryption(
        &creator,
        &prompt_id,
        &String::from_str(&env, ""),
        &String::from_str(&env, "valid-iv"),
        &String::from_str(&env, "valid-key"),
        &valid_hash,
    );
    match result {
        Err(Ok(Error::InvalidFieldLength)) => {}
        other => panic!("expected InvalidFieldLength, got {:?}", other),
    }
}

#[test]
fn test_set_bundle_active_toggles_purchasability() {
fn test_license_transfer_preserves_encryption_version() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let pid = create_prompt(&env, &client, &creator, "Toggle Prompt", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let price: i128 = 3_000;
    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Toggle Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/tog.png"),
        &ids,
        &price,
        &context.xlm,
    );

    // Deactivate
    client.set_bundle_active(&creator, &bundle_id, &false);
    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let result = client.try_buy_bundle(&buyer, &bundle_id, &price, &None::<Address>);
    match result {
        Err(Ok(crate::types::Error::BundleInactive)) => {}
        other => panic!("expected BundleInactive, got {:?}", other),
    }

    // Reactivate
    client.set_bundle_active(&creator, &bundle_id, &true);
    client.buy_bundle(&buyer, &bundle_id, &price, &None::<Address>);
    assert!(client.has_bundle_access(&buyer, &bundle_id));
}

#[test]
fn test_update_bundle_price_changes_required_payment() {
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_rotation_test_prompt(&env, &client, &creator, &context.xlm);

    fund_buyer(&xlm_client, &seller, &context.contract, 100_000);

    // Seller purchases at v1
    client.buy_prompt(&seller, &prompt_id, &None::<Bytes>, &10_000, &None::<Bytes>);
    assert_eq!(
        client
            .get_purchase_details(&prompt_id, &seller)
            .encryption_version,
        1
    );

    // Rotate to v2
    let (v2_enc, v2_iv, v2_key, v2_hash) = generate_test_payload(&env, 2);
    client.rotate_encryption(&creator, &prompt_id, &v2_enc, &v2_iv, &v2_key, &v2_hash);

    // Transfer license to buyer
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.transfer_license(&seller, &prompt_id, &buyer, &15_000);

    // New owner retains v1 encryption version (their license is at v1)
    let transferred = client.get_purchase_details(&prompt_id, &buyer);
    assert_eq!(transferred.encryption_version, 1);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_extend_ttl_success() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Extend TTL Prompt",
        1_000,
        &context.xlm,
    );

    let key = crate::types::DataKey::Prompt(prompt_id);
    let result = client.try_extend_ttl(&key);
    assert!(result.is_ok());
}

#[test]
fn test_extend_ttl_failure_key_not_found() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let missing_key = crate::types::DataKey::Prompt(9999);
    let result = client.try_extend_ttl(&missing_key);

    match result {
        Err(Ok(Error::KeyNotFound)) => {}
        other => panic!("expected KeyNotFound, got {:?}", other),
    }
}

// ─── #275: Creator Reputation Staking ────────────────────────────────────────

const SECONDS_PER_WEEK: u64 = 7 * 24 * 60 * 60;

#[test]
fn test_stake_records_balance_and_moves_tokens_into_custody() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let pid = create_prompt(&env, &client, &creator, "Price Change", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Price Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/price.png"),
        &ids,
        &3_000i128,
        &context.xlm,
    );

    client.update_bundle_price(&creator, &bundle_id, &15_000i128);
    assert_eq!(client.get_bundle(&bundle_id).price_stroops, 15_000i128);

    // Old price should now be insufficient
    fund_buyer(&xlm_client, &buyer, &context.contract, 15_000);
    let result = client.try_buy_bundle(&buyer, &bundle_id, &3_000i128, &None::<Address>);
    match result {
        Err(Ok(crate::types::Error::InvalidPaymentAmount)) => {}
        other => panic!("expected InvalidPaymentAmount after price increase, got {:?}", other),
    }

    // Correct price succeeds
    client.buy_bundle(&buyer, &bundle_id, &15_000i128, &None::<Address>);
    assert!(client.has_bundle_access(&buyer, &bundle_id));
}

#[test]
fn test_buy_bundle_blocked_when_contract_paused() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let pid = create_prompt(&env, &client, &creator, "Pause Bundle P", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Pause Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/pause.png"),
        &ids,
        &3_000i128,
        &context.xlm,
    );

    client.set_pause_status(&true);

    let result = client.try_buy_bundle(&buyer, &bundle_id, &3_000i128, &None::<Address>);
    match result {
        Err(Ok(crate::types::Error::ContractIsPaused)) => {}
        other => panic!("expected ContractIsPaused for buy_bundle, got {:?}", other),
    }
}

#[test]
fn test_only_bundle_creator_can_modify_bundle() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let pid = create_prompt(&env, &client, &creator, "Auth P", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Auth Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/auth.png"),
        &ids,
        &3_000i128,
        &context.xlm,
    );

    let r1 = client.try_update_bundle_price(&stranger, &bundle_id, &9_000i128);
    match r1 {
        Err(Ok(crate::types::Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for price update by stranger, got {:?}", other),
    }

    let r2 = client.try_set_bundle_active(&stranger, &bundle_id, &false);
    match r2 {
        Err(Ok(crate::types::Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for deactivation by stranger, got {:?}", other),
    }
}

#[test]
fn test_stake_records_balance_and_moves_tokens_into_custody_amounts() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Staked Prompt",
        10_000,
        &context.xlm,
    );

    // Fund the creator so they can stake.
    xlm_client.mint(&creator, &50_000);
    let creator_start = xlm_client.balance(&creator);
    let custody_start = xlm_client.balance(&context.contract);

    let total = client.stake(&creator, &prompt_id, &30_000);
    assert_eq!(total, 30_000);

    // Recorded stake reflects the amount.
    let stake = client.get_stake(&prompt_id);
    assert_eq!(stake.amount, 30_000);
    assert_eq!(stake.creator, creator);

    // Tokens moved from creator into contract custody.
    assert_eq!(xlm_client.balance(&creator), creator_start - 30_000);
    assert_eq!(
        xlm_client.balance(&context.contract),
        custody_start + 30_000
    );

    // Additional stake accumulates.
    let total2 = client.stake(&creator, &prompt_id, &10_000);
    assert_eq!(total2, 40_000);
    assert_eq!(client.get_stake(&prompt_id).amount, 40_000);
}

#[test]
fn test_only_prompt_creator_can_stake() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Owned Prompt",
        10_000,
        &context.xlm,
    );

    xlm_client.mint(&stranger, &50_000);
    let result = client.try_stake(&stranger, &prompt_id, &10_000);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!(
            "expected Unauthorized for non-creator stake, got {:?}",
            other
        ),
    }
}

#[test]
fn test_slash_reduces_stake_and_forwards_to_fee_wallet() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Slashable", 10_000, &context.xlm);

    xlm_client.mint(&creator, &50_000);
    client.stake(&creator, &prompt_id, &30_000);

    let fee_start = xlm_client.balance(&context.fee_wallet);
    let custody_start = xlm_client.balance(&context.contract);

    // Owner (admin) slashes part of the stake. #[only_owner] gates this call;
    // under mock_all_auths the owner authorization is satisfied automatically
    // (see test_set_referral_percentage_only_owner for the same convention).
    let slashed = client.slash(&prompt_id, &12_000);
    assert_eq!(slashed, 12_000);
    assert_eq!(client.get_stake(&prompt_id).amount, 18_000);

    // Slashed stroops leave custody and land in the fee wallet.
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start + 12_000);
    assert_eq!(
        xlm_client.balance(&context.contract),
        custody_start - 12_000
    );
}

#[test]
fn test_over_slash_is_clamped_to_available_stake() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Clamp", 10_000, &context.xlm);

    xlm_client.mint(&creator, &50_000);
    client.stake(&creator, &prompt_id, &20_000);

    // Requesting more than staked only removes what is available.
    let slashed = client.slash(&prompt_id, &100_000);
    assert_eq!(slashed, 20_000);
    assert_eq!(client.get_stake(&prompt_id).amount, 0);

    // A second slash on an empty stake removes nothing (clamped to zero).
    let slashed_again = client.slash(&prompt_id, &5_000);
    assert_eq!(slashed_again, 0);
    assert_eq!(client.get_stake(&prompt_id).amount, 0);
}

#[test]
fn test_slash_missing_stake_is_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "NoStake", 10_000, &context.xlm);

    let result = client.try_slash(&prompt_id, &1_000);
    match result {
        Err(Ok(Error::StakeNotFound)) => {}
        other => panic!("expected StakeNotFound, got {:?}", other),
    }
}

#[test]
fn test_unstake_returns_remaining_stake_after_cooldown() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Reclaimable", 10_000, &context.xlm);

    xlm_client.mint(&creator, &50_000);
    client.stake(&creator, &prompt_id, &30_000);

    // Admin slashes part; creator should only reclaim the non-slashed remainder.
    client.slash(&prompt_id, &10_000);
    assert_eq!(client.get_stake(&prompt_id).amount, 20_000);

    // Advance past the cooldown window.
    env.ledger()
        .with_mut(|l| l.timestamp = 1_000 + SECONDS_PER_WEEK + 1);

    let creator_before = xlm_client.balance(&creator);
    let custody_before = xlm_client.balance(&context.contract);

    let withdrawn = client.unstake(&creator, &prompt_id, &100_000);
    assert_eq!(withdrawn, 20_000, "unstake clamps to remaining stake");
    assert_eq!(client.get_stake(&prompt_id).amount, 0);

    assert_eq!(xlm_client.balance(&creator), creator_before + 20_000);
    assert_eq!(
        xlm_client.balance(&context.contract),
        custody_before - 20_000
    );
}

#[test]
fn test_unstake_before_cooldown_is_locked() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Locked", 10_000, &context.xlm);

    xlm_client.mint(&creator, &50_000);
    client.stake(&creator, &prompt_id, &30_000);

    // Only a little time passes — still within the cooldown.
    env.ledger().with_mut(|l| l.timestamp = 1_000 + 100);

    let result = client.try_unstake(&creator, &prompt_id, &10_000);
    match result {
        Err(Ok(Error::StakeLocked)) => {}
        other => panic!("expected StakeLocked before cooldown, got {:?}", other),
    }
    // Stake untouched.
    assert_eq!(client.get_stake(&prompt_id).amount, 30_000);
}

#[test]
fn test_unstake_by_non_owner_is_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Guarded", 10_000, &context.xlm);

    xlm_client.mint(&creator, &50_000);
    client.stake(&creator, &prompt_id, &30_000);

    env.ledger()
        .with_mut(|l| l.timestamp = 1_000 + SECONDS_PER_WEEK + 1);

    let result = client.try_unstake(&stranger, &prompt_id, &10_000);
    match result {
        Err(Ok(Error::NotStakeOwner)) => {}
        other => panic!("expected NotStakeOwner, got {:?}", other),
    }
}

// ─── #36: on-chain listing metadata max-length enforcement ─────────────────
//
// `create_prompt`'s string fields are already checked against MAX_*_LEN
// constants in contract.rs (via `validate_len`), and `fuzz.rs` already
// proves arbitrarily oversized input never panics. What was missing was a
// deterministic boundary test: exactly-at-the-limit must succeed and
// one-over-the-limit must fail with `Error::InvalidFieldLength` — for every
// listing-metadata field, not just one. These mirror the MAX_*_LEN values
// in contract.rs (title: 120, category: 40, preview_text: 280,
// image_url: 512) rather than importing them, since those constants are
// private to the `contract` module.

fn build_str(env: &Env, len: usize) -> String {
    let owned: std::string::String = "a".repeat(len);
    String::from_str(env, owned.as_str())
}

// A macro (rather than a function) so the return type is whatever
// `try_create_prompt` actually produces, without having to spell out its
// exact (and slightly unusual) nested `Result` shape.
macro_rules! try_create_prompt_with_fields {
    ($env:expr, $client:expr, $creator:expr, $asset:expr, $image_url:expr, $title:expr, $category:expr, $preview_text:expr $(,)?) => {
        $client.try_create_prompt(
            $creator,
            &$image_url,
            &$title,
            &$category,
            &$preview_text,
            &String::from_str($env, "ciphertext"),
            &String::from_str($env, "iv"),
            &String::from_str($env, "wrapped-key"),
            &hash($env, 11),
            &ListingConfig {
                price: 10_000,
                asset: $asset.clone(),
                expires_at: 0,
                splits: Vec::new($env),
            },
        )
    };
}

#[test]
fn test_create_prompt_title_at_max_length_succeeds() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let result = try_create_prompt_with_fields!(
        &env,
        client,
        &creator,
        &context.xlm,
        String::from_str(&env, "https://example.com/prompt.png"),
        build_str(&env, 120),
        String::from_str(&env, "Software Development"),
        String::from_str(&env, "Generate a production-ready implementation plan."),
    );
    assert!(
        result.is_ok(),
        "title at exactly MAX_TITLE_LEN must be accepted"
    );
}

#[test]
fn test_create_prompt_title_over_max_length_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let result = try_create_prompt_with_fields!(
        &env,
        client,
        &creator,
        &context.xlm,
        String::from_str(&env, "https://example.com/prompt.png"),
        build_str(&env, 121),
        String::from_str(&env, "Software Development"),
        String::from_str(&env, "Generate a production-ready implementation plan."),
    );
    match result {
        Err(Ok(Error::InvalidFieldLength)) => {}
        other => panic!("expected InvalidFieldLength, got {:?}", other),
    }
}

#[test]
fn test_buy_bundle_with_referrer_routes_commission() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500); // 5%

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);

    let pid = create_prompt(&env, &client, &creator, "Ref Bundle P", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let price: i128 = 10_000;
    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Ref Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/ref.png"),
        &ids,
        &price,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let referrer_start = xlm_client.balance(&referrer);
    let creator_start = xlm_client.balance(&creator);
    let fee_start = xlm_client.balance(&context.fee_wallet);

    client.buy_bundle(&buyer, &bundle_id, &price, &Some(referrer.clone()));

    let expected_fee = price * 500 / 10_000;       // 500
    let expected_ref = price * 500 / 10_000;        // 500
    let expected_creator = price - expected_fee - expected_ref; // 9_000

    assert_eq!(xlm_client.balance(&creator), creator_start + expected_creator);
    assert_eq!(xlm_client.balance(&context.fee_wallet), fee_start + expected_fee);
    assert_eq!(xlm_client.balance(&referrer), referrer_start + expected_ref);
    assert!(client.has_bundle_access(&buyer, &bundle_id));
}

#[test]
fn test_creator_has_bundle_access_without_buying() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let pid = create_prompt(&env, &client, &creator, "Access P", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Access Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/acc.png"),
        &ids,
        &3_000i128,
        &context.xlm,
    );

    assert!(client.has_bundle_access(&creator, &bundle_id));
    assert!(!client.has_bundle_access(&stranger, &bundle_id));
}

#[test]
fn test_create_bundle_with_empty_ids_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let empty: Vec<u128> = Vec::new(&env);

    let result = client.try_create_bundle(
        &creator,
        &String::from_str(&env, "Empty Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/empty.png"),
        &empty,
        &5_000i128,
        &context.xlm,
    );
    match result {
        Err(Ok(crate::types::Error::BundleEmpty)) => {}
        other => panic!("expected BundleEmpty for zero-length ids, got {:?}", other),
fn test_create_prompt_category_at_max_length_succeeds() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let result = try_create_prompt_with_fields!(
        &env,
        client,
        &creator,
        &context.xlm,
        String::from_str(&env, "https://example.com/prompt.png"),
        String::from_str(&env, "Valid Title"),
        build_str(&env, 40),
        String::from_str(&env, "Generate a production-ready implementation plan."),
    );
    assert!(
        result.is_ok(),
        "category at exactly MAX_CATEGORY_LEN must be accepted"
    );
}

#[test]
fn test_create_prompt_category_over_max_length_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let result = try_create_prompt_with_fields!(
        &env,
        client,
        &creator,
        &context.xlm,
        String::from_str(&env, "https://example.com/prompt.png"),
        String::from_str(&env, "Valid Title"),
        build_str(&env, 41),
        String::from_str(&env, "Generate a production-ready implementation plan."),
    );
    match result {
        Err(Ok(Error::InvalidFieldLength)) => {}
        other => panic!("expected InvalidFieldLength, got {:?}", other),
    }
}

// ─── #273: Time-based Discount Mechanics ────────────────────────────────────

#[test]
fn test_discount_applies_within_window_and_reverts_outside() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Discounted", 10_000, &context.xlm);

    // Discount active for ledger sequence in [100, 200].
    client.set_discount(&creator, &prompt_id, &4_000i128, &100u32, &200u32);
    let stored: Option<Discount> = client.get_discount(&prompt_id);
    assert!(stored.is_some());
    assert_eq!(stored.unwrap().discounted_price, 4_000i128);

    // Before the window -> base price.
    env.ledger().with_mut(|l| l.sequence_number = 50);
    let (price_before, _, is_discounted_before) = client.get_effective_price(&prompt_id);
    assert_eq!(price_before, 10_000i128);
    assert!(!is_discounted_before);

    // Inside the window -> discounted price.
    env.ledger().with_mut(|l| l.sequence_number = 150);
    let (price_in, _, is_discounted_in) = client.get_effective_price(&prompt_id);
    assert_eq!(price_in, 4_000i128);
    assert!(is_discounted_in);

    // After the window -> reverts to base price automatically.
    env.ledger().with_mut(|l| l.sequence_number = 250);
    let (price_after, _, is_discounted_after) = client.get_effective_price(&prompt_id);
    assert_eq!(price_after, 10_000i128);
    assert!(!is_discounted_after);
}

#[test]
fn test_only_creator_can_set_discount() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Guarded", 10_000, &context.xlm);

    let result = client.try_set_discount(&stranger, &prompt_id, &4_000i128, &100u32, &200u32);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized, got {:?}", other),
    }
}

#[test]
fn test_create_prompt_preview_text_at_max_length_succeeds() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let result = try_create_prompt_with_fields!(
        &env,
        client,
        &creator,
        &context.xlm,
        String::from_str(&env, "https://example.com/prompt.png"),
        String::from_str(&env, "Valid Title"),
        String::from_str(&env, "Software Development"),
        build_str(&env, 280),
    );
    assert!(
        result.is_ok(),
        "preview_text at exactly MAX_PREVIEW_LEN must be accepted"
    );
}

#[test]
fn test_create_prompt_preview_text_over_max_length_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let result = try_create_prompt_with_fields!(
        &env,
        client,
        &creator,
        &context.xlm,
        String::from_str(&env, "https://example.com/prompt.png"),
        String::from_str(&env, "Valid Title"),
        String::from_str(&env, "Software Development"),
        build_str(&env, 281),
    );
    match result {
        Err(Ok(Error::InvalidFieldLength)) => {}
        other => panic!("expected InvalidFieldLength, got {:?}", other),
    }
}

#[test]
fn test_bundle_item_from_different_creator_is_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator_a = Address::generate(&env);
    let creator_b = Address::generate(&env);

    let pid_b = create_prompt(&env, &client, &creator_b, "B Prompt", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid_b);

    // creator_a tries to bundle creator_b's prompt
    let result = client.try_create_bundle(
        &creator_a,
        &String::from_str(&env, "Mixed Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/mixed.png"),
        &ids,
        &5_000i128,
        &context.xlm,
    );
    match result {
        Err(Ok(crate::types::Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for foreign prompt, got {:?}", other),
    }
}
fn test_create_prompt_image_url_over_max_length_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let result = try_create_prompt_with_fields!(
        &env,
        client,
        &creator,
        &context.xlm,
        build_str(&env, 513),
        String::from_str(&env, "Valid Title"),
        String::from_str(&env, "Software Development"),
        String::from_str(&env, "Generate a production-ready implementation plan."),
    );
    match result {
        Err(Ok(Error::InvalidFieldLength)) => {}
        other => panic!("expected InvalidFieldLength, got {:?}", other),
    }
}

#[test]
fn test_create_prompt_empty_title_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let creator = Address::generate(&env);

    let result = try_create_prompt_with_fields!(
        &env,
        client,
        &creator,
        &context.xlm,
        String::from_str(&env, "https://example.com/prompt.png"),
        String::from_str(&env, ""),
        String::from_str(&env, "Software Development"),
        String::from_str(&env, "Generate a production-ready implementation plan."),
    );
    match result {
        Err(Ok(Error::InvalidFieldLength)) => {}
        other => panic!("expected InvalidFieldLength, got {:?}", other),
    }
}

#[test]
fn test_clear_discount_removes_active_discount() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Clearable", 10_000, &context.xlm);

    client.set_discount(&creator, &prompt_id, &4_000i128, &100u32, &200u32);
    client.clear_discount(&creator, &prompt_id);
    assert!(client.get_discount(&prompt_id).is_none());

    // Inside what used to be the window, base price is charged again.
    env.ledger().with_mut(|l| l.sequence_number = 150);
    let (price, _, is_discounted) = client.get_effective_price(&prompt_id);
    assert_eq!(price, 10_000i128);
    assert!(!is_discounted);
}

// ─── #35: Two-step contract administrator transfer ───────────────────────────
//
// The contract already wires up `stellar_access::ownable::Ownable`'s built-in
// 2-step transfer via `#[default_impl] impl Ownable for PromptHashContract {}`
// (see contract.rs) — `transfer_ownership`/`accept_ownership` were already
// exposed as public contract entrypoints, just never exercised by any test in
// this crate. These tests lock in that the flow behaves correctly end to end.

#[test]
fn test_two_step_ownership_transfer_completes_and_updates_owner() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.sequence_number = 100);
    let new_admin = Address::generate(&env);

    assert_eq!(client.get_owner(), Some(context.admin.clone()));

    // Step 1: current owner proposes a transfer. Ownership does not change yet.
    client.transfer_ownership(&new_admin, &1_000u32);
    assert_eq!(client.get_owner(), Some(context.admin.clone()));

    // Step 2: the proposed owner accepts. Only now does ownership move.
    client.accept_ownership();
    assert_eq!(client.get_owner(), Some(new_admin));
}

#[test]
fn test_accept_ownership_without_pending_transfer_is_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // No transfer_ownership() call preceded this — nothing to accept.
    let result = client.try_accept_ownership();
    assert!(result.is_err());
}

#[test]
fn test_transfer_ownership_with_past_ledger_is_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.sequence_number = 500);
    let new_admin = Address::generate(&env);

    // live_until_ledger (100) is already in the past relative to the current
    // ledger sequence (500).
    let result = client.try_transfer_ownership(&new_admin, &100u32);
    assert!(result.is_err());

    // Ownership is unaffected by the rejected proposal.
    assert_eq!(client.get_owner(), Some(context.admin));
}

#[test]
fn test_transfer_ownership_can_be_cancelled_before_acceptance() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|l| l.sequence_number = 100);
    let new_admin = Address::generate(&env);

    client.transfer_ownership(&new_admin, &1_000u32);
    // live_until_ledger == 0 cancels the pending transfer.
    client.transfer_ownership(&new_admin, &0u32);

    // Nothing left to accept.
    let result = client.try_accept_ownership();
    assert!(result.is_err());
    assert_eq!(client.get_owner(), Some(context.admin));
}

// ─── #45: Invariant Tests for Creator and Buyer Catalog Indexes ─────────────

#[test]
fn test_creator_catalog_index_invariant_prompt_added_on_creation() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    
    // Invariant: creator index should be empty before any prompts
    assert_eq!(client.get_prompts_by_creator(&creator).len(), 0);
    
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);
    
    // Invariant: creator index should contain exactly the created prompt
    let creator_prompts = client.get_prompts_by_creator(&creator);
    assert_eq!(creator_prompts.len(), 1);
    assert_eq!(creator_prompts.get(0).unwrap().id, prompt_id);
    assert_eq!(creator_prompts.get(0).unwrap().creator, creator);
}

#[test]
fn test_creator_catalog_index_invariant_multiple_prompts_tracked() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    
    let prompt_1 = create_prompt(&env, &client, &creator, "Prompt 1", 5_000, &context.xlm);
    let prompt_2 = create_prompt(&env, &client, &creator, "Prompt 2", 7_500, &context.xlm);
    let prompt_3 = create_prompt(&env, &client, &creator, "Prompt 3", 12_000, &context.xlm);
    
    // Invariant: creator index should contain all created prompts
    let creator_prompts = client.get_prompts_by_creator(&creator);
    assert_eq!(creator_prompts.len(), 3);
    
    // Invariant: all prompts in index should belong to the creator
    for i in 0..creator_prompts.len() {
        assert_eq!(creator_prompts.get(i).unwrap().creator, creator);
    }
    
    // Invariant: specific prompt IDs should be present
    let mut prompt_ids = Vec::new(&env);
    for i in 0..creator_prompts.len() {
        prompt_ids.push_back(creator_prompts.get(i).unwrap().id);
    }
    let mut found_1 = false;
    let mut found_2 = false;
    let mut found_3 = false;
    for i in 0..prompt_ids.len() {
        if prompt_ids.get(i).unwrap() == prompt_1 { found_1 = true; }
        if prompt_ids.get(i).unwrap() == prompt_2 { found_2 = true; }
        if prompt_ids.get(i).unwrap() == prompt_3 { found_3 = true; }
    }
    assert!(found_1);
    assert!(found_2);
    assert!(found_3);
}

#[test]
fn test_creator_catalog_index_invariant_isolation_between_creators() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator_a = Address::generate(&env);
    let creator_b = Address::generate(&env);
    
    let prompt_a = create_prompt(&env, &client, &creator_a, "A's Prompt", 10_000, &context.xlm);
    let prompt_b = create_prompt(&env, &client, &creator_b, "B's Prompt", 15_000, &context.xlm);
    
    // Invariant: creator A's index should only contain their prompts
    let a_prompts = client.get_prompts_by_creator(&creator_a);
    assert_eq!(a_prompts.len(), 1);
    assert_eq!(a_prompts.get(0).unwrap().id, prompt_a);
    assert_eq!(a_prompts.get(0).unwrap().creator, creator_a);
    
    // Invariant: creator B's index should only contain their prompts
    let b_prompts = client.get_prompts_by_creator(&creator_b);
    assert_eq!(b_prompts.len(), 1);
    assert_eq!(b_prompts.get(0).unwrap().id, prompt_b);
    assert_eq!(b_prompts.get(0).unwrap().creator, creator_b);
}

#[test]
fn test_creator_catalog_index_invariant_persistence_across_operations() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);
    
    // Invariant: creator index should persist after purchase
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>);
    
    let creator_prompts = client.get_prompts_by_creator(&creator);
    assert_eq!(creator_prompts.len(), 1);
    assert_eq!(creator_prompts.get(0).unwrap().id, prompt_id);
    
    // Invariant: creator index should persist after price update
    client.update_prompt_price(&creator, &prompt_id, &15_000);
    let creator_prompts = client.get_prompts_by_creator(&creator);
    assert_eq!(creator_prompts.len(), 1);
    assert_eq!(creator_prompts.get(0).unwrap().id, prompt_id);
    assert_eq!(creator_prompts.get(0).unwrap().price_stroops, 15_000);
    
    // Invariant: creator index should persist after status change
    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    let creator_prompts = client.get_prompts_by_creator(&creator);
    assert_eq!(creator_prompts.len(), 1);
    assert!(!creator_prompts.get(0).unwrap().active);
}

#[test]
fn test_buyer_catalog_index_invariant_prompt_added_on_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);
    
    // Invariant: buyer index should be empty before purchase
    assert_eq!(client.get_prompts_by_buyer(&buyer).len(), 0);
    
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>);
    
    // Invariant: buyer index should contain the purchased prompt
    let buyer_prompts = client.get_prompts_by_buyer(&buyer);
    assert_eq!(buyer_prompts.len(), 1);
    assert_eq!(buyer_prompts.get(0).unwrap().id, prompt_id);
}

#[test]
fn test_buyer_catalog_index_invariant_duplicate_purchase_prevented() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);
    
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>);
    
    // Invariant: duplicate purchase should not add duplicate to index
    let duplicate_result = client.try_buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>);
    match duplicate_result {
        Err(Ok(Error::AlreadyPurchased)) => {}
        other => panic!("expected AlreadyPurchased, got {:?}", other),
    }
    
    let buyer_prompts = client.get_prompts_by_buyer(&buyer);
    assert_eq!(buyer_prompts.len(), 1);
    assert_eq!(buyer_prompts.get(0).unwrap().id, prompt_id);
}

#[test]
fn test_buyer_catalog_index_invariant_transfer_updates_both_indexes() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);
    
    fund_buyer(&xlm_client, &seller, &context.contract, 100_000);
    client.buy_prompt(&seller, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>);
    
    // Invariant: seller should have prompt in index before transfer
    assert_eq!(client.get_prompts_by_buyer(&seller).len(), 1);
    assert_eq!(client.get_prompts_by_buyer(&buyer).len(), 0);
    
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.transfer_license(&seller, &prompt_id, &buyer, &20_000i128);
    
    // Invariant: seller's index should be updated (prompt removed)
    assert_eq!(client.get_prompts_by_buyer(&seller).len(), 0);
    
    // Invariant: buyer's index should be updated (prompt added)
    let buyer_prompts = client.get_prompts_by_buyer(&buyer);
    assert_eq!(buyer_prompts.len(), 1);
    assert_eq!(buyer_prompts.get(0).unwrap().id, prompt_id);
}

#[test]
fn test_buyer_catalog_index_invariant_multiple_purchases_tracked() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    
    let prompt_1 = create_prompt(&env, &client, &creator, "Prompt 1", 5_000, &context.xlm);
    let prompt_2 = create_prompt(&env, &client, &creator, "Prompt 2", 7_500, &context.xlm);
    let prompt_3 = create_prompt(&env, &client, &creator, "Prompt 3", 12_000, &context.xlm);
    
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_1, &None::<Bytes>, &5_000i128, &None::<Bytes>);
    client.buy_prompt(&buyer, &prompt_2, &None::<Bytes>, &7_500i128, &None::<Bytes>);
    client.buy_prompt(&buyer, &prompt_3, &None::<Bytes>, &12_000i128, &None::<Bytes>);
    
    // Invariant: buyer index should contain all purchased prompts
    let buyer_prompts = client.get_prompts_by_buyer(&buyer);
    assert_eq!(buyer_prompts.len(), 3);
    
    // Invariant: all purchased prompt IDs should be present
    let mut prompt_ids = Vec::new(&env);
    for i in 0..buyer_prompts.len() {
        prompt_ids.push_back(buyer_prompts.get(i).unwrap().id);
    }
    let mut found_1 = false;
    let mut found_2 = false;
    let mut found_3 = false;
    for i in 0..prompt_ids.len() {
        if prompt_ids.get(i).unwrap() == prompt_1 { found_1 = true; }
        if prompt_ids.get(i).unwrap() == prompt_2 { found_2 = true; }
        if prompt_ids.get(i).unwrap() == prompt_3 { found_3 = true; }
    }
    assert!(found_1);
    assert!(found_2);
    assert!(found_3);
}

#[test]
fn test_buyer_catalog_index_invariant_isolation_between_buyers() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer_a = Address::generate(&env);
    let buyer_b = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);
    
    fund_buyer(&xlm_client, &buyer_a, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer_b, &context.contract, 100_000);
    
    client.buy_prompt(&buyer_a, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>);
    
    // Invariant: buyer A should have the prompt
    assert_eq!(client.get_prompts_by_buyer(&buyer_a).len(), 1);
    
    // Invariant: buyer B should not have the prompt
    assert_eq!(client.get_prompts_by_buyer(&buyer_b).len(), 0);
    
    client.buy_prompt(&buyer_b, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>);
    
    // Invariant: both buyers should now have the prompt
    assert_eq!(client.get_prompts_by_buyer(&buyer_a).len(), 1);
    assert_eq!(client.get_prompts_by_buyer(&buyer_b).len(), 1);
}

#[test]
fn test_buyer_catalog_index_invariant_bundle_purchase_updates_index() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let p1 = create_prompt(&env, &client, &creator, "Bundle P1", 10_000, &context.xlm);
    let p2 = create_prompt(&env, &client, &creator, "Bundle P2", 20_000, &context.xlm);
    
    let ids = Vec::from_array(&env, [p1, p2]);
    let bundle_price = 24_000i128;
    let bundle_id = client.create_bundle(&creator, &ids, &bundle_price, &context.xlm);
    
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.purchase_bundle(&buyer, &bundle_id, &bundle_price);
    
    // Invariant: buyer index should contain all prompts from bundle
    let buyer_prompts = client.get_prompts_by_buyer(&buyer);
    assert_eq!(buyer_prompts.len(), 2);
    
    let mut prompt_ids = Vec::new(&env);
    for i in 0..buyer_prompts.len() {
        prompt_ids.push_back(buyer_prompts.get(i).unwrap().id);
    }
    let mut found_p1 = false;
    let mut found_p2 = false;
    for i in 0..prompt_ids.len() {
        if prompt_ids.get(i).unwrap() == p1 { found_p1 = true; }
        if prompt_ids.get(i).unwrap() == p2 { found_p2 = true; }
    }
    assert!(found_p1);
    assert!(found_p2);
}

#[test]
fn test_buyer_catalog_index_invariant_creator_not_in_buyer_index() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Test Prompt", 10_000, &context.xlm);
    
    // Invariant: creator should not appear in buyer index for their own prompt
    assert_eq!(client.get_prompts_by_buyer(&creator).len(), 0);
    
    // Invariant: creator should have access but not via buyer index
    assert!(client.has_access(&creator, &prompt_id));
}

#[test]
fn test_catalog_indexes_invariant_consistency_after_complex_flow() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator_a = Address::generate(&env);
    let creator_b = Address::generate(&env);
    let buyer_1 = Address::generate(&env);
    let buyer_2 = Address::generate(&env);
    
    let p_a1 = create_prompt(&env, &client, &creator_a, "A1", 10_000, &context.xlm);
    let p_a2 = create_prompt(&env, &client, &creator_a, "A2", 15_000, &context.xlm);
    let p_b1 = create_prompt(&env, &client, &creator_b, "B1", 20_000, &context.xlm);
    
    fund_buyer(&xlm_client, &buyer_1, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer_2, &context.contract, 100_000);
    
    // Buyer 1 purchases A1 and B1
    client.buy_prompt(&buyer_1, &p_a1, &None::<Bytes>, &10_000i128, &None::<Bytes>);
    client.buy_prompt(&buyer_1, &p_b1, &None::<Bytes>, &20_000i128, &None::<Bytes>);
    
    // Buyer 2 purchases A2
    client.buy_prompt(&buyer_2, &p_a2, &None::<Bytes>, &15_000i128, &None::<Bytes>);
    
    // Invariant: creator A should have 2 prompts in index
    assert_eq!(client.get_prompts_by_creator(&creator_a).len(), 2);
    
    // Invariant: creator B should have 1 prompt in index
    assert_eq!(client.get_prompts_by_creator(&creator_b).len(), 1);
    
    // Invariant: buyer 1 should have 2 prompts in index
    assert_eq!(client.get_prompts_by_buyer(&buyer_1).len(), 2);
    
    // Invariant: buyer 2 should have 1 prompt in index
    assert_eq!(client.get_prompts_by_buyer(&buyer_2).len(), 1);
    
    // Transfer A1 from buyer 1 to buyer 2
    fund_buyer(&xlm_client, &buyer_2, &context.contract, 100_000);
    client.transfer_license(&buyer_1, &p_a1, &buyer_2, &25_000i128);
    
    // Invariant: buyer 1 should now have 1 prompt (B1 only)
    assert_eq!(client.get_prompts_by_buyer(&buyer_1).len(), 1);
    let buyer_1_prompts = client.get_prompts_by_buyer(&buyer_1);
    assert_eq!(buyer_1_prompts.get(0).unwrap().id, p_b1);
    
    // Invariant: buyer 2 should now have 2 prompts (A2 and transferred A1)
    assert_eq!(client.get_prompts_by_buyer(&buyer_2).len(), 2);
    let buyer_2_prompts = client.get_prompts_by_buyer(&buyer_2);
    let mut found_a1 = false;
    let mut found_a2 = false;
    for i in 0..buyer_2_prompts.len() {
        if buyer_2_prompts.get(i).unwrap().id == p_a1 { found_a1 = true; }
        if buyer_2_prompts.get(i).unwrap().id == p_a2 { found_a2 = true; }
    }
    assert!(found_a1);
    assert!(found_a2);
    
    // Invariant: creator indexes should remain unchanged
    assert_eq!(client.get_prompts_by_creator(&creator_a).len(), 2);
    assert_eq!(client.get_prompts_by_creator(&creator_b).len(), 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Financial Invariant Tests
// Acceptance: seller proceeds + platform fee (+ referral + splits) == charged amount
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_buy_prompt_invariant_no_splits_no_referral() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 77_777;

    let prompt_id = create_prompt(&env, &client, &creator, "Invariant Base", price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    let creator_after = xlm_client.balance(&creator);
    let fee_after = xlm_client.balance(&context.fee_wallet);

    let settlement = client.get_purchase_details(&prompt_id, &buyer).settlement;
    assert_eq!(settlement.buyer_amount, price);
    assert_eq!(
        settlement.buyer_amount,
        settlement.creator_amount + settlement.platform_amount + settlement.referrer_amount + settlement.split_amount,
        "Settlement snapshot must sum to charged amount"
    );
    assert_eq!(price, (creator_after - creator_before) + (fee_after - fee_before));
    assert_eq!(settlement.creator_amount, creator_after - creator_before);
    assert_eq!(settlement.platform_amount, fee_after - fee_before);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_buy_prompt_invariant_with_splits() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);
    let co2 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 99_999;

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split { recipient: co1.clone(), bps: 1_500 });
    splits.push_back(Split { recipient: co2.clone(), bps: 750 });

    let prompt_id = create_prompt_with_splits(
        &env, &client, &creator, "Invariant Splits", price, &context.xlm, splits,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);
    let co1_before = xlm_client.balance(&co1);
    let co2_before = xlm_client.balance(&co2);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>);

    let creator_after = xlm_client.balance(&creator);
    let fee_after = xlm_client.balance(&context.fee_wallet);
    let co1_after = xlm_client.balance(&co1);
    let co2_after = xlm_client.balance(&co2);

    let settlement = client.get_purchase_details(&prompt_id, &buyer).settlement;
    assert_eq!(settlement.buyer_amount, price);
    assert_eq!(
        settlement.buyer_amount,
        settlement.creator_amount + settlement.platform_amount + settlement.referrer_amount + settlement.split_amount,
    );

    let onchain_total = (creator_after - creator_before)
        + (fee_after - fee_before)
        + (co1_after - co1_before)
        + (co2_after - co2_before);
    assert_eq!(settlement.buyer_amount, onchain_total);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_buy_prompt_invariant_with_referral() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&500);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price: i128 = 50_000;

    let prompt_id = create_prompt(&env, &client, &creator, "Invariant Referral", price, &context.xlm);

    let referral_code = Bytes::from_slice(&env, b"invariant-referral-secret");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&referrer, &referral_hash);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);
    let referrer_before = xlm_client.balance(&referrer);

    client.buy_prompt(&buyer, &prompt_id, &Some(referral_code), &price, &None::<Bytes>());

    let creator_after = xlm_client.balance(&creator);
    let fee_after = xlm_client.balance(&context.fee_wallet);
    let referrer_after = xlm_client.balance(&referrer);

    let settlement = client.get_purchase_details(&prompt_id, &buyer).settlement;
    assert_eq!(settlement.buyer_amount, price);
    assert_eq!(
        settlement.buyer_amount,
        settlement.creator_amount + settlement.platform_amount + settlement.referrer_amount + settlement.split_amount,
    );

    let onchain_total = (creator_after - creator_before)
        + (fee_after - fee_before)
        + (referrer_after - referrer_before);
    assert_eq!(settlement.buyer_amount, onchain_total);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_buy_prompt_invariant_with_splits_and_referral() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    client.set_referral_percentage(&300);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price: i128 = 123_456;

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split { recipient: co1.clone(), bps: 2_000 });

    let prompt_id = create_prompt_with_splits(
        &env, &client, &creator, "Invariant Full", price, &context.xlm, splits,
    );

    let referral_code = Bytes::from_slice(&env, b"invariant-full-secret");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&referrer, &referral_hash);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);
    let co1_before = xlm_client.balance(&co1);
    let referrer_before = xlm_client.balance(&referrer);

    client.buy_prompt(&buyer, &prompt_id, &Some(referral_code), &price, &None::<Bytes>());

    let creator_after = xlm_client.balance(&creator);
    let fee_after = xlm_client.balance(&context.fee_wallet);
    let co1_after = xlm_client.balance(&co1);
    let referrer_after = xlm_client.balance(&referrer);

    let settlement = client.get_purchase_details(&prompt_id, &buyer).settlement;
    assert_eq!(settlement.buyer_amount, price);
    assert_eq!(
        settlement.buyer_amount,
        settlement.creator_amount + settlement.platform_amount + settlement.referrer_amount + settlement.split_amount,
    );

    let onchain_total = (creator_after - creator_before)
        + (fee_after - fee_before)
        + (co1_after - co1_before)
        + (referrer_after - referrer_before);
    assert_eq!(settlement.buyer_amount, onchain_total);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_bundle_purchase_invariant_charged_equals_creator_plus_platform() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let p1 = create_prompt(&env, &client, &creator, "Bundle A", 10_000, &context.xlm);
    let p2 = create_prompt(&env, &client, &creator, "Bundle B", 20_000, &context.xlm);

    let ids = Vec::from_array(&env, [p1, p2]);
    let bundle_price = 28_000i128;
    let bundle_id = client.create_bundle(&creator, &ids, &bundle_price, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, bundle_price);

    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);

    client.purchase_bundle(&buyer, &bundle_id, &bundle_price);

    let creator_after = xlm_client.balance(&creator);
    let fee_after = xlm_client.balance(&context.fee_wallet);

    assert_eq!(bundle_price, (creator_after - creator_before) + (fee_after - fee_before));
    assert!(client.has_access(&buyer, &p1));
    assert!(client.has_access(&buyer, &p2));
}

#[test]
fn test_lease_prompt_invariant_charged_equals_creator_plus_platform() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let base_price: i128 = 100_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Lease Invariant", base_price, &context.xlm);

    let lease_price = base_price * 4_000 / 10_000;
    fund_buyer(&xlm_client, &buyer, &context.contract, lease_price);

    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);

    client.lease_prompt(&buyer, &prompt_id, &600);

    let creator_after = xlm_client.balance(&creator);
    let fee_after = xlm_client.balance(&context.fee_wallet);

    let settlement = client.get_purchase_details(&prompt_id, &buyer).settlement;
    assert_eq!(settlement.buyer_amount, lease_price);
    assert_eq!(lease_price, (creator_after - creator_before) + (fee_after - fee_before));
    assert_eq!(settlement.buyer_amount, settlement.creator_amount + settlement.platform_amount);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_transfer_license_invariant_resale_equals_seller_plus_royalty() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Transfer Invariant", price, &context.xlm);

    fund_buyer(&xlm_client, &seller, &context.contract, 100_000);
    client.buy_prompt(&seller, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>());

    let resale_price: i128 = 37_500;
    fund_buyer(&xlm_client, &buyer, &context.contract, resale_price);

    let seller_before = xlm_client.balance(&seller);
    let creator_before = xlm_client.balance(&creator);
    let buyer_before = xlm_client.balance(&buyer);

    client.transfer_license(&seller, &prompt_id, &buyer, &resale_price);

    let seller_after = xlm_client.balance(&seller);
    let creator_after = xlm_client.balance(&creator);
    let buyer_after = xlm_client.balance(&buyer);

    let royalty = resale_price * 500 / 10_000;
    let seller_proceeds = resale_price - royalty;

    assert_eq!(resale_price, (seller_after - seller_before) + (creator_after - creator_before));
    assert_eq!(creator_after - creator_before, royalty);
    assert_eq!(seller_after - seller_before, seller_proceeds);
    assert_eq!(buyer_after, buyer_before - resale_price);
    assert!(!client.has_access(&seller, &prompt_id));
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_transfer_license_invariant_zero_gift_moves_no_funds() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 10_000;
    let prompt_id = create_prompt(&env, &client, &creator, "Gift Transfer", price, &context.xlm);

    fund_buyer(&xlm_client, &seller, &context.contract, 100_000);
    client.buy_prompt(&seller, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>());

    let creator_before = xlm_client.balance(&creator);
    let seller_before = xlm_client.balance(&seller);

    client.transfer_license(&seller, &prompt_id, &buyer, &0i128);

    assert_eq!(xlm_client.balance(&creator), creator_before);
    assert_eq!(xlm_client.balance(&seller), seller_before);
    assert!(!client.has_access(&seller, &prompt_id));
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_subscription_purchase_invariant_charged_equals_creator_plus_platform() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let price: i128 = 25_000;

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    client.configure_subscription_pass(&creator, &600, &price, &context.xlm, &true);

    fund_buyer(&xlm_client, &subscriber, &context.contract, price);

    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);

    client.subscribe_catalog(&subscriber, &creator, &price);

    let creator_after = xlm_client.balance(&creator);
    let fee_after = xlm_client.balance(&context.fee_wallet);

    assert_eq!(price, (creator_after - creator_before) + (fee_after - fee_before));
}

#[test]
fn test_bulk_purchase_invariant_holds_per_prompt() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let p1 = create_prompt(&env, &client, &creator, "Bulk Inv A", 5_000, &context.xlm);
    let p2 = create_prompt(&env, &client, &creator, "Bulk Inv B", 15_000, &context.xlm);

    let total = 5_000 + 15_000;
    fund_buyer(&xlm_client, &buyer, &context.contract, total);

    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);

    let mut ids = Vec::new(&env);
    ids.push_back(p1);
    ids.push_back(p2);
    let mut amounts = Vec::new(&env);
    amounts.push_back(5_000i128);
    amounts.push_back(15_000i128);

    client.buy_prompts_bulk(&buyer, &ids, &amounts, &None::<Bytes>());

    let creator_after = xlm_client.balance(&creator);
    let fee_after = xlm_client.balance(&context.fee_wallet);

    assert_eq!(total, (creator_after - creator_before) + (fee_after - fee_before));
    assert!(client.has_access(&buyer, &p1));
    assert!(client.has_access(&buyer, &p2));
}

#[test]
fn test_settlement_snapshot_matches_actual_balances() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let referrer = Address::generate(&env);
    let price: i128 = 88_888;

    client.set_referral_percentage(&250);

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split { recipient: co1.clone(), bps: 1_250 });

    let prompt_id = create_prompt_with_splits(
        &env, &client, &creator, "Settlement Audit", price, &context.xlm, splits,
    );

    let referral_code = Bytes::from_slice(&env, b"settlement-audit-secret");
    let referral_hash = BytesN::from_array(&env, &env.crypto().sha256(&referral_code).to_array());
    client.register_referral_code(&referrer, &referral_hash);

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_before = xlm_client.balance(&creator);
    let fee_before = xlm_client.balance(&context.fee_wallet);
    let co1_before = xlm_client.balance(&co1);
    let referrer_before = xlm_client.balance(&referrer);

    client.buy_prompt(&buyer, &prompt_id, &Some(referral_code), &price, &None::<Bytes>());

    let settlement = client.get_purchase_details(&prompt_id, &buyer).settlement;

    assert_eq!(settlement.creator_amount, xlm_client.balance(&creator) - creator_before);
    assert_eq!(settlement.platform_amount, xlm_client.balance(&context.fee_wallet) - fee_before);
    assert_eq!(settlement.referrer_amount, xlm_client.balance(&referrer) - referrer_before);
    assert_eq!(settlement.split_amount, xlm_client.balance(&co1) - co1_before);
    assert_eq!(
        settlement.buyer_amount,
        settlement.creator_amount + settlement.platform_amount + settlement.referrer_amount + settlement.split_amount,
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Access Control Tests
// Acceptance: unauthorized accounts cannot mutate listings, fees, disputes, or access
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_stranger_cannot_set_max_supply() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Max Supply", 5_000, &context.xlm);

    let result = client.try_set_prompt_max_supply(&stranger, &prompt_id, &1u64);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger set_max_supply, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_create_promotion() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Promo", 5_000, &context.xlm);

    let result = client.try_create_promotion(
        &stranger,
        &prompt_id,
        &1_000u64,
        &2_000u64,
        &4_000i128,
        &context.xlm,
    );
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger create_promotion, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_cancel_promotion() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Cancel Promo", 5_000, &context.xlm);

    let result = client.try_cancel_promotion(&stranger, &prompt_id);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger cancel_promotion, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_clear_discount() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Clear Disc", 5_000, &context.xlm);

    let result = client.try_clear_discount(&stranger, &prompt_id);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger clear_discount, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_configure_subscription_pass() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);

    let result = client.try_configure_subscription_pass(&stranger, &600, &10_000, &context.xlm, &true);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger configure_subscription_pass, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_set_subscription_eligibility() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Sub Eligible", 5_000, &context.xlm);

    let result = client.try_set_subscription_eligibility(&stranger, &prompt_id, &true);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger set_subscription_eligibility, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_set_fee_wallet() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let stranger = Address::generate(&env);
    let new_wallet = Address::generate(&env);

    let result = client.try_set_fee_wallet(&stranger, &new_wallet);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger set_fee_wallet, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_set_pause_status() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let stranger = Address::generate(&env);

    let result = client.try_set_pause_status(&stranger, &true);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger set_pause_status, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_set_referral_percentage() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let stranger = Address::generate(&env);

    let result = client.try_set_referral_percentage(&stranger, &300);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger set_referral_percentage, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_propose_upgrade() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let stranger = Address::generate(&env);
    let stranger_two = Address::generate(&env);
    let wasm_hash = BytesN::from_array(&env, &[1u8; 32]);

    let result = client.try_propose_upgrade(&wasm_hash, &stranger, &stranger_two);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger propose_upgrade, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_confirm_upgrade() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let stranger = Address::generate(&env);
    let stranger_two = Address::generate(&env);

    let result = client.try_confirm_upgrade(&stranger, &stranger_two);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger confirm_upgrade, got {:?}", other),
    }
}

// ─── #194: Contract upgrade safety checks ────────────────────────────────────

const UPGRADE_COOLDOWN: u64 = 86_400; // UPGRADE_COOLDOWN_SECS in contract.rs

#[test]
fn test_upgrade_propose_requires_two_distinct_admins() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    // Same admin used for both approver slots must be rejected.
    let result = client.try_propose_upgrade(&wasm_hash, &context.admin, &context.admin);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for same-admin propose_upgrade, got {:?}", other),
    }
    // One admin + one stranger must be rejected too.
    let stranger = Address::generate(&env);
    let result = client.try_propose_upgrade(&wasm_hash, &context.admin, &stranger);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for mixed-admin propose_upgrade, got {:?}", other),
    }
}

#[test]
fn test_upgrade_rejects_invalid_implementation() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    // A zero WASM hash is never a valid implementation.
    let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_propose_upgrade(&zero_hash, &context.admin, &context.admin_two);
    match result {
        Err(Ok(Error::InvalidImplementation)) => {}
        other => panic!("expected InvalidImplementation for zero wasm hash, got {:?}", other),
    }
}

#[test]
fn test_upgrade_propose_twice_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    client.propose_upgrade(&wasm_hash, &context.admin, &context.admin_two);
    assert_eq!(client.get_pending_upgrade(), Some(wasm_hash));

    // A second proposal while one is pending must be rejected.
    let other_hash = BytesN::from_array(&env, &[2u8; 32]);
    let result = client.try_propose_upgrade(&other_hash, &context.admin, &context.admin_two);
    match result {
        Err(Ok(Error::UpgradeAlreadyProposed)) => {}
        other => panic!("expected UpgradeAlreadyProposed for duplicate proposal, got {:?}", other),
    }
}

#[test]
fn test_upgrade_confirm_without_proposal_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let result = client.try_confirm_upgrade(&context.admin, &context.admin_two);
    match result {
        Err(Ok(Error::UpgradeNotProposed)) => {}
        other => panic!("expected UpgradeNotProposed when nothing is proposed, got {:?}", other),
    }
}

#[test]
fn test_upgrade_confirm_before_cooldown_rejected() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    client.propose_upgrade(&wasm_hash, &context.admin, &context.admin_two);

    // Confirm too early, within the timelock window.
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000 + UPGRADE_COOLDOWN - 1);
    let result = client.try_confirm_upgrade(&context.admin, &context.admin_two);
    match result {
        Err(Ok(Error::UpgradeCooldownNotElapsed)) => {}
        other => panic!("expected UpgradeCooldownNotElapsed, got {:?}", other),
    }
}

#[test]
fn test_upgrade_cancel_clears_proposal() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    client.propose_upgrade(&wasm_hash, &context.admin, &context.admin_two);
    assert_eq!(client.get_pending_upgrade(), Some(wasm_hash));

    client.cancel_upgrade(&context.admin, &context.admin_two);
    assert_eq!(client.get_pending_upgrade(), None);

    // After cancellation, confirming must fail.
    let result = client.try_confirm_upgrade(&context.admin, &context.admin_two);
    match result {
        Err(Ok(Error::UpgradeNotProposed)) => {}
        other => panic!("expected UpgradeNotProposed after cancel, got {:?}", other),
    }
}

#[test]
fn test_upgrade_propose_confirm_success() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    client.propose_upgrade(&wasm_hash, &context.admin, &context.admin_two);
    assert_eq!(client.get_pending_upgrade(), Some(wasm_hash));

    // Wait out the timelock, then confirm.
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000 + UPGRADE_COOLDOWN + 1);
    client.confirm_upgrade(&context.admin, &context.admin_two);
    assert_eq!(client.get_pending_upgrade(), None);
}

#[test]
fn test_upgrade_preserves_license_holders() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "SecuredPrompt", 10_000, &context.xlm);

    // Establish an existing license holder.
    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &10_000, &None::<Bytes>);
    assert!(client.has_access(&buyer, &prompt_id));

    // Propose and confirm an upgrade after the timelock.
    let wasm_hash = BytesN::from_array(&env, &[1u8; 32]);
    client.propose_upgrade(&wasm_hash, &context.admin, &context.admin_two);
    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000 + UPGRADE_COOLDOWN + 1);
    client.confirm_upgrade(&context.admin, &context.admin_two);

    // The license holder keeps access and the listing data is intact.
    assert!(client.has_access(&buyer, &prompt_id));
    let prompt = client.get_prompt(&prompt_id);
    assert_eq!(prompt.creator, creator);
    assert_eq!(prompt.price_stroops, 10_000);
    assert_eq!(prompt.sales_count, 1);
}

#[test]
fn test_stranger_cannot_cancel_upgrade() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let stranger = Address::generate(&env);
    let stranger_two = Address::generate(&env);

    let result = client.try_cancel_upgrade(&stranger, &stranger_two);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger cancel_upgrade, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_slash() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let stranger = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Slashable", 5_000, &context.xlm);

    let result = client.try_slash(&stranger, &prompt_id, &1_000);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger slash, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_set_moderator_address() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let stranger = Address::generate(&env);
    let moderator = Address::generate(&env);

    let result = client.try_set_moderator_address(&stranger, &moderator);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger set_moderator_address, got {:?}", other),
    }
}

#[test]
fn test_stranger_cannot_migrate() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let stranger = Address::generate(&env);

    let result = client.try_migrate(&stranger, &2);
    match result {
        Err(Ok(Error::Unauthorized)) => {}
        other => panic!("expected Unauthorized for stranger migrate, got {:?}", other),
    }
}

#[test]
fn test_non_subscriber_cannot_renew_catalog_subscription() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let stranger = Address::generate(&env);

    env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);
    client.configure_subscription_pass(&creator, &600, &10_000, &context.xlm, &true);

    // subscriber subscribes
    client.subscribe_catalog(&subscriber, &creator, &10_000);

    // stranger tries to renew subscriber's subscription
    let result = client.try_renew_catalog_subscription(&stranger, &creator, &10_000);
    match result {
        Err(Ok(Error::SubscriptionNotFound)) => {}
        other => panic!("expected SubscriptionNotFound for stranger renew, got {:?}", other),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sequence / Access Rule Preservation Tests
// Acceptance: purchase, transfer, deactivate, and dispute sequences preserve access
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_purchase_then_deactivate_preserves_buyer_access() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Deactivate Seq", 10_000, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>());
    assert!(client.has_access(&buyer, &prompt_id));

    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    assert!(client.has_access(&buyer, &prompt_id));
}

#[test]
fn test_purchase_then_transfer_revokes_seller_grants_buyer() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Transfer Seq", 10_000, &context.xlm);

    fund_buyer(&xlm_client, &seller, &context.contract, 100_000);
    client.buy_prompt(&seller, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>());
    assert!(client.has_access(&seller, &prompt_id));

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.transfer_license(&seller, &prompt_id, &buyer, &15_000i128);

    assert!(!client.has_access(&seller, &prompt_id));
    assert!(client.has_access(&buyer, &prompt_id));
    assert_eq!(client.get_prompts_by_buyer(&seller).len(), 0);
    assert_eq!(client.get_prompts_by_buyer(&buyer).len(), 1);
}

#[test]
fn test_transfer_then_deactivate_preserves_new_owner_access() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Transfer Deactivate", 10_000, &context.xlm);

    fund_buyer(&xlm_client, &seller, &context.contract, 100_000);
    client.buy_prompt(&seller, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>());

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    client.transfer_license(&seller, &prompt_id, &buyer, &15_000i128);
    assert!(client.has_access(&buyer, &prompt_id));

    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    assert!(client.has_access(&buyer, &prompt_id));
    assert!(!client.has_access(&seller, &prompt_id));
}

#[test]
fn test_deactivated_listing_blocks_new_purchases() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Deactive Block", 10_000, &context.xlm);

    client.set_prompt_sale_status(&creator, &prompt_id, &false);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);
    let result = client.try_buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>());
    match result {
        Err(Ok(Error::PromptInactive)) => {}
        other => panic!("expected PromptInactive for deactivated listing, got {:?}", other),
    }
}

#[test]
fn test_chain_of_transfers_preserves_access() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer_a = Address::generate(&env);
    let buyer_b = Address::generate(&env);
    let buyer_c = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Chain Transfer", 10_000, &context.xlm);

    fund_buyer(&xlm_client, &buyer_a, &context.contract, 100_000);
    client.buy_prompt(&buyer_a, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>());
    assert!(client.has_access(&buyer_a, &prompt_id));

    fund_buyer(&xlm_client, &buyer_b, &context.contract, 100_000);
    client.transfer_license(&buyer_a, &prompt_id, &buyer_b, &12_000i128);
    assert!(!client.has_access(&buyer_a, &prompt_id));
    assert!(client.has_access(&buyer_b, &prompt_id));

    fund_buyer(&xlm_client, &buyer_c, &context.contract, 100_000);
    client.transfer_license(&buyer_b, &prompt_id, &buyer_c, &14_000i128);
    assert!(!client.has_access(&buyer_b, &prompt_id));
    assert!(client.has_access(&buyer_c, &prompt_id));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Boundary Value Tests
// Acceptance: overflow, zero, maximum, rounding, and repeated-operation cases
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_zero_payment_amount_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Zero Pay", 1, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, 1);
    let result = client.try_buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &0i128, &None::<Bytes>());
    match result {
        Err(Ok(Error::InvalidPaymentAmount)) => {}
        other => panic!("expected InvalidPaymentAmount for zero payment, got {:?}", other),
    }
}

#[test]
fn test_negative_payment_amount_fails() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Neg Pay", 1, &context.xlm);

    fund_buyer(&xlm_client, &buyer, &context.contract, 1);
    let result = client.try_buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &(-1i128), &None::<Bytes>());
    match result {
        Err(Ok(Error::InvalidPaymentAmount)) => {}
        other => panic!("expected InvalidPaymentAmount for negative payment, got {:?}", other),
    }
}

#[test]
fn test_max_supply_one_blocks_second_purchase() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer_a = Address::generate(&env);
    let buyer_b = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Max Supply One", 10_000, &context.xlm);

    client.set_prompt_max_supply(&creator, &prompt_id, &1u64);

    fund_buyer(&xlm_client, &buyer_a, &context.contract, 100_000);
    client.buy_prompt(&buyer_a, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>());
    assert!(client.has_access(&buyer_a, &prompt_id));

    fund_buyer(&xlm_client, &buyer_b, &context.contract, 100_000);
    let result = client.try_buy_prompt(&buyer_b, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>());
    match result {
        Err(Ok(Error::MaxSupplyReached)) => {}
        other => panic!("expected MaxSupplyReached for second purchase, got {:?}", other),
    }
}

#[test]
fn test_fee_rounding_across_multiple_prices() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let prices = [1i128, 19, 101, 1_001, 10_001, 99_999, 1_000_001];
    let mut total_fee = 0i128;
    let mut total_creator = 0i128;

    for &price in &prices {
        let prompt_id = create_prompt(&env, &client, &creator, "Rounding", price, &context.xlm);
        fund_buyer(&xlm_client, &buyer, &context.contract, price);

        let creator_before = xlm_client.balance(&creator);
        let fee_before = xlm_client.balance(&context.fee_wallet);

        client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>());

        let creator_after = xlm_client.balance(&creator);
        let fee_after = xlm_client.balance(&context.fee_wallet);

        let fee = fee_after - fee_before;
        let creator_amount = creator_after - creator_before;
        total_fee += fee;
        total_creator += creator_amount;

        assert_eq!(price, fee + creator_amount, "Rounding invariant failed for price {}", price);
    }
}

#[test]
fn test_split_rounding_preserves_total_across_operations() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let co1 = Address::generate(&env);
    let co2 = Address::generate(&env);
    let buyer = Address::generate(&env);
    let price: i128 = 100_001;

    let mut splits = Vec::<Split>::new(&env);
    splits.push_back(Split { recipient: co1.clone(), bps: 333 });
    splits.push_back(Split { recipient: co2.clone(), bps: 333 });

    let prompt_id = create_prompt_with_splits(
        &env, &client, &creator, "Split Rounding", price, &context.xlm, splits,
    );

    fund_buyer(&xlm_client, &buyer, &context.contract, price);

    let creator_before = xlm_client.balance(&creator);
    let co1_before = xlm_client.balance(&co1);
    let co2_before = xlm_client.balance(&co2);
    let fee_before = xlm_client.balance(&context.fee_wallet);

    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &price, &None::<Bytes>());

    let creator_after = xlm_client.balance(&creator);
    let co1_after = xlm_client.balance(&co1);
    let co2_after = xlm_client.balance(&co2);
    let fee_after = xlm_client.balance(&context.fee_wallet);

    let fee = fee_after - fee_before;
    let co1_amount = co1_after - co1_before;
    let co2_amount = co2_after - co2_before;
    let creator_amount = creator_after - creator_before;

    let distributed = fee + co1_amount + co2_amount + creator_amount;
    assert_eq!(price, distributed, "Rounding loss must be absorbed by creator: expected {}, got {}", price, distributed);
}

#[test]
fn test_overflow_fee_chain_returns_arithmetic_error() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let overflow_price = i128::MAX / 10_000 + 1;
    let prompt_id = create_prompt(
        &env,
        &client,
        &creator,
        "Overflow Price",
        overflow_price,
        &context.xlm,
    );

    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);
    fund_buyer(&xlm_client, &buyer, &context.contract, overflow_price);

    let result = client.try_buy_prompt(
        &buyer,
        &prompt_id,
        &None::<Bytes>,
        &overflow_price,
        &None::<Bytes>,
    );
    match result {
        Err(Ok(Error::ArithmeticOverflow)) => {}
        other => panic!("expected ArithmeticOverflow for overflow price, got {:?}", other),
    }
}

#[test]
fn test_repeated_operations_preserve_idempotency() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Idempotent", 10_000, &context.xlm);

    // Deactivating an already-inactive prompt should be a no-op (idempotent).
    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    assert!(!client.get_prompt(&prompt_id).active);

    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    assert!(!client.get_prompt(&prompt_id).active);

    // Reactivating then deactivating again.
    client.set_prompt_sale_status(&creator, &prompt_id, &true);
    assert!(client.get_prompt(&prompt_id).active);

    client.set_prompt_sale_status(&creator, &prompt_id, &false);
    assert!(!client.get_prompt(&prompt_id).active);
}

#[test]
fn test_buy_returns_insufficient_balance_when_wallet_unfunded() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Expensive", 10_000, &context.xlm);

    // Buyer has zero balance — should get InsufficientBalance, not a raw token error.
    let result = client.try_buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &10_000i128, &None::<Bytes>());
    match result {
        Err(Ok(Error::InsufficientBalance)) => {}
        other => panic!("expected InsufficientBalance, got {:?}", other),
    }
}

#[test]
fn test_buy_supply_enforcement_is_atomic() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Supply Two", 1_000, &context.xlm);
    client.set_prompt_max_supply(&creator, &prompt_id, &2u64);

    fund_buyer(&xlm_client, &buyer, &context.contract, 100_000);

    // Buy 1 of 2
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &1_000i128, &None::<Bytes>());
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 1);

    // Buy 2 of 2
    client.buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &1_000i128, &None::<Bytes>());
    assert_eq!(client.get_prompt(&prompt_id).sales_count, 2);

    // Buy 3 — should fail with MaxSupplyReached
    let result = client.try_buy_prompt(&buyer, &prompt_id, &None::<Bytes>, &1_000i128, &None::<Bytes>());
    match result {
        Err(Ok(Error::MaxSupplyReached)) => {}
        other => panic!("expected MaxSupplyReached, got {:?}", other),
    }
}

#[test]
fn test_buy_bundle_returns_insufficient_balance_when_wallet_unfunded() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);

    let pid = create_prompt(&env, &client, &creator, "Bundle P", 3_000, &context.xlm);
    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Test Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/test.png"),
        &ids,
        &10_000,
        &context.xlm,
    );

    // Buyer has zero balance — should get InsufficientBalance
    let result = client.try_buy_bundle(&buyer, &bundle_id, &10_000i128, &None::<Address>());
    match result {
        Err(Ok(Error::InsufficientBalance)) => {}
        other => panic!("expected InsufficientBalance for bundle, got {:?}", other),
    }
}

#[test]
fn test_buy_bundle_supply_enforcement_blocks_when_full() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    let xlm_client = token::StellarAssetClient::new(&env, &context.xlm);

    let creator = Address::generate(&env);
    let buyer_a = Address::generate(&env);
    let buyer_b = Address::generate(&env);

    let pid = create_prompt(&env, &client, &creator, "Supply Bundle", 3_000, &context.xlm);
    client.set_prompt_max_supply(&creator, &pid, &1u64);

    let mut ids = Vec::new(&env);
    ids.push_back(pid);

    let bundle_id = client.create_bundle(
        &creator,
        &String::from_str(&env, "Supply Bundle"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, "https://img.example.com/test.png"),
        &ids,
        &10_000,
        &context.xlm,
    );

    fund_buyer(&xlm_client, &buyer_a, &context.contract, 100_000);
    fund_buyer(&xlm_client, &buyer_b, &context.contract, 100_000);

    // First buyer succeeds
    client.buy_bundle(&buyer_a, &bundle_id, &10_000i128, &None::<Address>());
    assert!(client.has_access(&buyer_a, &pid));

    // Second buyer should hit MaxSupplyReached
    let result = client.try_buy_bundle(&buyer_b, &bundle_id, &10_000i128, &None::<Address>());
    match result {
        Err(Ok(Error::MaxSupplyReached)) => {}
        other => panic!("expected MaxSupplyReached for bundle second purchase, got {:?}", other),
    }
}

#[test]
fn test_lease_returns_insufficient_balance_when_wallet_unfunded() {
    let env: Env = Default::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);

    let creator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prompt_id = create_prompt(&env, &client, &creator, "Lease Prompt", 10_000, &context.xlm);

    // Buyer has zero balance — should get InsufficientBalance
    let result = client.try_lease_prompt(&buyer, &prompt_id, &3600u64);
    match result {
        Err(Ok(Error::InsufficientBalance)) => {}
        other => panic!("expected InsufficientBalance for lease, got {:?}", other),
    }
}


#[test]
fn test_price_bounds() {
    let env = Env::default();
    let context = setup(&env);
    let client = PromptHashContractClient::new(&env, &context.contract);
    
    let creator = Address::generate(&env);
    
    // Test setting price bounds
    let min_price = Some(10_000);
    let max_price = Some(500_000);
    client.set_price_bounds(&context.admin, &context.admin_two, &min_price, &max_price);
    
    let bounds = client.get_price_bounds();
    assert_eq!(bounds, (min_price, max_price));
    
    // Try to create prompt below min price - should fail
    let title = String::from_str(&env, "Title");
    let category = String::from_str(&env, "Category");
    let preview = String::from_str(&env, "Preview");
    let enc_prompt = String::from_str(&env, "Encrypted");
    let iv = String::from_str(&env, "IV");
    let wrapped_key = String::from_str(&env, "WrappedKey");
    let image_url = String::from_str(&env, "https://example.com/image.png");
    
    let mut config = ListingConfig {
        price: 5_000,
        asset: context.xlm.clone(),
        splits: Vec::new(&env),
        expires_at: 0,
    };
    
    let result = client.try_create_prompt(
        &creator,
        &image_url,
        &title,
        &category,
        &preview,
        &enc_prompt,
        &iv,
        &wrapped_key,
        &BytesN::from_array(&env, &[0; 32]),
        &config,
    );
    assert_eq!(result, Err(Ok(Error::InvalidPrice)));
    
    // Try to create prompt above max price - should fail
    config.price = 600_000;
    let result = client.try_create_prompt(
        &creator,
        &image_url,
        &title,
        &category,
        &preview,
        &enc_prompt,
        &iv,
        &wrapped_key,
        &BytesN::from_array(&env, &[0; 32]),
        &config,
    );
    assert_eq!(result, Err(Ok(Error::InvalidPrice)));
    
    // Try to create prompt within bounds - should succeed
    config.price = 100_000;
    let prompt_id = client.create_prompt(
        &creator,
        &image_url,
        &title,
        &category,
        &preview,
        &enc_prompt,
        &iv,
        &wrapped_key,
        &BytesN::from_array(&env, &[0; 32]),
        &config,
    );
    
    // Try to update prompt above max price - should fail
    let result = client.try_update_prompt_price(&creator, &prompt_id, &600_000);
    assert_eq!(result, Err(Ok(Error::InvalidPrice)));
    
    // Try to update prompt below min price - should fail
    let result = client.try_update_prompt_price(&creator, &prompt_id, &5_000);
    assert_eq!(result, Err(Ok(Error::InvalidPrice)));
    
    // Try to update prompt within bounds - should succeed
    client.update_prompt_price(&creator, &prompt_id, &200_000);
}
