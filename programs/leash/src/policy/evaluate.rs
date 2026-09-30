//! Payment evaluation (01-onchain-program §7.1): a pure function of plain data.
//!
//! Instruction handlers gather the data, call [`evaluate`] and apply the effects it returns; no
//! account is touched here. `@leash/sdk` `evaluatePayment` is the TypeScript mirror and
//! `packages/contracts/test-vectors/policy.json` proves the two agree (`tests/vectors.rs`):
//! change both, or neither.

use anchor_lang::prelude::Pubkey;

use crate::{
    errors::LeashError,
    policy::{is_expired, roll_recurring_period, rolled, PeriodError, Window},
    state::{AgentStatus, DenialReason, PayeeMode, Policy, RequestStatus},
    subscriptions::{DelegationState, RecurringState},
};

/// The allowlist entry passed with the payment, if any. It counts only if it belongs to this
/// agent and names the owner of the destination token account (step 4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PayeeEntryState {
    pub agent: Pubkey,
    pub payee: Pubkey,
    pub max_per_payment: u64,
    pub period_limit: u64,
    pub period_secs: u32,
    pub period_start: i64,
    pub spent_in_period: u64,
}

/// An approved payment request to consume (step 5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RequestState {
    pub agent: Pubkey,
    pub status: RequestStatus,
    pub payee: Pubkey,
    pub amount: u64,
    pub reference: [u8; 32],
    pub expires_at: i64,
}

/// Everything the evaluation reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EvalInput {
    pub now: i64,
    pub principal_frozen: bool,
    /// The Agent PDA.
    pub agent: Pubkey,
    pub status: AgentStatus,
    pub policy: Policy,
    pub velocity_window_start: i64,
    pub velocity_count: u16,
    pub payee_entry: Option<PayeeEntryState>,
    pub request: Option<RequestState>,
    pub delegation: DelegationState,
    /// The owner's token balance.
    pub source_amount: u64,
    pub amount: u64,
    /// `P`: the owner of the destination token account.
    pub destination_owner: Pubkey,
    pub reference: [u8; 32],
}

/// What an allowed payment writes (§7.2). Counters of switched-off limits come back unchanged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Effects {
    /// The agent's velocity window after the payment.
    pub velocity: Window<u16>,
    /// The matching entry's period window after the payment; `None` without a matching entry.
    pub payee: Option<Window<u64>>,
    /// The delegation as Subscriptions will leave it. Leash never writes it; tests compare it.
    pub delegation: DelegationState,
    pub consumes_request: bool,
}

/// Why a payment cannot go through.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rejection {
    /// The policy blocks it: `pay` fails with the matching `Denied*` error, and the attempt may
    /// be reported with `report_denied_attempt`.
    Denied(DenialReason),
    /// Not a policy decision (bad amount, request mismatch, unsupported delegation, overflow).
    Error(LeashError),
}

impl Rejection {
    /// The error `pay` fails with.
    pub fn error(self) -> LeashError {
        match self {
            Rejection::Denied(reason) => reason.error(),
            Rejection::Error(error) => error,
        }
    }
}

impl From<LeashError> for Rejection {
    fn from(error: LeashError) -> Self {
        Rejection::Error(error)
    }
}

fn denied<T>(reason: DenialReason) -> Result<T, Rejection> {
    Err(Rejection::Denied(reason))
}

/// Evaluates a payment exactly as the program enforces it: the first failing check wins. For
/// an allowed payment it returns the state to write.
pub fn evaluate(input: &EvalInput) -> Result<Effects, Rejection> {
    let policy = &input.policy;
    let amount = input.amount;
    let now = input.now;

    // 0–3: amount, freezes, expiry.
    if amount == 0 {
        return Err(LeashError::InvalidAmount.into());
    }
    if input.principal_frozen {
        return denied(DenialReason::PrincipalFrozen);
    }
    if input.status == AgentStatus::Frozen {
        return denied(DenialReason::AgentFrozen);
    }
    if policy.valid_until != 0 && now >= policy.valid_until {
        return denied(DenialReason::AgentExpired);
    }

    // 4: the allowlist checks the destination's owner, never its address.
    let entry = input
        .payee_entry
        .filter(|entry| entry.agent == input.agent && entry.payee == input.destination_owner);
    if policy.payee_mode == PayeeMode::AllowListOnly && entry.is_none() {
        return denied(DenialReason::PayeeNotAllowed);
    }

    match &input.request {
        // 5: an approved request waives checks 6–8 for exactly this payee, amount, reference.
        Some(request) => check_request(request, input)?,
        None => {
            // 6: the instant limit, or approval.
            if amount > policy.max_per_payment {
                return denied(
                    if policy.max_per_request != 0 && amount <= policy.max_per_request {
                        DenialReason::ApprovalRequired
                    } else {
                        DenialReason::ExceedsPaymentLimit
                    },
                );
            }
            if let Some(entry) = &entry {
                // 7: the payee's cap per payment.
                if entry.max_per_payment != 0 && amount > entry.max_per_payment {
                    return denied(DenialReason::ExceedsPayeePaymentLimit);
                }
                // 8: the payee's period budget.
                if entry.period_limit != 0
                    && payee_period(entry, amount, now)?.counter > entry.period_limit
                {
                    return denied(DenialReason::ExceedsPayeePeriodLimit);
                }
            }
        }
    }

    // 9: the rate limit. A limit that is off is not tracked
    // (ADR 20260929-ws0-disabled-limits-are-not-tracked).
    let mut velocity = Window {
        start: input.velocity_window_start,
        counter: input.velocity_count,
    };
    if policy.velocity_max_payments != 0 {
        let window = rolled(
            input.velocity_window_start,
            policy.velocity_window_secs,
            input.velocity_count,
            now,
        )?;
        match window.counter.checked_add(1) {
            Some(count) if count <= policy.velocity_max_payments => {
                velocity = Window {
                    start: window.start,
                    counter: count,
                };
            }
            _ => return denied(DenialReason::VelocityExceeded),
        }
    }

    // 10: the allowance ceiling (I1).
    let delegation = check_allowance(&input.delegation, amount, now)?;

    // 11: the owner's balance.
    if input.source_amount < amount {
        return denied(DenialReason::InsufficientFunds);
    }

    // Payee accounting: every allowed payment to a matching entry counts towards its period,
    // approved requests included (their limit checks were waived, not their spend).
    let payee = match entry {
        None => None,
        Some(entry) if entry.period_limit != 0 => Some(payee_period(&entry, amount, now)?),
        Some(entry) => Some(Window {
            start: entry.period_start,
            counter: entry.spent_in_period,
        }),
    };

    Ok(Effects {
        velocity,
        payee,
        delegation,
        consumes_request: input.request.is_some(),
    })
}

/// The payee's period window with `amount` added.
fn payee_period(entry: &PayeeEntryState, amount: u64, now: i64) -> Result<Window<u64>, LeashError> {
    let window = rolled(
        entry.period_start,
        entry.period_secs,
        entry.spent_in_period,
        now,
    )?;
    Ok(Window {
        start: window.start,
        counter: window
            .counter
            .checked_add(amount)
            .ok_or(LeashError::MathOverflow)?,
    })
}

fn check_request(request: &RequestState, input: &EvalInput) -> Result<(), Rejection> {
    if request.agent != input.agent {
        return Err(LeashError::RequestMismatch.into());
    }
    if request.status != RequestStatus::Approved {
        return Err(LeashError::RequestNotApproved.into());
    }
    if input.now >= request.expires_at {
        return Err(LeashError::RequestExpired.into());
    }
    if request.payee != input.destination_owner
        || request.amount != input.amount
        || request.reference != input.reference
    {
        return Err(LeashError::RequestMismatch.into());
    }
    Ok(())
}

/// Step 10: the allowance pre-check (§7.3). Returns the delegation as the pull will leave it.
fn check_allowance(
    delegation: &DelegationState,
    amount: u64,
    now: i64,
) -> Result<DelegationState, Rejection> {
    if is_expired(delegation.expiry_ts(), now) {
        return denied(DenialReason::AllowanceExpired);
    }
    match *delegation {
        DelegationState::Fixed {
            amount_remaining,
            expiry_ts,
        } => match amount_remaining.checked_sub(amount) {
            Some(amount_remaining) => Ok(DelegationState::Fixed {
                amount_remaining,
                expiry_ts,
            }),
            None => denied(DenialReason::AllowanceExceeded),
        },
        DelegationState::Recurring(state) => {
            let period = match roll_recurring_period(&state, now) {
                Ok(period) => period,
                Err(PeriodError::InvalidPeriodLength) => {
                    return Err(LeashError::UnsupportedDelegation.into())
                }
                Err(PeriodError::NotStarted) => return denied(DenialReason::AllowanceExceeded),
                Err(PeriodError::Arithmetic) => return Err(LeashError::MathOverflow.into()),
            };
            // Upstream computes `available = amount_per_period - pulled` (an underflow means
            // nothing is left) and compares the amount against it, so an almost-full period
            // is a denial, never an overflow error.
            match state.amount_per_period.checked_sub(period.pulled_in_period) {
                Some(available) if amount <= available => {
                    Ok(DelegationState::Recurring(RecurringState {
                        current_period_start: period.current_period_start,
                        pulled_in_period: period
                            .pulled_in_period
                            .checked_add(amount)
                            .ok_or(LeashError::MathOverflow)?,
                        ..state
                    }))
                }
                _ => denied(DenialReason::AllowanceExceeded),
            }
        }
    }
}
