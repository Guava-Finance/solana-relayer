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
  
  // Check relayer wallet balance
  console.log(`Checking relayer wallet balance...`);
  const balance = await connection.getBalance(feePayer.publicKey);
  console.log(`Relayer wallet balance: ${balance} lamports (${balance / 1e9} SOL)`);
  
  // Calculate required lamports for nonce account
  const nonceRentExemption = await connection.getMinimumBalanceForRentExemption(
    NONCE_ACCOUNT_LENGTH
  );
  console.log(`Nonce account rent exemption: ${nonceRentExemption} lamports`);
  
  // Estimate transaction fee (approximate)
  const estimatedFee = 5000; // ~0.000005 SOL
  const totalRequired = nonceRentExemption + estimatedFee;
  console.log(`Total required: ${totalRequired} lamports (${totalRequired / 1e9} SOL)`);
  
  if (balance < totalRequired) {
    throw new Error(`Insufficient balance. Relayer wallet needs at least ${totalRequired / 1e9} SOL but has ${balance / 1e9} SOL`);
  }
  
  let nonceAccount = Keypair.generate();
  console.log(`nonce account: ${nonceAccount.publicKey.toBase58()}`);
  let tx = new Transaction().add(
    // create nonce account
    SystemProgram.createAccount({
      fromPubkey: feePayer.publicKey,
      newAccountPubkey: nonceAccount.publicKey,
      lamports: nonceRentExemption,
      space: NONCE_ACCOUNT_LENGTH,
      programId: SystemProgram.programId,
    }),
    // init nonce account
    SystemProgram.nonceInitialize({
      noncePubkey: nonceAccount.publicKey, // nonce account pubkey
      authorizedPubkey: nonceAccountAuth.publicKey, // nonce account authority (for advance and close)
    })
  );

  try {
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
  } catch (error) {
    console.log(`Error sending nonce creation transaction:`, error);
    // Type guard to check if error is an Error object with a message property
    if (error instanceof Error && error.message?.includes('0x1')) {
      throw new Error(`Transaction failed: Insufficient SOL balance in relayer wallet. Please fund the relayer wallet with at least 0.01 SOL`);
    }
    throw error;
  }
  
  return { nonceAccount, nonceAccountAuth };
};

export default createDurableNonce;