use anchor_lang::prelude::*;

declare_id!("AS6DaoNtP1V45C73KvmXaScotzVQhs2PC5KrN6DipeFp");

#[program]
pub mod amm {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
