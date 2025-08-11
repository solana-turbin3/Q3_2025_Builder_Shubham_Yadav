use anchor_lang::prelude::*;
//use anchor_spl::token::Mint;
use anchor_spl::token::Token;
use anchor_spl::token::TokenAccount;
use crate::state::*;
use crate::events::*;
use crate::errors::EscrowError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub bounty_id: [u8; 32],
    pub token_mint: Pubkey,          // SPL mint (use Pubkey::default() sentinel for SOL)
    pub recipients: Vec<Pubkey>,     // must be <= MAX_RECIPIENTS
    pub splits: Vec<u16>,            // same len as recipients, sum == 10000
    pub required_confirmations: u8,  // >=1 and <= recipients.len()
    pub arbiter: Pubkey,             // Pubkey::default() allowed
    pub timelock_expiry: i64,        // 0 if none
}

#[derive(Accounts)]
#[instruction(params: InitializeParams)]
pub struct InitializeEscrow<'info> {
    #[account(
        init,
        payer = requester,
        space = ESCROW_SPACE,
        seeds = [b"escrow", requester.key().as_ref(), params.bounty_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: expected to be (or become) a token account owned by escrow PDA; validated later.
    #[account(
    mut,
    constraint = vault.owner == escrow.key(),
    constraint = vault.mint == params.token_mint
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub requester: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_escrow(ctx: Context<InitializeEscrow>, params: InitializeParams) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow;

    let recipients = &params.recipients;
    let splits = &params.splits;

    
    // Basic validations
    let rcount = recipients.len();
    require!(rcount > 0 && rcount <= MAX_RECIPIENTS, EscrowError::InvalidRecipientCount);
    require!(splits.len() == rcount, EscrowError::InvalidSplits);
    require!(params.required_confirmations >= 1 && (params.required_confirmations as usize) <= rcount, EscrowError::InvalidRecipientCount);

    // Duplicate recipient check
    for i in 0..rcount { for j in (i+1)..rcount { require!(recipients[i] != recipients[j], EscrowError::DuplicateRecipient); } }

    // Splits: no zero, sum exact
    let mut sum: u32 = 0;
    for s in splits { require!(*s > 0, EscrowError::ZeroSplit); sum = sum.checked_add(*s as u32).ok_or(error!(EscrowError::InvalidSplits))?; }
    require!(sum == BASIS_POINTS_DENOM as u32, EscrowError::InvalidSplits);

    // Timelock validation
    if params.timelock_expiry != 0 { let now = Clock::get()?.unix_timestamp; require!(params.timelock_expiry > now, EscrowError::InvalidTimelock); }

    // Arbiter sanity (optional rule: cannot equal requester unless default)
    if params.arbiter != Pubkey::default() { require!(params.arbiter != ctx.accounts.requester.key(), EscrowError::InvalidArbiter); }

    // Populate escrow
    escrow.requester = ctx.accounts.requester.key();
    escrow.bounty_id = params.bounty_id;
    escrow.token_mint = params.token_mint;
    escrow.vault = ctx.accounts.vault.key();
    escrow.total_amount = 0;
    escrow.recipient_count = rcount as u8;

    // Copy recipients & splits (account is zeroed on init so no manual clearing needed)
    for (i, pk) in recipients.iter().enumerate() { escrow.recipients[i] = *pk; escrow.splits[i] = splits[i]; }

    escrow.confirmations = 0;
    escrow.status = STATUS_INITIALIZED;
    escrow.required_confirmations = params.required_confirmations;
    escrow.arbiter = params.arbiter;
    escrow.created_at = Clock::get()?.unix_timestamp;
    escrow.timelock_expiry = params.timelock_expiry;
    escrow.bump = ctx.bumps.escrow; // updated bump retrieval
    escrow.claimed = 0; // initialize claimed bitmask

    emit!(EscrowCreated { escrow: escrow.key(), requester: escrow.requester, bounty_id: escrow.bounty_id });
    Ok(())
}
