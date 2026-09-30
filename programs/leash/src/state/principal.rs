//! `Principal`: one per owner, the global off switch for all their agents (01 §4.1).

use anchor_lang::prelude::*;

/// Seeds: `[PRINCIPAL_SEED, owner]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Principal {
    pub version: u8,
    pub bump: u8,
    /// The owner wallet.
    pub owner: Pubkey,
    /// `Pubkey::default()` means no guardian.
    pub guardian: Pubkey,
    /// Global off switch for all agents of this owner.
    pub frozen: bool,
    /// 0 if not frozen.
    pub frozen_at: i64,
    /// Default if not frozen.
    pub frozen_by: Pubkey,
    /// Live agents.
    pub agent_count: u32,
    pub created_at: i64,
    pub reserved: [u8; 64],
}

impl Principal {
    /// The guardian, if one is set.
    pub fn guardian(&self) -> Option<Pubkey> {
        (self.guardian != Pubkey::default()).then_some(self.guardian)
    }

    /// Whether `signer` may use the owner-or-guardian instructions (freeze, reject).
    pub fn is_owner_or_guardian(&self, signer: &Pubkey) -> bool {
        *signer == self.owner || self.guardian() == Some(*signer)
    }

    /// Freezes every agent of this owner. Returns false if it was already frozen (idempotent).
    pub fn freeze(&mut self, by: Pubkey, now: i64) -> bool {
        if self.frozen {
            return false;
        }
        self.frozen = true;
        self.frozen_at = now;
        self.frozen_by = by;
        true
    }

    /// Lifts the global freeze. Returns false if it was not frozen (idempotent).
    pub fn unfreeze(&mut self) -> bool {
        if !self.frozen {
            return false;
        }
        self.frozen = false;
        self.frozen_at = 0;
        self.frozen_by = Pubkey::default();
        true
    }
}

/// Normalizes a guardian argument: `Some(Pubkey::default())` means no guardian too.
pub fn guardian_arg(guardian: Option<Pubkey>) -> Option<Pubkey> {
    guardian.filter(|key| *key != Pubkey::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn principal(guardian: Pubkey) -> Principal {
        Principal {
            version: 1,
            bump: 255,
            owner: Pubkey::new_from_array([1; 32]),
            guardian,
            frozen: false,
            frozen_at: 0,
            frozen_by: Pubkey::default(),
            agent_count: 0,
            created_at: 0,
            reserved: [0; 64],
        }
    }

    #[test]
    fn only_the_owner_or_a_set_guardian_is_authorized() {
        let guardian = Pubkey::new_from_array([2; 32]);
        let stranger = Pubkey::new_from_array([3; 32]);
        let with_guardian = principal(guardian);
        assert!(with_guardian.is_owner_or_guardian(&with_guardian.owner));
        assert!(with_guardian.is_owner_or_guardian(&guardian));
        assert!(!with_guardian.is_owner_or_guardian(&stranger));
        // Without a guardian, the default key must not count as one.
        let without = principal(Pubkey::default());
        assert!(!without.is_owner_or_guardian(&Pubkey::default()));
        assert_eq!(without.guardian(), None);
    }

    #[test]
    fn freeze_and_unfreeze_are_idempotent() {
        let mut p = principal(Pubkey::default());
        let by = p.owner;
        assert!(p.freeze(by, 100));
        assert!(!p.freeze(by, 200));
        assert_eq!((p.frozen, p.frozen_at, p.frozen_by), (true, 100, by));
        assert!(p.unfreeze());
        assert!(!p.unfreeze());
        assert_eq!(
            (p.frozen, p.frozen_at, p.frozen_by),
            (false, 0, Pubkey::default())
        );
    }

    #[test]
    fn default_guardian_argument_means_none() {
        assert_eq!(guardian_arg(Some(Pubkey::default())), None);
        let key = Pubkey::new_from_array([9; 32]);
        assert_eq!(guardian_arg(Some(key)), Some(key));
        assert_eq!(guardian_arg(None), None);
    }
}
