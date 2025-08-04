// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import base58 from "bs58";
import type { NextApiRequest, NextApiResponse } from "next";
import createDurableNonce from "../../utils/nonce";

type Data = {
  result: "success" | "error";
  message:
    | {
        tx: string;
        signatures: ({ key: string; signature: string | null } | null)[];
      }
    | { error: Error };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  console.log(`[API] /api/tx - Request started - Method: ${req.method}`);
  
  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      console.log(`[API] /api/tx - Method not allowed: ${req.method}`);
      return res.status(405).json({
        result: "error",
        message: { error: new Error("Method not allowed") }
      });
    }

    console.log(`[API] /api/tx - Request body:`, req.body);
    const { address } = req.body;
    
    // Validate that address is provided
    if (!address || typeof address !== 'string') {
      console.log(`[API] /api/tx - Invalid address:`, address);
      return res.status(400).json({
        result: "error",
        message: { error: new Error("Address is required and must be a string") }
      });
    }

    console.log(`[API] /api/tx - Validating public key: ${address}`);
    // Validate that the address is a valid public key format
    let user: PublicKey;
    try {
      user = new PublicKey(address);
      console.log(`[API] /api/tx - Public key validated successfully: ${user.toBase58()}`);
    } catch (error) {
      console.log(`[API] /api/tx - Invalid public key format: ${address}`, error);
      return res.status(400).json({
        result: "error", 
        message: { error: new Error("Invalid public key format") }
      });
    }

    console.log(`[API] /api/tx - Creating mint keypair`);
    const mint = Keypair.generate();
    console.log(`[API] /api/tx - Mint public key: ${mint.publicKey.toBase58()}`);
    
    console.log(`[API] /api/tx - Creating connection to mainnet`);
    const connection = new Connection(clusterApiUrl("mainnet-beta"), "finalized");
    
    console.log(`[API] /api/tx - Loading wallet from environment`);
    if (!process.env.WALLET) {
      console.log(`[API] /api/tx - WALLET environment variable not found`);
      return res.status(500).json({
        result: "error",
        message: { error: new Error("Wallet environment variable not configured") }
      });
    }
    
    let wallet: Keypair;
    try {
      wallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
      console.log(`[API] /api/tx - Wallet loaded successfully: ${wallet.publicKey.toBase58()}`);
    } catch (error) {
      console.log(`[API] /api/tx - Failed to load wallet:`, error);
      return res.status(500).json({
        result: "error",
        message: { error: new Error("Invalid wallet configuration") }
      });
    }
    
    console.log(`[API] /api/tx - Creating durable nonce`);
    let nonceAccount, nonceAccountAuth;
    try {
      const nonceResult = await createDurableNonce(wallet);
      nonceAccount = nonceResult.nonceAccount;
      nonceAccountAuth = nonceResult.nonceAccountAuth;
      console.log(`[API] /api/tx - Nonce account created: ${nonceAccount.publicKey.toBase58()}`);
    } catch (error) {
      console.log(`[API] /api/tx - Failed to create durable nonce:`, error);
      return res.status(500).json({
        result: "error",
        message: { error: new Error("Failed to create durable nonce") }
      });
    }

    console.log(`[API] /api/tx - Getting associated token address`);
    let ata;
    try {
      ata = await getAssociatedTokenAddress(
        mint.publicKey, // mint
        user // owner
      );
      console.log(`[API] /api/tx - Associated token address: ${ata.toBase58()}`);
    } catch (error) {
      console.log(`[API] /api/tx - Failed to get associated token address:`, error);
      return res.status(500).json({
        result: "error",
        message: { error: new Error("Failed to get associated token address") }
      });
    }
    
    console.log(`[API] /api/tx - Building transaction`);
    let txn;
    try {
      const lamports = await getMinimumBalanceForRentExemptMint(connection);
      console.log(`[API] /api/tx - Required lamports for mint: ${lamports}`);
      
      txn = new Transaction().add(
        SystemProgram.nonceAdvance({
          noncePubkey: nonceAccount.publicKey,
          authorizedPubkey: nonceAccountAuth.publicKey,
        }),
        SystemProgram.createAccount({
          fromPubkey: wallet.publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports: lamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        // init mint account
        createInitializeMintInstruction(
          mint.publicKey, // mint pubkey
          0, // decimals
          wallet.publicKey, // mint authority
          wallet.publicKey // freeze authority (you can use `null` to disable it. when you disable it, you can't turn it on again)
        ),
        createAssociatedTokenAccountInstruction(
          wallet.publicKey, // payer
          ata, // ata
          user, // owner
          mint.publicKey // mint
        ),
        createMintToCheckedInstruction(
          mint.publicKey, // mint
          ata, // receiver (should be a token account)
          wallet.publicKey, // mint authority
          1, // amount. if your decimals is 8, you mint 10^8 for 1 token.
          0 // decimals
          // [signer1, signer2 ...], // only multisig account will use
        )
      );
      console.log(`[API] /api/tx - Transaction built successfully with ${txn.instructions.length} instructions`);
    } catch (error) {
      console.log(`[API] /api/tx - Failed to build transaction:`, error);
      return res.status(500).json({
        result: "error",
        message: { error: new Error("Failed to build transaction") }
      });
    }
    
    console.log(`[API] /api/tx - Getting nonce from account`);
    let nonce: string | null = null;
    let nonceAttempts = 0;
    const maxNonceAttempts = 20; // Increased from 10 to 20
    
    while (nonce === null && nonceAttempts < maxNonceAttempts) {
      nonceAttempts++;
      console.log(`[API] /api/tx - Nonce attempt ${nonceAttempts}/${maxNonceAttempts}`);
      
      try {
        const alchemyConnection = new Connection(process.env.ALCHEMY!, "recent");
        let nonceAccountInfo = await alchemyConnection.getAccountInfo(
          nonceAccount.publicKey,
          {
            commitment: "recent",
          }
        );
        console.log(`[API] /api/tx - Nonce account info:`, nonceAccountInfo);
        
        if (nonceAccountInfo === null) {
          console.log(`[API] /api/tx - Nonce account info is null, retrying...`);
          // Add a small delay before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        } else {
          let nonceAccountNonce = NonceAccount.fromAccountData(
            nonceAccountInfo?.data
          );
          nonce = nonceAccountNonce.nonce;
          console.log(`[API] /api/tx - Nonce retrieved successfully: ${nonce}`);
        }
      } catch (error) {
        console.log(`[API] /api/tx - Error getting nonce (attempt ${nonceAttempts}):`, error);
        // Add a small delay before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (nonceAttempts >= maxNonceAttempts) {
          return res.status(500).json({
            result: "error",
            message: { error: new Error("Failed to get nonce after maximum attempts") }
          });
        }
      }
    }

    if (!nonce) {
      console.log(`[API] /api/tx - Failed to get nonce after ${maxNonceAttempts} attempts`);
      return res.status(500).json({
        result: "error",
        message: { error: new Error("Failed to get nonce") }
      });
    }

    console.log(`[API] /api/tx - Final check values:`, {
      user: user.toBase58(),
      ata: ata.toBase58(),
      mint: mint.publicKey.toBase58(),
      nonce: nonce
    });

    console.log(`[API] /api/tx - Setting transaction properties`);
    try {
      txn.recentBlockhash = nonce;
      console.log(`[API] /api/tx - Recent blockhash set: ${txn.recentBlockhash}`);
      txn.feePayer = wallet.publicKey;
      console.log(`[API] /api/tx - Fee payer set: ${txn.feePayer.toBase58()}`);

      console.log(`[API] /api/tx - Partially signing transaction`);
      txn.partialSign(mint, wallet, nonceAccountAuth);
      console.log(`[API] /api/tx - Transaction signed successfully`);

      console.log(`[API] /api/tx - Serializing transaction`);
      const txnserialized = base58.encode(txn.serializeMessage());
      console.log(`[API] /api/tx - Transaction serialized: ${txnserialized.substring(0, 50)}...`);

      console.log(`[API] /api/tx - Processing signatures`);
      const sigs = txn.signatures.map((s) => {
        return {
          key: s.publicKey.toBase58(),
          signature: s.signature ? base58.encode(s.signature) : null,
        };
      });
      console.log(`[API] /api/tx - Signatures processed:`, sigs);
      
      console.log(`[API] /api/tx - Sending success response`);
      res.json({
        result: "success",
        message: {
          tx: txnserialized,
          signatures: sigs,
        },
      });
      console.log(`[API] /api/tx - Request completed successfully`);
      
    } catch (error) {
      console.log(`[API] /api/tx - Error in transaction processing:`, error);
      res.status(500).json({ 
        result: "error", 
        message: { error: error as Error } 
      });
    }
    
  } catch (error) {
    console.log(`[API] /api/tx - Unexpected error:`, error);
    res.status(500).json({ 
      result: "error", 
      message: { error: error as Error } 
    });
  }
}
