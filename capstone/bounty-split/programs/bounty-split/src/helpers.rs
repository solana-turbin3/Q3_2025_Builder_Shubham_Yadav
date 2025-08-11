use anchor_lang::prelude::*;
use crate::state::BASIS_POINTS_DENOM;

/// Count set bits in u8
pub fn count_bits(x: u8) -> u8 {
    x.count_ones() as u8
}

/// Set bit at index
pub fn set_bit(mask: &mut u8, idx: usize) {
    *mask |= 1u8 << idx;
}

/// Check if bit is set
pub fn is_bit_set(mask: u8, idx: usize) -> bool {
    (mask & (1u8 << idx)) != 0
}

/// Compute distribution amounts (returns Vec<u64>)
pub fn calc_distributions(total: u64, splits: &[u16], count: usize) -> Result<Vec<u64>> {
    let mut out = Vec::with_capacity(count);
    let mut accumulated: u128 = 0;
    for i in 0..count {
        let amt = (total as u128)
            .checked_mul(splits[i] as u128)
            .ok_or(error!(crate::errors::EscrowError::Overflow))?
            / (BASIS_POINTS_DENOM as u128);
        out.push(amt as u64);
        accumulated = accumulated.checked_add(amt).ok_or(error!(crate::errors::EscrowError::Overflow))?;
    }
    // dust left = total - accumulated
    let distributed = accumulated as u64;
    if distributed > total {
        return Err(error!(crate::errors::EscrowError::Overflow));
    }
    Ok(out)
}
