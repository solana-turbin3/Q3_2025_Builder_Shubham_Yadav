import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, Wallet, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { IDL, Turbin3Prereq } from "./programs/turbin3_prereq";
import wallet from "./Turbin3-wallet.json";

const keypair = Keypair.fromSecretKey(new Uint8Array(wallet));
const connection = new Connection("https://api.devnet.solana.com");
const provider = new AnchorProvider(connection, new Wallet(keypair), { 
  commitment: "confirmed" 
});
const programId = new PublicKey("TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM");
const program = new Program<Turbin3Prereq>(IDL, provider);
const account_seeds = [
  Buffer.from("prereqs"),
  keypair.publicKey.toBuffer(),
];
const [account_key, _account_bump] = PublicKey.findProgramAddressSync(
  account_seeds,
  programId
);

const mintCollection = new PublicKey("5ebsp5RChCGK7ssRZMVMufgVZhd2kFbNaotcZ5UvytN2");
const mintTs = Keypair.generate();
const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

(async () => {
  try {
    const txhash = await program.methods
      .initialize("batmnnn")
      .accounts({
        user: keypair.publicKey,
      })
      .signers([keypair])
      .rpc();
    console.log(`Success! Check out your TX here: https://explorer.solana.com/tx/${txhash}?cluster=devnet`);
  } catch (e) {
    console.error(`Oops, something went wrong: ${e}`);
  }
})();


(async () => {
    try {
        const txhash = await program.methods.submitTs().accountsPartial({
            user: keypair.publicKey,
            account: account_key,
            mint: mintTs.publicKey,
            collection: mintCollection,
            mpl_core_program: MPL_CORE_PROGRAM_ID,
            system_program: SystemProgram.programId,
        }).signers([keypair, mintTs]).rpc();

        console.log(`Success! Check out your TX here: https://explorer.solana.com/tx/${txhash}?cluster=devnet`);
    } catch (e) {
        console.log("Something went wrong: ",e)
    }
})();
