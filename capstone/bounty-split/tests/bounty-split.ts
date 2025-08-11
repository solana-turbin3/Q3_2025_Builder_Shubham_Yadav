import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BountySplit } from "../target/types/bounty_split";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import {

  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import * as fs from "fs";

describe("bounty-split", () => {
  // Configure anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BountySplit as Program<BountySplit>;

  // Test accounts
  const requesterSecret = JSON.parse(fs.readFileSync("/Users/batman/Documents/GitHub/bounty-split/bounty-split/target/deploy/bounty_split-keypair.json", "utf8"));
  const requester = Keypair.fromSecretKey(new Uint8Array(requesterSecret));
  const recipient1 = Keypair.generate();
  const recipient2 = Keypair.generate();
  const arbiter = Keypair.generate();
  
  // Test state
  let mint: PublicKey;
  let requesterAta: PublicKey;
  let recipient1Ata: PublicKey;
  let recipient2Ata: PublicKey;
  let escrowPda: PublicKey;
  let vaultAta: PublicKey;
  let escrowBump: number;
  let bountyId: Uint8Array;
  
  const BASIS_POINTS_DENOM = 10_000;
  const STATUS_INITIALIZED = 0;
  const STATUS_FUNDED = 1;
  const STATUS_PENDING = 2;
  const STATUS_RELEASED = 3;

  before(async () => {
    // Fund all test accounts with SOL
    for (const kp of [requester, recipient1, recipient2, arbiter]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey, 
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Create test token mint
    mint = await createMint(
      provider.connection,
      requester,
      requester.publicKey,
      null,
      6 // decimals
    );

    // Create token accounts
    requesterAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      requester,
      mint,
      requester.publicKey
    )).address;

    recipient1Ata = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      requester, // payer for account creation
      mint,
      recipient1.publicKey
    )).address;

    recipient2Ata = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      requester, // payer for account creation
      mint,
      recipient2.publicKey
    )).address;

    // Mint tokens to requester
    await mintTo(
      provider.connection,
      requester,
      mint,
      requesterAta,
      requester.publicKey,
      10_000_000 // 10 tokens with 6 decimals
    );

    // Create unique bounty ID
    bountyId = Buffer.from(Array(32).fill(0));
    bountyId.set(Buffer.from("test-bounty-" + Date.now()));

    // Derive escrow PDA
    [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
      [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
      program.programId
    );
  });

  it("initialize escrow", async () => {
    // Create token account for escrow PDA
    vaultAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      requester,
      mint,
      escrowPda,
      true // allow owner off curve
    )).address;
    
    // Initialize escrow
    const params = {
      bountyId: Array.from(bountyId),
      tokenMint: mint,
      recipients: [recipient1.publicKey, recipient2.publicKey],
      splits: [7000, 3000], // 70/30 split
      requiredConfirmations: 1,
      arbiter: arbiter.publicKey,
      timelockExpiry: new anchor.BN(0),
    };

    await program.methods
      .initializeEscrow(params)
      .accounts({
        escrow: escrowPda,
        vault: vaultAta,
        requester: requester.publicKey,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([requester])
      .rpc();

    // Verify escrow was properly initialized
    const escrow = await program.account.escrow.fetch(escrowPda);
    assert.equal(escrow.requester.toBase58(), requester.publicKey.toBase58());
    assert.equal(escrow.status, STATUS_INITIALIZED);
    assert.equal(escrow.recipientCount, 2);
    assert.deepEqual(escrow.splits.slice(0, 2), [7000, 3000]);
    assert.equal(escrow.totalAmount.toNumber(), 0);
  });

  it("fund escrow", async () => {
    const fundAmount = 1_000_000; // 1 token with 6 decimals
    
    // Fund escrow
    await program.methods
      .fundEscrow(new anchor.BN(fundAmount))
      .accounts({
        escrow: escrowPda,
        payer: requester.publicKey,
        payerTokenAccount: requesterAta,
        mint: mint,
        vault: vaultAta,
        
      })
      .signers([requester])
      .rpc();
      
    // Verify escrow was funded
    const escrow = await program.account.escrow.fetch(escrowPda);
    assert.equal(escrow.status, STATUS_FUNDED);
    assert.equal(escrow.totalAmount.toNumber(), fundAmount);
    
    // Check that vault balance is correct
    const vaultBalance = await getAccount(provider.connection, vaultAta);
    assert.equal(Number(vaultBalance.amount), fundAmount);
  });
  
  it("propose release", async () => {
    // Propose release
    await program.methods
      .proposeRelease()
      .accounts({
        escrow: escrowPda,
        proposer: requester.publicKey,
      })
      .signers([requester])
      .rpc();
    
    // Verify escrow status changed to PENDING
    const escrow = await program.account.escrow.fetch(escrowPda);
    assert.equal(escrow.status, STATUS_PENDING);
  });
  
  it("confirm release", async () => {
    // Confirm release by recipient1
    await program.methods
      .confirmRelease()
      .accounts({
        escrow: escrowPda,
        recipient: recipient1.publicKey,
      })
      .signers([recipient1])
      .rpc();
    
    // Verify escrow status changed to RELEASED
    const escrow = await program.account.escrow.fetch(escrowPda);
    assert.equal(escrow.status, STATUS_RELEASED);
    assert.equal(escrow.confirmations, 1); // First bit set
  });
  
  it("claim by first recipient", async () => {
    // Get balances before claim
    const escrowBefore = await program.account.escrow.fetch(escrowPda);
    const totalAmount = escrowBefore.totalAmount.toNumber();
    const recipientShare = Math.floor(totalAmount * 7000 / BASIS_POINTS_DENOM); // 70%
    
    // First recipient claims their share
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
    
    // Verify recipient received their share
    const recipientBalance = await getAccount(provider.connection, recipient1Ata);
    assert.equal(Number(recipientBalance.amount), recipientShare);
    
    // Verify escrow claimed bit is set for first recipient
    const escrow = await program.account.escrow.fetch(escrowPda);
    assert.equal(escrow.claimed, 1); // First bit set
  });
  
  it("claim by second recipient", async () => {
    // Get balances before claim
    const escrowBefore = await program.account.escrow.fetch(escrowPda);
    const totalAmount = 1_000_000; // Original amount
    const recipientShare = Math.floor(totalAmount * 3000 / BASIS_POINTS_DENOM); // 30%
    
    // Second recipient claims their share
    await program.methods
      .claim()
      .accounts({
        escrow: escrowPda,
        vault: vaultAta,
        claimant: recipient2.publicKey,
        claimantAta: recipient2Ata,
        
      })
      .signers([recipient2])
      .rpc();
    
    // Verify recipient received their share
    const recipientBalance = await getAccount(provider.connection, recipient2Ata);
    assert.equal(Number(recipientBalance.amount), recipientShare);
    
    // Verify escrow claimed bits are set for both recipients
    const escrow = await program.account.escrow.fetch(escrowPda);
    assert.equal(escrow.claimed, 3); // Both bits set (0b11)
    assert.equal(escrow.totalAmount.toNumber(), 0); // All claimed, total should be reset
  });
  
  it("prevents double claim", async () => {
    // Try to claim again with first recipient
    try {
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
      assert.fail("Should have thrown AlreadyClaimed error");
    } catch (error) {
      assert.include(error.toString(), "AlreadyClaimed");
    }
  });
});
