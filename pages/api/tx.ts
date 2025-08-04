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
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import base58 from "bs58";
import type { NextApiRequest, NextApiResponse } from "next";
import { createEncryptionMiddleware } from "../../utils/encrytption"; // Adjust path as needed

// Memo Program ID on Solana
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

type Data = {
  result: "success" | "error";
  message:
  | {
    tx: string;
    signatures: ({ key: string; signature: string | null } | null)[];
  }
  | { error: Error };
};

// Initialize encryption middleware
const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || 'default-key',
  process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!' // Must be exactly 16 bytes
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  console.log(`[API] /api/tx - Request started - Method: ${req.method}`);
  console.log(`[API] /api/tx - Headers:`, req.headers);

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      console.log(`[API] /api/tx - Method not allowed: ${req.method}`);
      return res.status(405).json({
        result: "error",
        message: { error: new Error("Method not allowed") }
      });
    }

    // Process request data (decrypt if IS_ENCRYPTED header is set)
    const processedBody = encryptionMiddleware.processRequest(req.body, req.headers);
    console.log(`[API] /api/tx - Processed request body:`, processedBody);

    const {
      senderAddress,
      receiverAddress,
      tokenMint,
      amount,
      transactionFee,
      transactionFeeAddress,
      narration
    } = processedBody;

    // Validate required parameters
    if (!senderAddress || typeof senderAddress !== 'string') {
      const errorResponse = {
        result: "error" as const,
        message: { error: new Error("Sender address is required and must be a string") }
      };
      return res.status(400).json(
        encryptionMiddleware.processResponse(errorResponse, req.headers)
      );
    }

    if (!receiverAddress || typeof receiverAddress !== 'string') {
      const errorResponse = {
        result: "error" as const,
        message: { error: new Error("Receiver address is required and must be a string") }
      };
      return res.status(400).json(
        encryptionMiddleware.processResponse(errorResponse, req.headers)
      );
    }

    if (!tokenMint || typeof tokenMint !== 'string') {
      const errorResponse = {
        result: "error" as const,
        message: { error: new Error("Token mint address is required and must be a string") }
      };
      return res.status(400).json(
        encryptionMiddleware.processResponse(errorResponse, req.headers)
      );
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      const errorResponse = {
        result: "error" as const,
        message: { error: new Error("Amount is required and must be a positive number") }
      };
      return res.status(400).json(
        encryptionMiddleware.processResponse(errorResponse, req.headers)
      );
    }

    // Validate transaction fee parameters (optional)
    if (transactionFee !== undefined && transactionFee !== null) {
      if (typeof transactionFee !== 'number' || transactionFee <= 0) {
        const errorResponse = {
          result: "error" as const,
          message: { error: new Error("Transaction fee must be a positive number") }
        };
        return res.status(400).json(
          encryptionMiddleware.processResponse(errorResponse, req.headers)
        );
      }

      if (!transactionFeeAddress || typeof transactionFeeAddress !== 'string') {
        const errorResponse = {
          result: "error" as const,
          message: { error: new Error("Transaction fee address is required when transaction fee is provided") }
        };
        return res.status(400).json(
          encryptionMiddleware.processResponse(errorResponse, req.headers)
        );
      }
    }

    // Validate narration (optional)
    if (narration !== undefined && narration !== null && typeof narration !== 'string') {
      const errorResponse = {
        result: "error" as const,
        message: { error: new Error("Narration must be a string") }
      };
      return res.status(400).json(
        encryptionMiddleware.processResponse(errorResponse, req.headers)
      );
    }

    // Validate public key formats
    let sender: PublicKey;
    let receiver: PublicKey;
    let mint: PublicKey;
    let feeReceiver: PublicKey | null = null;

    try {
      sender = new PublicKey(senderAddress);
      receiver = new PublicKey(receiverAddress);
      mint = new PublicKey(tokenMint);

      if (transactionFeeAddress) {
        feeReceiver = new PublicKey(transactionFeeAddress);
      }
    } catch (error) {
      const errorResponse = {
        result: "error" as const,
        message: { error: new Error("Invalid public key format") }
      };
      return res.status(400).json(
        encryptionMiddleware.processResponse(errorResponse, req.headers)
      );
    }

    console.log(`[API] /api/tx - Loading relayer wallet`);
    if (!process.env.WALLET) {
      console.log(`[API] /api/tx - WALLET environment variable not found`);
      const errorResponse = {
        result: "error" as const,
        message: { error: new Error("Wallet environment variable not configured") }
      };
      return res.status(500).json(
        encryptionMiddleware.processResponse(errorResponse, req.headers)
      );
    }

    let relayerWallet: Keypair;
    try {
      relayerWallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
      console.log(`[API] /api/tx - Relayer wallet loaded: ${relayerWallet.publicKey.toBase58()}`);
    } catch (error) {
      console.log(`[API] /api/tx - Failed to load relayer wallet:`, error);
      const errorResponse = {
        result: "error" as const,
        message: { error: new Error("Invalid relayer wallet configuration") }
      };
      return res.status(500).json(
        encryptionMiddleware.processResponse(errorResponse, req.headers)
      );
    }

    console.log(`[API] /api/tx - Creating connection to devnet`);
    const connection = new Connection(clusterApiUrl("devnet"), "finalized");

    console.log(`[API] /api/tx - Getting associated token addresses`);
    const senderAta = await getAssociatedTokenAddress(mint, sender);
    const receiverAta = await getAssociatedTokenAddress(mint, receiver);

    // Get fee receiver ATA if transaction fee is specified
    let feeReceiverAta: PublicKey | null = null;
    if (feeReceiver && transactionFee) {
      feeReceiverAta = await getAssociatedTokenAddress(mint, feeReceiver);
    }

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

    // Check if fee receiver ATA exists (if transaction fee is specified)
    if (feeReceiverAta && feeReceiver) {
      const feeReceiverAccountInfo = await connection.getAccountInfo(feeReceiverAta);
      if (!feeReceiverAccountInfo) {
        console.log(`[API] /api/tx - Creating fee receiver ATA (relayer pays)`);
        instructions.push(
          createAssociatedTokenAccountInstruction(
            relayerWallet.publicKey, // RELAYER pays for ATA creation
            feeReceiverAta,
            feeReceiver,
            mint
          )
        );
      }
    }

    // Add main transfer instruction (sender authorizes, but relayer pays gas)
    console.log(`[API] /api/tx - Adding main transfer instruction: ${amount} tokens`);
    instructions.push(
      createTransferInstruction(
        senderAta,
        receiverAta,
        sender, // sender must authorize the transfer
        amount
      )
    );

    // Add transaction fee transfer instruction (if specified)
    if (feeReceiverAta && feeReceiver && transactionFee) {
      console.log(`[API] /api/tx - Adding transaction fee instruction: ${transactionFee} tokens to ${feeReceiver.toBase58()}`);
      instructions.push(
        createTransferInstruction(
          senderAta,
          feeReceiverAta,
          sender, // sender must authorize the fee transfer
          transactionFee
        )
      );
    }

    // Add memo instruction (if narration is provided)
    if (narration && narration.trim() !== '') {
      console.log(`[API] /api/tx - Adding memo instruction: "${narration}"`);
      const memoInstruction = new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(narration, 'utf8'),
      });
      instructions.push(memoInstruction);
    }

    // Create transaction
    const transaction = new Transaction().add(...instructions);

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;

    // IMPORTANT: Set relayer as fee payer (this is what makes relayer pay gas)
    transaction.feePayer = relayerWallet.publicKey;

    console.log(`[API] /api/tx - Fee payer set to relayer: ${relayerWallet.publicKey.toBase58()}`);
    console.log(`[API] /api/tx - Transaction instructions count: ${instructions.length}`);

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
    console.log(`[API] /api/tx - Main transfer: ${amount} tokens`);
    if (transactionFee) {
      console.log(`[API] /api/tx - Transaction fee: ${transactionFee} tokens to ${feeReceiver?.toBase58()}`);
    }
    if (narration) {
      console.log(`[API] /api/tx - Memo: "${narration}"`);
    }

    const successResponse = {
      result: "success" as const,
      message: {
        tx: serializedTx,
        signatures: signatures,
      },
    };

    // Process response data (encrypt if IS_ENCRYPTED header is set)
    const processedResponse = encryptionMiddleware.processResponse(successResponse, req.headers);

    res.json(processedResponse);

  } catch (error) {
    console.log(`[API] /api/tx - Error:`, error);

    const errorResponse = {
      result: "error" as const,
      message: { error: error as Error }
    };

    const processedErrorResponse = encryptionMiddleware.processResponse(errorResponse, req.headers);

    res.status(500).json(processedErrorResponse);
  }
}