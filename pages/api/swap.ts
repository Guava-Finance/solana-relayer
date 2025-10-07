import type { NextApiRequest, NextApiResponse } from "next";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction
} from "@solana/spl-token";
import base58 from "bs58";

import { createEncryptionMiddleware } from "../../utils/encrytption";
import { validateSecurity, createSecurityErrorResponse, createEncryptedUnauthorizedResponse } from "../../utils/security";
import { createRateLimiter, RateLimitConfigs } from "../../utils/rateLimiter";
import { validateRedisBlacklist, addToRedisBlacklist } from "../../utils/redisBlacklist";
import { createAdvancedSecurityMiddleware } from "../../utils/requestSigning";
import { getCachedAtaFarmingAnalysis } from "../../utils/ataFarmingDetector";

type NetworkCongestion = 'low' | 'medium' | 'high' | 'extreme';

const PRIORITY_FEE_CONFIG = {
  LOW_CONGESTION: 5000,
  MEDIUM_CONGESTION: 25000,
  HIGH_CONGESTION: 75000,
  EXTREME_CONGESTION: 150000
};

const COMPUTE_UNIT_CONFIG = {
  DEFAULT_UNITS: 200000,
  TOKEN_TRANSFER_UNITS: 150000,
  COMPLEX_TX_UNITS: 400000,
};

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || "default-key",
  process.env.AES_ENCRYPTION_IV || "default-iv-16b!!"
);
const rateLimiter = createRateLimiter(RateLimitConfigs.TRANSACTION);
const advancedSecurity = createAdvancedSecurityMiddleware();

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

function truncateForLog(input: any, max: number = 2000): string {
  try {
    const str = typeof input === 'string' ? input : JSON.stringify(input);
    if (str.length > max) {
      return str.slice(0, max) + `... [truncated, total ${str.length} chars]`;
    }
    return str;
  } catch {
    return String(input);
  }
}

async function detectNetworkCongestion(connection: Connection): Promise<{
  level: NetworkCongestion;
  priorityFee: number;
  computeUnits: number;
}> {
  try {
    const perfSamples = await connection.getRecentPerformanceSamples(5);
    if (perfSamples.length === 0) {
      return {
        level: 'medium',
        priorityFee: PRIORITY_FEE_CONFIG.MEDIUM_CONGESTION,
        computeUnits: COMPUTE_UNIT_CONFIG.DEFAULT_UNITS
      };
    }

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

    let suggestedPriorityFee = PRIORITY_FEE_CONFIG.LOW_CONGESTION;

    try {
      const recentFees = await connection.getRecentPrioritizationFees({
        lockedWritableAccounts: [new PublicKey("11111111111111111111111111111111")]
      });
      if (recentFees.length > 0) {
        const fees = recentFees.map(f => f.prioritizationFee).sort((a, b) => a - b);
        const p90 = Math.floor(fees.length * 0.9);
        const p95 = Math.floor(fees.length * 0.95);
        const aggressive = fees[p95] || fees[p90];
        suggestedPriorityFee = Math.max(aggressive, PRIORITY_FEE_CONFIG.LOW_CONGESTION);
      }
    } catch { }

    let level: NetworkCongestion;
    let fee: number;
    let units: number;

    if (avgSlotTime > 0.7 || avgTxPerSlot > 2500) {
      level = 'extreme';
      fee = Math.max(suggestedPriorityFee * 1.2, PRIORITY_FEE_CONFIG.EXTREME_CONGESTION);
      units = COMPUTE_UNIT_CONFIG.COMPLEX_TX_UNITS;
    } else if (avgSlotTime > 0.55 || avgTxPerSlot > 1800) {
      level = 'high';
      fee = Math.max(suggestedPriorityFee * 1.1, PRIORITY_FEE_CONFIG.HIGH_CONGESTION);
      units = COMPUTE_UNIT_CONFIG.DEFAULT_UNITS;
    } else if (avgSlotTime > 0.45 || avgTxPerSlot > 800) {
      level = 'medium';
      fee = Math.max(suggestedPriorityFee, PRIORITY_FEE_CONFIG.MEDIUM_CONGESTION);
      units = COMPUTE_UNIT_CONFIG.DEFAULT_UNITS;
    } else {
      level = 'low';
      fee = Math.max(suggestedPriorityFee, PRIORITY_FEE_CONFIG.LOW_CONGESTION);
      units = COMPUTE_UNIT_CONFIG.TOKEN_TRANSFER_UNITS;
    }

    fee = Math.min(fee, 1_000_000);

    return { level, priorityFee: fee, computeUnits: units };
  } catch {
    return {
      level: 'medium',
      priorityFee: PRIORITY_FEE_CONFIG.MEDIUM_CONGESTION,
      computeUnits: COMPUTE_UNIT_CONFIG.DEFAULT_UNITS
    };
  }
}

type Data =
  | {
    result: "success";
    message: {
      tx: string;
      destinationTokenAccount: string;
      priorityFee: number;
      networkCongestion: NetworkCongestion;
    };
  }
  | {
    result: "error";
    message: string | { error: Error };
  };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        result: "error",
        message: "Method not allowed"
      });
    }

    console.log(`[SWAP] Request start - headers:`, req.headers);
    console.log(`[SWAP] Raw body (as received):`, truncateForLog(req.body));

    const securityValidation = validateSecurity(req);
    if (!securityValidation.isValid) {
      console.log(`[SWAP] Security validation failed:`, securityValidation.error);
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }

    let processedBody: any;
    try {
      processedBody = encryptionMiddleware.processRequest(req.body, req.headers);
      console.log(`[SWAP] Decrypted body:`, truncateForLog(processedBody));
    } catch (e) {
      console.log(`[SWAP] Decryption failed`);
      return res.status(400).json({
        result: "error",
        message: "Decryption failed"
      });
    }

    const advancedSecurityValidation = await advancedSecurity.validateRequest(req, processedBody);
    if (!advancedSecurityValidation.valid) {
      console.log(`[SWAP] Advanced security validation failed:`, advancedSecurityValidation.error);
      return res.status(401).json(createEncryptedUnauthorizedResponse());
    }

    const { senderAddress, inputMint, amount } = processedBody;

    if (!(await rateLimiter.checkWithSender(req, res, senderAddress))) {
      console.log(`[SWAP] Rate limiter blocked request for sender: ${senderAddress}`);
      return;
    }
    console.log(`[SWAP] Rate limiter passed for sender: ${senderAddress}`);

    if (!senderAddress || typeof senderAddress !== "string") {
      return res.status(400).json({
        result: "error",
        message: "senderAddress is required"
      });
    }
    if (!inputMint || typeof inputMint !== "string") {
      return res.status(400).json({
        result: "error",
        message: "inputMint is required"
      });
    }
    if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({
        result: "error",
        message: "amount must be a positive integer (without decimals)"
      });
    }

    const blacklist = await validateRedisBlacklist(senderAddress, senderAddress);
    if (blacklist.blocked) {
      console.log(`[SWAP] Redis blacklist block:`, blacklist);
      return res.status(403).json({
        result: "error",
        message: `${blacklist.reason}`
      });
    }
    console.log(`[SWAP] Redis blacklist passed`);

    if (!process.env.WALLET) {
      return res.status(500).json({
        result: "error",
        message: "Relayer wallet not configured"
      });
    }
    const relayerWallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
    console.log(`[SWAP] Relayer pubkey: ${relayerWallet.publicKey.toBase58()}`);

    const rpcEndpoint = process.env.ALCHEMY || clusterApiUrl("mainnet-beta");
    console.log(`[SWAP] Using RPC endpoint: ${rpcEndpoint}`);
    const connection = new Connection(rpcEndpoint, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000
    });

    const sender = new PublicKey(senderAddress);
    const inMint = new PublicKey(inputMint);

    // Ensure sender USDC ATA exists; if not, run farming detection then create it
    const senderUsdcAta = await getAssociatedTokenAddress(USDC_MINT, sender);
    const senderUsdcInfo = await connection.getAccountInfo(senderUsdcAta);
    console.log(`[SWAP] Sender USDC ATA: ${senderUsdcAta.toBase58()} exists=${!!senderUsdcInfo}`);

    if (!senderUsdcInfo) {
      try {
        const analysis = await getCachedAtaFarmingAnalysis(senderAddress);
        console.log(`[SWAP] ATA farming analysis:`, analysis);
        if (analysis.isSuspicious) {
          await addToRedisBlacklist(
            senderAddress,
            `ATA farming detected: Risk score ${analysis.riskScore}, Flags: ${analysis.flags.join(", ")}`
          );
          return res.status(403).json({
            result: "error",
            message: "Blocked due to suspicious ATA farming behavior."
          });
        }
      } catch { }

      const ix = createAssociatedTokenAccountInstruction(
        relayerWallet.publicKey,
        senderUsdcAta,
        sender,
        USDC_MINT
      );

      const { blockhash } = await connection.getLatestBlockhash("finalized");
      const tx = new (require("@solana/web3.js").Transaction)().add(ix);
      tx.recentBlockhash = blockhash;
      tx.feePayer = relayerWallet.publicKey;
      tx.partialSign(relayerWallet);
      const ataSig = await connection.sendRawTransaction(tx.serialize({ requireAllSignatures: true }), { skipPreflight: true });
      console.log(`[SWAP] Created USDC ATA for sender. Signature: ${ataSig}`);
    }

    const congestion = await detectNetworkCongestion(connection);
    console.log(`[SWAP] Congestion level=${congestion.level}, priorityFee=${congestion.priorityFee}, computeUnits=${congestion.computeUnits}`);

    // 1) Jupiter quote (ExactIn, outputMint = USDC)
    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inMint.toBase58()}&outputMint=${USDC_MINT.toBase58()}&amount=${Number(amount)}&swapMode=ExactIn`;
    console.log(`[SWAP] Quote URL: ${quoteUrl}`);
    const quoteResp = await fetch(quoteUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });
    if (!quoteResp.ok) {
      return res.status(500).json({
        result: "error",
        message: "Quote request failed"
      });
    }
    const quoteJson = await quoteResp.json();
    console.log(`[SWAP] Quote response:`, truncateForLog(quoteJson));

    // 2) Jupiter swap
    const bodyPayload = {
      userPublicKey: senderAddress,
      payer: relayerWallet.publicKey.toBase58(),
      trackingAccount: relayerWallet.publicKey.toBase58(),
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel: (congestion.level === 'low' ? 'medium' : congestion.level),
          maxLamports: congestion.priorityFee
        }
      },
      destinationTokenAccount: senderUsdcAta.toBase58(),
      dynamicComputeUnitLimit: true,
      skipUserAccountsRpcCalls: false,
      blockhashSlotsToExpiry: 10,
      quoteResponse: quoteJson
    } as any;
    console.log(`[SWAP] Swap request payload:`, truncateForLog(bodyPayload));

    const swapResp = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload)
    });

    if (!swapResp.ok) {
      const errText = await swapResp.text().catch(() => "");
      return res.status(500).json({
        result: "error",
        message: `Swap build failed${errText ? `: ${errText}` : ""}`
      });
    }
    const swapJson = await swapResp.json();
    console.log(`[SWAP] Swap response:`, truncateForLog({ ...swapJson, swapTransaction: swapJson?.swapTransaction ? `[base64 ${swapJson.swapTransaction.length} chars]` : null }));

    const swapTxB64 = swapJson?.swapTransaction;
    if (!swapTxB64 || typeof swapTxB64 !== "string") {
      return res.status(500).json({
        result: "error",
        message: "Invalid swapTransaction in response"
      });
    }

    const raw = Buffer.from(swapTxB64, "base64");
    let txBase58: string;
    try {
      const vtx = VersionedTransaction.deserialize(Uint8Array.from(raw));
      vtx.sign([relayerWallet]);
      txBase58 = base58.encode(vtx.serialize());
      console.log(`[SWAP] Transaction decoded as versioned and signed by relayer`);
    } catch {
      const { Transaction } = require("@solana/web3.js");
      const ltx = Transaction.from(raw);
      ltx.partialSign(relayerWallet);
      txBase58 = base58.encode(ltx.serialize({ requireAllSignatures: false }));
      console.log(`[SWAP] Transaction decoded as legacy and signed by relayer`);
    }

    const response = {
      result: "success" as const,
      message: {
        tx: txBase58,
        destinationTokenAccount: senderUsdcAta.toBase58(),
        priorityFee: congestion.priorityFee,
        networkCongestion: congestion.level
      }
    };
    console.log(`[SWAP] Success response:`, truncateForLog({ ...response, message: { ...response.message, tx: `[base58 ${response.message.tx.length} chars]` } }));

    return res.json(encryptionMiddleware.processResponse(response, req.headers));

  } catch (err: any) {
    console.error(`[SWAP] Error:`, err);
    let msg = typeof err?.message === "string" ? err.message : "Internal error";
    if (msg.includes("insufficient funds")) {
      msg = "Relayer has insufficient funds to pay for fees";
    } else if (msg.includes("blockhash not found")) {
      msg = "Transaction expired due to network congestion. Please retry.";
    }
    return res.status(500).json({
      result: "error",
      message: msg
    });
  }
}


