//! The LiteSVM harness shared by the program suites (01-onchain-program §11).
//!
//! It runs the committed binaries (`artifacts/programs/leash.so` and `subscriptions.so`, the
//! audited Subscriptions tag) in-process, with:
//! - a USDC-like mint (6 decimals) and the owner's associated token account holding 100 USDC,
//! - the owner's principal (with a guardian), an agent with the demo policy, and the merchant on
//!   its allowlist,
//! - the owner's Subscription Authority and a recurring delegation (5 USDC a day) whose delegatee
//!   is the Agent PDA, both created by real Subscriptions transactions.
//!
//! Keys are deterministic: the ed25519 seed of `name` is `sha256("leash:test-key:" + name)`, as in
//! the policy vectors and the SDK's tests.
// Every suite uses a different part of the harness.
#![allow(dead_code)]
// Helpers return LiteSVM's failure metadata (with the logs) as is: a large `Err` costs nothing
// that matters in a test, and callers read it directly.
#![allow(clippy::result_large_err)]

use anchor_lang::{
    event::EVENT_IX_TAG_LE,
    prelude::{AccountDeserialize, AccountSerialize, Clock, Pubkey},
    pubkey,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        system_program,
    },
    AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
};
use leash::{
    constants::{
        AGENT_SEED, ASSOCIATED_TOKEN_PROGRAM_ID, PAYEE_SEED, PRINCIPAL_SEED, REQUEST_SEED,
        SUBSCRIPTIONS_EVENT_AUTHORITY, SUBSCRIPTIONS_PROGRAM_ID,
    },
    errors::LeashError,
    state::{PayeeLimits, PayeeMode, Policy},
    PayArgs, RequestArgs,
};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

/// 2026-10-02 10:00 UTC, the "now" of the policy vectors.
pub const NOW: i64 = 1_790_935_200;
pub const DAY: i64 = 86_400;
/// One USDC in base units.
pub const USDC: u64 = 1_000_000;
pub const SOL: u64 = 1_000_000_000;

pub const TOKEN_PROGRAM: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const MEMO_PROGRAM: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
pub const COMPUTE_BUDGET_PROGRAM: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");

/// `TransferChecked` in SPL Token and Token-2022.
pub const TRANSFER_CHECKED: u8 = 12;

/// The deterministic test keypair for `name`.
pub fn test_key(name: &str) -> Keypair {
    let seed: [u8; 32] = Sha256::digest(format!("leash:test-key:{name}").as_bytes()).into();
    Keypair::new_from_array(seed)
}

/// A zero-padded fixed-size string (labels and memos).
pub fn padded<const N: usize>(text: &str) -> [u8; N] {
    let mut out = [0u8; N];
    out[..text.len()].copy_from_slice(text.as_bytes());
    out
}

/// A distinct reference for each `n`.
pub fn reference(n: u8) -> [u8; 32] {
    Sha256::digest([b"leash:reference:".as_slice(), &[n]].concat()).into()
}

/// The demo policy (02-contracts §11, `research-assistant`).
pub fn demo_policy() -> Policy {
    Policy {
        max_per_payment: USDC,
        max_per_request: 5 * USDC,
        payee_mode: PayeeMode::AllowListOnly,
        velocity_max_payments: 30,
        velocity_window_secs: 60,
        tripwire_max_strikes: 3,
        tripwire_window_secs: 600,
        request_ttl_secs: 3_600,
        valid_until: 0,
    }
}

/// The merchant's limits in the demo preset: 2 USDC per payment, 3 USDC a day.
pub fn merchant_limits() -> PayeeLimits {
    PayeeLimits {
        max_per_payment: 2 * USDC,
        period_limit: 3 * USDC,
        period_secs: 86_400,
    }
}

// ---------------------------------------------------------------------------------------- PDAs

pub fn principal_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PRINCIPAL_SEED, owner.as_ref()], &leash::ID).0
}

pub fn agent_pda(principal: &Pubkey, agent_key: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[AGENT_SEED, principal.as_ref(), agent_key.as_ref()],
        &leash::ID,
    )
    .0
}

pub fn payee_pda(agent: &Pubkey, payee: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PAYEE_SEED, agent.as_ref(), payee.as_ref()], &leash::ID).0
}

pub fn request_pda(agent: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[REQUEST_SEED, agent.as_ref(), &nonce.to_le_bytes()],
        &leash::ID,
    )
    .0
}

pub fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &leash::ID).0
}

pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), token_program.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

pub fn subscription_authority_pda(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"SubscriptionAuthority", owner.as_ref(), mint.as_ref()],
        &SUBSCRIPTIONS_PROGRAM_ID,
    )
    .0
}

pub fn delegation_pda(
    authority: &Pubkey,
    owner: &Pubkey,
    delegatee: &Pubkey,
    nonce: u64,
) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"delegation",
            authority.as_ref(),
            owner.as_ref(),
            delegatee.as_ref(),
            &nonce.to_le_bytes(),
        ],
        &SUBSCRIPTIONS_PROGRAM_ID,
    )
    .0
}

// ------------------------------------------------------------------------------ token accounts

fn coption_key(key: Option<&Pubkey>) -> [u8; 36] {
    let mut out = [0u8; 36];
    if let Some(key) = key {
        out[0] = 1;
        out[4..].copy_from_slice(key.as_ref());
    }
    out
}

/// An SPL Token mint account (82 bytes).
pub fn mint_data(authority: &Pubkey, supply: u64, decimals: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(82);
    data.extend_from_slice(&coption_key(Some(authority)));
    data.extend_from_slice(&supply.to_le_bytes());
    data.push(decimals);
    data.push(1); // initialized
    data.extend_from_slice(&coption_key(None));
    data
}

/// An initialized SPL Token account (165 bytes) with no delegate.
pub fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(165);
    data.extend_from_slice(mint.as_ref());
    data.extend_from_slice(owner.as_ref());
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&coption_key(None)); // delegate
    data.push(1); // state: initialized
    data.extend_from_slice(&[0u8; 12]); // is_native: None
    data.extend_from_slice(&0u64.to_le_bytes()); // delegated amount
    data.extend_from_slice(&coption_key(None)); // close authority
    data
}

// ------------------------------------------------------------------ Subscriptions instructions

/// `InitSubscriptionAuthority` (discriminator 0): the SPL delegate of the owner's ATA.
pub fn ix_init_subscription_authority(
    owner: &Pubkey,
    mint: &Pubkey,
    owner_ata: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: SUBSCRIPTIONS_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*owner, true),
            AccountMeta::new(subscription_authority_pda(owner, mint), false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*owner_ata, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
        ],
        data: vec![0],
    }
}

/// The allowance a delegation grants.
#[derive(Clone, Copy, Debug)]
pub enum Allowance {
    Recurring {
        amount_per_period: u64,
        period_length_s: u64,
        start_ts: i64,
        expiry_ts: i64,
    },
    Fixed {
        amount: u64,
        expiry_ts: i64,
    },
}

/// `CreateRecurringDelegation` (2) or `CreateFixedDelegation` (1).
pub fn ix_create_delegation(
    owner: &Pubkey,
    mint: &Pubkey,
    delegatee: &Pubkey,
    nonce: u64,
    allowance: Allowance,
    init_id: i64,
) -> Instruction {
    let authority = subscription_authority_pda(owner, mint);
    let mut data = Vec::new();
    match allowance {
        Allowance::Recurring {
            amount_per_period,
            period_length_s,
            start_ts,
            expiry_ts,
        } => {
            data.push(2);
            data.extend_from_slice(&nonce.to_le_bytes());
            data.extend_from_slice(&amount_per_period.to_le_bytes());
            data.extend_from_slice(&period_length_s.to_le_bytes());
            data.extend_from_slice(&start_ts.to_le_bytes());
            data.extend_from_slice(&expiry_ts.to_le_bytes());
        }
        Allowance::Fixed { amount, expiry_ts } => {
            data.push(1);
            data.extend_from_slice(&nonce.to_le_bytes());
            data.extend_from_slice(&amount.to_le_bytes());
            data.extend_from_slice(&expiry_ts.to_le_bytes());
        }
    }
    data.extend_from_slice(&init_id.to_le_bytes());
    Instruction {
        program_id: SUBSCRIPTIONS_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*owner, true),
            AccountMeta::new_readonly(authority, false),
            AccountMeta::new(delegation_pda(&authority, owner, delegatee, nonce), false),
            AccountMeta::new_readonly(*delegatee, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

// ------------------------------------------------------------------------ Leash instructions

/// An instruction of the Leash program.
pub fn leash_ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: leash::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

/// The error a failed transaction reports, as a custom program error code.
pub fn error_code(failure: &FailedTransactionMetadata) -> Option<u32> {
    use solana_transaction::{InstructionError, TransactionError};
    match &failure.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => Some(*code),
        _ => None,
    }
}

/// The Anchor code of a Leash error (6000 + its index).
pub fn code(error: LeashError) -> u32 {
    6000 + error as u32
}

/// The code of an Anchor framework error (constraint failures).
pub fn anchor_code(error: anchor_lang::error::ErrorCode) -> u32 {
    error as u32
}

/// Asserts that `result` failed with `error`, printing the logs otherwise.
#[track_caller]
pub fn expect_error(result: Result<Sent, FailedTransactionMetadata>, expected: u32) {
    match result {
        Ok(sent) => panic!(
            "expected error {expected}, but the transaction succeeded:\n{}",
            sent.meta.pretty_logs()
        ),
        Err(failure) => assert_eq!(
            error_code(&failure),
            Some(expected),
            "wrong error ({:?}):\n{}",
            failure.err,
            failure.meta.pretty_logs()
        ),
    }
}

/// A sent transaction: its metadata and its account keys (to resolve inner instructions).
pub struct Sent {
    pub meta: TransactionMetadata,
    pub keys: Vec<Pubkey>,
}

impl Sent {
    /// Every inner instruction as (program id, data).
    pub fn inner(&self) -> Vec<(Pubkey, Vec<u8>)> {
        self.meta
            .inner_instructions
            .iter()
            .flatten()
            .map(|inner| {
                let program = self.keys[inner.instruction.program_id_index as usize];
                (program, inner.instruction.data.clone())
            })
            .collect()
    }

    /// The Leash events of type `E` this transaction emitted (Anchor `emit_cpi!`).
    pub fn events<E: AnchorDeserialize + Discriminator>(&self) -> Vec<E> {
        self.inner()
            .into_iter()
            .filter(|(program, data)| {
                *program == leash::ID
                    && data.len() >= 8 + E::DISCRIMINATOR.len()
                    && data[..8] == *EVENT_IX_TAG_LE
                    && data[8..8 + E::DISCRIMINATOR.len()] == *E::DISCRIMINATOR
            })
            .map(|(_, data)| {
                E::deserialize(&mut &data[8 + E::DISCRIMINATOR.len()..]).expect("event decodes")
            })
            .collect()
    }

    /// The `TransferChecked` instructions any token program ran inside this transaction.
    pub fn transfers_checked(&self) -> usize {
        self.inner()
            .iter()
            .filter(|(program, data)| {
                (*program == TOKEN_PROGRAM || *program == TOKEN_2022_PROGRAM)
                    && data.first() == Some(&TRANSFER_CHECKED)
            })
            .count()
    }
}

/// Options for [`Env::setup`].
#[derive(Clone, Copy, Debug)]
pub struct Setup {
    pub policy: Policy,
    pub guardian: bool,
    pub merchant: Option<PayeeLimits>,
    pub allowance: Allowance,
    /// The owner's USDC balance.
    pub owner_usdc: u64,
}

impl Default for Setup {
    fn default() -> Self {
        Setup {
            policy: demo_policy(),
            guardian: true,
            merchant: Some(merchant_limits()),
            allowance: Allowance::Recurring {
                amount_per_period: 5 * USDC,
                period_length_s: 86_400,
                start_ts: NOW,
                expiry_ts: 0,
            },
            owner_usdc: 100 * USDC,
        }
    }
}

/// One owner with one agent, funded and delegated, ready to pay.
pub struct Env {
    pub svm: LiteSVM,
    pub owner: Keypair,
    pub agent_key: Keypair,
    pub guardian: Keypair,
    pub stranger: Keypair,
    pub merchant: Keypair,
    pub attacker: Keypair,
    pub mint: Pubkey,
    pub owner_ata: Pubkey,
    pub merchant_ata: Pubkey,
    pub attacker_ata: Pubkey,
    pub principal: Pubkey,
    pub agent: Pubkey,
    pub merchant_entry: Pubkey,
    pub subscription_authority: Pubkey,
    pub delegation: Pubkey,
}

fn read_artifact(name: &str) -> Vec<u8> {
    let path = format!(
        "{}/../../artifacts/programs/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&path).unwrap_or_else(|error| {
        panic!("{path}: {error}. It is built on a machine with the Solana toolchain (programs/leash/README.md).")
    })
}

impl Env {
    /// The default scenario: demo policy, merchant allowlisted, 5 USDC a day.
    pub fn new() -> Self {
        Self::setup(Setup::default())
    }

    pub fn setup(setup: Setup) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(leash::ID, &read_artifact("leash.so"))
            .unwrap();
        svm.add_program(SUBSCRIPTIONS_PROGRAM_ID, &read_artifact("subscriptions.so"))
            .unwrap();
        let mut clock: Clock = svm.get_sysvar();
        clock.unix_timestamp = NOW;
        svm.set_sysvar(&clock);

        let owner = test_key("owner");
        let agent_key = test_key("agentKey");
        let guardian = test_key("guardian");
        let stranger = test_key("stranger");
        let merchant = test_key("merchant");
        let attacker = test_key("attacker");
        for key in [&owner, &agent_key, &guardian, &stranger] {
            svm.airdrop(&key.pubkey(), 100 * SOL).unwrap();
        }

        let mint = test_key("usdcMint").pubkey();
        let owner_ata = ata(&owner.pubkey(), &mint, &TOKEN_PROGRAM);
        let merchant_ata = ata(&merchant.pubkey(), &mint, &TOKEN_PROGRAM);
        let attacker_ata = ata(&attacker.pubkey(), &mint, &TOKEN_PROGRAM);
        let principal = principal_pda(&owner.pubkey());
        let agent = agent_pda(&principal, &agent_key.pubkey());
        let subscription_authority = subscription_authority_pda(&owner.pubkey(), &mint);
        let mut env = Env {
            svm,
            merchant_entry: payee_pda(&agent, &merchant.pubkey()),
            delegation: delegation_pda(&subscription_authority, &owner.pubkey(), &agent, 0),
            owner,
            agent_key,
            guardian,
            stranger,
            merchant,
            attacker,
            mint,
            owner_ata,
            merchant_ata,
            attacker_ata,
            principal,
            agent,
            subscription_authority,
        };
        env.put_account(
            mint,
            TOKEN_PROGRAM,
            mint_data(&env.owner.pubkey(), setup.owner_usdc, 6),
        );
        env.set_token_balance(owner_ata, &env.owner.pubkey(), setup.owner_usdc);
        let (merchant_key, attacker_key) = (env.merchant.pubkey(), env.attacker.pubkey());
        env.set_token_balance(merchant_ata, &merchant_key, 0);
        env.set_token_balance(attacker_ata, &attacker_key, 0);

        let guardian = setup.guardian.then(|| env.guardian.pubkey());
        env.initialize_principal(guardian).unwrap();
        let agent_key = env.agent_key.pubkey();
        env.create_agent(agent_key, setup.policy).unwrap();
        if let Some(limits) = setup.merchant {
            env.add_payee(merchant_key, limits).unwrap();
        }
        env.init_subscription_authority().unwrap();
        let agent = env.agent;
        env.create_delegation(&agent, 0, setup.allowance).unwrap();
        env
    }

    // ------------------------------------------------------------------------------ plumbing

    /// Sends `instructions` with `payer` paying the fee; every signer signs.
    pub fn send_with_payer(
        &mut self,
        instructions: &[Instruction],
        payer: &Keypair,
        signers: &[&Keypair],
    ) -> Result<Sent, FailedTransactionMetadata> {
        self.svm.expire_blockhash();
        let message = Message::new_with_blockhash(
            instructions,
            Some(&payer.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let keys = message.account_keys.clone();
        let mut all: Vec<&Keypair> = vec![payer];
        for signer in signers {
            if !all.iter().any(|k| k.pubkey() == signer.pubkey()) {
                all.push(signer);
            }
        }
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &all).unwrap();
        self.svm
            .send_transaction(tx)
            .map(|meta| Sent { meta, keys })
    }

    /// Sends one instruction; the first signer pays the fee.
    pub fn send(
        &mut self,
        instruction: Instruction,
        signers: &[&Keypair],
    ) -> Result<Sent, FailedTransactionMetadata> {
        let payer = signers[0].insecure_clone();
        self.send_with_payer(&[instruction], &payer, signers)
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn warp(&mut self, secs: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }

    pub fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }

    pub fn exists(&self, address: &Pubkey) -> bool {
        self.svm
            .get_account(address)
            .is_some_and(|a| a.lamports > 0)
    }

    pub fn lamports(&self, address: &Pubkey) -> u64 {
        self.svm.get_account(address).map_or(0, |a| a.lamports)
    }

    /// A Leash account, deserialized.
    pub fn read<T: AccountDeserialize>(&self, address: &Pubkey) -> T {
        let account = self.svm.get_account(address).expect("account exists");
        T::try_deserialize(&mut account.data.as_slice()).expect("account decodes")
    }

    /// Overwrites a Leash account's data with `value` (to set up states instructions can't reach).
    pub fn write<T: AccountSerialize>(&mut self, address: &Pubkey, value: &T) {
        let mut account = self.svm.get_account(address).expect("account exists");
        let mut data = Vec::new();
        value.try_serialize(&mut data).unwrap();
        account.data[..data.len()].copy_from_slice(&data);
        self.svm.set_account(*address, account).unwrap();
    }

    pub fn put_account(&mut self, address: Pubkey, owner: Pubkey, data: Vec<u8>) {
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm
            .set_account(
                address,
                Account {
                    lamports,
                    data,
                    owner,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    /// Creates or overwrites an SPL token account of `mint` for `owner`, keeping any delegate.
    pub fn set_token_balance(&mut self, address: Pubkey, owner: &Pubkey, amount: u64) {
        match self.svm.get_account(&address) {
            Some(mut account) if account.data.len() == 165 => {
                account.data[64..72].copy_from_slice(&amount.to_le_bytes());
                self.svm.set_account(address, account).unwrap();
            }
            _ => {
                let mint = self.mint;
                self.put_account(
                    address,
                    TOKEN_PROGRAM,
                    token_account_data(&mint, owner, amount),
                );
            }
        }
    }

    pub fn token_balance(&self, address: &Pubkey) -> u64 {
        let account = self.svm.get_account(address).expect("token account exists");
        u64::from_le_bytes(account.data[64..72].try_into().unwrap())
    }

    /// Raw data of any account.
    pub fn data(&self, address: &Pubkey) -> Vec<u8> {
        self.svm.get_account(address).expect("account exists").data
    }

    /// Recurring delegation state: (current period start, pulled in period).
    pub fn recurring_state(&self, delegation: &Pubkey) -> (i64, u64) {
        let data = self.data(delegation);
        (
            i64::from_le_bytes(data[171..179].try_into().unwrap()),
            u64::from_le_bytes(data[203..211].try_into().unwrap()),
        )
    }

    /// Fixed delegation state: amount remaining.
    pub fn fixed_remaining(&self, delegation: &Pubkey) -> u64 {
        u64::from_le_bytes(self.data(delegation)[171..179].try_into().unwrap())
    }

    // -------------------------------------------------------------------------- Subscriptions

    pub fn init_subscription_authority(&mut self) -> Result<Sent, FailedTransactionMetadata> {
        let owner = self.owner.insecure_clone();
        let ix = ix_init_subscription_authority(&owner.pubkey(), &self.mint, &self.owner_ata);
        self.send(ix, &[&owner])
    }

    /// The Subscription Authority's `init_id` (it must match every delegation).
    pub fn init_id(&self) -> i64 {
        let data = self.data(&self.subscription_authority);
        i64::from_le_bytes(data[98..106].try_into().unwrap())
    }

    pub fn create_delegation(
        &mut self,
        delegatee: &Pubkey,
        nonce: u64,
        allowance: Allowance,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let owner = self.owner.insecure_clone();
        let ix = ix_create_delegation(
            &owner.pubkey(),
            &self.mint,
            delegatee,
            nonce,
            allowance,
            self.init_id(),
        );
        self.send(ix, &[&owner])
    }

    // ------------------------------------------------------------------ Leash, owner and guardian

    pub fn initialize_principal(
        &mut self,
        guardian: Option<Pubkey>,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let owner = self.owner.insecure_clone();
        let ix = leash_ix(
            leash::accounts::InitializePrincipal {
                owner: owner.pubkey(),
                principal: self.principal,
                system_program: system_program::ID,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::InitializePrincipal { guardian },
        );
        self.send(ix, &[&owner])
    }

    pub fn create_agent(
        &mut self,
        agent_key: Pubkey,
        policy: Policy,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let owner = self.owner.insecure_clone();
        let ix = leash_ix(
            leash::accounts::CreateAgent {
                owner: owner.pubkey(),
                principal: self.principal,
                agent: agent_pda(&self.principal, &agent_key),
                mint: self.mint,
                system_program: system_program::ID,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::CreateAgent {
                agent_key,
                label: padded("Research agent"),
                policy,
            },
        );
        self.send(ix, &[&owner])
    }

    pub fn add_payee(
        &mut self,
        payee: Pubkey,
        limits: PayeeLimits,
    ) -> Result<Sent, FailedTransactionMetadata> {
        self.add_payee_for(self.agent, payee, limits)
    }

    pub fn add_payee_for(
        &mut self,
        agent: Pubkey,
        payee: Pubkey,
        limits: PayeeLimits,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let owner = self.owner.insecure_clone();
        let ix = leash_ix(
            leash::accounts::AddPayee {
                owner: owner.pubkey(),
                principal: self.principal,
                agent,
                payee_entry: payee_pda(&agent, &payee),
                system_program: system_program::ID,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::AddPayee {
                payee,
                label: padded("Research API"),
                limits,
            },
        );
        self.send(ix, &[&owner])
    }

    pub fn freeze_agent_as(
        &mut self,
        authority: &Keypair,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::FreezeAgent {
                authority: authority.pubkey(),
                principal: self.principal,
                agent: self.agent,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::FreezeAgent {},
        );
        self.send(ix, &[authority])
    }

    pub fn unfreeze_agent_as(
        &mut self,
        owner: &Keypair,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::UnfreezeAgent {
                owner: owner.pubkey(),
                principal: self.principal,
                agent: self.agent,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::UnfreezeAgent {},
        );
        self.send(ix, &[owner])
    }

    pub fn freeze_principal_as(
        &mut self,
        authority: &Keypair,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::FreezePrincipal {
                authority: authority.pubkey(),
                principal: self.principal,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::FreezePrincipal {},
        );
        self.send(ix, &[authority])
    }

    pub fn unfreeze_principal_as(
        &mut self,
        owner: &Keypair,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::UnfreezePrincipal {
                owner: owner.pubkey(),
                principal: self.principal,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::UnfreezePrincipal {},
        );
        self.send(ix, &[owner])
    }

    // ------------------------------------------------------------------------------ the agent

    /// `pay`'s accounts for a payment to `destination`, with the matching allowlist entry when
    /// the destination's owner has one.
    pub fn pay_accounts(&self, destination: Pubkey) -> leash::accounts::Pay {
        let owner_of_destination = Pubkey::try_from(&self.data(&destination)[32..64]).unwrap();
        let entry = payee_pda(&self.agent, &owner_of_destination);
        leash::accounts::Pay {
            agent_key: self.agent_key.pubkey(),
            principal: self.principal,
            agent: self.agent,
            payee_entry: self.exists(&entry).then_some(entry),
            request: None,
            request_rent_receiver: None,
            delegation: self.delegation,
            subscription_authority: self.subscription_authority,
            source_token_account: self.owner_ata,
            destination_token_account: destination,
            mint: self.mint,
            token_program: TOKEN_PROGRAM,
            subscriptions_program: SUBSCRIPTIONS_PROGRAM_ID,
            subscriptions_event_authority: SUBSCRIPTIONS_EVENT_AUTHORITY,
            event_authority: event_authority(),
            program: leash::ID,
        }
    }

    pub fn pay_args(amount: u64, n: u8) -> PayArgs {
        PayArgs {
            amount,
            reference: reference(n),
            memo: padded("Premium research report"),
        }
    }

    /// `pay` with the given accounts, signed by the agent key.
    pub fn pay_with(
        &mut self,
        accounts: leash::accounts::Pay,
        args: PayArgs,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let agent_key = self.agent_key.insecure_clone();
        self.send(
            leash_ix(accounts, leash::instruction::Pay { args }),
            &[&agent_key],
        )
    }

    /// Pays `amount` to the merchant (allowlisted in the default setup).
    pub fn pay(&mut self, amount: u64) -> Result<Sent, FailedTransactionMetadata> {
        self.pay_to(self.merchant_ata, amount)
    }

    pub fn pay_to(
        &mut self,
        destination: Pubkey,
        amount: u64,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let accounts = self.pay_accounts(destination);
        self.pay_with(accounts, Self::pay_args(amount, 1))
    }

    /// `report_denied_attempt`'s accounts for a payment to `destination`.
    pub fn report_accounts(&self, destination: Pubkey) -> leash::accounts::ReportDeniedAttempt {
        let pay = self.pay_accounts(destination);
        leash::accounts::ReportDeniedAttempt {
            agent_key: pay.agent_key,
            principal: pay.principal,
            agent: pay.agent,
            payee_entry: pay.payee_entry,
            delegation: pay.delegation,
            source_token_account: pay.source_token_account,
            destination_token_account: pay.destination_token_account,
            mint: pay.mint,
            event_authority: event_authority(),
            program: leash::ID,
        }
    }

    pub fn report_with(
        &mut self,
        accounts: leash::accounts::ReportDeniedAttempt,
        args: PayArgs,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let agent_key = self.agent_key.insecure_clone();
        self.send(
            leash_ix(accounts, leash::instruction::ReportDeniedAttempt { args }),
            &[&agent_key],
        )
    }

    pub fn report_to(
        &mut self,
        destination: Pubkey,
        amount: u64,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let accounts = self.report_accounts(destination);
        self.report_with(accounts, Self::pay_args(amount, 2))
    }

    /// `request_payment` for `payee`, the agent key paying the rent.
    pub fn request_payment(
        &mut self,
        payee: Pubkey,
        amount: u64,
        n: u8,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let agent: leash::state::Agent = self.read(&self.agent);
        let entry = payee_pda(&self.agent, &payee);
        let agent_key = self.agent_key.insecure_clone();
        let ix = leash_ix(
            leash::accounts::RequestPayment {
                agent_key: agent_key.pubkey(),
                rent_payer: agent_key.pubkey(),
                principal: self.principal,
                agent: self.agent,
                payee_entry: self.exists(&entry).then_some(entry),
                request: request_pda(&self.agent, agent.stats.request_nonce),
                system_program: system_program::ID,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::RequestPayment {
                args: RequestArgs {
                    payee,
                    amount,
                    reference: reference(n),
                    memo: padded("A detailed market report"),
                },
            },
        );
        self.send(ix, &[&agent_key])
    }

    pub fn set_guardian_as(
        &mut self,
        owner: &Keypair,
        guardian: Option<Pubkey>,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::SetGuardian {
                owner: owner.pubkey(),
                principal: self.principal,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::SetGuardian { guardian },
        );
        self.send(ix, &[owner])
    }

    pub fn update_policy_as(
        &mut self,
        owner: &Keypair,
        policy: Policy,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::UpdatePolicy {
                owner: owner.pubkey(),
                principal: self.principal,
                agent: self.agent,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::UpdatePolicy { policy },
        );
        self.send(ix, &[owner])
    }

    pub fn update_payee_as(
        &mut self,
        owner: &Keypair,
        entry: Pubkey,
        limits: PayeeLimits,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::UpdatePayee {
                owner: owner.pubkey(),
                principal: self.principal,
                agent: self.agent,
                payee_entry: entry,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::UpdatePayee {
                label: padded("Research API, updated"),
                limits,
            },
        );
        self.send(ix, &[owner])
    }

    pub fn remove_payee_as(
        &mut self,
        owner: &Keypair,
        entry: Pubkey,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::RemovePayee {
                owner: owner.pubkey(),
                principal: self.principal,
                agent: self.agent,
                payee_entry: entry,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::RemovePayee {},
        );
        self.send(ix, &[owner])
    }

    pub fn close_agent_as(&mut self, owner: &Keypair) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::CloseAgent {
                owner: owner.pubkey(),
                principal: self.principal,
                agent: self.agent,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::CloseAgent {},
        );
        self.send(ix, &[owner])
    }

    pub fn reject_request_as(
        &mut self,
        authority: &Keypair,
        request: Pubkey,
        rent_receiver: Pubkey,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::RejectRequest {
                authority: authority.pubkey(),
                principal: self.principal,
                agent: self.agent,
                request,
                rent_receiver,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::RejectRequest {},
        );
        self.send(ix, &[authority])
    }

    /// `expire_request` has no signer; `payer` only pays the fee.
    pub fn expire_request_as(
        &mut self,
        payer: &Keypair,
        request: Pubkey,
        rent_receiver: Pubkey,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::ExpireRequest {
                agent: self.agent,
                request,
                rent_receiver,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::ExpireRequest {},
        );
        self.send(ix, &[payer])
    }

    /// Pays the merchant with an approved request attached; its rent goes back to the agent key.
    pub fn pay_with_request(
        &mut self,
        request: Pubkey,
        amount: u64,
        n: u8,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let accounts = leash::accounts::Pay {
            request: Some(request),
            request_rent_receiver: Some(self.agent_key.pubkey()),
            ..self.pay_accounts(self.merchant_ata)
        };
        let args = PayArgs {
            amount,
            reference: reference(n),
            memo: padded("A detailed market report"),
        };
        self.pay_with(accounts, args)
    }

    pub fn approve_request_as(
        &mut self,
        owner: &Keypair,
        request: Pubkey,
    ) -> Result<Sent, FailedTransactionMetadata> {
        let ix = leash_ix(
            leash::accounts::ApproveRequest {
                owner: owner.pubkey(),
                principal: self.principal,
                agent: self.agent,
                request,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::ApproveRequest {},
        );
        self.send(ix, &[owner])
    }
}
