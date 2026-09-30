//! The Subscriptions transfer Leash calls from `pay` (01-onchain-program §8.1, §8.2).

use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};

use crate::constants::SUBSCRIPTIONS_PROGRAM_ID;

/// Size of `TransferFixed` / `TransferRecurring` instruction data.
pub const TRANSFER_DATA_LEN: usize = 73;

/// `[discriminator] ‖ amount: u64 LE ‖ delegator ‖ mint`: 4 for a fixed delegation, 5 for a
/// recurring one.
pub fn transfer_data(
    discriminator: u8,
    amount: u64,
    delegator: &Pubkey,
    mint: &Pubkey,
) -> [u8; TRANSFER_DATA_LEN] {
    let mut data = [0u8; TRANSFER_DATA_LEN];
    data[0] = discriminator;
    data[1..9].copy_from_slice(&amount.to_le_bytes());
    data[9..41].copy_from_slice(delegator.as_ref());
    data[41..73].copy_from_slice(mint.as_ref());
    data
}

/// The accounts of a Subscriptions transfer, in the order that program fixes.
pub struct TransferAccounts<'a, 'info> {
    pub delegation: &'a AccountInfo<'info>,
    pub subscription_authority: &'a AccountInfo<'info>,
    /// The owner's associated token account.
    pub source: &'a AccountInfo<'info>,
    pub destination: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    /// The Agent PDA: the delegatee, signing through `invoke_signed`.
    pub delegatee: &'a AccountInfo<'info>,
    pub event_authority: &'a AccountInfo<'info>,
    pub program: &'a AccountInfo<'info>,
}

/// The instruction for a transfer. `remaining` (Token-2022 transfer-hook accounts) is appended
/// untouched, with the flags it arrived with.
pub fn transfer_instruction(
    accounts: &TransferAccounts,
    remaining: &[AccountInfo],
    data: [u8; TRANSFER_DATA_LEN],
) -> Instruction {
    let mut metas = vec![
        AccountMeta::new(*accounts.delegation.key, false),
        AccountMeta::new_readonly(*accounts.subscription_authority.key, false),
        AccountMeta::new(*accounts.source.key, false),
        AccountMeta::new(*accounts.destination.key, false),
        AccountMeta::new_readonly(*accounts.mint.key, false),
        AccountMeta::new_readonly(*accounts.token_program.key, false),
        AccountMeta::new_readonly(*accounts.delegatee.key, true),
        AccountMeta::new_readonly(*accounts.event_authority.key, false),
        AccountMeta::new_readonly(*accounts.program.key, false),
    ];
    metas.extend(remaining.iter().map(|account| AccountMeta {
        pubkey: *account.key,
        is_signer: account.is_signer,
        is_writable: account.is_writable,
    }));
    Instruction {
        program_id: SUBSCRIPTIONS_PROGRAM_ID,
        accounts: metas,
        data: data.to_vec(),
    }
}

/// Calls Subscriptions with the Agent PDA signing as the delegatee.
pub fn invoke_transfer<'info>(
    accounts: &TransferAccounts<'_, 'info>,
    remaining: &[AccountInfo<'info>],
    data: [u8; TRANSFER_DATA_LEN],
    agent_seeds: &[&[u8]],
) -> Result<()> {
    let instruction = transfer_instruction(accounts, remaining, data);
    let mut infos = vec![
        accounts.delegation.clone(),
        accounts.subscription_authority.clone(),
        accounts.source.clone(),
        accounts.destination.clone(),
        accounts.mint.clone(),
        accounts.token_program.clone(),
        accounts.delegatee.clone(),
        accounts.event_authority.clone(),
        accounts.program.clone(),
    ];
    infos.extend(remaining.iter().cloned());
    invoke_signed(&instruction, &infos, &[agent_seeds])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_is_73_bytes_in_the_documented_order() {
        let delegator = Pubkey::new_from_array([7; 32]);
        let mint = Pubkey::new_from_array([9; 32]);
        let data = transfer_data(5, 0x0102_0304_0506_0708, &delegator, &mint);
        assert_eq!(data[0], 5);
        assert_eq!(&data[1..9], &[8, 7, 6, 5, 4, 3, 2, 1]);
        assert_eq!(&data[9..41], delegator.as_ref());
        assert_eq!(&data[41..73], mint.as_ref());
    }

    #[test]
    fn accounts_follow_the_subscriptions_order() {
        let keys: Vec<Pubkey> = (1..=10).map(|b| Pubkey::new_from_array([b; 32])).collect();
        let owner = Pubkey::default();
        let mut lamports: Vec<u64> = vec![0; 10];
        let mut data: Vec<Vec<u8>> = vec![Vec::new(); 10];
        let mut infos = Vec::new();
        for ((key, lamports), data) in keys.iter().zip(lamports.iter_mut()).zip(data.iter_mut()) {
            infos.push(AccountInfo::new(
                key, false, false, lamports, data, &owner, false,
            ));
        }
        let accounts = TransferAccounts {
            delegation: &infos[0],
            subscription_authority: &infos[1],
            source: &infos[2],
            destination: &infos[3],
            mint: &infos[4],
            token_program: &infos[5],
            delegatee: &infos[6],
            event_authority: &infos[7],
            program: &infos[8],
        };
        let mut hook = infos[9].clone();
        hook.is_writable = true;
        let ix = transfer_instruction(&accounts, &[hook], [0; TRANSFER_DATA_LEN]);
        assert_eq!(ix.program_id, SUBSCRIPTIONS_PROGRAM_ID);
        let flags: Vec<(Pubkey, bool, bool)> = ix
            .accounts
            .iter()
            .map(|m| (m.pubkey, m.is_signer, m.is_writable))
            .collect();
        let expected = [
            (keys[0], false, true),
            (keys[1], false, false),
            (keys[2], false, true),
            (keys[3], false, true),
            (keys[4], false, false),
            (keys[5], false, false),
            (keys[6], true, false),
            (keys[7], false, false),
            (keys[8], false, false),
            (keys[9], false, true),
        ];
        assert_eq!(flags, expected);
    }
}
