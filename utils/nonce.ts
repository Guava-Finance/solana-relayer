import {
  SystemProgram,
  NONCE_ACCOUNT_LENGTH,
  Keypair,
  Transaction,
  Connection,
  clusterApiUrl,
} from "@solana/web3.js";

const createDurableNonce = async (feePayer: Keypair) => {
  const nonceAccountAuth = Keypair.generate();
  if (!process.env.ALCHEMY) throw new Error("ALCHEMY env var not set");
  const connection = new Connection(process.env.ALCHEMY, {
    commitment: "finalized",
  });
  let nonceAccount = Keypair.generate();
  console.log(`nonce account: ${nonceAccount.publicKey.toBase58()}`);
  let tx = new Transaction().add(
    // create nonce account
    SystemProgram.createAccount({
      fromPubkey: feePayer.publicKey,
      newAccountPubkey: nonceAccount.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(
        NONCE_ACCOUNT_LENGTH
      ),
      space: NONCE_ACCOUNT_LENGTH,
      programId: SystemProgram.programId,
    }),
    // init nonce account
    SystemProgram.nonceInitialize({
      noncePubkey: nonceAccount.publicKey, // nonce account pubkey
      authorizedPubkey: nonceAccountAuth.publicKey, // nonce account authority (for advance and close)
    })
  );

  const txhash = await connection.sendTransaction(
    tx,
    [feePayer, nonceAccount],
    {
      preflightCommitment: "finalized",
    }
  );
  console.log(`nonce txhash: ${txhash}`);
  
  // Try to confirm the transaction, but don't fail if it times out
  console.log(`Waiting for nonce account creation to be confirmed...`);
  try {
    const confirmation = await connection.confirmTransaction(txhash, "finalized");
    console.log(`Nonce account creation confirmed:`, confirmation);
  } catch (error) {
    console.log(`Nonce account creation confirmation timed out, but transaction was sent: ${txhash}`);
    console.log(`You can check the transaction status at: https://solscan.io/tx/${txhash}`);
  }
  
  return { nonceAccount, nonceAccountAuth };
};

export default createDurableNonce;
