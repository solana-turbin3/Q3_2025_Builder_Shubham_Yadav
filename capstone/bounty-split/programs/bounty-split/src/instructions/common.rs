// src/instructions/common.rs
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::errors::*;
use crate::helpers::calc_distributions;

pub fn distribute_spl<'info>(
    escrow: &mut Account<'info, Escrow>,
    vault: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<u64> {
    let rc = escrow.recipient_count as usize;
    require!(rc > 0, EscrowError::InvalidRecipientCount);
    require!(remaining_accounts.len() >= rc + 1, EscrowError::RecipientNotFound);

    let distributions = calc_distributions(escrow.total_amount, &escrow.splits, rc)?;

    let seeds: &[&[u8]] = &[
        b"escrow",
        escrow.requester.as_ref(),
        &escrow.bounty_id[..],
        &[escrow.bump],
    ];
    let signer_seeds = &[seeds];
    let authority_info = escrow.to_account_info();

    let mut distributed_total: u128 = 0;
    for i in 0..rc {
        let amount = distributions[i];
        if amount == 0 { continue; }
        let ata_info = &remaining_accounts[i];
        let ata_state = anchor_spl::token::spl_token::state::Account::unpack(&ata_info.try_borrow_data()?)
            .map_err(|_| error!(EscrowError::InvalidAccountData))?;
        require!(ata_state.mint == vault.mint, EscrowError::InvalidMint);
        require!(ata_state.owner == escrow.recipients[i], EscrowError::RecipientNotFound);
        let cpi_accounts = token::Transfer { from: vault.to_account_info(), to: ata_info.clone(), authority: authority_info.clone() };
        let cpi_ctx = CpiContext::new_with_signer(token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;
        distributed_total = distributed_total.checked_add(amount as u128).ok_or(error!(EscrowError::Overflow))?;
    }

    let distributed_total_u64 = distributed_total as u64;
    let leftover = escrow.total_amount.checked_sub(distributed_total_u64).ok_or(error!(EscrowError::Overflow))?;
    if leftover > 0 {
        let requester_ata_info = &remaining_accounts[rc];
        let requester_state = anchor_spl::token::spl_token::state::Account::unpack(&requester_ata_info.try_borrow_data()?)
            .map_err(|_| error!(EscrowError::InvalidAccountData))?;
        require!(requester_state.owner == escrow.requester, EscrowError::Unauthorized);
        require!(requester_state.mint == vault.mint, EscrowError::InvalidMint);
        let cpi_accounts = token::Transfer { from: vault.to_account_info(), to: requester_ata_info.clone(), authority: authority_info.clone() };
        let cpi_ctx = CpiContext::new_with_signer(token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, leftover)?;
    }
    escrow.total_amount = 0;
    Ok(distributed_total_u64)
}
