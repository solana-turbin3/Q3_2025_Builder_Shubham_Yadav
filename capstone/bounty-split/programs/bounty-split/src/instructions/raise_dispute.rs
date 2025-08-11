use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;
use crate::events::*;

#[derive(Accounts)]
pub struct RaiseDispute<'info> {
    #[account(mut)] pub escrow: Account<'info, Escrow>,
    pub initiator: Signer<'info>,
}

pub fn raise_dispute(ctx: Context<RaiseDispute>, reason_hash: [u8;32]) -> Result<()> {
    let e = &mut ctx.accounts.escrow;
    require!(e.status != STATUS_RELEASED && e.status != STATUS_REFUNDED, EscrowError::AlreadyFinalized);
    let k = ctx.accounts.initiator.key();
    let mut authorized = k == e.requester;
    if !authorized { for i in 0..(e.recipient_count as usize) { if e.recipients[i] == k { authorized = true; break; } } }
    require!(authorized, EscrowError::Unauthorized);
    e.status = STATUS_DISPUTED;
    emit!(DisputeRaised { escrow: e.key(), by: k, reason_hash });
    Ok(())
}
