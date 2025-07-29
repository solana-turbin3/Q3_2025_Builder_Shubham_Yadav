#![allow(unexpected_cfgs, deprecated)]
use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;


pub use instructions::*;
pub use state::*;

declare_id!("8ieYMRVtZciTAPHNzBwxpqmVqz1jufiUyWGwmQnCmfZR");

#[program]
pub mod anchor_escrow {
    use super::*;

    pub fn make(ctx: Context<Make>,deposit:u64,  seed: u64, receive: u64, amount: u64) ->Result<()> {
    ctx.accounts.init_escrow(seed, receive, &ctx.bumps)?;
    ctx.accounts.deposit(deposit)
        }

    pub fn take (ctx: Context<Take>) -> Result<()>{
        ctx.accounts.deposit()?;
        ctx.accounts.transfer_and_close()
    }
    pub fn refund(ctx: Context<Refund>) ->Result<()>{
        ctx.accounts.refund_and_close_vault()
    }
}


#[derive(Accounts)]
pub struct Initialize {}
