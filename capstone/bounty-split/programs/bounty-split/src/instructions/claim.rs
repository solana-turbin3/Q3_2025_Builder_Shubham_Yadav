use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers::calc_distributions;

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)] pub escrow: Account<'info, Escrow>,
    #[account(mut, 
        constraint = vault.owner == escrow.key(), 
        constraint = vault.mint == escrow.token_mint
    )] 
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut, 
        constraint = claimant_ata.owner == claimant.key(), 
        constraint = claimant_ata.mint == escrow.token_mint
    )] 
    pub claimant_ata: Account<'info, TokenAccount>,
    pub claimant: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let e = &mut ctx.accounts.escrow;
    require!(e.status == STATUS_RELEASED, EscrowError::InvalidStatus);
    let rc = e.recipient_count as usize;
    // find claimant index
    let mut idx_opt = None; for i in 0..rc { if e.recipients[i] == ctx.accounts.claimant.key() { idx_opt = Some(i); break; } }
    let idx = idx_opt.ok_or(error!(EscrowError::RecipientNotFound))?;
    require!((e.claimed & (1u8 << idx)) == 0, EscrowError::AlreadyClaimed);

    let distributions = calc_distributions(e.total_amount, &e.splits, rc)?;
    let amount = distributions[idx];
    require!(amount > 0, EscrowError::InvalidSplits);

    e.claimed |= 1u8 << idx;

    let seeds: &[&[u8]] = &[b"escrow", e.requester.as_ref(), &e.bounty_id[..], &[e.bump]]; let signer_seeds = &[seeds];
    let cpi_accounts = token::Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.claimant_ata.to_account_info(), authority: e.to_account_info() };
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, amount)?;

    if e.claimed.count_ones() as usize >= rc { e.total_amount = 0; }
    emit!(EscrowReleased { escrow: e.key(), total_distributed: amount });
    Ok(())
}
