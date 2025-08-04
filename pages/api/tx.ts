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
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import base58 from "bs58";
import type { NextApiRequest, NextApiResponse } from "next";

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
    const { senderAddress, receiverAddress, tokenMint, amount } = req.body;
    
    // Validate required parameters
    if (!senderAddress || typeof senderAddress !== 'string') {
      return res.status(400).json({
        result: "error",
        message: { error: new Error("Sender address is required and must be a string") }
      });
    }

    if (!receiverAddress || typeof receiverAddress !== 'string') {
      return res.status(400).json({
        result: "error",
        message: { error: new Error("Receiver address is required and must be a string") }
      });
    }

    if (!tokenMint || typeof tokenMint !== 'string') {
      return res.status(400).json({
        result: "error",
        message: { error: new Error("Token mint address is required and must be a string") }
      });
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        result: "error",
        message: { error: new Error("Amount is required and must be a positive number") }
      });
    }

    // Validate public key formats
    let sender: PublicKey;
    let receiver: PublicKey;
    let mint: PublicKey;
    
    try {
      sender = new PublicKey(senderAddress);
      receiver = new PublicKey(receiverAddress);
      mint = new PublicKey(tokenMint);
    } catch (error) {
      return res.status(400).json({
        result: "error", 
        message: { error: new Error("Invalid public key format") }
      });
    }

    console.log(`[API] /api/tx - Loading relayer wallet`);
    if (!process.env.WALLET) {
      console.log(`[API] /api/tx - WALLET environment variable not found`);
      return res.status(500).json({
        result: "error",
        message: { error: new Error("Wallet environment variable not configured") }
      });
    }
    
    let relayerWallet: Keypair;
    try {
      relayerWallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
      console.log(`[API] /api/tx - Relayer wallet loaded: ${relayerWallet.publicKey.toBase58()}`);
    } catch (error) {
      console.log(`[API] /api/tx - Failed to load relayer wallet:`, error);
      return res.status(500).json({
        result: "error",
        message: { error: new Error("Invalid relayer wallet configuration") }
      });
    }

    console.log(`[API] /api/tx - Creating connection to devnet`);
    const connection = new Connection(clusterApiUrl("devnet"), "finalized");
    
    console.log(`[API] /api/tx - Getting associated token addresses`);
    const senderAta = await getAssociatedTokenAddress(mint, sender);
    const receiverAta = await getAssociatedTokenAddress(mint, receiver);

    console.log(`[API] /api/tx - Building transaction with relayer as fee payer`);
    const instructions = [];

    // Check if sender ATA exists
    const senderAccountInfo = await connection.getAccountInfo(senderAta);
    if (!senderAccountInfo) {
      console.log(`[API] /api/tx - Creating sender ATA (relayer pays)`);
      instructions.push(
        createAssociatedTokenAccountInstruction(
          relayerWallet.publicKey, // RELAYER pays for ATA creation
          senderAta,
          sender,
          mint
        )
      );
    }

    // Check if receiver ATA exists
    const receiverAccountInfo = await connection.getAccountInfo(receiverAta);
    if (!receiverAccountInfo) {
      console.log(`[API] /api/tx - Creating receiver ATA (relayer pays)`);
      instructions.push(
        createAssociatedTokenAccountInstruction(
          relayerWallet.publicKey, // RELAYER pays for ATA creation
          receiverAta,
          receiver,
          mint
        )
      );
    }

    // Add transfer instruction (sender authorizes, but relayer pays gas)
    instructions.push(
      createTransferInstruction(
        senderAta,
        receiverAta,
        sender, // sender must authorize the transfer
        amount
      )
    );

    // Create transaction
    const transaction = new Transaction().add(...instructions);
    
    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    
    // IMPORTANT: Set relayer as fee payer (this is what makes relayer pay gas)
    transaction.feePayer = relayerWallet.publicKey;
    
    console.log(`[API] /api/tx - Fee payer set to relayer: ${relayerWallet.publicKey.toBase58()}`);

    // Pre-sign with relayer wallet (for gas payment and ATA creation)
    transaction.partialSign(relayerWallet);
    console.log(`[API] /api/tx - Transaction pre-signed by relayer`);

    console.log(`[API] /api/tx - Serializing transaction for user signature`);
    const serializedTx = base58.encode(
      transaction.serialize({ requireAllSignatures: false })
    );

    const signatures = transaction.signatures.map((s) => ({
      key: s.publicKey.toBase58(),
      signature: s.signature ? base58.encode(s.signature) : null,
    }));

    console.log(`[API] /api/tx - Transaction ready - Relayer will pay gas fees`);
    console.log(`[API] /api/tx - Fee payer: ${transaction.feePayer?.toBase58()}`);
    console.log(`[API] /api/tx - Required signatures:`, signatures.length);

    res.json({
      result: "success",
      message: {
        tx: serializedTx,
        signatures: signatures,
      },
    });
    
  } catch (error) {
    console.log(`[API] /api/tx - Error:`, error);
    res.status(500).json({ 
      result: "error", 
      message: { error: error as Error } 
    });
  }
}