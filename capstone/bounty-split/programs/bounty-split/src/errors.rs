use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Invalid recipient count")]
    InvalidRecipientCount,
    #[msg("Invalid splits, must sum to 10000 basis points")]
    InvalidSplits,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid status for this action")]
    InvalidStatus,
    #[msg("Insufficient funds in escrow")]
    InsufficientFunds,
    #[msg("Overflow")]
    Overflow,
    #[msg("Underflow")]
    Underflow,
    #[msg("Timelock not expired")]
    TimelockActive,
    #[msg("Already released or refunded")]
    AlreadyFinalized,
    #[msg("Recipient not found in escrow")]
    RecipientNotFound,
    #[msg("Mismatched distribution length")]
    DistributionLengthMismatch,
    #[msg("Invalid token account data")]
    InvalidAccountData,
    #[msg("Invalid token mint for this operation")]
    InvalidMint,
    #[msg("Invalid transfer amount")]
    InvalidAmount,
    #[msg("Recipient already confirmed")]
    AlreadyConfirmed,
    #[msg("Duplicate recipient")]
    DuplicateRecipient,
    #[msg("Split cannot be zero")]
    ZeroSplit,
    #[msg("Invalid timelock")]
    InvalidTimelock,
    #[msg("Invalid arbiter")]
    InvalidArbiter,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Math error")]
    MathError,
    #[msg("Invalid vault account")]
    InvalidVault,
}
