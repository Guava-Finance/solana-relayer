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
} from "@solana/web3.js";
import base58 from "bs58";
import type { NextApiRequest, NextApiResponse } from "next";
import { createEncryptionMiddleware } from "../../utils/encrytption";
import { validateSecurity, createSecurityErrorResponse, createEncryptedUnauthorizedResponse } from "../../utils/security";
import { createRateLimiter, RateLimitConfigs } from "../../utils/rateLimiter";
import { TransactionMonitor } from "../../utils/transactionMonitoring";
import { validateEmergencyBlacklist } from "../../utils/emergencyBlacklist";
import { createAdvancedSecurityMiddleware } from "../../utils/requestSigning";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// Priority fee configuration based on network congestion
const PRIORITY_FEE_CONFIG = {
  LOW_CONGESTION: 1000,      // 0.000001 SOL (1,000 microlamports)
  MEDIUM_CONGESTION: 10000,  // 0.00001 SOL (10,000 microlamports)
  HIGH_CONGESTION: 50000,    // 0.00005 SOL (50,000 microlamports)
  EXTREME_CONGESTION: 100000 // 0.0001 SOL (100,000 microlamports)
};

// Compute unit configuration
const COMPUTE_UNIT_CONFIG = {
  DEFAULT_UNITS: 200000,     // Default compute units
  TOKEN_TRANSFER_UNITS: 150000, // For simple token transfers
  COMPLEX_TX_UNITS: 400000,  // For transactions with multiple instructions
};

type NetworkCongestion = 'low' | 'medium' | 'high' | 'extreme';

type Data = {
  result: "success" | "error";
  message:
    | {
        tx: string;
        signatures: ({ key: string; signature: string | null } | null)[];
        priorityFee?: number;
        networkCongestion?: NetworkCongestion;
        estimatedTotalCost?: number;
      }
    | { error: Error };
};

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || 'default-key',
  process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
);

const rateLimiter = createRateLimiter(RateLimitConfigs.TRANSACTION);
const advancedSecurity = createAdvancedSecurityMiddleware();

/**
 * Detect network congestion based on recent block production and fee levels
 */
async function detectNetworkCongestion(connection: Connection): Promise<{
  level: NetworkCongestion;
  priorityFee: number;
  computeUnits: number;
}> {
  console.log(`[CONGESTION] Detecting network congestion...`);
  
  try {
    // Get recent performance samples to analyze network health
    const perfSamples = await connection.getRecentPerformanceSamples(5);
    
    if (perfSamples.length === 0) {
      console.log(`[CONGESTION] No performance samples available, using medium congestion settings`);
      return {
        level: 'medium',
        priorityFee: PRIORITY_FEE_CONFIG.MEDIUM_CONGESTION,
        computeUnits: COMPUTE_UNIT_CONFIG.DEFAULT_UNITS
      };
    }

    // Calculate average slot time and transaction count
    let totalSlots = 0;
    let totalTransactions = 0;
    let totalSamplePeriod = 0;

    for (const sample of perfSamples) {
      totalSlots += sample.numSlots;
      totalTransactions += sample.numTransactions;
      totalSamplePeriod += sample.samplePeriodSecs;
    }

    const avgSlotTime = totalSamplePeriod / totalSlots;
    const avgTxPerSlot = totalTransactions / totalSlots;
    
    console.log(`[CONGESTION] Average slot time: ${avgSlotTime.toFixed(3)}s`);
    console.log(`[CONGESTION] Average transactions per slot: ${avgTxPerSlot.toFixed(0)}`);

    // Additional check: Get recent prioritization fees from successful transactions
    let suggestedPriorityFee = PRIORITY_FEE_CONFIG.LOW_CONGESTION;
    
    try {
      const recentFees = await connection.getRecentPrioritizationFees({
        lockedWritableAccounts: [new PublicKey("11111111111111111111111111111111")] // System program
      });
      
      if (recentFees.length > 0) {
        // Calculate 75th percentile of recent fees for better success rate
        const fees = recentFees.map(f => f.prioritizationFee).sort((a, b) => a - b);
        const percentile75Index = Math.floor(fees.length * 0.75);
        suggestedPriorityFee = Math.max(fees[percentile75Index], PRIORITY_FEE_CONFIG.LOW_CONGESTION);
        
        console.log(`[CONGESTION] Recent priority fees (75th percentile): ${suggestedPriorityFee} microlamports`);
      }
    } catch (error) {
      console.log(`[CONGESTION] Could not fetch recent prioritization fees:`, error);
    }

    // Determine congestion level based on network metrics
    let congestionLevel: NetworkCongestion;
    let finalPriorityFee: number;
    let computeUnits: number;

    // Network congestion heuristics
    if (avgSlotTime > 0.8 || avgTxPerSlot > 3000) {
      // High congestion: slow slot times or high transaction volume
      congestionLevel = 'extreme';
      finalPriorityFee = Math.max(suggestedPriorityFee, PRIORITY_FEE_CONFIG.EXTREME_CONGESTION);
      computeUnits = COMPUTE_UNIT_CONFIG.COMPLEX_TX_UNITS;
    } else if (avgSlotTime > 0.6 || avgTxPerSlot > 2000) {
      congestionLevel = 'high';
      finalPriorityFee = Math.max(suggestedPriorityFee, PRIORITY_FEE_CONFIG.HIGH_CONGESTION);
      computeUnits = COMPUTE_UNIT_CONFIG.DEFAULT_UNITS;
    } else if (avgSlotTime > 0.5 || avgTxPerSlot > 1000) {
      congestionLevel = 'medium';
      finalPriorityFee = Math.max(suggestedPriorityFee, PRIORITY_FEE_CONFIG.MEDIUM_CONGESTION);
      computeUnits = COMPUTE_UNIT_CONFIG.DEFAULT_UNITS;
    } else {
      congestionLevel = 'low';
      finalPriorityFee = Math.max(suggestedPriorityFee, PRIORITY_FEE_CONFIG.LOW_CONGESTION);
      computeUnits = COMPUTE_UNIT_CONFIG.TOKEN_TRANSFER_UNITS;
    }

    console.log(`[CONGESTION] Network congestion level: ${congestionLevel}`);
    console.log(`[CONGESTION] Applied priority fee: ${finalPriorityFee} microlamports`);
    console.log(`[CONGESTION] Compute units: ${computeUnits}`);

    return {
      level: congestionLevel,
      priorityFee: finalPriorityFee,
      computeUnits: computeUnits
    };

  } catch (error) {
    console.log(`[CONGESTION] Error detecting network congestion:`, error);
    // Fallback to medium congestion settings
    return {
      level: 'medium',
      priorityFee: PRIORITY_FEE_CONFIG.MEDIUM_CONGESTION,
      computeUnits: COMPUTE_UNIT_CONFIG.DEFAULT_UNITS
    };
  }
}

/**
 * Calculate estimated total transaction cost including priority fees
 */
function calculateTransactionCost(priorityFee: number, computeUnits: number): number {
  // Base transaction fee (approximately 5000 lamports)
  const baseFee = 5000;
  
  // Priority fee calculation: (priorityFee in microlamports * computeUnits) / 1,000,000
  const priorityFeeCost = Math.ceil((priorityFee * computeUnits) / 1_000_000);
  
  return baseFee + priorityFeeCost;
}

async function txHandler(
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

    // Security validation
    const securityValidation = validateSecurity(req);
    if (!securityValidation.isValid) {
      console.log(`[API] /api/tx - Security validation failed: ${securityValidation.error}`);
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }

    // ✅ STEP 1: Decrypt the body FIRST
    let processedBody;
    try {
      processedBody = encryptionMiddleware.processRequest(req.body, req.headers);
      console.log(`[API] /api/tx - Decrypted request body:`, processedBody);
    } catch (error) {
      if (error instanceof Error && error.message === 'Encryption failed') {
        console.log(`[API] /api/tx - Decryption failed during request processing`);
        return res.status(400).json({
          result: "error",
          message: { error: new Error("Decryption failed") }
        });
      }
      throw error;
    }

    // ✅ STEP 2: Validate signature with DECRYPTED body
    const advancedSecurityValidation = await advancedSecurity.validateRequest(req, processedBody);
    if (!advancedSecurityValidation.valid) {
      console.log(`[API] /api/tx - Advanced security validation failed: ${advancedSecurityValidation.error}`);
      return res.status(401).json(createEncryptedUnauthorizedResponse());
    }

    const {
      senderAddress,
      receiverAddress,
      tokenMint,
      amount,
      transactionFee,
      transactionFeeAddress,
      narration
    } = processedBody;

    // Apply rate limiting based on sender address
    if (!(await rateLimiter.checkWithSender(req, res, senderAddress))) {
      return; // Rate limit exceeded, response already sent
    }

    // Convert amount and fee to number if they're strings
    const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    const parsedTransactionFee = typeof transactionFee === 'string' ? parseFloat(transactionFee) : transactionFee;

    // EMERGENCY BLACKLIST CHECK (works even when Redis is down)
    const emergencyCheck = validateEmergencyBlacklist(senderAddress, receiverAddress);
    if (emergencyCheck.blocked) {
      console.log(`[API] /api/tx - EMERGENCY BLACKLIST BLOCK:`, {
        address: emergencyCheck.address,
        reason: emergencyCheck.reason
      });
      
      return res.status(403).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { 
          error: new Error(`Address blocked: ${emergencyCheck.reason}`) 
        }
      }, req.headers));
    }

    // Transaction monitoring and blacklist check
    console.log(`[API] /api/tx - Analyzing transaction for suspicious patterns`);
    const transactionAnalysis = await TransactionMonitor.analyzeTransaction(
      senderAddress,
      receiverAddress,
      parsedAmount,
      tokenMint
    );

    if (!transactionAnalysis.allowed) {
      console.log(`[API] /api/tx - Transaction blocked by monitoring system:`, {
        riskScore: transactionAnalysis.riskScore,
        flags: transactionAnalysis.flags
      });
      
      // Auto-blacklist high-risk addresses or repeated offenders
      if (transactionAnalysis.riskScore >= 100) {
        console.log(`[API] /api/tx - Auto-blacklisting high-risk sender: ${senderAddress}`);
        await TransactionMonitor.blacklistAddress(
          senderAddress, 
          `Auto-blacklisted: Risk score ${transactionAnalysis.riskScore}, Flags: ${transactionAnalysis.flags.join(', ')}`
        );
      } else if (transactionAnalysis.riskScore >= 80) {
        // Check for repeated violations - greylist first, then blacklist
        console.log(`[API] /api/tx - High-risk sender detected, adding to greylist: ${senderAddress}`);
        await TransactionMonitor.greylistAddress(
          senderAddress,
          `Greylisted: Risk score ${transactionAnalysis.riskScore}, Flags: ${transactionAnalysis.flags.join(', ')}`
        );
      }
      
      return res.status(403).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { 
          error: new Error(`Transaction blocked: ${transactionAnalysis.flags.join(', ')}`) 
        }
      }, req.headers));
    }

    // Log transaction analysis for monitoring
    if (transactionAnalysis.riskScore > 50) {
      console.log(`[API] /api/tx - High-risk transaction allowed:`, {
        sender: senderAddress,
        receiver: receiverAddress,
        amount: parsedAmount,
        riskScore: transactionAnalysis.riskScore,
        flags: transactionAnalysis.flags
      });
    }

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
      console.log(`[API] /api/tx - Relayer wallet loaded: ${relayerWallet.publicKey.toBase58()}`);
    } catch {
      return res.status(500).json(encryptionMiddleware.processResponse({
        result: "error",
        message: { error: new Error("Invalid relayer wallet configuration") }
      }, req.headers));
    }

    // Use the correct RPC endpoint from environment or default to mainnet
    const rpcEndpoint = process.env.ALCHEMY || clusterApiUrl("mainnet-beta");
    console.log(`[API] /api/tx - Using RPC endpoint: ${rpcEndpoint}`);
    
    const connection = new Connection(rpcEndpoint, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000, // 60 seconds
    });

    // Detect network congestion and determine priority fee
    const congestionInfo = await detectNetworkCongestion(connection);
    
    // Calculate estimated transaction cost
    const estimatedTotalCost = calculateTransactionCost(
      congestionInfo.priorityFee, 
      congestionInfo.computeUnits
    );

    console.log(`[API] /api/tx - Estimated total transaction cost: ${estimatedTotalCost} lamports (${estimatedTotalCost / 1e9} SOL)`);

    // Get Associated Token Addresses
    const senderAta = await getAssociatedTokenAddress(mint, sender);
    const receiverAta = await getAssociatedTokenAddress(mint, receiver);
    let feeReceiverAta: PublicKey | null = null;
    if (feeReceiver && parsedTransactionFee) {
      feeReceiverAta = await getAssociatedTokenAddress(mint, feeReceiver);
    }

    const instructions: TransactionInstruction[] = [];

    // Add compute budget instructions for priority fees and compute units
    console.log(`[API] /api/tx - Adding compute budget instructions`);
    
    // Set compute unit limit
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: congestionInfo.computeUnits,
      })
    );

    // Set compute unit price (priority fee)
    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: congestionInfo.priorityFee,
      })
    );

    // ANTI-GRIEFING: Check and create ATAs if needed (with restrictions)
    console.log(`[API] /api/tx - Checking sender ATA: ${senderAta.toBase58()}`);
    const senderAccountInfo = await connection.getAccountInfo(senderAta);
    if (!senderAccountInfo) {
      console.log(`[API] /api/tx - SECURITY WARNING: Sender ATA does not exist. This could be a griefing attack.`);
      return res.status(400).json(
        encryptionMiddleware.processResponse({
          result: "error",
          message: { error: new Error("Sender ATA does not exist. Please create it first using the create-ata endpoint with proper authorization.") }
        }, req.headers)
      );
    }

    console.log(`[API] /api/tx - Checking receiver ATA: ${receiverAta.toBase58()}`);
    const receiverAccountInfo = await connection.getAccountInfo(receiverAta);
    if (!receiverAccountInfo) {
      console.log(`[API] /api/tx - Receiver ATA does not exist, adding creation instruction`);
      // Only create receiver ATA (this is expected for legitimate transfers)
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
      console.log(`[API] /api/tx - Checking fee receiver ATA: ${feeReceiverAta.toBase58()}`);
      const feeReceiverAccountInfo = await connection.getAccountInfo(feeReceiverAta);
      if (!feeReceiverAccountInfo) {
        console.log(`[API] /api/tx - Fee receiver ATA does not exist, adding creation instruction`);
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

    // Add main transfer instruction
    console.log(`[API] /api/tx - Adding main transfer instruction: ${parsedAmount} tokens`);
    instructions.push(
      createTransferInstruction(
        senderAta,
        receiverAta,
        sender,
        parsedAmount
      )
    );

    // Add fee transfer instruction if specified
    if (feeReceiverAta && feeReceiver && parsedTransactionFee) {
      console.log(`[API] /api/tx - Adding fee transfer instruction: ${parsedTransactionFee} tokens`);
      instructions.push(
        createTransferInstruction(
          senderAta,
          feeReceiverAta,
          sender,
          parsedTransactionFee
        )
      );
    }

    // Add memo instruction if specified
    if (narration && narration.trim() !== '') {
      console.log(`[API] /api/tx - Adding memo instruction: "${narration}"`);
      instructions.push(
        new TransactionInstruction({
          keys: [],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(narration, 'utf8'),
        })
      );
    }

    // Create and configure transaction
    const transaction = new Transaction().add(...instructions);
    
    console.log(`[API] /api/tx - Getting latest blockhash`);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = relayerWallet.publicKey;

    console.log(`[API] /api/tx - Transaction configured with ${instructions.length} instructions`);
    console.log(`[API] /api/tx - Fee payer: ${relayerWallet.publicKey.toBase58()}`);
    console.log(`[API] /api/tx - Recent blockhash: ${blockhash}`);
    console.log(`[API] /api/tx - Last valid block height: ${lastValidBlockHeight}`);

    // Partially sign with relayer wallet
    transaction.partialSign(relayerWallet);
    console.log(`[API] /api/tx - Transaction partially signed by relayer`);

    // Serialize transaction
    const serializedTx = base58.encode(
      Uint8Array.from(transaction.serialize({ requireAllSignatures: false }))
    );

    // Prepare signatures array
    const signatures = transaction.signatures.map((s) => ({
      key: s.publicKey.toBase58(),
      signature: s.signature ? base58.encode(Uint8Array.from(s.signature)) : null,
    }));

    const successResponse = {
      result: "success" as const,
      message: {
        tx: serializedTx,
        signatures,
        priorityFee: congestionInfo.priorityFee,
        networkCongestion: congestionInfo.level,
        estimatedTotalCost: estimatedTotalCost,
      },
    };

    console.log(`[API] /api/tx - Transaction created successfully`);
    console.log(`[API] /api/tx - Network congestion: ${congestionInfo.level}`);
    console.log(`[API] /api/tx - Priority fee: ${congestionInfo.priorityFee} microlamports`);
    console.log(`[API] /api/tx - Estimated cost: ${estimatedTotalCost} lamports`);

    return res.json(
      encryptionMiddleware.processResponse(successResponse, req.headers)
    );

  } catch (error) {
    console.error(`[API] /api/tx - Error:`, error);
    
    // Enhanced error handling for specific Solana errors
    if (error instanceof Error) {
      let errorMessage = error.message;
      
      if (error.message.includes('insufficient funds')) {
        errorMessage = "Relayer has insufficient funds to pay for transaction fees";
      } else if (error.message.includes('blockhash not found')) {
        errorMessage = "Transaction expired due to network congestion. Please retry.";
      } else if (error.message.includes('Invalid mint')) {
        errorMessage = "Invalid token mint address provided";
      } else if (error.message.includes('InvalidAccountData')) {
        errorMessage = "Invalid account data - token account may not exist";
      } else if (error.message.includes('TokenAccountNotFoundError')) {
        errorMessage = "Token account not found for the specified address";
      }
      
      return res.status(500).json(
        encryptionMiddleware.processResponse({
          result: "error",
          message: { error: new Error(errorMessage) }
        }, req.headers)
      );
    }

    return res.status(500).json(
      encryptionMiddleware.processResponse({
        result: "error",
        message: { error: error as Error }
      }, req.headers)
    );
  }
}

// Export handler without automatic rate limiting (we'll do it manually after processing)
export default txHandler;