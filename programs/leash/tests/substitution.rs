//! Account substitution (01-onchain-program §11.5, threat T6): every account slot of `pay` fed a
//! wrong-but-plausible account must fail and move nothing. The plausible alternatives come from a
//! second owner with the same setup (its principal, agent, allowlist entry, request, delegation,
//! Subscription Authority and token account), a second mint, and look-alike token accounts.

mod common;

use anchor_lang::{
    error::ErrorCode as AnchorError,
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_program},
};
use common::*;
use leash::{constants::SUBSCRIPTIONS_PROGRAM_ID, errors::LeashError, PayArgs, RequestArgs};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// A second owner with its own principal, agent, allowlist entry for the same merchant,
/// approved request, Subscription Authority and delegation.
struct Other {
    agent_key: Keypair,
    principal: Pubkey,
    agent: Pubkey,
    merchant_entry: Pubkey,
    request: Pubkey,
    owner_ata: Pubkey,
    subscription_authority: Pubkey,
    delegation: Pubkey,
}

fn send(env: &mut Env, ix: Instruction, signer: &Keypair) {
    env.send(ix, &[signer]).expect("setup transaction");
}

fn second_owner(env: &mut Env) -> Other {
    let owner = test_key("secondOwner");
    let agent_key = test_key("secondAgentKey");
    env.svm.airdrop(&owner.pubkey(), 100 * SOL).unwrap();
    env.svm.airdrop(&agent_key.pubkey(), 10 * SOL).unwrap();
    let owner_ata = ata(&owner.pubkey(), &env.mint, &TOKEN_PROGRAM);
    env.set_token_balance(owner_ata, &owner.pubkey(), 100 * USDC);

    let principal = principal_pda(&owner.pubkey());
    let agent = agent_pda(&principal, &agent_key.pubkey());
    let merchant = env.merchant.pubkey();
    let merchant_entry = payee_pda(&agent, &merchant);
    let accounts = leash::accounts::InitializePrincipal {
        owner: owner.pubkey(),
        principal,
        system_program: system_program::ID,
        event_authority: event_authority(),
        program: leash::ID,
    };
    send(
        env,
        leash_ix(
            accounts,
            leash::instruction::InitializePrincipal { guardian: None },
        ),
        &owner,
    );
    let accounts = leash::accounts::CreateAgent {
        owner: owner.pubkey(),
        principal,
        agent,
        mint: env.mint,
        system_program: system_program::ID,
        event_authority: event_authority(),
        program: leash::ID,
    };
    let args = leash::instruction::CreateAgent {
        agent_key: agent_key.pubkey(),
        label: padded("Other agent"),
        policy: demo_policy(),
    };
    send(env, leash_ix(accounts, args), &owner);
    let accounts = leash::accounts::AddPayee {
        owner: owner.pubkey(),
        principal,
        agent,
        payee_entry: merchant_entry,
        system_program: system_program::ID,
        event_authority: event_authority(),
        program: leash::ID,
    };
    let args = leash::instruction::AddPayee {
        payee: merchant,
        label: padded("Research API"),
        limits: merchant_limits(),
    };
    send(env, leash_ix(accounts, args), &owner);

    // An approved request for the same merchant, amount and reference our tests use.
    let request = request_pda(&agent, 0);
    let accounts = leash::accounts::RequestPayment {
        agent_key: agent_key.pubkey(),
        rent_payer: agent_key.pubkey(),
        principal,
        agent,
        payee_entry: Some(merchant_entry),
        request,
        system_program: system_program::ID,
        event_authority: event_authority(),
        program: leash::ID,
    };
    let args = leash::instruction::RequestPayment {
        args: RequestArgs {
            payee: merchant,
            amount: 2 * USDC,
            reference: reference(1),
            memo: padded("A detailed market report"),
        },
    };
    send(env, leash_ix(accounts, args), &agent_key);
    let accounts = leash::accounts::ApproveRequest {
        owner: owner.pubkey(),
        principal,
        agent,
        request,
        event_authority: event_authority(),
        program: leash::ID,
    };
    send(
        env,
        leash_ix(accounts, leash::instruction::ApproveRequest {}),
        &owner,
    );

    send(
        env,
        ix_init_subscription_authority(&owner.pubkey(), &env.mint, &owner_ata),
        &owner,
    );
    let subscription_authority = subscription_authority_pda(&owner.pubkey(), &env.mint);
    let data = env.data(&subscription_authority);
    let init_id = i64::from_le_bytes(data[98..106].try_into().unwrap());
    let allowance = Allowance::Recurring {
        amount_per_period: 5 * USDC,
        period_length_s: 86_400,
        start_ts: NOW,
        expiry_ts: 0,
    };
    let ix = ix_create_delegation(&owner.pubkey(), &env.mint, &agent, 0, allowance, init_id);
    send(env, ix, &owner);
    Other {
        agent_key,
        principal,
        agent,
        merchant_entry,
        request,
        owner_ata,
        subscription_authority,
        delegation: delegation_pda(&subscription_authority, &owner.pubkey(), &agent, 0),
    }
}

/// Every token balance in play, and the delegations.
fn state(env: &Env, other: &Other) -> (Vec<u64>, Vec<u8>, Vec<u8>) {
    let balances = [
        env.owner_ata,
        env.merchant_ata,
        env.attacker_ata,
        other.owner_ata,
    ]
    .iter()
    .map(|address| env.token_balance(address))
    .collect();
    (
        balances,
        env.data(&env.delegation),
        env.data(&other.delegation),
    )
}

fn args() -> PayArgs {
    Env::pay_args(10_000, 1)
}

/// Asserts that `pay` with these accounts fails with `expected` and changes nothing.
#[track_caller]
fn rejected(env: &mut Env, other: &Other, accounts: leash::accounts::Pay, expected: u32) {
    let before = state(env, other);
    expect_error(env.pay_with(accounts, args()), expected);
    assert!(
        state(env, other) == before,
        "a substituted payment changed state"
    );
}

#[test]
fn the_unmodified_payment_goes_through() {
    let mut env = Env::new();
    second_owner(&mut env);
    let accounts = env.pay_accounts(env.merchant_ata);
    env.pay_with(accounts, args()).expect("the baseline pays");
}

#[test]
fn signer_principal_and_agent_cannot_be_swapped() {
    let mut env = Env::new();
    let other = second_owner(&mut env);
    let seeds = anchor_code(AnchorError::ConstraintSeeds);

    // Another key signing for our agent, or the other agent's key signing for it.
    for signer in [
        env.stranger.insecure_clone(),
        other.agent_key.insecure_clone(),
    ] {
        let accounts = leash::accounts::Pay {
            agent_key: signer.pubkey(),
            ..env.pay_accounts(env.merchant_ata)
        };
        let before = state(&env, &other);
        let ix = leash_ix(accounts, leash::instruction::Pay { args: args() });
        expect_error(env.send(ix, &[&signer]), seeds);
        assert!(state(&env, &other) == before);
    }
    // The other owner's principal with our agent, and the other agent under our principal.
    let accounts = leash::accounts::Pay {
        principal: other.principal,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, seeds);
    let accounts = leash::accounts::Pay {
        agent: other.agent,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, seeds);
}

#[test]
fn another_agents_allowlist_entry_or_request_is_not_ours() {
    let mut env = Env::new();
    let other = second_owner(&mut env);
    let accounts = leash::accounts::Pay {
        payee_entry: Some(other.merchant_entry),
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(
        &mut env,
        &other,
        accounts,
        code(LeashError::DeniedPayeeNotAllowed),
    );

    // The other agent's approved request, for the same merchant, amount and reference.
    let receiver = other.agent_key.pubkey();
    let accounts = leash::accounts::Pay {
        request: Some(other.request),
        request_rent_receiver: Some(receiver),
        ..env.pay_accounts(env.merchant_ata)
    };
    let before = state(&env, &other);
    let args = PayArgs {
        amount: 2 * USDC,
        reference: reference(1),
        memo: padded("A detailed market report"),
    };
    expect_error(
        env.pay_with(accounts, args),
        code(LeashError::RequestMismatch),
    );
    assert!(state(&env, &other) == before);
    assert!(env.exists(&other.request));
}

#[test]
fn the_delegation_must_be_this_owners_to_this_agent() {
    let mut env = Env::new();
    let other = second_owner(&mut env);
    let mismatch = code(LeashError::DelegationMismatch);

    // The other owner's delegation (to its own agent).
    let accounts = leash::accounts::Pay {
        delegation: other.delegation,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, mismatch);

    // Our owner's delegation to someone else.
    let stranger = env.stranger.pubkey();
    let allowance = Allowance::Recurring {
        amount_per_period: 50 * USDC,
        period_length_s: 86_400,
        start_ts: NOW,
        expiry_ts: 0,
    };
    env.create_delegation(&stranger, 1, allowance).unwrap();
    let to_stranger = delegation_pda(
        &env.subscription_authority,
        &env.owner.pubkey(),
        &stranger,
        1,
    );
    let accounts = leash::accounts::Pay {
        delegation: to_stranger,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, mismatch);

    // Not a Subscriptions account at all, or a Subscriptions account that is no delegation.
    let accounts = leash::accounts::Pay {
        delegation: env.principal,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, mismatch);
    let accounts = leash::accounts::Pay {
        delegation: env.subscription_authority,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(
        &mut env,
        &other,
        accounts,
        code(LeashError::UnsupportedDelegation),
    );

    // A delegation account whose layout version Leash does not know.
    let mut data = env.data(&env.delegation);
    data[1] = 2;
    let forged = test_key("forgedDelegation").pubkey();
    env.put_account(forged, SUBSCRIPTIONS_PROGRAM_ID, data);
    let accounts = leash::accounts::Pay {
        delegation: forged,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(
        &mut env,
        &other,
        accounts,
        code(LeashError::UnsupportedDelegation),
    );
}

#[test]
fn the_subscription_authority_must_be_the_one_the_delegation_names() {
    let mut env = Env::new();
    let other = second_owner(&mut env);
    let accounts = leash::accounts::Pay {
        subscription_authority: other.subscription_authority,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(
        &mut env,
        &other,
        accounts,
        code(LeashError::DelegationMismatch),
    );
    let accounts = leash::accounts::Pay {
        subscription_authority: env.principal,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(
        &mut env,
        &other,
        accounts,
        code(LeashError::DelegationMismatch),
    );
}

#[test]
fn the_source_must_be_the_owners_associated_token_account() {
    let mut env = Env::new();
    let other = second_owner(&mut env);
    let mismatch = code(LeashError::DelegationMismatch);
    // Another owner's account, the attacker's, and one of our owner's that is not the ATA.
    let side_account = test_key("ownerSideAccount").pubkey();
    let owner = env.owner.pubkey();
    env.set_token_balance(side_account, &owner, 50 * USDC);
    for source in [other.owner_ata, env.attacker_ata, side_account] {
        let accounts = leash::accounts::Pay {
            source_token_account: source,
            ..env.pay_accounts(env.merchant_ata)
        };
        rejected(&mut env, &other, accounts, mismatch);
    }
}

#[test]
fn the_destination_must_hold_the_mint_and_belong_to_someone_else() {
    let mut env = Env::new();
    let other = second_owner(&mut env);
    let invalid = code(LeashError::InvalidDestination);

    // The source itself. Anchor 1.2 rejects a writable account passed twice before the handler
    // runs; the handler's own `InvalidDestination` check stays as defense in depth (and is what
    // `report_denied_attempt`, whose token accounts are read-only, returns).
    let accounts = leash::accounts::Pay {
        destination_token_account: env.owner_ata,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(
        &mut env,
        &other,
        accounts,
        anchor_code(AnchorError::ConstraintDuplicateMutableAccount),
    );

    // Accounts owned by the agent key or by the Agent PDA.
    for (name, holder) in [
        ("keyAccount", env.agent_key.pubkey()),
        ("pdaAccount", env.agent),
    ] {
        let address = test_key(name).pubkey();
        env.set_token_balance(address, &holder, 0);
        let accounts = leash::accounts::Pay {
            destination_token_account: address,
            ..env.pay_accounts(env.merchant_ata)
        };
        rejected(&mut env, &other, accounts, invalid);
    }

    // The merchant's account for another mint.
    let other_mint = test_key("otherMint").pubkey();
    let owner = env.owner.pubkey();
    env.put_account(other_mint, TOKEN_PROGRAM, mint_data(&owner, 0, 6));
    let foreign = test_key("merchantOtherMint").pubkey();
    let merchant = env.merchant.pubkey();
    env.put_account(
        foreign,
        TOKEN_PROGRAM,
        token_account_data(&other_mint, &merchant, 0),
    );
    let accounts = leash::accounts::Pay {
        destination_token_account: foreign,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, code(LeashError::MintMismatch));
}

#[test]
fn mint_token_program_and_program_addresses_are_fixed() {
    let mut env = Env::new();
    let other = second_owner(&mut env);

    let other_mint = test_key("otherMint").pubkey();
    let owner = env.owner.pubkey();
    env.put_account(other_mint, TOKEN_PROGRAM, mint_data(&owner, 0, 6));
    let accounts = leash::accounts::Pay {
        mint: other_mint,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, code(LeashError::MintMismatch));

    // Token-2022 does not own this mint.
    let accounts = leash::accounts::Pay {
        token_program: TOKEN_2022_PROGRAM,
        ..env.pay_accounts(env.merchant_ata)
    };
    let before = state(&env, &other);
    assert!(env.pay_with(accounts, args()).is_err());
    assert!(state(&env, &other) == before);

    let address = anchor_code(AnchorError::ConstraintAddress);
    let accounts = leash::accounts::Pay {
        subscriptions_program: leash::ID,
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, address);
    let accounts = leash::accounts::Pay {
        subscriptions_event_authority: event_authority(),
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, address);
    let accounts = leash::accounts::Pay {
        event_authority: test_key("fakeAuthority").pubkey(),
        ..env.pay_accounts(env.merchant_ata)
    };
    rejected(&mut env, &other, accounts, address);
}

#[test]
fn reports_run_the_same_account_checks() {
    let mut env = Env::new();
    let other = second_owner(&mut env);
    let base = || leash::accounts::ReportDeniedAttempt {
        payee_entry: None,
        ..env.report_accounts(env.attacker_ata)
    };
    let cases = [
        (
            leash::accounts::ReportDeniedAttempt {
                delegation: other.delegation,
                ..base()
            },
            code(LeashError::DelegationMismatch),
        ),
        (
            leash::accounts::ReportDeniedAttempt {
                source_token_account: other.owner_ata,
                ..base()
            },
            code(LeashError::DelegationMismatch),
        ),
        (
            leash::accounts::ReportDeniedAttempt {
                destination_token_account: env.owner_ata,
                ..base()
            },
            code(LeashError::InvalidDestination),
        ),
    ];
    for (accounts, expected) in cases {
        expect_error(env.report_with(accounts, Env::pay_args(USDC, 2)), expected);
    }
    let agent: leash::state::Agent = env.read(&env.agent);
    assert_eq!(agent.stats.denied_count, 0);
}
