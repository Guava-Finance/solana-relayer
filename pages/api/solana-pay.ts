// Solana Pay Transaction Request API
// Spec: https://docs.solanapay.com/spec#specification-transaction-request
import type { NextApiRequest, NextApiResponse } from "next";
import { PublicKey } from "@solana/web3.js";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const GUAVA_LOGO_URL = "https://guava.finance/assets/logo.svg";
const GUAVA_ICON_URL = "https://guava.finance/assets/logo.svg"; // Can be a smaller icon if you have one

type SolanaPayResponse = {
  transaction: string;
  message?: string;
};

type SolanaPayError = {
  error: string;
  message?: string;
};

/**
 * Solana Pay Transaction Request Endpoint
 * 
 * This endpoint creates gasless USDC payment transactions following the Solana Pay spec.
 * It bridges Solana Pay wallets with the Guava relayer service.
 * 
 * Query Parameters (from Solana Pay spec):
 * - account: The customer's wallet address (required)
 * - recipient: The merchant's wallet address (required)
 * - amount: The payment amount in USDC (e.g., "1.5") (required)
 * - reference: Transaction reference for tracking (optional)
 * - label: Payment label/description (optional)
 * 
 * Returns:
 * - transaction: Base64 encoded partially-signed transaction
 * - message: Human-readable payment description
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SolanaPayResponse | SolanaPayError>
) {
  console.log(`[SOLANA-PAY] Request received - Method: ${req.method}`);
  console.log(`[SOLANA-PAY] Query params:`, req.query);

  // Only allow GET requests (per Solana Pay spec)
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed",
      message: "Only GET requests are supported for Solana Pay Transaction Requests",
    });
  }

  try {
    // Extract and validate query parameters
    const { account, recipient, amount, reference, label } = req.query;

    // Validate required parameters
    if (!account || typeof account !== "string") {
      return res.status(400).json({
        error: "Missing or invalid parameter",
        message: "The 'account' parameter is required and must be a valid Solana address",
      });
    }

    if (!recipient || typeof recipient !== "string") {
      return res.status(400).json({
        error: "Missing or invalid parameter",
        message: "The 'recipient' parameter is required and must be a valid Solana address",
      });
    }

    if (!amount || typeof amount !== "string") {
      return res.status(400).json({
        error: "Missing or invalid parameter",
        message: "The 'amount' parameter is required and must be a valid number",
      });
    }

    // Validate addresses
    let customerAddress: PublicKey;
    let merchantAddress: PublicKey;

    try {
      customerAddress = new PublicKey(account);
    } catch (error) {
      return res.status(400).json({
        error: "Invalid address",
        message: "The 'account' parameter is not a valid Solana address",
      });
    }

    try {
      merchantAddress = new PublicKey(recipient);
    } catch (error) {
      return res.status(400).json({
        error: "Invalid address",
        message: "The 'recipient' parameter is not a valid Solana address",
      });
    }

    // Parse and validate amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        error: "Invalid amount",
        message: "The 'amount' parameter must be a positive number",
      });
    }

    // Convert amount from USDC (6 decimals) to raw units (lamports equivalent for USDC)
    const amountInRawUnits = Math.floor(parsedAmount * 1_000_000); // USDC has 6 decimals

    console.log(`[SOLANA-PAY] Payment request:`);
    console.log(`[SOLANA-PAY] - Customer: ${account}`);
    console.log(`[SOLANA-PAY] - Merchant: ${recipient}`);
    console.log(`[SOLANA-PAY] - Amount: ${parsedAmount} USDC (${amountInRawUnits} raw units)`);
    console.log(`[SOLANA-PAY] - Label: ${label || "Guava Payment"}`);
    console.log(`[SOLANA-PAY] - Reference: ${reference || "N/A"}`);

    // Prepare payload for the relayer
    const relayerPayload = {
      senderAddress: account,
      receiverAddress: recipient,
      tokenMint: USDC_MINT,
      amount: amountInRawUnits.toString(),
      narration: label || "Powered by Guava",
    };

    console.log(`[SOLANA-PAY] Calling relayer with payload:`, relayerPayload);

    // Call the internal /api/tx endpoint
    // Note: In production, you might want to make this a direct function call
    // instead of an HTTP request to avoid the overhead
    const relayerUrl = process.env.RELAYER_URL || "https://relayer.guava.finance";
    const response = await fetch(`${relayerUrl}/api/tx`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(relayerPayload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`[SOLANA-PAY] Relayer error:`, errorData);
      
      return res.status(response.status).json({
        error: "Transaction creation failed",
        message: errorData.message || "Failed to create gasless transaction",
      });
    }

    const relayerData = await response.json();
    console.log(`[SOLANA-PAY] Relayer response received:`, {
      hasTransaction: !!relayerData.message?.tx,
      networkCongestion: relayerData.message?.networkCongestion,
      priorityFee: relayerData.message?.priorityFee,
    });

    // Extract the transaction from the relayer response
    const transaction = relayerData.message?.tx;

    if (!transaction) {
      console.error(`[SOLANA-PAY] No transaction in relayer response`);
      return res.status(500).json({
        error: "Transaction creation failed",
        message: "Relayer did not return a valid transaction",
      });
    }

    // Build human-readable message
    const merchantLabel = typeof label === "string" ? label : "Guava Payment";
    const paymentMessage = `${merchantLabel} - ${parsedAmount} USDC (Gasless)`;

    console.log(`[SOLANA-PAY] Transaction created successfully`);
    console.log(`[SOLANA-PAY] Message: ${paymentMessage}`);

    // Return Solana Pay response
    return res.status(200).json({
      transaction: transaction,
      message: paymentMessage,
    });

  } catch (error) {
    console.error(`[SOLANA-PAY] Error:`, error);

    if (error instanceof Error) {
      return res.status(500).json({
        error: "Internal server error",
        message: error.message,
      });
    }

    return res.status(500).json({
      error: "Internal server error",
      message: "An unexpected error occurred",
    });
  }
}

