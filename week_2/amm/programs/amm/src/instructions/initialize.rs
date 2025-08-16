use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::states::Config;

#[derive(Accounts)]
#[instructions(seed: u64)]