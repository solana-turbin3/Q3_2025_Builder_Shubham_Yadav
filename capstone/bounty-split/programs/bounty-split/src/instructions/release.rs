// src/instructions/release.rs
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;
use crate::events::*;


#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
    pub requester: Signer<'info>,
}

pub fn release(ctx: Context<Release>) -> Result<()> {
    let e = &mut ctx.accounts.escrow;
    require!(e.status == STATUS_FUNDED || e.status == STATUS_PENDING, EscrowError::InvalidStatus);
    require_keys_eq!(e.requester, ctx.accounts.requester.key(), EscrowError::Unauthorized);
    e.status = STATUS_RELEASED;
    emit!(EscrowReleased { escrow: e.key(), total_distributed: 0 });
    Ok(())
}
