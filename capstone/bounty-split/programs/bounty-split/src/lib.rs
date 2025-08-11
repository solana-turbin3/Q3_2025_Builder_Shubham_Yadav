#![allow(deprecated, unexpected_cfgs)]
use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod instructions;

use instructions::*;

declare_id!("CWeBHTenNeh1p4katXr8ABchs29vJS421Wfz3gVDxBPZ");

#[program]
pub mod bounty_split {
    use super::*;
    pub fn initialize_escrow(ctx: Context<InitializeEscrow>, params: InitializeParams) -> Result<()> {
        instructions::initialize_escrow::initialize_escrow(ctx, params)
    }

   pub fn fund_escrow(ctx: Context<FundEscrow>, amount: u64) -> Result<()> {
       instructions::fund_escrow::fund_escrow(ctx, amount)
    }
 
    pub fn propose_release(ctx: Context<ProposeRelease>) -> Result<()> {
        instructions::propose_release::propose_release(ctx)
    }

    pub fn confirm_release(ctx: Context<ConfirmRelease>) -> Result<()> {
        instructions::confirm_release::confirm(ctx)
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        instructions::release::release(ctx)
    }

    pub fn raise_dispute(ctx: Context<RaiseDispute>, reason_hash: [u8;32]) -> Result<()> {
        instructions::raise_dispute::raise_dispute(ctx, reason_hash)
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>) -> Result<()> {
        instructions::resolve_dispute::resolve_dispute(ctx)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::refund(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::claim(ctx)
    }
}
