use anchor_lang::prelude::*;

declare_id!("B4dLvFedN78x3nTZdQHu3uXwUfQkxHWtUuwnC47gt4d2");

#[program]
pub mod marketplace {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
