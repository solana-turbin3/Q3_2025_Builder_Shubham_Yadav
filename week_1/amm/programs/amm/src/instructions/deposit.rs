use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token:AssociatedToken,
    token::{mint_to, transfer_checked, Mint, MintTo, Token, TokenAccount,TransferChecked},
};
use contant_product_curve::ConstantProduct;

use crate::states::Config;
use crate::errors::AmmError;

#[derive(Accounts)]
pub struct Deposit<'info>{
    #[account(mut)]
    pub user:Signer<'info>,


    pub mint_x: Account<'info, Mint>,

    pub mint_y: Account<'info, Mint>,

    #[account(
        seeds =[b"config", config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump,
        has_one = mint_x,
        has_one = mint_y,
    )]
    pub config: Account<'info, Config>,
}