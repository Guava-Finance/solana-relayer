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
import { validateRedisBlacklist, addToRedisBlacklist } from "../../utils/redisBlacklist";
import { createAdvancedSecurityMiddleware } from "../../utils/requestSigning";
// import { getCachedAtaFarmingAnalysis } from "../../utils/ataFarmingDetector";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// Priority fee configuration based on network congestion - Optimized for competitive speed
const PRIORITY_FEE_CONFIG = {
  LOW_CONGESTION: 5000,      // 0.000005 SOL (5,000 microlamports) - 5x increase
  MEDIUM_CONGESTION: 25000,  // 0.000025 SOL (25,000 microlamports) - 2.5x increase
  HIGH_CONGESTION: 75000,    // 0.000075 SOL (75,000 microlamports) - 1.5x increase
  EXTREME_CONGESTION: 150000 // 0.00015 SOL (150,000 microlamports) - 1.5x increase
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
    ataCreationCost?: number;
    ataCreationCount?: number;
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
        // Calculate 90th percentile of recent fees for competitive speed
        const fees = recentFees.map(f => f.prioritizationFee).sort((a, b) => a - b);
        const percentile90Index = Math.floor(fees.length * 0.9);
        const percentile95Index = Math.floor(fees.length * 0.95);
        
        // Use 95th percentile for aggressive speed, with 90th as minimum
        const aggressiveFee = fees[percentile95Index] || fees[percentile90Index];
        suggestedPriorityFee = Math.max(aggressiveFee, PRIORITY_FEE_CONFIG.LOW_CONGESTION);

        console.log(`[CONGESTION] Recent priority fees (95th percentile): ${suggestedPriorityFee} microlamports`);
        console.log(`[CONGESTION] Fee range: min=${Math.min(...fees)}, max=${Math.max(...fees)}, median=${fees[Math.floor(fees.length / 2)]}`);
      }
    } catch (error) {
      console.log(`[CONGESTION] Could not fetch recent prioritization fees:`, error);
    }

    // Determine congestion level based on network metrics
    let congestionLevel: NetworkCongestion;
    let finalPriorityFee: number;
    let computeUnits: number;

    // Network congestion heuristics - More aggressive thresholds for competitive speed
    if (avgSlotTime > 0.7 || avgTxPerSlot > 2500) {
      // Extreme congestion: slow slot times or high transaction volume
      congestionLevel = 'extreme';
      finalPriorityFee = Math.max(suggestedPriorityFee * 1.2, PRIORITY_FEE_CONFIG.EXTREME_CONGESTION); // 20% boost
      computeUnits = COMPUTE_UNIT_CONFIG.COMPLEX_TX_UNITS;
    } else if (avgSlotTime > 0.55 || avgTxPerSlot > 1800) {
      congestionLevel = 'high';
      finalPriorityFee = Math.max(suggestedPriorityFee * 1.1, PRIORITY_FEE_CONFIG.HIGH_CONGESTION); // 10% boost
      computeUnits = COMPUTE_UNIT_CONFIG.DEFAULT_UNITS;
    } else if (avgSlotTime > 0.45 || avgTxPerSlot > 800) {
      congestionLevel = 'medium';
      finalPriorityFee = Math.max(suggestedPriorityFee, PRIORITY_FEE_CONFIG.MEDIUM_CONGESTION);
      computeUnits = COMPUTE_UNIT_CONFIG.DEFAULT_UNITS;
    } else {
      congestionLevel = 'low';
      finalPriorityFee = Math.max(suggestedPriorityFee, PRIORITY_FEE_CONFIG.LOW_CONGESTION);
      computeUnits = COMPUTE_UNIT_CONFIG.TOKEN_TRANSFER_UNITS;
    }

    // Apply safety cap to prevent extremely high fees (max 0.001 SOL = 1,000,000 microlamports)
    const maxPriorityFee = 1000000; // 0.001 SOL cap
    finalPriorityFee = Math.min(finalPriorityFee, maxPriorityFee);

    console.log(`[CONGESTION] Network congestion level: ${congestionLevel}`);
    console.log(`[CONGESTION] Applied priority fee: ${finalPriorityFee} microlamports (${(finalPriorityFee / 1e9).toFixed(9)} SOL)`);
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

    // ========================================
    // STEP 1: Rate Limiting
    // ========================================
    if (!(await rateLimiter.checkWithSender(req, res, senderAddress))) {
      return; // Rate limit exceeded, response already sent
    }

    // Convert amount and fee to number if they're strings
    const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    const parsedTransactionFee = typeof transactionFee === 'string' ? parseFloat(transactionFee) : transactionFee;

    // ========================================
    // STEP 2: Redis Blacklist Check
    // ========================================
    const blacklistCheck = await validateRedisBlacklist(senderAddress, receiverAddress);
    if (blacklistCheck.blocked) {
      console.log(`[API] /api/tx - REDIS BLACKLIST BLOCK:`, {
        address: blacklistCheck.address,
        reason: blacklistCheck.reason
      });

      return res.status(403).json(encryptionMiddleware.processResponse({
        result: "error",
        message: (`${blacklistCheck.reason}`)
      }, req.headers));
    }

    // ========================================
    // STEP 3: Check if ATA needs to be created
    // ========================================
    console.log(`[API] /api/tx - Checking ATA requirements...`);

    // Convert addresses to PublicKey objects
    let sender: PublicKey;
    let receiver: PublicKey;
    let mint: PublicKey;
    let feeReceiver: PublicKey | undefined;

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
        message: ("Invalid public key format")
      }, req.headers));
    }

    // Use the correct RPC endpoint from environment or default to mainnet
    const rpcEndpoint = process.env.ALCHEMY || clusterApiUrl("mainnet-beta");
    console.log(`[API] /api/tx - Using RPC endpoint: ${rpcEndpoint}`);

    const connection = new Connection(rpcEndpoint, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000, // 60 seconds
    });

    // Get Associated Token Addresses
    const senderAta = await getAssociatedTokenAddress(mint, sender);
    const receiverAta = await getAssociatedTokenAddress(mint, receiver);
    let feeReceiverAta: PublicKey | null = null;
    if (feeReceiver && parsedTransactionFee) {
      feeReceiverAta = await getAssociatedTokenAddress(mint, feeReceiver);
    }

    // Track ATA creation costs to pass to sender
    let ataCreationCount = 0;
    let totalAtaCreationCost = 0;
    let receiverNeedsAta = false; // Track specifically if receiver needs ATA

    // Check if receiver needs ATA creation
    const receiverAccountInfo = await connection.getAccountInfo(receiverAta);
    if (!receiverAccountInfo) {
      ataCreationCount++;
      receiverNeedsAta = true; // Flag for farming detection
      console.log(`[API] /api/tx - Receiver ATA needs creation (relayer will pay)`);
    }

    if (feeReceiverAta && feeReceiver) {
      const feeReceiverAccountInfo = await connection.getAccountInfo(feeReceiverAta);
      if (!feeReceiverAccountInfo) {
        ataCreationCount++;
        console.log(`[API] /api/tx - Fee receiver ATA needs creation (relayer will pay)`);
      }
    }

    // ========================================
    // STEP 4: ATA Farming Detection (if receiver needs ATA) - COMMENTED OUT
    // ========================================
    // console.log(`[API] /api/tx - ATA Farming Detection: ${process.env.HELIUS_API_KEY ? 'ENABLED ✅' : 'DISABLED (no API key) ⚠️'}`);

    // // Only check if RECEIVER needs ATA creation (avoid unnecessary API calls)
    // if (receiverNeedsAta) {
    //   console.log(`[API] /api/tx - 🔍 Receiver ATA needs creation - Running farming detection...`);
    //   console.log(`[API] /api/tx - 🔍 Analyzing sender for ATA farming patterns...`);

    //   try {
    //     const farmingAnalysis = await getCachedAtaFarmingAnalysis(senderAddress);

    //     console.log(`[API] /api/tx - Analysis complete:`, {
    //       address: senderAddress.substring(0, 8) + '...',
    //       riskScore: farmingAnalysis.riskScore,
    //       isSuspicious: farmingAnalysis.isSuspicious,
    //       flags: farmingAnalysis.flags,
    //     });

    //     // STRICT BLOCKING: Reject any wallet with suspicious patterns
    //     if (farmingAnalysis.isSuspicious) {
    //       console.log(`[API] /api/tx - 🚨 BLOCKING TRANSACTION - ATA farming pattern detected:`, {
    //         address: senderAddress,
    //         riskScore: farmingAnalysis.riskScore,
    //         flags: farmingAnalysis.flags,
    //         details: farmingAnalysis.details,
    //       });

    //       // ATA farming detected - add to Redis blacklist and block transaction
    //       await addToRedisBlacklist(
    //         senderAddress,
    //         `ATA farming detected: Risk score ${farmingAnalysis.riskScore}, Flags: ${farmingAnalysis.flags.join(', ')}`
    //       );

    //       const errorMessage =
    //         `Transaction blocked: Wallet has been flagged for suspicious account creation patterns. ` +
    //         `Risk score: ${farmingAnalysis.riskScore}/100. ` +
    //         `Detected patterns: ${farmingAnalysis.flags.join(', ')}. ` +
    //         `If you believe this is an error, please contact support with your wallet address.`;

    //       return res.status(403).json(
    //         createSecurityErrorResponse(errorMessage)
    //       );
    //     }

    //     console.log(`[API] /api/tx - ✅ No ATA farming patterns detected - proceeding with transaction`);

    //   } catch (error) {
    //     // (Fail-open to avoid blocking legitimate users due to API issues)
    //     console.error(`[API] /api/tx - ⚠️ ATA farming analysis failed:`, error);
    //     console.log(`[API] /api/tx - Proceeding with transaction despite analysis failure`);
    //   }
    // } else {
    //   console.log(`[API] /api/tx - ✅ Receiver already has ATA - Skipping farming detection (optimization)`);
    // }

    // ========================================
    // STEP 5: Setup Relayer Wallet
    // ========================================
    if (!process.env.WALLET) {
      return res.status(500).json(encryptionMiddleware.processResponse({
        result: "error",
        message: "Something went wrong"
      }, req.headers));
    }

    let relayerWallet: Keypair;
    try {
      relayerWallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
      console.log(`[API] /api/tx - Relayer wallet loaded: ${relayerWallet.publicKey.toBase58()}`);
    } catch {
      return res.status(500).json(encryptionMiddleware.processResponse({
        result: "error",
        message: ("Invalid relayer wallet configuration")
      }, req.headers));
    }

    // ========================================
    // STEP 6: Validation
    // ========================================
    if (!senderAddress || typeof senderAddress !== 'string') {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: ("Sender address is required and must be a string")
      }, req.headers));
    }

    if (!receiverAddress || typeof receiverAddress !== 'string') {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: ("Receiver address is required and must be a string")
      }, req.headers));
    }

    if (!tokenMint || typeof tokenMint !== 'string') {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: ("Token mint address is required and must be a string")
      }, req.headers));
    }

    if (!parsedAmount || typeof parsedAmount !== 'number' || parsedAmount <= 0) {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: ("Amount is required and must be a positive number")
      }, req.headers));
    }

    if (parsedTransactionFee !== undefined && parsedTransactionFee !== null) {
      if (typeof parsedTransactionFee !== 'number' || parsedTransactionFee <= 0) {
        return res.status(400).json(encryptionMiddleware.processResponse({
          result: "error",
          message: ("Transaction fee must be a positive number")
        }, req.headers));
      }

      if (!transactionFeeAddress || typeof transactionFeeAddress !== 'string') {
        return res.status(400).json(encryptionMiddleware.processResponse({
          result: "error",
          message: ("Transaction fee address is required when transaction fee is provided")
        }, req.headers));
      }
    }

    if (narration !== undefined && narration !== null && typeof narration !== 'string') {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: ("Narration must be a string")
      }, req.headers));
    }

    // Variables already declared above

    // Detect network congestion and determine priority fee
    const congestionInfo = await detectNetworkCongestion(connection);

    // Calculate estimated transaction cost
    const estimatedTotalCost = calculateTransactionCost(
      congestionInfo.priorityFee,
      congestionInfo.computeUnits
    );

    console.log(`[API] /api/tx - Estimated total transaction cost: ${estimatedTotalCost} lamports (${estimatedTotalCost / 1e9} SOL)`);

    // ATA creation check and farming detection already completed above

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
          message: ("Sender ATA does not exist. Please create it first using the create-ata endpoint with proper authorization.")
        }, req.headers)
      );
    }

    console.log(`[API] /api/tx - Checking receiver ATA: ${receiverAta.toBase58()}`);
    const receiverAccountInfoCheck = await connection.getAccountInfo(receiverAta);
    if (!receiverAccountInfoCheck) {
      console.log(`[API] /api/tx - Receiver ATA does not exist, adding creation instruction`);

      // COMMENTED OUT: Sender pays for ATA creation
      // Relayer pays for ATA creation (original behavior)

      // const ataRent = await connection.getMinimumBalanceForRentExemption(165);
      // console.log(`[API] /api/tx - Adding SOL transfer for ATA creation: ${ataRent} lamports (${ataRent / 1e9} SOL)`);
      // instructions.push(
      //   SystemProgram.transfer({
      //     fromPubkey: sender,
      //     toPubkey: relayerWallet.publicKey,
      //     lamports: ataRent,
      //   })
      // );

      // Create receiver ATA (relayer pays)
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
      const feeReceiverAccountInfoCheck = await connection.getAccountInfo(feeReceiverAta);
      if (!feeReceiverAccountInfoCheck) {
        console.log(`[API] /api/tx - Fee receiver ATA does not exist, adding creation instruction`);

        // COMMENTED OUT: Sender pays for ATA creation
        // Relayer pays for ATA creation (original behavior)

        // const ataRent = await connection.getMinimumBalanceForRentExemption(165);
        // console.log(`[API] /api/tx - Adding SOL transfer for fee receiver ATA creation: ${ataRent} lamports (${ataRent / 1e9} SOL)`);
        // instructions.push(
        //   SystemProgram.transfer({
        //     fromPubkey: sender,
        //     toPubkey: relayerWallet.publicKey,
        //     lamports: ataRent,
        //   })
        // );

        // Create fee receiver ATA (relayer pays)
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
        ataCreationCost: totalAtaCreationCost,
        ataCreationCount: ataCreationCount,
      },
    };

    console.log(`[API] /api/tx - Transaction created successfully`);
    console.log(`[API] /api/tx - Network congestion: ${congestionInfo.level}`);
    console.log(`[API] /api/tx - Priority fee: ${congestionInfo.priorityFee} microlamports`);
    console.log(`[API] /api/tx - Estimated cost: ${estimatedTotalCost} lamports`);
    if (ataCreationCount > 0) {
      console.log(`[API] /api/tx - ATA creation cost (paid by sender): ${totalAtaCreationCost} lamports (${totalAtaCreationCost / 1e9} SOL)`);
      console.log(`[API] /api/tx - Number of ATAs to create: ${ataCreationCount}`);
    }

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
          message: (errorMessage)
        }, req.headers)
      );
    }

    return res.status(500).json(
      encryptionMiddleware.processResponse({
        result: "error",
        message: error as Error
      }, req.headers)
    );
  }
}

// Export handler without automatic rate limiting (we'll do it manually after processing)
export default txHandler;