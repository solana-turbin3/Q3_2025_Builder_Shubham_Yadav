use anchor_lang::prelude::*;

pub const MAX_RECIPIENTS: usize = 8;
pub const BASIS_POINTS_DENOM: u16 = 10_000;

// Status constants
pub const STATUS_INITIALIZED: u8 = 0;
pub const STATUS_FUNDED: u8 = 1;
pub const STATUS_PENDING: u8 = 2;
pub const STATUS_RELEASED: u8 = 3;
pub const STATUS_DISPUTED: u8 = 4;
pub const STATUS_REFUNDED: u8 = 5;

// main Escrow account
#[account]
pub struct Escrow {
    pub requester: Pubkey,                 // 32
    pub bounty_id: [u8;32],                // 32
    pub token_mint: Pubkey,                // 32  (use sentinel for SOL handling)
    pub vault: Pubkey,                     // 32
    pub total_amount: u64,                 // 8
    pub recipient_count: u8,               // 1
    pub recipients: [Pubkey; MAX_RECIPIENTS], // 256
    pub splits: [u16; MAX_RECIPIENTS],    // 16
    pub confirmations: u8,                 // bitmask (up to 8)
    pub status: u8,                        // see STATUS_* constants
    pub required_confirmations: u8,        // threshold
    pub arbiter: Pubkey,                   // 32 or Pubkey::default() if none
    pub created_at: i64,                   // 8
    pub timelock_expiry: i64,              // 8 (0 if none)
    pub bump: u8,                          // 1
    pub claimed: u8,                       // NEW bitmask of claimed distributions
    // padding for future fields
}

// Computed space constant (use in account init) with safety margin
pub const ESCROW_SPACE: usize = 8 + core::mem::size_of::<Escrow>() + 32; // +32 bytes future padding
