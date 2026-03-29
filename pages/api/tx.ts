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
// import { validateSecurity, createSecurityErrorResponse, createEncryptedUnauthorizedResponse } from "../../utils/security";
// import { createRateLimiter, RateLimitConfigs } from "../../utils/rateLimiter";
// import { validateRedisBlacklist, addToRedisBlacklist } from "../../utils/redisBlacklist";
// import { createAdvancedSecurityMiddleware } from "../../utils/requestSigning";
// import { getCachedAtaFarmingAnalysis } from "../../utils/ataFarmingDetector";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC mint address

const JUPITER_PRICE_API = "https://lite-api.jup.ag/price/v2";
const SOL_MINT_ADDRESS = "So11111111111111111111111111111111111111112";
const ATA_RENT_LAMPORTS = 2039280; // rent-exempt minimum for a token account
const MIN_TRANSFER_AMOUNT = 1_000_000; // 1 USDC minimum net transfer to receiver (6 decimals)

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
    ataRentDeductedUsdc?: number;
    ataRentDeductedRaw?: number;
  }
  | { error: Error };
};

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || 'default-key',
  process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
);

// const rateLimiter = createRateLimiter(RateLimitConfigs.TRANSACTION);
// const advancedSecurity = createAdvancedSecurityMiddleware();

/**
 * Fetch current SOL/USDC price from Jupiter price API
 */
async function getSolPriceInUsdc(): Promise<number> {
  const response = await fetch(`${JUPITER_PRICE_API}?ids=${SOL_MINT_ADDRESS}`);
  if (!response.ok) throw new Error(`Jupiter price API error: HTTP ${response.status}`);
  const data = await response.json();
  const price = parseFloat(data?.data?.[SOL_MINT_ADDRESS]?.price);
  if (!price || isNaN(price) || price <= 0) throw new Error("Invalid SOL price returned from Jupiter");
  console.log(`[PRICE] SOL/USDC: $${price}`);
  return price;
}

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
  console.log(`[API] /api/tx - Request started`);

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ result: "error", message: { error: new Error("Method not allowed") } });
    }

    // ── Decrypt body ─────────────────────────────────────────────────────────
    let processedBody;
    try {
      processedBody = encryptionMiddleware.processRequest(req.body, req.headers);
    } catch (error) {
      if (error instanceof Error && error.message === 'Encryption failed') {
        return res.status(400).json({ result: "error", message: { error: new Error("Decryption failed") } });
      }
      throw error;
    }

    const { senderAddress, receiverAddress, tokenMint, amount, transactionFee, transactionFeeAddress, narration } = processedBody;

    // ── 1. Field validation (sync, zero I/O) ─────────────────────────────────
    if (!senderAddress || typeof senderAddress !== 'string')
      return res.status(400).json(encryptionMiddleware.processResponse({ result: "error", message: "Sender address is required and must be a string" }, req.headers));
    if (!receiverAddress || typeof receiverAddress !== 'string')
      return res.status(400).json(encryptionMiddleware.processResponse({ result: "error", message: "Receiver address is required and must be a string" }, req.headers));
    if (!tokenMint || typeof tokenMint !== 'string')
      return res.status(400).json(encryptionMiddleware.processResponse({ result: "error", message: "Token mint address is required and must be a string" }, req.headers));
    if (narration !== undefined && narration !== null && typeof narration !== 'string')
      return res.status(400).json(encryptionMiddleware.processResponse({ result: "error", message: "Narration must be a string" }, req.headers));

    const parsedAmount: number = typeof amount === 'string' ? parseFloat(amount) : amount;
    const parsedTransactionFee: number = typeof transactionFee === 'string' ? parseFloat(transactionFee) : (transactionFee ?? 0);

    if (!parsedAmount || typeof parsedAmount !== 'number' || parsedAmount <= 0)
      return res.status(400).json(encryptionMiddleware.processResponse({ result: "error", message: "Amount is required and must be a positive number" }, req.headers));
    if (parsedTransactionFee > 0 && (!transactionFeeAddress || typeof transactionFeeAddress !== 'string'))
      return res.status(400).json(encryptionMiddleware.processResponse({ result: "error", message: "Transaction fee address is required when transaction fee is provided" }, req.headers));

    // ── 2. Parse public keys (sync) ──────────────────────────────────────────
    let sender: PublicKey, receiver: PublicKey, mint: PublicKey, feeReceiver: PublicKey | undefined;
    try {
      sender = new PublicKey(senderAddress);
      receiver = new PublicKey(receiverAddress);
      mint = new PublicKey(tokenMint);
      if (transactionFeeAddress) feeReceiver = new PublicKey(transactionFeeAddress);
    } catch {
      return res.status(400).json(encryptionMiddleware.processResponse({ result: "error", message: "Invalid public key format" }, req.headers));
    }

    // ── 3. Load relayer wallet (sync) ────────────────────────────────────────
    if (!process.env.WALLET)
      return res.status(500).json(encryptionMiddleware.processResponse({ result: "error", message: "Something went wrong" }, req.headers));
    let relayerWallet: Keypair;
    try {
      relayerWallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
    } catch {
      return res.status(500).json(encryptionMiddleware.processResponse({ result: "error", message: "Invalid relayer wallet configuration" }, req.headers));
    }

    // ── 4. Connection ────────────────────────────────────────────────────────
    const rpcEndpoint = process.env.ALCHEMY || clusterApiUrl("mainnet-beta");
    const connection = new Connection(rpcEndpoint, { commitment: "confirmed", confirmTransactionInitialTimeout: 60000 });

    // ── 5. PHASE 1: Derive all ATAs in parallel (local crypto, no RPC) ───────
    const [senderAta, receiverAta, senderUsdcAta, relayerUsdcAta, feeReceiverAta] = await Promise.all([
      getAssociatedTokenAddress(mint, sender, true),
      getAssociatedTokenAddress(mint, receiver, true),
      getAssociatedTokenAddress(USDC_MINT, sender, true),
      getAssociatedTokenAddress(USDC_MINT, relayerWallet.publicKey, true),
      feeReceiver && parsedTransactionFee
        ? getAssociatedTokenAddress(mint, feeReceiver, true)
        : Promise.resolve(null as PublicKey | null),
    ]);

    // ── 6. PHASE 2: All RPC + external calls in one parallel batch ────────────
    // Collapses ~9 sequential round-trips (each ~80-120ms) into a single wait.
    // getLatestBlockhash and getSolPriceInUsdc are fetched speculatively here
    // so they are ready when needed — no sequential dependency.
    console.log(`[API] /api/tx - Firing parallel I/O batch (6× RPC + Jupiter + blockhash)`);
    const [
      mintInfoResult,
      senderAtaInfoResult,
      receiverAtaInfoResult,
      senderUsdcAccountResult,
      senderUsdcBalanceResult,
      congestionResult,
      blockhashResult,
      solPriceResult,
    ] = await Promise.allSettled([
      connection.getParsedAccountInfo(mint),
      connection.getAccountInfo(senderAta),
      connection.getAccountInfo(receiverAta),
      connection.getAccountInfo(senderUsdcAta),
      connection.getTokenAccountBalance(senderUsdcAta),
      detectNetworkCongestion(connection),
      connection.getLatestBlockhash('finalized'),
      getSolPriceInUsdc(),
    ]);

    // ── 7. Unpack results ─────────────────────────────────────────────────────

    // Token decimals (soft failure → default 6)
    let tokenDecimals = 6;
    if (mintInfoResult.status === 'fulfilled' && mintInfoResult.value?.value) {
      const data = mintInfoResult.value.value.data as { parsed?: { info?: { decimals?: number } } };
      tokenDecimals = data?.parsed?.info?.decimals ?? 6;
    }

    // Blockhash (hard requirement)
    if (blockhashResult.status === 'rejected') throw new Error(`Failed to fetch blockhash: ${blockhashResult.reason}`);
    const { blockhash, lastValidBlockHeight } = blockhashResult.value;

    // Congestion (detectNetworkCongestion already has an internal fallback)
    const congestionInfo = congestionResult.status === 'fulfilled'
      ? congestionResult.value
      : { level: 'medium' as NetworkCongestion, priorityFee: PRIORITY_FEE_CONFIG.MEDIUM_CONGESTION, computeUnits: COMPUTE_UNIT_CONFIG.DEFAULT_UNITS };

    // Sender ATA must exist
    if (senderAtaInfoResult.status === 'rejected' || !senderAtaInfoResult.value) {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: "Sender ATA does not exist. Please create it first using the create-ata endpoint with proper authorization."
      }, req.headers));
    }

    // Receiver ATA — resolved once, used everywhere (no redundant second check)
    const receiverNeedsAta = receiverAtaInfoResult.status === 'rejected' || !receiverAtaInfoResult.value;
    const ataCreationCount = receiverNeedsAta ? 1 : 0;
    const totalAtaCreationCost = ataCreationCount * ATA_RENT_LAMPORTS;

    // ATA rent in USDC raw units (from speculatively-fetched Jupiter price)
    let ataRentInUsdcRaw = 0;
    if (receiverNeedsAta) {
      if (solPriceResult.status === 'rejected') throw new Error(`Could not fetch SOL price: ${solPriceResult.reason}`);
      ataRentInUsdcRaw = Math.ceil((ATA_RENT_LAMPORTS / 1e9) * solPriceResult.value * 1e6);
      console.log(`[API] /api/tx - ATA rent: ${(ataRentInUsdcRaw / 1e6).toFixed(6)} USDC`);
    }

    // Amount conversions (token decimals now known from Phase 2)
    const amountInRawUnits = parsedAmount;
    const feeInRawUnits = parsedTransactionFee || 0;
    const amountInUiUnits = parsedAmount / Math.pow(10, tokenDecimals);
    const feeInUiUnits = parsedTransactionFee ? parsedTransactionFee / Math.pow(10, tokenDecimals) : 0;

    // ── 8. USDC balance + minimum-size check ──────────────────────────────────
    if (mint.equals(USDC_MINT)) {
      if (senderUsdcAccountResult.status === 'rejected' || !senderUsdcAccountResult.value) {
        return res.status(400).json(encryptionMiddleware.processResponse({
          result: "error",
          message: "Sender does not have a USDC account. Please create one first."
        }, req.headers));
      }
      if (senderUsdcBalanceResult.status === 'rejected') {
        return res.status(400).json(encryptionMiddleware.processResponse({
          result: "error",
          message: "Could not fetch sender USDC balance"
        }, req.headers));
      }

      const senderUsdcBalance = senderUsdcBalanceResult.value;
      console.log(`[API] /api/tx - Sender USDC: ${senderUsdcBalance.value.uiAmount} | rent deducted: ${(ataRentInUsdcRaw / 1e6).toFixed(6)}`);

      // Rent is deducted from transfer amount — sender only needs amount + fee, not amount + fee + rent
      const requiredAmount = amountInUiUnits + feeInUiUnits;
      if (senderUsdcBalance.value.uiAmount === null || senderUsdcBalance.value.uiAmount < requiredAmount) {
        return res.status(400).json(encryptionMiddleware.processResponse({
          result: "error",
          message: `Insufficient USDC balance. Required: ${requiredAmount} USDC, Available: ${senderUsdcBalance.value.uiAmount || 0} USDC`
        }, req.headers));
      }

      if (receiverNeedsAta) {
        const netTransferRaw = amountInRawUnits - ataRentInUsdcRaw;
        if (netTransferRaw < MIN_TRANSFER_AMOUNT) {
          return res.status(400).json(encryptionMiddleware.processResponse({
            result: "error",
            message: `Amount too small: after deducting ATA rent (${(ataRentInUsdcRaw / 1e6).toFixed(6)} USDC), receiver would get ${(netTransferRaw / 1e6).toFixed(6)} USDC, below the minimum of ${MIN_TRANSFER_AMOUNT / 1e6} USDC`
          }, req.headers));
        }
      }
    }

    const estimatedTotalCost = calculateTransactionCost(congestionInfo.priorityFee, congestionInfo.computeUnits);

    // ── 9. Build transaction ──────────────────────────────────────────────────
    const instructions: TransactionInstruction[] = [];

    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: congestionInfo.computeUnits }));
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: congestionInfo.priorityFee }));

    // ATA creation + atomic rent reimbursement (single tx — all-or-nothing)
    if (receiverNeedsAta) {
      instructions.push(
        createAssociatedTokenAccountInstruction(relayerWallet.publicKey, receiverAta, receiver, mint)
      );
      if (ataRentInUsdcRaw > 0) {
        // For USDC transfers senderAta === senderUsdcAta; for other tokens use senderUsdcAta explicitly
        const rentSourceAta = mint.equals(USDC_MINT) ? senderAta : senderUsdcAta;
        console.log(`[API] /api/tx - Bundling rent reimbursement: ${(ataRentInUsdcRaw / 1e6).toFixed(6)} USDC → relayer`);
        instructions.push(
          createTransferInstruction(rentSourceAta, relayerUsdcAta, sender, ataRentInUsdcRaw)
        );
      }
    }

    // Main transfer: receiver gets (amount − rent) for USDC+ATA case, full amount otherwise
    const netTransferAmount = receiverNeedsAta && mint.equals(USDC_MINT)
      ? amountInRawUnits - ataRentInUsdcRaw
      : amountInRawUnits;
    instructions.push(createTransferInstruction(senderAta, receiverAta, sender, netTransferAmount));

    // Fee transfer
    if (feeReceiverAta && feeReceiver && feeInRawUnits > 0) {
      instructions.push(createTransferInstruction(senderAta, feeReceiverAta, sender, feeInRawUnits));
    }

    // Memo
    if (narration && narration.trim() !== '') {
      instructions.push(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(narration, 'utf8') }));
    }

    // Assemble + sign (blockhash already in hand from Phase 2)
    const transaction = new Transaction().add(...instructions);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = relayerWallet.publicKey;

    console.log(`[API] /api/tx - ${instructions.length} instructions | blockhash: ${blockhash} | valid to: ${lastValidBlockHeight}`);

    transaction.partialSign(relayerWallet);

    const serializedTx = base58.encode(Uint8Array.from(transaction.serialize({ requireAllSignatures: false })));
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
        estimatedTotalCost,
        ataCreationCost: totalAtaCreationCost,
        ataCreationCount,
        ataRentDeductedUsdc: ataRentInUsdcRaw / 1e6,
        ataRentDeductedRaw: ataRentInUsdcRaw,
      },
    };

    console.log(`[API] /api/tx - OK | congestion: ${congestionInfo.level} | fee: ${congestionInfo.priorityFee} µL | cost: ${estimatedTotalCost} L`);
    return res.json(encryptionMiddleware.processResponse(successResponse, req.headers));

  } catch (error) {
    console.error(`[API] /api/tx - Error:`, error);

    if (error instanceof Error) {
      let errorMessage = error.message;
      if (error.message.includes('insufficient funds')) errorMessage = "Relayer has insufficient funds to pay for transaction fees";
      else if (error.message.includes('blockhash not found')) errorMessage = "Transaction expired due to network congestion. Please retry.";
      else if (error.message.includes('Invalid mint')) errorMessage = "Invalid token mint address provided";
      else if (error.message.includes('InvalidAccountData')) errorMessage = "Invalid account data - token account may not exist";
      else if (error.message.includes('TokenAccountNotFoundError')) errorMessage = "Token account not found for the specified address";

      return res.status(500).json(encryptionMiddleware.processResponse({ result: "error", message: errorMessage }, req.headers));
    }

    return res.status(500).json(encryptionMiddleware.processResponse({ result: "error", message: error as Error }, req.headers));
  }
}

// Export handler without automatic rate limiting (we'll do it manually after processing)
export default txHandler;