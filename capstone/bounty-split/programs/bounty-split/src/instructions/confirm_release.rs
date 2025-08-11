// src/instructions/confirm_release.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;
use crate::events::*;
use crate::helpers::count_bits;

#[derive(Accounts)]
pub struct ConfirmRelease<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
    pub recipient: Signer<'info>,
}

pub fn confirm(ctx: Context<ConfirmRelease>) -> Result<()> {
    let e = &mut ctx.accounts.escrow;
    require!(e.status == STATUS_PENDING, EscrowError::InvalidStatus);
    // find recipient index
    let mut idx = None; for i in 0..(e.recipient_count as usize) { if e.recipients[i] == ctx.accounts.recipient.key() { idx = Some(i); break; } }
    let idx = idx.ok_or(error!(EscrowError::RecipientNotFound))?;
    require!((e.confirmations & (1u8 << idx)) == 0, EscrowError::AlreadyConfirmed);
    e.confirmations |= 1u8 << idx;
    emit!(ReleaseConfirmed { escrow: e.key(), by: ctx.accounts.recipient.key(), confirmations: e.confirmations });
    if count_bits(e.confirmations) as usize >= e.required_confirmations as usize { e.status = STATUS_RELEASED; }
    Ok(())
}
