use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;
use crate::events::*;

#[derive(Accounts)]
pub struct ProposeRelease<'info> {
    #[account(mut)] pub escrow: Account<'info, Escrow>,
    pub proposer: Signer<'info>,
}

pub fn propose_release(ctx: Context<ProposeRelease>) -> Result<()> {
    let e = &mut ctx.accounts.escrow;
    require!(e.status == STATUS_FUNDED, EscrowError::InvalidStatus);
    let k = ctx.accounts.proposer.key();
    let mut authorized = k == e.requester;
    if !authorized {
        for i in 0..(e.recipient_count as usize) { if e.recipients[i] == k { authorized = true; break; } }
    }
    require!(authorized, EscrowError::Unauthorized);
    e.status = STATUS_PENDING;
    emit!(ReleaseProposed { escrow: e.key(), by: k });
    Ok(())
}
