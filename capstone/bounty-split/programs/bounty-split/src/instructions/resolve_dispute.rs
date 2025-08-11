use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::*;
use crate::events::*;

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
    pub arbiter: Signer<'info>,
}

pub fn resolve_dispute(ctx: Context<ResolveDispute>) -> Result<()> {
    let e = &mut ctx.accounts.escrow;
    require!(e.status == STATUS_DISPUTED, EscrowError::InvalidStatus);
    require_keys_eq!(e.arbiter, ctx.accounts.arbiter.key(), EscrowError::Unauthorized);
    e.status = STATUS_RELEASED;
    emit!(EscrowReleased { escrow: e.key(), total_distributed: 0 });
    Ok(())
}
