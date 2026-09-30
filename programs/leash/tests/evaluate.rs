//! `evaluate` beyond the shared vectors: the branches they do not reach, and invariants over
//! random states. Same cases as `packages/sdk/test/evaluate.test.ts`, so the two evaluators are
//! held to the same edges.

use anchor_lang::prelude::Pubkey;
use leash::{
    errors::LeashError,
    policy::{
        evaluate, is_expired, roll_recurring_period, EvalInput, PayeeEntryState, Rejection,
        RequestState,
    },
    state::{AgentStatus, DenialReason, PayeeMode, Policy, RequestStatus},
    subscriptions::{DelegationState, RecurringState},
};

const T: i64 = 1_790_935_200;
const AGENT: Pubkey = Pubkey::new_from_array([1; 32]);
const OTHER_AGENT: Pubkey = Pubkey::new_from_array([2; 32]);
const MERCHANT: Pubkey = Pubkey::new_from_array([3; 32]);
const ATTACKER: Pubkey = Pubkey::new_from_array([4; 32]);
const REFERENCE: [u8; 32] = [7; 32];

fn input() -> EvalInput {
    EvalInput {
        now: T,
        principal_frozen: false,
        agent: AGENT,
        status: AgentStatus::Active,
        policy: Policy {
            max_per_payment: 1_000_000,
            max_per_request: 5_000_000,
            payee_mode: PayeeMode::AllowListOnly,
            velocity_max_payments: 30,
            velocity_window_secs: 60,
            tripwire_max_strikes: 3,
            tripwire_window_secs: 600,
            request_ttl_secs: 3_600,
            valid_until: 0,
        },
        velocity_window_start: T - 30,
        velocity_count: 5,
        payee_entry: Some(PayeeEntryState {
            agent: AGENT,
            payee: MERCHANT,
            max_per_payment: 2_000_000,
            period_limit: 3_000_000,
            period_secs: 86_400,
            period_start: T - 3_600,
            spent_in_period: 100_000,
        }),
        request: None,
        delegation: DelegationState::Recurring(RecurringState {
            current_period_start: T - 3_600,
            period_length_s: 86_400,
            expiry_ts: 0,
            amount_per_period: 5_000_000,
            pulled_in_period: 100_000,
        }),
        source_amount: 100_000_000,
        amount: 10_000,
        destination_owner: MERCHANT,
        reference: REFERENCE,
    }
}

fn recurring(state: RecurringState) -> DelegationState {
    DelegationState::Recurring(state)
}

// ── Branches the vectors do not reach ────────────────────────────────────────

#[test]
fn a_payee_spend_that_would_overflow_u64_is_an_error() {
    let mut i = input();
    i.payee_entry = i.payee_entry.map(|entry| PayeeEntryState {
        period_limit: u64::MAX,
        spent_in_period: u64::MAX,
        ..entry
    });
    assert_eq!(
        evaluate(&i),
        Err(Rejection::Error(LeashError::MathOverflow))
    );
}

#[test]
fn an_approved_request_still_counts_its_spend_and_can_overflow() {
    // Steps 6–8 are waived for the request, but the payee accounting is not.
    let mut i = input();
    i.payee_entry = i.payee_entry.map(|entry| PayeeEntryState {
        spent_in_period: u64::MAX,
        ..entry
    });
    i.request = Some(RequestState {
        agent: AGENT,
        status: RequestStatus::Approved,
        payee: MERCHANT,
        amount: i.amount,
        reference: REFERENCE,
        expires_at: T + 60,
    });
    assert_eq!(
        evaluate(&i),
        Err(Rejection::Error(LeashError::MathOverflow))
    );
}

#[test]
fn a_window_end_beyond_i64_is_an_error() {
    let mut i = input();
    i.velocity_window_start = 9_223_372_036_854_775_800;
    assert_eq!(
        evaluate(&i),
        Err(Rejection::Error(LeashError::MathOverflow))
    );
}

#[test]
fn a_payee_period_end_beyond_i64_is_an_error() {
    let mut i = input();
    i.payee_entry = i.payee_entry.map(|entry| PayeeEntryState {
        period_start: i64::MAX - 10,
        ..entry
    });
    assert_eq!(
        evaluate(&i),
        Err(Rejection::Error(LeashError::MathOverflow))
    );
}

#[test]
fn a_recurring_delegation_with_a_zero_or_huge_period_is_unsupported() {
    for period_length_s in [0, i64::MAX as u64 + 1] {
        let mut i = input();
        i.delegation = recurring(RecurringState {
            current_period_start: T,
            period_length_s,
            expiry_ts: 0,
            amount_per_period: 5_000_000,
            pulled_in_period: 0,
        });
        assert_eq!(
            evaluate(&i),
            Err(Rejection::Error(LeashError::UnsupportedDelegation))
        );
    }
}

#[test]
fn an_unsupported_period_does_not_pre_empt_earlier_checks() {
    // Decided at step 10, as in the SDK: a frozen owner still wins.
    let mut i = input();
    i.principal_frozen = true;
    i.delegation = recurring(RecurringState {
        current_period_start: T,
        period_length_s: 0,
        expiry_ts: 0,
        amount_per_period: 5_000_000,
        pulled_in_period: 0,
    });
    assert_eq!(
        evaluate(&i),
        Err(Rejection::Denied(DenialReason::PrincipalFrozen))
    );
}

#[test]
fn an_over_pulled_delegation_is_a_denial_not_an_overflow() {
    let mut i = input();
    i.delegation = recurring(RecurringState {
        current_period_start: T - 10,
        period_length_s: 86_400,
        expiry_ts: 0,
        amount_per_period: 5_000_000,
        pulled_in_period: 6_000_000,
    });
    assert_eq!(
        evaluate(&i),
        Err(Rejection::Denied(DenialReason::AllowanceExceeded))
    );
}

#[test]
fn a_huge_amount_against_an_almost_full_period_is_a_denial() {
    // WS2's case 3: never `pulled + amount`, which would overflow here.
    let mut i = input();
    i.policy.max_per_payment = u64::MAX;
    i.policy.max_per_request = 0;
    i.payee_entry = None;
    i.policy.payee_mode = PayeeMode::AnyPayee;
    i.amount = u64::MAX;
    i.source_amount = u64::MAX;
    i.delegation = recurring(RecurringState {
        current_period_start: T - 10,
        period_length_s: 86_400,
        expiry_ts: 0,
        amount_per_period: u64::MAX,
        pulled_in_period: 1,
    });
    assert_eq!(
        evaluate(&i),
        Err(Rejection::Denied(DenialReason::AllowanceExceeded))
    );
}

#[test]
fn a_request_with_another_reference_is_a_mismatch() {
    let mut i = input();
    i.request = Some(RequestState {
        agent: AGENT,
        status: RequestStatus::Approved,
        payee: MERCHANT,
        amount: i.amount,
        reference: [8; 32],
        expires_at: T + 60,
    });
    assert_eq!(
        evaluate(&i),
        Err(Rejection::Error(LeashError::RequestMismatch))
    );
}

#[test]
fn the_rejection_names_the_error_pay_fails_with() {
    let mut i = input();
    i.payee_entry = None;
    let rejection = evaluate(&i).unwrap_err();
    assert_eq!(rejection, Rejection::Denied(DenialReason::PayeeNotAllowed));
    assert_eq!(rejection.error(), LeashError::DeniedPayeeNotAllowed);
    assert_eq!(u32::from(rejection.error()), 6003);
    assert_eq!(
        Rejection::Error(LeashError::MathOverflow).error(),
        LeashError::MathOverflow
    );
}

// ── Invariants over random states ────────────────────────────────────────────

/// xorshift64*: deterministic, so a failure always reproduces.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    fn below(&mut self, bound: u64) -> u64 {
        self.next() % bound
    }
    fn flip(&mut self) -> bool {
        self.next() & 1 == 1
    }
    fn amount(&mut self) -> u64 {
        self.below(10_000_001)
    }
    fn time(&mut self) -> i64 {
        T - 200_000 + self.below(400_001) as i64
    }
    fn time_or_zero(&mut self) -> i64 {
        if self.flip() {
            0
        } else {
            self.time()
        }
    }
}

/// Random states with the same shape as the SDK's `arbitraryInput`.
fn random_input(rng: &mut Rng) -> EvalInput {
    let velocity_max = rng.below(41) as u16;
    let entry_limit = rng.amount();
    let fixed = rng.flip();
    let per_period = rng.amount();
    let entry = if rng.flip() {
        Some(PayeeEntryState {
            agent: if rng.flip() { OTHER_AGENT } else { AGENT },
            payee: if rng.flip() { MERCHANT } else { ATTACKER },
            max_per_payment: rng.amount(),
            period_limit: entry_limit,
            period_secs: if entry_limit == 0 { 0 } else { 86_400 },
            period_start: rng.time_or_zero(),
            spent_in_period: rng.amount(),
        })
    } else {
        None
    };
    EvalInput {
        now: rng.time(),
        principal_frozen: rng.flip(),
        agent: AGENT,
        status: if rng.flip() {
            AgentStatus::Frozen
        } else {
            AgentStatus::Active
        },
        policy: Policy {
            max_per_payment: 1 + rng.below(3_000_000),
            max_per_request: if rng.flip() {
                0
            } else {
                3_000_001 + rng.below(5_000_000)
            },
            payee_mode: if rng.flip() {
                PayeeMode::AnyPayee
            } else {
                PayeeMode::AllowListOnly
            },
            velocity_max_payments: velocity_max,
            velocity_window_secs: if velocity_max == 0 { 0 } else { 60 },
            tripwire_max_strikes: 3,
            tripwire_window_secs: 600,
            request_ttl_secs: 3_600,
            valid_until: rng.time_or_zero(),
        },
        velocity_window_start: rng.time(),
        velocity_count: rng.below(46) as u16,
        payee_entry: entry,
        request: None,
        delegation: if fixed {
            DelegationState::Fixed {
                amount_remaining: per_period,
                expiry_ts: rng.time_or_zero(),
            }
        } else {
            recurring(RecurringState {
                current_period_start: rng.time(),
                period_length_s: 86_400,
                expiry_ts: rng.time_or_zero(),
                amount_per_period: per_period,
                pulled_in_period: rng.amount(),
            })
        },
        source_amount: rng.amount(),
        amount: rng.amount(),
        destination_owner: if rng.flip() { MERCHANT } else { ATTACKER },
        reference: REFERENCE,
    }
}

/// What the delegatee could pull at `now` (the SDK's `allowanceRemaining`).
fn allowance_remaining(delegation: &DelegationState, now: i64) -> u64 {
    if is_expired(delegation.expiry_ts(), now) {
        return 0;
    }
    match delegation {
        DelegationState::Fixed {
            amount_remaining, ..
        } => *amount_remaining,
        DelegationState::Recurring(state) => match roll_recurring_period(state, now) {
            Ok(period) => state
                .amount_per_period
                .saturating_sub(period.pulled_in_period),
            Err(_) => 0,
        },
    }
}

const RUNS: usize = 20_000;

#[test]
fn i1_an_allowed_payment_never_exceeds_the_allowance_the_balance_or_the_instant_limit() {
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    let mut allowed = 0;
    for _ in 0..RUNS {
        let i = random_input(&mut rng);
        if evaluate(&i).is_ok() {
            allowed += 1;
            assert!(i.amount > 0, "{i:?}");
            assert!(
                i.amount <= allowance_remaining(&i.delegation, i.now),
                "{i:?}"
            );
            assert!(i.amount <= i.source_amount, "{i:?}");
            assert!(i.amount <= i.policy.max_per_payment, "{i:?}");
        }
    }
    // The generator must actually reach the allowed path, or the property proves nothing.
    assert!(
        allowed > 50,
        "only {allowed} allowed payments in {RUNS} runs"
    );
}

#[test]
fn i2_in_allow_list_mode_only_this_agents_entry_for_the_destination_lets_money_through() {
    let mut rng = Rng(0x2545_f491_4f6c_dd1d);
    for _ in 0..RUNS {
        let i = random_input(&mut rng);
        if evaluate(&i).is_ok() && i.policy.payee_mode == PayeeMode::AllowListOnly {
            let entry = i
                .payee_entry
                .expect("an allowed allow-list payment has an entry");
            assert_eq!(entry.agent, AGENT);
            assert_eq!(entry.payee, i.destination_owner);
        }
    }
}

#[test]
fn i3_nothing_is_allowed_while_the_principal_or_the_agent_is_frozen() {
    let mut rng = Rng(0x1234_5678_9abc_def1);
    for _ in 0..RUNS {
        let i = random_input(&mut rng);
        if i.principal_frozen || i.status == AgentStatus::Frozen {
            assert!(evaluate(&i).is_err(), "{i:?}");
        }
    }
}

#[test]
fn evaluation_is_deterministic() {
    let mut rng = Rng(0x0bad_cafe_dead_beef);
    for _ in 0..RUNS {
        let i = random_input(&mut rng);
        assert_eq!(evaluate(&i), evaluate(&i));
    }
}
