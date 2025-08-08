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
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import base58 from "bs58";
import type { NextApiRequest, NextApiResponse } from "next";
import { createEncryptionMiddleware } from "../../utils/encrytption"; // Adjust path as needed

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// Priority fee constants
const DEFAULT_COMPUTE_UNIT_PRICE = 1000; // micro lamports per compute unit
const MAX_COMPUTE_UNIT_PRICE = 50000; // Cap to prevent excessive fees
const COMPUTE_UNIT_LIMIT = 300000; // Adjust based on your transaction complexity

type Data = {
  result: "success" | "error";
  message:
    | {
        tx: string;
        signatures: ({ key: string; signature: string | null } | null)[];
        priorityFee?: number;
        computeUnits?: number;
        estimatedFee?: number;
      }
    | { error: Error };
};

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || 'default-key',
  process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
);

// Alternative method to get fee estimates when advanced methods aren't available
async function getFallbackFeeEstimate(connection: Connection): Promise<number> {
  try {
    // Method 1: Try to get fee calculator (older versions)
    const { feeCalculator } = await connection.getFees();
    if (feeCalculator && feeCalculator.lamportsPerSignature) {
      // Base fee estimation on network base fee
      const baseFee = feeCalculator.lamportsPerSignature;
      if (baseFee > 5000) {
        // Network is charging higher base fees, increase priority fee
        return Math.min(DEFAULT_COMPUTE_UNIT_PRICE * 2, MAX_COMPUTE_UNIT_PRICE);
      }
    }
  } catch (error) {
    console.warn('Fee calculator not available:', error);
  }

  try {
    // Method 2: Check slot height progression for congestion
    const slot1 = await connection.getSlot();
    await new Promise(resolve => setTimeout(resolve, 1000));
    const slot2 = await connection.getSlot();
    
    const slotsPerSecond = slot2 - slot1;
    console.log(`Slots per second: ${slotsPerSecond}`);
    
    // Normal Solana produces ~2.5 slots per second
    if (slotsPerSecond < 2) {
      // Slow slot progression indicates congestion
      return Math.min(DEFAULT_COMPUTE_UNIT_PRICE * 3, MAX_COMPUTE_UNIT_PRICE);
    } else if (slotsPerSecond < 2.5) {
      return Math.min(DEFAULT_COMPUTE_UNIT_PRICE * 1.5, MAX_COMPUTE_UNIT_PRICE);
    }
  } catch (error) {
    console.warn('Slot progression check failed:', error);
  }

  // Final fallback - use time-based estimation
  const hour = new Date().getHours();
  
  // Higher fees during typical high-activity hours (UTC)
  if ((hour >= 13 && hour <= 17) || (hour >= 21 && hour <= 1)) {
    return Math.min(DEFAULT_COMPUTE_UNIT_PRICE * 1.5, MAX_COMPUTE_UNIT_PRICE);
  }
  
  return DEFAULT_COMPUTE_UNIT_PRICE;
}
async function getPriorityFeeEstimate(connection: Connection): Promise<number> {
  try {
    // Check if the method exists (newer versions of @solana/web3.js)
    if (typeof connection.getRecentPrioritizationFees === 'function') {
      const recentPriorityFees = await connection.getRecentPrioritizationFees();
      
      if (recentPriorityFees.length === 0) {
        console.log('No recent priority fees found, using default');
        return DEFAULT_COMPUTE_UNIT_PRICE;
      }

      // Calculate percentiles for smart fee selection
      const fees = recentPriorityFees
        .map(fee => fee.prioritizationFee)
        .filter(fee => fee > 0)
        .sort((a, b) => a - b);

      if (fees.length === 0) {
        return DEFAULT_COMPUTE_UNIT_PRICE;
      }

      // Use 75th percentile for better confirmation probability
      const percentile75Index = Math.floor(fees.length * 0.75);
      const recommendedFee = Math.min(fees[percentile75Index] || DEFAULT_COMPUTE_UNIT_PRICE, MAX_COMPUTE_UNIT_PRICE);
      
      console.log(`Priority fee estimate: ${recommendedFee} micro lamports (from ${fees.length} samples)`);
      return Math.max(recommendedFee, DEFAULT_COMPUTE_UNIT_PRICE);
    } else {
      // Fallback for older versions - use network performance to estimate fees
      console.log('getRecentPrioritizationFees not available, using performance-based estimation');
      const performanceSamples = await connection.getRecentPerformanceSamples(5);
      
      if (performanceSamples.length === 0) {
        return DEFAULT_COMPUTE_UNIT_PRICE;
      }

      // Calculate average slot time and transactions per slot
      const avgSlotTime = performanceSamples.reduce((sum, sample) => 
        sum + sample.samplePeriodSecs, 0) / performanceSamples.length;
      
      const avgTxPerSlot = performanceSamples.reduce((sum, sample) => 
        sum + sample.numTransactions, 0) / performanceSamples.length;

      // Estimate congestion-based fee
      let estimatedFee = DEFAULT_COMPUTE_UNIT_PRICE;
      
      if (avgSlotTime > 0.5) { // Slow slots indicate congestion
        estimatedFee = Math.min(DEFAULT_COMPUTE_UNIT_PRICE * 3, MAX_COMPUTE_UNIT_PRICE);
      } else if (avgTxPerSlot > 2000) { // High transaction count
        estimatedFee = Math.min(DEFAULT_COMPUTE_UNIT_PRICE * 2, MAX_COMPUTE_UNIT_PRICE);
      }

      console.log(`Performance-based fee estimate: ${estimatedFee} micro lamports (avg slot time: ${avgSlotTime}s, avg tx/slot: ${avgTxPerSlot})`);
      return estimatedFee;
    }
  } catch (error) {
    console.warn('Failed to get priority fee estimate:', error);
    return DEFAULT_COMPUTE_UNIT_PRICE;
  }
}

// Helper function to check network congestion
async function getNetworkCongestion(connection: Connection): Promise<{
  level: 'low' | 'medium' | 'high';
  commitment: 'processed' | 'confirmed' | 'finalized';
  retryDelay: number;
}> {
  try {
    const performanceSamples = await connection.getRecentPerformanceSamples(5);
    
    if (performanceSamples.length === 0) {
      return { level: 'medium', commitment: 'confirmed', retryDelay: 2000 };
    }

    // Calculate average slot time and transactions per slot
    const avgSlotTime = performanceSamples.reduce((sum, sample) => 
      sum + sample.samplePeriodSecs, 0) / performanceSamples.length;
    
    const avgTxPerSlot = performanceSamples.reduce((sum, sample) => 
      sum + sample.numTransactions, 0) / performanceSamples.length;

    // Calculate transactions per second
    const avgTps = avgSlotTime > 0 ? avgTxPerSlot / avgSlotTime : 0;

    console.log(`Network stats - TPS: ${avgTps.toFixed(2)}, Avg slot time: ${avgSlotTime.toFixed(3)}s, Tx/slot: ${avgTxPerSlot.toFixed(0)}`);

    // Determine congestion level based on multiple factors
    let congestionScore = 0;
    
    // Factor 1: Transaction throughput
    if (avgTps > 3000) congestionScore += 2;
    else if (avgTps > 1500) congestionScore += 1;
    
    // Factor 2: Slot timing (normal slot time is ~400ms)
    if (avgSlotTime > 0.6) congestionScore += 2;
    else if (avgSlotTime > 0.5) congestionScore += 1;
    
    // Factor 3: Transactions per slot
    if (avgTxPerSlot > 2500) congestionScore += 2;
    else if (avgTxPerSlot > 1500) congestionScore += 1;

    // Determine final congestion level
    if (congestionScore >= 4) {
      return { level: 'high', commitment: 'processed', retryDelay: 5000 };
    } else if (congestionScore >= 2) {
      return { level: 'medium', commitment: 'confirmed', retryDelay: 2000 };
    } else {
      return { level: 'low', commitment: 'finalized', retryDelay: 1000 };
    }
  } catch (error) {
    console.warn('Failed to assess network congestion:', error);
    return { level: 'medium', commitment: 'confirmed', retryDelay: 2000 };
  }
}

// Helper function to estimate total transaction fee
function estimateTransactionFee(
  baseFee: number,
  priorityFee: number,
  computeUnits: number,
  numInstructions: number
): number {
  // Base fee (5000 lamports per signature)
  const signatureFee = baseFee;
  
  // Priority fee calculation
  const priorityFeeCost = (priorityFee * computeUnits) / 1_000_000; // Convert micro lamports to lamports
  
  return Math.ceil(signatureFee + priorityFeeCost);
}

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
      narration,
      priorityFee, // Optional: allow client to override priority fee
      computeUnits, // Optional: allow client to override compute units
      fastMode = false // Optional: prioritize speed over cost
    } = processedBody;

    // Convert amount and fee to number if they're strings
    const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    const parsedTransactionFee = typeof transactionFee === 'string' ? parseFloat(transactionFee) : transactionFee;
    const customPriorityFee = typeof priorityFee === 'string' ? parseFloat(priorityFee) : priorityFee;
    const customComputeUnits = typeof computeUnits === 'string' ? parseInt(computeUnits) : computeUnits;

    // Validation (keeping existing validations...)
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

    // Additional validations for fee parameters...
    if (customPriorityFee !== undefined && (customPriorityFee < 0 || customPriorityFee > MAX_COMPUTE_UNIT_PRICE)) {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error(`Priority fee must be between 0 and ${MAX_COMPUTE_UNIT_PRICE}`) }
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

    const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

    // Assess network conditions
    console.log('Assessing network conditions...');
    const [congestionInfo, estimatedPriorityFee] = await Promise.all([
      getNetworkCongestion(connection),
      customPriorityFee !== undefined ? Promise.resolve(customPriorityFee) : getPriorityFeeEstimate(connection)
    ]);

    console.log(`Network congestion: ${congestionInfo.level}, using commitment: ${congestionInfo.commitment}`);

    // Adjust priority fee based on fast mode
    const finalPriorityFee = fastMode ? 
      Math.min(estimatedPriorityFee * 2, MAX_COMPUTE_UNIT_PRICE) : 
      estimatedPriorityFee;

    const finalComputeUnits = customComputeUnits || COMPUTE_UNIT_LIMIT;

    // Get associated token addresses
    const senderAta = await getAssociatedTokenAddress(mint, sender);
    const receiverAta = await getAssociatedTokenAddress(mint, receiver);
    let feeReceiverAta: PublicKey | null = null;
    if (feeReceiver && parsedTransactionFee) {
      feeReceiverAta = await getAssociatedTokenAddress(mint, feeReceiver);
    }

    const instructions = [];

    // Add compute budget instructions for priority fees
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: finalComputeUnits,
      })
    );

    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: finalPriorityFee,
      })
    );

    // Check and create ATAs if needed
    const senderAccountInfo = await connection.getAccountInfo(senderAta);
    if (!senderAccountInfo) {
      console.log('Creating sender ATA');
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
      console.log('Creating receiver ATA');
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
        console.log('Creating fee receiver ATA');
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

    // Add transfer instructions
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

    // Add memo if provided
    if (narration && narration.trim() !== '') {
      instructions.push(
        new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(narration, 'utf8'),
        })
      );
    }

    // Build and sign transaction
    const transaction = new Transaction().add(...instructions);
    const { blockhash } = await connection.getLatestBlockhash(congestionInfo.commitment);
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

    // Estimate total transaction fee
    const baseFee = 5000; // lamports per signature
    const estimatedFee = estimateTransactionFee(baseFee, finalPriorityFee, finalComputeUnits, instructions.length);

    const successResponse = {
      result: "success" as const,
      message: {
        tx: serializedTx,
        signatures,
        priorityFee: finalPriorityFee,
        computeUnits: finalComputeUnits,
        estimatedFee: estimatedFee,
      },
    };

    console.log(`Transaction built successfully. Priority fee: ${finalPriorityFee}, Estimated total fee: ${estimatedFee} lamports`);

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