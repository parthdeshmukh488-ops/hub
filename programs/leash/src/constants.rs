//! Program constants (01-onchain-program §3) and the addresses Leash depends on (§2, §8).
//!
//! Constants marked `#[constant]` are published in the IDL; `@leash/contracts` mirrors them in
//! `PROGRAM_CONSTANTS` and `SEEDS`, and a contracts test compares the two. The byte lengths are
//! not (the IDL has no `usize`); the IDL's array types carry them.

use anchor_lang::prelude::*;

/// Length of an agent or payee label: UTF-8, zero-padded.
pub const LABEL_LEN: usize = 32;

/// Length of a payment memo: UTF-8, zero-padded.
pub const MEMO_LEN: usize = 64;

/// Length of a payment reference: opaque bytes binding a payment to its context.
pub const REFERENCE_LEN: usize = 32;

/// Open payment requests per agent (spam guard).
#[constant]
pub const MAX_OPEN_REQUESTS: u16 = 8;

/// Longest lifetime of a payment request: 7 days.
#[constant]
pub const MAX_REQUEST_TTL_SECS: u32 = 604_800;

/// Written to every account; later versions only append fields (01 §12).
#[constant]
pub const ACCOUNT_VERSION: u8 = 1;

/// `Principal` seeds: `[PRINCIPAL_SEED, owner]`.
#[constant]
pub const PRINCIPAL_SEED: &[u8] = b"principal";

/// `Agent` seeds: `[AGENT_SEED, principal, agent_key]`. The Agent PDA is the Subscriptions
/// delegatee.
#[constant]
pub const AGENT_SEED: &[u8] = b"agent";

/// `Payee` seeds: `[PAYEE_SEED, agent, payee_wallet]`.
#[constant]
pub const PAYEE_SEED: &[u8] = b"payee";

/// `PaymentRequest` seeds: `[REQUEST_SEED, agent, nonce as u64 little-endian]`.
#[constant]
pub const REQUEST_SEED: &[u8] = b"request";

/// The Solana Foundation's audited Subscriptions program (v0.5.x, delegation layout v1).
pub const SUBSCRIPTIONS_PROGRAM_ID: Pubkey =
    pubkey!("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");

/// Subscriptions' event authority seeds, under that program.
pub const SUBSCRIPTIONS_EVENT_AUTHORITY_SEED: &[u8] = b"event_authority";

/// Subscriptions' event authority: `[SUBSCRIPTIONS_EVENT_AUTHORITY_SEED]` under that program.
/// A constant saves `pay` a PDA search; a unit test derives it.
pub const SUBSCRIPTIONS_EVENT_AUTHORITY: Pubkey =
    pubkey!("3Hnj4BYoDgtpBuqXfiy7Y8cNa3jXaNd4oqgSXBzkMcH7");

/// The Associated Token Account program: Subscriptions only debits the owner's ATA.
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_subscriptions_event_authority_is_its_pda() {
        let (address, _) = Pubkey::find_program_address(
            &[SUBSCRIPTIONS_EVENT_AUTHORITY_SEED],
            &SUBSCRIPTIONS_PROGRAM_ID,
        );
        assert_eq!(address, SUBSCRIPTIONS_EVENT_AUTHORITY);
    }
}
