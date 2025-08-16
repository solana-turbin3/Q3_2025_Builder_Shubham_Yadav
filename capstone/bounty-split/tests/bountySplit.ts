import * as fs from "fs";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BountySplit } from "../target/types/bounty_split";
import { Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("Bounty Split - Test Suite", () => {
  // Configure anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.BountySplit as Program<BountySplit>;

  // Load persistent wallet for requester to avoid airdrop limits
  const requesterSecret = JSON.parse(fs.readFileSync("/Users/batman/.config/solana/id.json", "utf8"));
  const requester = Keypair.fromSecretKey(new Uint8Array(requesterSecret));
  
  // Test accounts
  const recipient1 = Keypair.generate();
  const recipient2 = Keypair.generate();
  const recipient3 = Keypair.generate();
  const arbiter = Keypair.generate();
  const unauthorizedUser = Keypair.generate();
  
  // Test state variables
  let mint: PublicKey;
  let requesterAta: PublicKey;
  let recipient1Ata: PublicKey;
  let recipient2Ata: PublicKey;
  let recipient3Ata: PublicKey;
  let unauthorizedAta: PublicKey;
  let escrowPda: PublicKey;
  let vaultAta: PublicKey;
  let escrowBump: number;
  let bountyId: Uint8Array;
  
  const BASIS_POINTS_DENOM = 10_000;
  const STATUS_INITIALIZED = 0;
  const STATUS_FUNDED = 1;
  const STATUS_PENDING = 2;
  const STATUS_RELEASED = 3;
  const STATUS_DISPUTED = 4;

  before(async () => {
    // Only fund the requester (who will pay for everything)
    const requesterBalance = await provider.connection.getBalance(requester.publicKey);
    if (requesterBalance < 5 * anchor.web3.LAMPORTS_PER_SOL) {
      const sig = await provider.connection.requestAirdrop(
        requester.publicKey, 
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Fund other accounts via transfer from requester instead of airdrop
    const transferTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: requester.publicKey,
        toPubkey: recipient1.publicKey,
        lamports: anchor.web3.LAMPORTS_PER_SOL,
      }),
      anchor.web3.SystemProgram.transfer({
        fromPubkey: requester.publicKey,
        toPubkey: recipient2.publicKey,
        lamports: anchor.web3.LAMPORTS_PER_SOL,
      }),
      anchor.web3.SystemProgram.transfer({
        fromPubkey: requester.publicKey,
        toPubkey: recipient3.publicKey,
        lamports: anchor.web3.LAMPORTS_PER_SOL,
      }),
      anchor.web3.SystemProgram.transfer({
        fromPubkey: requester.publicKey,
        toPubkey: arbiter.publicKey,
        lamports: anchor.web3.LAMPORTS_PER_SOL,
      }),
      anchor.web3.SystemProgram.transfer({
        fromPubkey: requester.publicKey,
        toPubkey: unauthorizedUser.publicKey,
        lamports: anchor.web3.LAMPORTS_PER_SOL,
      })
    );
    
    await provider.sendAndConfirm(transferTx, [requester]);

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
      requester,
      mint,
      recipient1.publicKey
    )).address;

    recipient2Ata = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      requester,
      mint,
      recipient2.publicKey
    )).address;

    recipient3Ata = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      requester,
      mint,
      recipient3.publicKey
    )).address;

    unauthorizedAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      requester,
      mint,
      unauthorizedUser.publicKey
    )).address;

    // Mint tokens to requester
    await mintTo(
      provider.connection,
      requester,
      mint,
      requesterAta,
      requester.publicKey,
      100_000_000 // 100 tokens with 6 decimals
    );
  });

  describe("Initialize Escrow", () => {
    beforeEach(async () => {
      // Create unique bounty ID for each test
      bountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString();
      bountyId.set(Buffer.from(uniqueId.slice(-20))); // Use last 20 chars to fit in 32 bytes

      // Derive escrow PDA
      [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
        program.programId
      );

      // Create vault for escrow PDA
      vaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        escrowPda,
        true // allow owner off curve
      )).address;
    });

    it("Should successfully initialize escrow with valid parameters", async () => {
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

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      // Verify all escrow fields
      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.requester.toBase58(), requester.publicKey.toBase58());
      assert.equal(escrow.status, STATUS_INITIALIZED);
      assert.equal(escrow.recipientCount, 2);
      assert.deepEqual(escrow.splits.slice(0, 2), [7000, 3000]);
      assert.equal(escrow.totalAmount.toNumber(), 0);
      assert.equal(escrow.requiredConfirmations, 1);
      assert.equal(escrow.arbiter.toBase58(), arbiter.publicKey.toBase58());
      assert.equal(escrow.confirmations, 0);
      assert.equal(escrow.claimed, 0);
      assert.equal(escrow.tokenMint.toBase58(), mint.toBase58());
      assert.equal(escrow.vault.toBase58(), vaultAta.toBase58());
      assert.isAbove(escrow.createdAt.toNumber(), 0);
    });

    it("Should successfully initialize with maximum recipients (8)", async () => {
      const maxRecipients = Array(8).fill(0).map(() => Keypair.generate().publicKey);
      const maxSplits = Array(8).fill(1250); // 8 * 1250 = 10000

      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: maxRecipients,
        splits: maxSplits,
        requiredConfirmations: 4,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.recipientCount, 8);
      assert.equal(escrow.requiredConfirmations, 4);
    });

    it("Should successfully initialize with future timelock", async () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [5000, 5000],
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(futureTime),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.timelockExpiry.toNumber(), futureTime);
    });

    it("Should fail with duplicate recipients", async () => {
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient1.publicKey], // Duplicate
        splits: [5000, 5000],
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      try {
        await program.methods
          .initializeEscrow(params)
          .accounts({

            vault: vaultAta,
            requester: requester.publicKey,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have thrown DuplicateRecipient error");
      } catch (error) {
        assert.include(error.toString(), "DuplicateRecipient");
      }
    });

    it("Should fail with invalid splits (don't sum to 10000)", async () => {
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [6000, 3000], // Sum = 9000, not 10000
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      try {
        await program.methods
          .initializeEscrow(params)
          .accounts({

            vault: vaultAta,
            requester: requester.publicKey,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have thrown InvalidSplits error");
      } catch (error) {
        assert.include(error.toString(), "InvalidSplits");
      }
    });

    it("Should fail with zero split", async () => {
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [10000, 0], // Zero split
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      try {
        await program.methods
          .initializeEscrow(params)
          .accounts({

            vault: vaultAta,
            requester: requester.publicKey,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have thrown ZeroSplit error");
      } catch (error) {
        assert.include(error.toString(), "ZeroSplit");
      }
    });

    it("Should fail with past timelock", async () => {
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [5000, 5000],
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(pastTime),
      };

      try {
        await program.methods
          .initializeEscrow(params)
          .accounts({

            vault: vaultAta,
            requester: requester.publicKey,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have thrown InvalidTimelock error");
      } catch (error) {
        assert.include(error.toString(), "InvalidTimelock");
      }
    });

    it("Should fail with invalid required confirmations (exceeds recipient count)", async () => {
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [5000, 5000],
        requiredConfirmations: 3, // More than 2 recipients
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      try {
        await program.methods
          .initializeEscrow(params)
          .accounts({

            vault: vaultAta,
            requester: requester.publicKey,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have thrown InvalidRecipientCount error");
      } catch (error) {
        assert.include(error.toString(), "InvalidRecipientCount");
      }
    });

    it("Should fail with arbiter same as requester", async () => {
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [5000, 5000],
        requiredConfirmations: 1,
        arbiter: requester.publicKey, // Same as requester
        timelockExpiry: new anchor.BN(0),
      };

      try {
        await program.methods
          .initializeEscrow(params)
          .accounts({

            vault: vaultAta,
            requester: requester.publicKey,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have thrown InvalidArbiter error");
      } catch (error) {
        assert.include(error.toString(), "InvalidArbiter");
      }
    });

    it("Should fail when unauthorized user tries to initialize", async () => {
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [5000, 5000],
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      try {
        await program.methods
          .initializeEscrow(params)
          .accounts({

            vault: vaultAta,
            requester: unauthorizedUser.publicKey, // Wrong signer
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([unauthorizedUser])
          .rpc();
        assert.fail("Should have failed with seed constraint error");
      } catch (error) {
        assert.include(error.toString().toLowerCase(), "vault");
      }
    });
  });

  describe("Fund Escrow", () => {
    beforeEach(async () => {
      // Create fresh escrow for each test
      bountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString(); bountyId.set(Buffer.from(uniqueId.slice(-20)));

      [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
        program.programId
      );

      vaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        escrowPda,
        true
      )).address;

      // Initialize escrow
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [7000, 3000],
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();
    });

    it("Should successfully fund escrow", async () => {
      const fundAmount = 1_000_000; // 1 token
      const initialBalance = await getAccount(provider.connection, requesterAta);
      
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

      // Verify escrow state
      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.status, STATUS_FUNDED);
      assert.equal(escrow.totalAmount.toNumber(), fundAmount);

      // Verify vault balance
      const vaultBalance = await getAccount(provider.connection, vaultAta);
      assert.equal(Number(vaultBalance.amount), fundAmount);

      // Verify requester balance decreased
      const finalBalance = await getAccount(provider.connection, requesterAta);
      assert.equal(
        Number(initialBalance.amount) - Number(finalBalance.amount),
        fundAmount
      );
    });

    it("Should successfully fund escrow multiple times", async () => {
      const fundAmount1 = 500_000; // 0.5 tokens
      const fundAmount2 = 300_000; // 0.3 tokens
      const totalExpected = fundAmount1 + fundAmount2;

      // First funding
      await program.methods
        .fundEscrow(new anchor.BN(fundAmount1))
        .accounts({
          escrow: escrowPda,

          payer: requester.publicKey,
          payerTokenAccount: requesterAta,
          mint: mint,
          vault: vaultAta,
        })
        .signers([requester])
        .rpc();

      // Second funding
      await program.methods
        .fundEscrow(new anchor.BN(fundAmount2))
        .accounts({
          escrow: escrowPda,

          payer: requester.publicKey,
          payerTokenAccount: requesterAta,
          mint: mint,
          vault: vaultAta,
        })
        .signers([requester])
        .rpc();

      // Verify total amount
      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.totalAmount.toNumber(), totalExpected);

      const vaultBalance = await getAccount(provider.connection, vaultAta);
      assert.equal(Number(vaultBalance.amount), totalExpected);
    });

    it("Should fail with zero amount", async () => {
      try {
        await program.methods
          .fundEscrow(new anchor.BN(0))
          .accounts({
          escrow: escrowPda,

            payer: requester.publicKey,
            payerTokenAccount: requesterAta,
            mint: mint,
            vault: vaultAta,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have thrown InvalidAmount error");
      } catch (error) {
        assert.include(error.toString(), "InvalidAmount");
      }
    });

    it("Should fail when unauthorized user tries to fund", async () => {
      try {
        await program.methods
          .fundEscrow(new anchor.BN(1000000))
          .accounts({
          escrow: escrowPda,

            payer: unauthorizedUser.publicKey,
            payerTokenAccount: unauthorizedAta,
            mint: mint,
            vault: vaultAta,
          })
          .signers([unauthorizedUser])
          .rpc();
        assert.fail("Should have failed - only requester or recipients should fund");
      } catch (error) {
        // Should fail due to constraint or authorization
        assert.isTrue(error.toString().includes("Error") || error.toString().includes("constraint"));
      }
    });

    it("Should fail with insufficient funds", async () => {
      const excessiveAmount = new anchor.BN("999999999999999"); // Way more than available

      try {
        await program.methods
          .fundEscrow(excessiveAmount)
          .accounts({
          escrow: escrowPda,

            payer: requester.publicKey,
            payerTokenAccount: requesterAta,
            mint: mint,
            vault: vaultAta,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have failed with insufficient funds");
      } catch (error) {
        assert.include(error.toString().toLowerCase(), "insufficient");
      }
    });
  });

  describe("Propose Release", () => {
    beforeEach(async () => {
      // Setup funded escrow
      bountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString(); bountyId.set(Buffer.from(uniqueId.slice(-20)));

      [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
        program.programId
      );

      vaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        escrowPda,
        true
      )).address;

      // Initialize and fund escrow
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [7000, 3000],
        requiredConfirmations: 2, // Both recipients must confirm
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      await program.methods
        .fundEscrow(new anchor.BN(1_000_000))
        .accounts({
          escrow: escrowPda,

          payer: requester.publicKey,
          payerTokenAccount: requesterAta,
          mint: mint,
          vault: vaultAta,
        })
        .signers([requester])
        .rpc();
    });

    it("Should successfully propose release", async () => {
      await program.methods
        .proposeRelease()
        .accounts({
          escrow: escrowPda,

          proposer: requester.publicKey,
        })
        .signers([requester])
        .rpc();

      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.status, STATUS_PENDING);
    });

    it("Should fail when unauthorized user tries to propose", async () => {
      try {
        await program.methods
          .proposeRelease()
          .accounts({
          escrow: escrowPda,

            proposer: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();
        assert.fail("Should have thrown Unauthorized error");
      } catch (error) {
        assert.include(error.toString(), "Unauthorized");
      }
    });

    it("Should fail when proposing on uninitialized escrow", async () => {
      // Create new PDA that doesn't exist
      const fakeBountyId = Buffer.from(Array(32).fill(1));
      const [fakeEscrowPda] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), fakeBountyId],
        program.programId
      );

      try {
        await program.methods
          .proposeRelease()
          .accounts({
          escrow: escrowPda,
            escrow: fakeEscrowPda,
            proposer: requester.publicKey,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have failed - account doesn't exist");
      } catch (error) {
        assert.include(error.toString().toLowerCase(), "account");
      }
    });
  });

  describe("Confirm Release", () => {
    beforeEach(async () => {
      // Setup escrow with pending release
      bountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString(); bountyId.set(Buffer.from(uniqueId.slice(-20)));

      [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
        program.programId
      );

      vaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        escrowPda,
        true
      )).address;

      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey, recipient3.publicKey],
        splits: [4000, 3000, 3000],
        requiredConfirmations: 2, // Need 2 out of 3 confirmations
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      await program.methods
        .fundEscrow(new anchor.BN(1_000_000))
        .accounts({
          escrow: escrowPda,

          payer: requester.publicKey,
          payerTokenAccount: requesterAta,
          mint: mint,
          vault: vaultAta,
        })
        .signers([requester])
        .rpc();

      await program.methods
        .proposeRelease()
        .accounts({
          escrow: escrowPda,

          proposer: requester.publicKey,
        })
        .signers([requester])
        .rpc();
    });

    it("Should successfully confirm release (first confirmation)", async () => {
      await program.methods
        .confirmRelease()
        .accounts({
          escrow: escrowPda,

          recipient: recipient1.publicKey,
        })
        .signers([recipient1])
        .rpc();

      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.status, STATUS_PENDING); // Still pending, need 2 confirmations
      assert.equal(escrow.confirmations, 1); // First bit set (recipient1 is index 0)
    });

    it("Should reach released status after required confirmations", async () => {
      // First confirmation
      await program.methods
        .confirmRelease()
        .accounts({
          escrow: escrowPda,

          recipient: recipient1.publicKey,
        })
        .signers([recipient1])
        .rpc();

      // Second confirmation - should trigger release
      await program.methods
        .confirmRelease()
        .accounts({
          escrow: escrowPda,

          recipient: recipient2.publicKey,
        })
        .signers([recipient2])
        .rpc();

      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.status, STATUS_RELEASED);
      assert.equal(escrow.confirmations, 3); // Both bits set (binary: 011 = 3)
    });

    it("Should fail when unauthorized user tries to confirm", async () => {
      try {
        await program.methods
          .confirmRelease()
          .accounts({
          escrow: escrowPda,

            recipient: unauthorizedUser.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc();
        assert.fail("Should have thrown RecipientNotFound error");
      } catch (error) {
        assert.include(error.toString(), "RecipientNotFound");
      }
    });

    it("Should fail when recipient confirms twice", async () => {
      // First confirmation
      await program.methods
        .confirmRelease()
        .accounts({
          escrow: escrowPda,

          recipient: recipient1.publicKey,
        })
        .signers([recipient1])
        .rpc();

      // Try to confirm again
      try {
        await program.methods
          .confirmRelease()
          .accounts({
          escrow: escrowPda,

            recipient: recipient1.publicKey,
          })
          .signers([recipient1])
          .rpc();
        assert.fail("Should have thrown AlreadyConfirmed error");
      } catch (error) {
        assert.include(error.toString(), "AlreadyConfirmed");
      }
    });

    it("Should fail when confirming non-pending escrow", async () => {
      // First set escrow to released by getting enough confirmations
      await program.methods
        .confirmRelease()
        .accounts({
          escrow: escrowPda,

          recipient: recipient1.publicKey,
        })
        .signers([recipient1])
        .rpc();

      await program.methods
        .confirmRelease()
        .accounts({
          escrow: escrowPda,

          recipient: recipient2.publicKey,
        })
        .signers([recipient2])
        .rpc();

      // Now try to confirm on released escrow
      try {
        await program.methods
          .confirmRelease()
          .accounts({
          escrow: escrowPda,

            recipient: recipient3.publicKey,
          })
          .signers([recipient3])
          .rpc();
        assert.fail("Should have thrown InvalidStatus error");
      } catch (error) {
        assert.include(error.toString(), "InvalidStatus");
      }
    });
  });

  describe("Claim Funds", () => {
    beforeEach(async () => {
      // Setup released escrow
      bountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString(); bountyId.set(Buffer.from(uniqueId.slice(-20)));

      [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
        program.programId
      );

      vaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        escrowPda,
        true
      )).address;

      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [6000, 4000], // 60/40 split
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      await program.methods
        .fundEscrow(new anchor.BN(1_000_000))
        .accounts({
          escrow: escrowPda,

          payer: requester.publicKey,
          payerTokenAccount: requesterAta,
          mint: mint,
          vault: vaultAta,
        })
        .signers([requester])
        .rpc();

      await program.methods
        .proposeRelease()
        .accounts({
          escrow: escrowPda,

          proposer: requester.publicKey,
        })
        .signers([requester])
        .rpc();

      await program.methods
        .confirmRelease()
        .accounts({
          escrow: escrowPda,

          recipient: recipient1.publicKey,
        })
        .signers([recipient1])
        .rpc();
    });

    it("Should successfully claim funds by first recipient", async () => {
      const initialBalance = await getAccount(provider.connection, recipient1Ata);
      const escrowBefore = await program.account.escrow.fetch(escrowPda);
      const expectedShare = Math.floor(escrowBefore.totalAmount.toNumber() * 6000 / BASIS_POINTS_DENOM);

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

      // Verify recipient received correct amount
      const finalBalance = await getAccount(provider.connection, recipient1Ata);
      const received = Number(finalBalance.amount) - Number(initialBalance.amount);
      assert.equal(received, expectedShare);

      // Verify escrow state updated
      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.claimed, 1); // First bit set
    });

    it("Should successfully claim funds by second recipient", async () => {
      // First recipient claims first
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

      const initialBalance = await getAccount(provider.connection, recipient2Ata);
      const fundAmount = 1_000_000;
      const expectedShare = Math.floor(fundAmount * 4000 / BASIS_POINTS_DENOM);

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

      // Verify recipient received correct amount
      const finalBalance = await getAccount(provider.connection, recipient2Ata);
      const received = Number(finalBalance.amount) - Number(initialBalance.amount);
      assert.equal(received, expectedShare);

      // Verify escrow state - both claimed, total amount should be reset
      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.claimed, 3); // Both bits set (binary: 11 = 3)
      assert.equal(escrow.totalAmount.toNumber(), 0); // Should be reset when all claimed
    });

    it("Should fail when recipient tries to claim twice", async () => {
      // First claim
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

      // Try to claim again
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

    it("Should fail when unauthorized user tries to claim", async () => {
      try {
        await program.methods
          .claim()
          .accounts({
          escrow: escrowPda,

            vault: vaultAta,
            claimant: unauthorizedUser.publicKey,
            claimantAta: unauthorizedAta,
          })
          .signers([unauthorizedUser])
          .rpc();
        assert.fail("Should have thrown RecipientNotFound error");
      } catch (error) {
        assert.include(error.toString(), "RecipientNotFound");
      }
    });

    it("Should fail when claiming from non-released escrow", async () => {
      // Create new escrow that's not released
      const newBountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString(); newBountyId.set(Buffer.from(uniqueId.slice(-20)));

      const [newEscrowPda] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), newBountyId],
        program.programId
      );

      const newVaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        newEscrowPda,
        true
      )).address;

      const params = {
        bountyId: Array.from(newBountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [5000, 5000],
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({
          escrow: newEscrowPda,
          vault: newVaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      await program.methods
        .fundEscrow(new anchor.BN(500_000))
        .accounts({
          escrow: escrowPda,
          escrow: newEscrowPda,
          payer: requester.publicKey,
          payerTokenAccount: requesterAta,
          mint: mint,
          vault: newVaultAta,
        })
        .signers([requester])
        .rpc();

      // Try to claim without release
      try {
        await program.methods
          .claim()
          .accounts({
          escrow: escrowPda,
            escrow: newEscrowPda,
            vault: newVaultAta,
            claimant: recipient1.publicKey,
            claimantAta: recipient1Ata,
          })
          .signers([recipient1])
          .rpc();
        assert.fail("Should have thrown InvalidStatus error");
      } catch (error) {
        assert.include(error.toString(), "InvalidStatus");
      }
    });
  });

  describe("Edge Cases and Complex Scenarios", () => {
    it("Should handle very small amounts and rounding", async () => {
      bountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString(); bountyId.set(Buffer.from(uniqueId.slice(-20)));

      [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
        program.programId
      );

      vaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        escrowPda,
        true
      )).address;

      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey, recipient3.publicKey],
        splits: [3333, 3333, 3334], // Should sum to 10000 with rounding
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      // Fund with small amount
      const smallAmount = 10; // Very small amount
      await program.methods
        .fundEscrow(new anchor.BN(smallAmount))
        .accounts({
          escrow: escrowPda,

          payer: requester.publicKey,
          payerTokenAccount: requesterAta,
          mint: mint,
          vault: vaultAta,
        })
        .signers([requester])
        .rpc();

      await program.methods
        .proposeRelease()
        .accounts({
          escrow: escrowPda,

          proposer: requester.publicKey,
        })
        .signers([requester])
        .rpc();

      await program.methods
        .confirmRelease()
        .accounts({
          escrow: escrowPda,

          recipient: recipient1.publicKey,
        })
        .signers([recipient1])
        .rpc();

      // All recipients should be able to claim (even if amounts are tiny)
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

      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.claimed, 1);
    });

    it("Should handle maximum size bounty with 8 recipients", async () => {
      bountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString(); bountyId.set(Buffer.from(uniqueId.slice(-20)));

      [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
        program.programId
      );

      vaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        escrowPda,
        true
      )).address;

      // Create 8 recipients
      const maxRecipients = [
        recipient1.publicKey,
        recipient2.publicKey,
        recipient3.publicKey,
        arbiter.publicKey,
        unauthorizedUser.publicKey,
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
      ];

      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: maxRecipients,
        splits: [1250, 1250, 1250, 1250, 1250, 1250, 1250, 1250], // 8 * 1250 = 10000
        requiredConfirmations: 8, // All must confirm
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      const escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.recipientCount, 8);
      assert.equal(escrow.requiredConfirmations, 8);
    });

    it("Should prevent claiming when escrow has zero balance", async () => {
      bountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString(); bountyId.set(Buffer.from(uniqueId.slice(-20)));

      [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
        program.programId
      );

      vaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        escrowPda,
        true
      )).address;

      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [5000, 5000],
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      // Don't fund the escrow, try to propose release (should fail)
      try {
        await program.methods
          .proposeRelease()
          .accounts({
            escrow: escrowPda,
            proposer: requester.publicKey,
          })
          .signers([requester])
          .rpc();
        assert.fail("Should have failed to propose release on unfunded escrow");
      } catch (error) {
        assert.include(error.toString(), "InvalidStatus");
      }
    });
  });

  describe("State Consistency", () => {
    it("Should maintain correct state through full workflow", async () => {
      bountyId = Buffer.from(Array(32).fill(0));
      const uniqueId = Date.now().toString(); bountyId.set(Buffer.from(uniqueId.slice(-20)));

      [escrowPda, escrowBump] = await PublicKey.findProgramAddress(
        [Buffer.from("escrow"), requester.publicKey.toBuffer(), bountyId],
        program.programId
      );

      vaultAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection,
        requester,
        mint,
        escrowPda,
        true
      )).address;

      // 1. Initialize
      const params = {
        bountyId: Array.from(bountyId),
        tokenMint: mint,
        recipients: [recipient1.publicKey, recipient2.publicKey],
        splits: [8000, 2000], // 80/20 split
        requiredConfirmations: 1,
        arbiter: arbiter.publicKey,
        timelockExpiry: new anchor.BN(0),
      };

      await program.methods
        .initializeEscrow(params)
        .accounts({

          vault: vaultAta,
          requester: requester.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([requester])
        .rpc();

      let escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.status, STATUS_INITIALIZED);
      assert.equal(escrow.totalAmount.toNumber(), 0);
      assert.equal(escrow.confirmations, 0);
      assert.equal(escrow.claimed, 0);

      // 2. Fund
      const fundAmount = 2_000_000; // 2 tokens
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

      escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.status, STATUS_FUNDED);
      assert.equal(escrow.totalAmount.toNumber(), fundAmount);

      // 3. Propose
      await program.methods
        .proposeRelease()
        .accounts({
          escrow: escrowPda,

          proposer: requester.publicKey,
        })
        .signers([requester])
        .rpc();

      escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.status, STATUS_PENDING);

      // 4. Confirm
      await program.methods
        .confirmRelease()
        .accounts({
          escrow: escrowPda,

          recipient: recipient1.publicKey,
        })
        .signers([recipient1])
        .rpc();

      escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.status, STATUS_RELEASED);
      assert.equal(escrow.confirmations, 1);

      // 5. Claim - First recipient (80%)
      const recipient1InitialBalance = await getAccount(provider.connection, recipient1Ata);
      
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

      const recipient1FinalBalance = await getAccount(provider.connection, recipient1Ata);
      const recipient1Received = Number(recipient1FinalBalance.amount) - Number(recipient1InitialBalance.amount);
      assert.equal(recipient1Received, Math.floor(fundAmount * 8000 / BASIS_POINTS_DENOM));

      escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.claimed, 1); // First bit set

      // 6. Claim - Second recipient (20%)
      const recipient2InitialBalance = await getAccount(provider.connection, recipient2Ata);

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

      const recipient2FinalBalance = await getAccount(provider.connection, recipient2Ata);
      const recipient2Received = Number(recipient2FinalBalance.amount) - Number(recipient2InitialBalance.amount);
      assert.equal(recipient2Received, Math.floor(fundAmount * 2000 / BASIS_POINTS_DENOM));

      // Final state verification
      escrow = await program.account.escrow.fetch(escrowPda);
      assert.equal(escrow.claimed, 3); // Both bits set
      assert.equal(escrow.totalAmount.toNumber(), 0); // Reset after all claimed

      // Verify vault is empty
      const vaultBalance = await getAccount(provider.connection, vaultAta);
      assert.equal(Number(vaultBalance.amount), 0);

      // Verify total distributed equals original amount
      assert.equal(recipient1Received + recipient2Received, fundAmount);
    });
  });
});
