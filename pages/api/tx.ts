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

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || 'default-key',
  process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  console.log(`[API] /api/tx - Request started - Method: ${req.method}`);
  console.log(`[API] /api/tx - Headers:`, req.headers);

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({
        result: "error",
        message: { error: new Error("Method not allowed") }
      });
    }

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

    // Convert amount and fee to number if they're strings
    const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    const parsedTransactionFee = typeof transactionFee === 'string' ? parseFloat(transactionFee) : transactionFee;

    // Validation
    if (!senderAddress || typeof senderAddress !== 'string') {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error("Sender address is required and must be a string") }
      }, req.headers));
    }

    if (!receiverAddress || typeof receiverAddress !== 'string') {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error("Receiver address is required and must be a string") }
      }, req.headers));
    }

    if (!tokenMint || typeof tokenMint !== 'string') {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error("Token mint address is required and must be a string") }
      }, req.headers));
    }

    if (!parsedAmount || typeof parsedAmount !== 'number' || parsedAmount <= 0) {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error("Amount is required and must be a positive number") }
      }, req.headers));
    }

    if (parsedTransactionFee !== undefined && parsedTransactionFee !== null) {
      if (typeof parsedTransactionFee !== 'number' || parsedTransactionFee <= 0) {
        return res.status(400).json(encryptionMiddleware.processResponse({
          result: "error",
          message: { error: new Error("Transaction fee must be a positive number") }
        }, req.headers));
      }

      if (!transactionFeeAddress || typeof transactionFeeAddress !== 'string') {
        return res.status(400).json(encryptionMiddleware.processResponse({
          result: "error",
          message: { error: new Error("Transaction fee address is required when transaction fee is provided") }
        }, req.headers));
      }
    }

    if (narration !== undefined && narration !== null && typeof narration !== 'string') {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error("Narration must be a string") }
      }, req.headers));
    }

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
    } catch {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error("Invalid public key format") }
      }, req.headers));
    }

    if (!process.env.WALLET) {
      return res.status(500).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error("Wallet environment variable not configured") }
      }, req.headers));
    }

    let relayerWallet: Keypair;
    try {
      relayerWallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
    } catch {
      return res.status(500).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error("Invalid relayer wallet configuration") }
      }, req.headers));
    }

    const connection = new Connection(clusterApiUrl("mainnet-beta"), "finalized");

    const senderAta = await getAssociatedTokenAddress(mint, sender);
    const receiverAta = await getAssociatedTokenAddress(mint, receiver);
    let feeReceiverAta: PublicKey | null = null;
    if (feeReceiver && parsedTransactionFee) {
      feeReceiverAta = await getAssociatedTokenAddress(mint, feeReceiver);
    }

    const instructions = [];

    const senderAccountInfo = await connection.getAccountInfo(senderAta);
    if (!senderAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          relayerWallet.publicKey,
          senderAta,
          sender,
          mint
        )
      );
    }

    const receiverAccountInfo = await connection.getAccountInfo(receiverAta);
    if (!receiverAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          relayerWallet.publicKey,
          receiverAta,
          receiver,
          mint
        )
      );
    }

    if (feeReceiverAta && feeReceiver) {
      const feeReceiverAccountInfo = await connection.getAccountInfo(feeReceiverAta);
      if (!feeReceiverAccountInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            relayerWallet.publicKey,
            feeReceiverAta,
            feeReceiver,
            mint
          )
        );
      }
    }

    instructions.push(
      createTransferInstruction(
        senderAta,
        receiverAta,
        sender,
        parsedAmount
      )
    );

    if (feeReceiverAta && feeReceiver && parsedTransactionFee) {
      instructions.push(
        createTransferInstruction(
          senderAta,
          feeReceiverAta,
          sender,
          parsedTransactionFee
        )
      );
    }

    if (narration && narration.trim() !== '') {
      instructions.push(
        new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(narration, 'utf8'),
        })
      );
    }

    const transaction = new Transaction().add(...instructions);
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = relayerWallet.publicKey;
    transaction.partialSign(relayerWallet);

    const serializedTx = base58.encode(
      transaction.serialize({ requireAllSignatures: false })
    );

    const signatures = transaction.signatures.map((s) => ({
      key: s.publicKey.toBase58(),
      signature: s.signature ? base58.encode(s.signature) : null,
    }));

    const successResponse = {
      result: "success" as const,
      message: {
        tx: serializedTx,
        signatures,
      },
    };

    return res.json(
      encryptionMiddleware.processResponse(successResponse, req.headers)
    );
  } catch (error) {
    console.error(`[API] /api/tx - Error:`, error);
    return res.status(500).json(
      encryptionMiddleware.processResponse({
        result: "error",
        message: { error: error as Error }
      }, req.headers)
    );
  }
}
