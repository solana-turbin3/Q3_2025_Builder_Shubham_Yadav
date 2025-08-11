use anchor_lang::prelude::*;
use anchor_spl::token::{self, TokenAccount, Token};
use crate::state::*;
use crate::errors::*;
use crate::events::*;

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)] pub escrow: Account<'info, Escrow>,
    #[account(mut, constraint = vault.owner == escrow.key(), constraint = vault.mint == escrow.token_mint)] pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = requester_ata.owner == escrow.requester, constraint = requester_ata.mint == escrow.token_mint)] pub requester_ata: Account<'info, TokenAccount>,
    pub requester: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn refund(ctx: Context<Refund>) -> Result<()> {
    // Phase 1: extract data & mutate state minimally
    let (requester_key, bounty_id, bump, amount) = {
        let e = &mut ctx.accounts.escrow;
        require!(e.requester == ctx.accounts.requester.key(), EscrowError::Unauthorized);
        require!(e.status != STATUS_RELEASED && e.status != STATUS_REFUNDED, EscrowError::AlreadyFinalized);
        if e.timelock_expiry != 0 { let now = Clock::get()?.unix_timestamp; require!(now >= e.timelock_expiry, EscrowError::TimelockActive); }
        let amt = e.total_amount; require!(amt > 0, EscrowError::InsufficientFunds);
        (e.requester, e.bounty_id, e.bump, amt)
    };

    // Phase 2: perform transfer (no mutable escrow borrow during CPI)
    let seeds: &[&[u8]] = &[b"escrow", requester_key.as_ref(), &bounty_id[..], &[bump]];
    let signer_seeds = &[seeds];
    let cpi_accounts = token::Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.requester_ata.to_account_info(), authority: ctx.accounts.escrow.to_account_info() };
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, amount)?;

    // Phase 3: finalize escrow state
    let e2 = &mut ctx.accounts.escrow;
    e2.total_amount = 0;
    e2.status = STATUS_REFUNDED;
    emit!(EscrowRefunded { escrow: e2.key(), refunded_to: requester_key, amount });
    Ok(())
}
