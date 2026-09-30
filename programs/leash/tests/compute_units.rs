//! Compute units of every instruction on the real binaries (01-onchain-program §11.4). The table in
//! `programs/leash/CU.md` comes from this test; print it again with
//! `cargo test -p leash --test compute_units -- --nocapture`.

mod common;

use anchor_lang::{prelude::Pubkey, solana_program::system_program};
use common::*;
use solana_signer::Signer;

/// `pay` without a request must stay under this (01 §11.4).
const PAY_BUDGET: u64 = 100_000;

#[derive(Default)]
struct Table(Vec<(&'static str, &'static str, u64)>);

impl Table {
    fn row(&mut self, instruction: &'static str, case: &'static str, sent: Sent) {
        self.0
            .push((instruction, case, sent.meta.compute_units_consumed));
    }

    fn print(&self) {
        println!("| Instruction | Case | Compute units |");
        println!("| --- | --- | ---: |");
        for (instruction, case, units) in &self.0 {
            println!("| `{instruction}` | {case} | {units} |");
        }
    }
}

#[test]
fn compute_units_of_every_instruction() {
    let mut table = Table::default();
    let mut env = Env::new();
    let (owner, guardian, stranger) = (
        env.owner.insecure_clone(),
        env.guardian.insecure_clone(),
        env.stranger.insecure_clone(),
    );
    let (merchant, attacker_ata) = (env.merchant.pubkey(), env.attacker_ata);
    let agent_key = env.agent_key.pubkey();

    // The setup instructions, measured on a second owner (the stranger).
    let principal = principal_pda(&stranger.pubkey());
    let second_key: Pubkey = test_key("secondAgentKey").pubkey();
    let agent = agent_pda(&principal, &second_key);
    let entry = payee_pda(&agent, &merchant);
    let ix = leash_ix(
        leash::accounts::InitializePrincipal {
            owner: stranger.pubkey(),
            principal,
            system_program: system_program::ID,
            event_authority: event_authority(),
            program: leash::ID,
        },
        leash::instruction::InitializePrincipal {
            guardian: Some(guardian.pubkey()),
        },
    );
    table.row(
        "initialize_principal",
        "with a guardian",
        env.send(ix, &[&stranger]).unwrap(),
    );
    let ix = leash_ix(
        leash::accounts::CreateAgent {
            owner: stranger.pubkey(),
            principal,
            agent,
            mint: env.mint,
            system_program: system_program::ID,
            event_authority: event_authority(),
            program: leash::ID,
        },
        leash::instruction::CreateAgent {
            agent_key: second_key,
            label: padded("Second agent"),
            policy: demo_policy(),
        },
    );
    table.row("create_agent", "", env.send(ix, &[&stranger]).unwrap());
    let ix = leash_ix(
        leash::accounts::AddPayee {
            owner: stranger.pubkey(),
            principal,
            agent,
            payee_entry: entry,
            system_program: system_program::ID,
            event_authority: event_authority(),
            program: leash::ID,
        },
        leash::instruction::AddPayee {
            payee: merchant,
            label: padded("Research API"),
            limits: merchant_limits(),
        },
    );
    table.row("add_payee", "", env.send(ix, &[&stranger]).unwrap());
    let ix = leash_ix(
        leash::accounts::RemovePayee {
            owner: stranger.pubkey(),
            principal,
            agent,
            payee_entry: entry,
            event_authority: event_authority(),
            program: leash::ID,
        },
        leash::instruction::RemovePayee {},
    );
    table.row("remove_payee", "", env.send(ix, &[&stranger]).unwrap());
    let ix = leash_ix(
        leash::accounts::CloseAgent {
            owner: stranger.pubkey(),
            principal,
            agent,
            event_authority: event_authority(),
            program: leash::ID,
        },
        leash::instruction::CloseAgent {},
    );
    table.row("close_agent", "", env.send(ix, &[&stranger]).unwrap());

    // Owner and guardian switches.
    let sent = env
        .set_guardian_as(&owner, Some(guardian.pubkey()))
        .unwrap();
    table.row("set_guardian", "", sent);
    table.row(
        "update_policy",
        "",
        env.update_policy_as(&owner, demo_policy()).unwrap(),
    );
    let sent = env
        .update_payee_as(&owner, env.merchant_entry, merchant_limits())
        .unwrap();
    table.row("update_payee", "", sent);
    table.row(
        "freeze_agent",
        "by the guardian",
        env.freeze_agent_as(&guardian).unwrap(),
    );
    table.row("unfreeze_agent", "", env.unfreeze_agent_as(&owner).unwrap());
    table.row(
        "freeze_principal",
        "by the guardian",
        env.freeze_principal_as(&guardian).unwrap(),
    );
    table.row(
        "unfreeze_principal",
        "",
        env.unfreeze_principal_as(&owner).unwrap(),
    );

    // The agent.
    table.row(
        "pay",
        "recurring allowance, first payment",
        env.pay(10_000).unwrap(),
    );
    table.row(
        "pay",
        "recurring allowance, later payment",
        env.pay(10_000).unwrap(),
    );
    table.row(
        "request_payment",
        "",
        env.request_payment(merchant, 2 * USDC, 1).unwrap(),
    );
    let first = request_pda(&env.agent, 0);
    table.row(
        "approve_request",
        "",
        env.approve_request_as(&owner, first).unwrap(),
    );
    let sent = env.pay_with_request(first, 2 * USDC, 1).unwrap();
    table.row("pay", "with an approved request (closes it)", sent);
    env.request_payment(merchant, 2 * USDC, 2).unwrap();
    let second = request_pda(&env.agent, 1);
    let sent = env.reject_request_as(&guardian, second, agent_key).unwrap();
    table.row("reject_request", "by the guardian", sent);
    env.request_payment(merchant, 2 * USDC, 3).unwrap();
    let third = request_pda(&env.agent, 2);
    table.row(
        "report_denied_attempt",
        "strike",
        env.report_to(attacker_ata, USDC).unwrap(),
    );
    env.report_to(attacker_ata, USDC).unwrap();
    let sent = env.report_to(attacker_ata, USDC).unwrap();
    table.row(
        "report_denied_attempt",
        "third strike, trips the wire",
        sent,
    );
    env.warp(3_600);
    let sent = env.expire_request_as(&stranger, third, agent_key).unwrap();
    table.row("expire_request", "", sent);

    let mut fixed = Env::setup(Setup {
        allowance: Allowance::Fixed {
            amount: 10 * USDC,
            expiry_ts: 0,
        },
        ..Setup::default()
    });
    table.row("pay", "fixed allowance", fixed.pay(10_000).unwrap());

    table.print();
    for (instruction, case, units) in &table.0 {
        if *instruction == "pay" && !case.contains("request") {
            assert!(
                *units < PAY_BUDGET,
                "pay ({case}) used {units} compute units"
            );
        }
    }
}
