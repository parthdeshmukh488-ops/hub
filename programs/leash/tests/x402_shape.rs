//! The x402 transaction shape (01-onchain-program §11.3, 02-contracts §9): the facilitator's
//! fee payer signs a `[SetComputeUnitLimit, SetComputeUnitPrice, pay, Memo]` transaction it
//! appears in nowhere else, and simulation shows exactly one `TransferChecked` of the price to the
//! merchant. That is what the official facilitator's smart-wallet path verifies (ADR-0003).

mod common;

use anchor_lang::solana_program::instruction::Instruction;
use common::*;
use leash::{errors::LeashError, events::PaymentExecuted};
use solana_keypair::Keypair;
use solana_signer::Signer;

fn compute_budget(limit: u32, micro_lamports: u64) -> [Instruction; 2] {
    let mut limit_data = vec![2];
    limit_data.extend_from_slice(&limit.to_le_bytes());
    let mut price_data = vec![3];
    price_data.extend_from_slice(&micro_lamports.to_le_bytes());
    [
        Instruction {
            program_id: COMPUTE_BUDGET_PROGRAM,
            accounts: vec![],
            data: limit_data,
        },
        Instruction {
            program_id: COMPUTE_BUDGET_PROGRAM,
            accounts: vec![],
            data: price_data,
        },
    ]
}

/// The x402 payment transaction's instructions for `amount` to `destination`.
fn x402_instructions(
    env: &Env,
    destination: anchor_lang::prelude::Pubkey,
    amount: u64,
) -> Vec<Instruction> {
    let [limit, price] = compute_budget(200_000, 1);
    let pay = leash_ix(
        env.pay_accounts(destination),
        leash::instruction::Pay {
            args: Env::pay_args(amount, 9),
        },
    );
    let memo = Instruction {
        program_id: MEMO_PROGRAM,
        accounts: vec![],
        data: b"3f9a2c7e51d04b8a9e6f0c1d2b3a4f5e".to_vec(),
    };
    vec![limit, price, pay, memo]
}

fn facilitator(env: &mut Env) -> Keypair {
    let key = test_key("facilitator");
    env.svm.airdrop(&key.pubkey(), SOL).unwrap();
    key
}

#[test]
fn a_facilitator_pays_the_fee_and_appears_in_no_instruction() {
    let mut env = Env::new();
    let fee_payer = facilitator(&mut env);
    let instructions = x402_instructions(&env, env.merchant_ata, 10_000);
    for instruction in &instructions {
        assert!(instruction
            .accounts
            .iter()
            .all(|meta| meta.pubkey != fee_payer.pubkey()));
    }

    let agent_key = env.agent_key.insecure_clone();
    let (fee_payer_before, agent_before) = (
        env.lamports(&fee_payer.pubkey()),
        env.lamports(&agent_key.pubkey()),
    );
    let sent = env
        .send_with_payer(&instructions, &fee_payer, &[&agent_key])
        .expect("the x402 payment settles");

    // The facilitator paid the network fee; the agent key only signed.
    assert_eq!(
        env.lamports(&fee_payer.pubkey()),
        fee_payer_before - sent.meta.fee
    );
    assert_eq!(env.lamports(&agent_key.pubkey()), agent_before);
    // Exactly one TransferChecked, of the price, and the merchant got it.
    assert_eq!(sent.transfers_checked(), 1);
    let (_, data) = sent
        .inner()
        .into_iter()
        .find(|(program, data)| {
            *program == TOKEN_PROGRAM && data.first() == Some(&TRANSFER_CHECKED)
        })
        .unwrap();
    assert_eq!(u64::from_le_bytes(data[1..9].try_into().unwrap()), 10_000);
    assert_eq!(data[9], 6, "TransferChecked carries the mint's decimals");
    assert_eq!(env.token_balance(&env.merchant_ata), 10_000);
    assert_eq!(sent.events::<PaymentExecuted>().len(), 1);
    println!(
        "x402 transaction: {} compute units",
        sent.meta.compute_units_consumed
    );
}

#[test]
fn a_denied_payment_fails_the_whole_x402_transaction() {
    let mut env = Env::new();
    let fee_payer = facilitator(&mut env);
    let instructions = x402_instructions(&env, env.attacker_ata, 10_000);
    let agent_key = env.agent_key.insecure_clone();
    let owner_before = env.token_balance(&env.owner_ata);
    expect_error(
        env.send_with_payer(&instructions, &fee_payer, &[&agent_key]),
        code(LeashError::DeniedPayeeNotAllowed),
    );
    assert_eq!(env.token_balance(&env.attacker_ata), 0);
    assert_eq!(env.token_balance(&env.owner_ata), owner_before);
}
