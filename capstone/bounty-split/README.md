# Bounty Split

A Solana program for splitting bounty payments among multiple recipients with customizable percentages and multi-signature release.

## Features

- Split bounties among up to 8 recipients
- Custom percentage allocation (basis points)
- Multi-signature release mechanism
- Individual claiming system
- SPL token support
- Built-in security validations

## Prerequisites

- Node.js v16+
- Rust v1.70+
- Anchor CLI v0.29+
- Solana CLI v1.16+

## Setup

1. **Clone and install**
   ```bash
   git clone <repo-url>
   cd bounty-split
   yarn install
   ```

2. **Configure Solana**
   ```bash
   solana config set --url devnet
   solana-keygen new  # or use existing wallet
   solana airdrop 2
   ```

3. **Build and deploy**
   ```bash
   anchor build
   anchor deploy
   ```

4. **Run tests**
   ```bash
   anchor test
   ```

## Usage

### 1. Initialize Escrow
```typescript
const params = {
  bountyId: Array.from(crypto.getRandomValues(new Uint8Array(32))),
  tokenMint: USDC_MINT,
  recipients: [recipient1.publicKey, recipient2.publicKey],
  splits: [7000, 3000], // 70% and 30%
  requiredConfirmations: 1,
  arbiter: Pubkey.default(),
  timelockExpiry: new anchor.BN(0),
};

await program.methods
  .initializeEscrow(params)
  .accounts({ vault: vaultAta, requester: requester.publicKey })
  .signers([requester])
  .rpc();
```

### 2. Fund Escrow
```typescript
await program.methods
  .fundEscrow(new anchor.BN(1000000)) // Amount in token units
  .accounts({
    escrow: escrowPda,
    payer: requester.publicKey,
    payerTokenAccount: requesterAta,
    vault: vaultAta,
  })
  .signers([requester])
  .rpc();
```

### 3. Propose Release
```typescript
await program.methods
  .proposeRelease()
  .accounts({
    escrow: escrowPda,
    proposer: requester.publicKey,
  })
  .signers([requester])
  .rpc();
```

### 4. Confirm Release
```typescript
await program.methods
  .confirmRelease()
  .accounts({
    escrow: escrowPda,
    recipient: recipient1.publicKey,
  })
  .signers([recipient1])
  .rpc();
```

### 5. Claim Funds
```typescript
await program.methods
  .claim()
  .accounts({
    escrow: escrowPda,
    vault: vaultAta,
    claimant: recipient1.publicKey,
    claimantAta: recipient1Ata,
  })
  .signers([recipient1])
  .rpc();
```

## Key Validations

- Recipients: 1-8 maximum
- Splits must sum to exactly 10,000 basis points
- No duplicate recipients
- No zero splits
- Only recipients or requester can propose release
- Recipients can't confirm twice
- Can only claim after release confirmation

## Testing

All tests are comprehensive and cover:
- Basic functionality
- Edge cases
- Security validations
- Error conditions

```bash
# Run all tests
anchor test

# Run specific test
anchor test -- --grep "Initialize Escrow"
```

## Program Structure

- `initialize_escrow`: Create new bounty with recipients and splits
- `fund_escrow`: Add tokens to the bounty
- `propose_release`: Start the release process
- `confirm_release`: Recipients confirm release
- `claim`: Recipients claim their portion

## Development

To add new features:
1. Add instruction in `lib.rs`
2. Create handler in `instructions/`
3. Add tests
4. Update this README

## License

MIT
