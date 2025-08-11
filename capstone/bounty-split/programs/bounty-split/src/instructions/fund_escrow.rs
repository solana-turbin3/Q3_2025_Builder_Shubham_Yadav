//the idea is to use mandates on the depositor account

// src/instructions/fund_escrow.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{
    Mint, 
    TransferChecked,
    TokenAccount, 
    Token, 
    transfer_checked
    };
use crate::state::*;
use crate::errors::*;
use crate::events::*;

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    /// escrow account that holds metadata. must already be initialized
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// payer's token account (source) — must match escrow.token_mint and be owned by payer
    #[account(mut, 
        constraint = payer_token_account.owner == payer.key(), 
        constraint = payer_token_account.mint == escrow.token_mint
    )]
    pub payer_token_account: Account<'info, TokenAccount>,
    
    pub mint :  Account<'info, Mint>,
    #[account(
        mut, 
        constraint = vault.owner == escrow.key(), 
        constraint = vault.mint == escrow.token_mint
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn fund_escrow(ctx: Context<FundEscrow>, amount: u64) -> Result<()> {
    require!(amount > 0, EscrowError::InvalidAmount);

    // Transfer tokens from payer ATA -> vault ATA
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.payer_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: ctx.accounts.payer.to_account_info(),
        
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    // update escrow accounting
    let escrow = &mut ctx.accounts.escrow;
    escrow.total_amount = escrow.total_amount.checked_add(amount).ok_or(error!(EscrowError::Overflow))?;

    // if this was the first fund, mark as Funded
    if escrow.status == STATUS_INITIALIZED { escrow.status = STATUS_FUNDED; }

    emit!(EscrowFunded { escrow: ctx.accounts.escrow.key(), amount });
    Ok(())
}
