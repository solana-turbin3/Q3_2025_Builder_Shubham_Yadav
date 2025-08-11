use anchor_lang::prelude::*;

#[event]
pub struct EscrowCreated {
    pub escrow: Pubkey,
    pub requester: Pubkey,
    pub bounty_id: [u8;32],
}

#[event]
pub struct EscrowFunded {
    pub escrow: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ReleaseProposed {
    pub escrow: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct ReleaseConfirmed {
    pub escrow: Pubkey,
    pub by: Pubkey,
    pub confirmations: u8,
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub total_distributed: u64,
}

#[event]
pub struct EscrowRefunded {
    pub escrow: Pubkey,
    pub refunded_to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DisputeRaised {
    pub escrow: Pubkey,
    pub by: Pubkey,
    pub reason_hash: [u8;32],
}

#[event]
pub struct DisputeResolved {
    pub escrow: Pubkey,
    pub arbiter: Pubkey,
    pub total_distributed: u64,
}
