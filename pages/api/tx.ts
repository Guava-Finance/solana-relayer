// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
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
    const { address, tokenMint, amount } = req.body;
    
    // Validate that required parameters are provided
    if (!address || typeof address !== 'string') {
      console.log(`[API] /api/tx - Invalid address:`, address);
      return res.status(400).json({
        result: "error",
        message: { error: new Error("Address is required and must be a string") }
      });
    }

    if (!tokenMint || typeof tokenMint !== 'string') {
      console.log(`[API] /api/tx - Invalid token mint:`, tokenMint);
      return res.status(400).json({
        result: "error",
        message: { error: new Error("Token mint address is required and must be a string") }
      });
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      console.log(`[API] /api/tx - Invalid amount:`, amount);
      return res.status(400).json({
        result: "error",
        message: { error: new Error("Amount is required and must be a positive number") }
      });
    }

    console.log(`[API] /api/tx - Validating public keys`);
    // Validate that the addresses are valid public key formats
    let user: PublicKey;
    let mint: PublicKey;
    try {
      user = new PublicKey(address);
      console.log(`[API] /api/tx - User public key validated: ${user.toBase58()}`);
    } catch (error) {
      console.log(`[API] /api/tx - Invalid user public key format: ${address}`, error);
      return res.status(400).json({
        result: "error", 
        message: { error: new Error("Invalid user public key format") }
      });
    }

    try {
      mint = new PublicKey(tokenMint);
      console.log(`[API] /api/tx - Token mint validated: ${mint.toBase58()}`);
    } catch (error) {
      console.log(`[API] /api/tx - Invalid token mint format: ${tokenMint}`, error);
      return res.status(400).json({
        result: "error", 
        message: { error: new Error("Invalid token mint format") }
      });
    }
    
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

    console.log(`[API] /api/tx - Getting associated token addresses`);
    let senderAta, receiverAta;
    try {
      senderAta = await getAssociatedTokenAddress(
        mint, // mint
        wallet.publicKey // sender (relayer wallet)
      );
      receiverAta = await getAssociatedTokenAddress(
        mint, // mint
        user // receiver (user)
      );
      console.log(`[API] /api/tx - Sender ATA: ${senderAta.toBase58()}`);
      console.log(`[API] /api/tx - Receiver ATA: ${receiverAta.toBase58()}`);
    } catch (error) {
      console.log(`[API] /api/tx - Failed to get associated token addresses:`, error);
      return res.status(500).json({
        result: "error",
        message: { error: new Error("Failed to get associated token addresses") }
      });
    }
    
    console.log(`[API] /api/tx - Building transfer transaction`);
    let txn;
    try {
      const instructions = [];
      
      // Add nonce advance instruction
      instructions.push(
        SystemProgram.nonceAdvance({
          noncePubkey: nonceAccount.publicKey,
          authorizedPubkey: nonceAccountAuth.publicKey,
        })
      );

      // Check if sender ATA exists, if not create it
      const senderAccountInfo = await connection.getAccountInfo(senderAta);
      if (!senderAccountInfo) {
        console.log(`[API] /api/tx - Creating sender ATA`);
        instructions.push(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey, // payer
            senderAta, // ata
            wallet.publicKey, // owner
            mint // mint
          )
        );
      }

      // Check if receiver ATA exists, if not create it
      const receiverAccountInfo = await connection.getAccountInfo(receiverAta);
      if (!receiverAccountInfo) {
        console.log(`[API] /api/tx - Creating receiver ATA`);
        instructions.push(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey, // payer
            receiverAta, // ata
            user, // owner
            mint // mint
          )
        );
      }

      // Add transfer instruction
      instructions.push(
        createTransferInstruction(
          senderAta, // from
          receiverAta, // to
          wallet.publicKey, // authority
          amount // amount
        )
      );
      
      txn = new Transaction().add(...instructions);
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
      mint: mint.toBase58(),
      senderAta: senderAta.toBase58(),
      receiverAta: receiverAta.toBase58(),
      amount: amount,
      nonce: nonce
    });

    console.log(`[API] /api/tx - Setting transaction properties`);
    try {
      txn.recentBlockhash = nonce;
      console.log(`[API] /api/tx - Recent blockhash set: ${txn.recentBlockhash}`);
      txn.feePayer = wallet.publicKey;
      console.log(`[API] /api/tx - Fee payer set: ${txn.feePayer.toBase58()}`);

      console.log(`[API] /api/tx - Partially signing transaction`);
      txn.partialSign(wallet, nonceAccountAuth);
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
