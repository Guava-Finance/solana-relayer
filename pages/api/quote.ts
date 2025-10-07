import type { NextApiRequest, NextApiResponse } from "next";
import { PublicKey } from "@solana/web3.js";
import { createEncryptionMiddleware } from "../../utils/encrytption";

// Fixed USDC mint address
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || "default-key",
  process.env.AES_ENCRYPTION_IV || "default-iv-16b!!"
);

interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: any;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot: number;
  timeTaken: number;
  swapUsdValue: string;
  simplerRouteUsed: boolean;
  mostReliableAmmsQuoteReport: any;
  useIncurredSlippageForQuoting: any;
  otherRoutePlans: any;
  loadedLongtailToken: boolean;
  instructionVersion: any;
}

interface QuoteResponse {
  outAmount: string;
  outAmountWithDecimals: string;
  priceImpactPct: string;
  swapUsdValue: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<QuoteResponse | { error: string }>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const decryptedBody = encryptionMiddleware.processRequest(req.body || {}, req.headers);
    const { inputMint, amount } = decryptedBody || {};
    console.log("[quote] incoming request (decrypted)", { inputMint, amount });

    // Validate required parameters
    if (!inputMint || !amount) {
      return res.status(400).json({ 
        error: "Missing required parameters: inputMint and amount are required" 
      });
    }

    // Validate inputMint is a valid PublicKey
    try {
      new PublicKey(inputMint as string);
    } catch (error) {
      console.warn("[quote] invalid inputMint", { inputMint });
      return res.status(400).json({ 
        error: "Invalid inputMint: must be a valid Solana public key" 
      });
    }

    // Validate amount is a positive number
    const amountNum = parseInt(amount as string);
    if (isNaN(amountNum) || amountNum <= 0) {
      console.warn("[quote] invalid amount", { amount });
      return res.status(400).json({ 
        error: "Invalid amount: must be a positive integer" 
      });
    }
    console.log("[quote] validated params", { inputMint, amount: amountNum });

    // Build Jupiter API URL
    const jupiterUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
    jupiterUrl.searchParams.set("inputMint", inputMint as string);
    jupiterUrl.searchParams.set("outputMint", USDC_MINT);
    jupiterUrl.searchParams.set("amount", amount as string);
    jupiterUrl.searchParams.set("swapMode", "ExactIn");
    jupiterUrl.searchParams.set("slippageBps", "50"); // 0.5% slippage

    console.log(`[quote] fetching Jupiter URL: ${jupiterUrl.toString()}`);

    // Fetch quote from Jupiter API
    const response = await fetch(jupiterUrl.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Guava-Finance/1.0"
      }
    });

    console.log("[quote] Jupiter response status", response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[quote] Jupiter API error: ${response.status} - ${errorText}`);
      return res.status(500).json({ 
        error: `Failed to fetch quote from Jupiter API: ${response.status}` 
      });
    }

    const quoteData: JupiterQuoteResponse = await response.json();

    // Validate response structure
    if (!quoteData.outAmount) {
      console.error("[quote] invalid Jupiter response: missing outAmount", quoteData);
      return res.status(500).json({ 
        error: "Invalid response from Jupiter API" 
      });
    }
    console.log("[quote] Jupiter outAmount (raw)", quoteData.outAmount);

    // Convert outAmount from base units to decimal (USDC has 6 decimals)
    const USDC_DECIMALS = 6;
    const outAmountBigInt = BigInt(quoteData.outAmount);
    const divisor = BigInt(10 ** USDC_DECIMALS);
    
    const wholePart = outAmountBigInt / divisor;
    const fractionalPart = outAmountBigInt % divisor;
    
    // Format with proper decimal places
    const outAmountWithDecimals = fractionalPart === BigInt(0) 
      ? wholePart.toString()
      : `${wholePart}.${fractionalPart.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')}`;

    const responseData: QuoteResponse = {
      outAmount: quoteData.outAmount,
      outAmountWithDecimals: outAmountWithDecimals,
      priceImpactPct: quoteData.priceImpactPct,
      swapUsdValue: quoteData.swapUsdValue
    };

    console.log(`[quote] success: ${amount} ${inputMint} -> ${outAmountWithDecimals} USDC`);

    const encrypted = encryptionMiddleware.processResponse(responseData, req.headers);
    return res.status(200).json(encrypted);

  } catch (error) {
    console.error("Quote endpoint error:", error);
    return res.status(500).json({ 
      error: "Internal server error while fetching quote" 
    });
  }
}
