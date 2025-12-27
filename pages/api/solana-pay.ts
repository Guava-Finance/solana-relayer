// Solana Pay Transaction Request API
// Spec: https://docs.solanapay.com/spec#specification-transaction-request
import type { NextApiRequest, NextApiResponse } from "next";
import { PublicKey } from "@solana/web3.js";
import base58 from "bs58";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const GUAVA_LOGO_URL = "https://res.cloudinary.com/oghenekparobor/image/upload/v1766849906/Group_14161_xuqla5.png";
const GUAVA_ICON_URL = "https://res.cloudinary.com/oghenekparobor/image/upload/v1766849906/Group_14161_xuqla5.png";

// GET response - returns label and icon
type SolanaPayGetResponse = {
  label: string;
  icon: string;
};

// POST response - returns transaction
type SolanaPayPostResponse = {
  transaction: string;
  message?: string;
};

type SolanaPayResponse = SolanaPayGetResponse | SolanaPayPostResponse;

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
// File: solana-relayer/pages/api/solana-pay.ts

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SolanaPayResponse | SolanaPayError>
) {
  console.log(`[SOLANA-PAY] Request received - Method: ${req.method}`);
  console.log(`[SOLANA-PAY] Query params:`, req.query);
  console.log(`[SOLANA-PAY] Body:`, req.body);

  // Handle GET request - return label and icon
  if (req.method === "GET") {
    const label = typeof req.query.label === "string" ? req.query.label : "Guava Payment";
    const icon = GUAVA_ICON_URL;

    return res.status(200).json({
      label,
      icon,
    });
  }

  // Handle POST request - create transaction
  if (req.method === "POST") {
    return handlePostRequest(req, res);
  }

  return res.status(405).json({
    error: "Method not allowed",
    message: "Only GET and POST requests are supported",
  });
}

async function handlePostRequest(
  req: NextApiRequest,
  res: NextApiResponse<SolanaPayResponse | SolanaPayError>
) {
  try {
    // Extract parameters
    // account comes from POST body (sent by wallet)
    // recipient, amount, label, reference come from query params (from QR code URL)
    const { account } = req.body;
    const { recipient, amount, reference, label } = req.query;

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

    // Convert amount from USDC (6 decimals) to raw units
    const amountInRawUnits = Math.floor(parsedAmount * 1_000_000);

    console.log(`[SOLANA-PAY] Payment request:`);
    console.log(`[SOLANA-PAY] - Customer: ${account} (from POST body)`);
    console.log(`[SOLANA-PAY] - Merchant: ${recipient} (from query params)`);
    console.log(`[SOLANA-PAY] - Amount: ${parsedAmount} USDC (${amountInRawUnits} raw units)`);
    console.log(`[SOLANA-PAY] - Label: ${label || "Guava Payment"}`);
    console.log(`[SOLANA-PAY] - Reference: ${reference || "N/A"}`);

    // Prepare payload for the relayer
    const relayerPayload = {
      senderAddress: account,
      receiverAddress: recipient,
      tokenMint: USDC_MINT,
      amount: amountInRawUnits.toString(),
      narration: typeof label === "string" ? label : "Powered by Guava",
    };

    console.log(`[SOLANA-PAY] Calling relayer with payload:`, relayerPayload);

    // Call the internal /api/tx endpoint
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

    // Extract the transaction from the relayer response (in base58 format)
    const transactionBase58 = relayerData.message?.tx;

    if (!transactionBase58) {
      console.error(`[SOLANA-PAY] No transaction in relayer response`);
      return res.status(500).json({
        error: "Transaction creation failed",
        message: "Relayer did not return a valid transaction",
      });
    }

    // Convert transaction from base58 (relayer format) to base64 (Solana Pay format)
    let transactionBase64: string;
    try {
      const transactionBytes = base58.decode(transactionBase58);
      transactionBase64 = Buffer.from(transactionBytes).toString('base64');
      console.log(`[SOLANA-PAY] Converted transaction from base58 to base64`);
      console.log(`[SOLANA-PAY] - Base58 length: ${transactionBase58.length} chars`);
      console.log(`[SOLANA-PAY] - Base64 length: ${transactionBase64.length} chars`);
    } catch (error) {
      console.error(`[SOLANA-PAY] Failed to convert transaction format:`, error);
      return res.status(500).json({
        error: "Transaction encoding failed",
        message: "Failed to convert transaction to base64 format",
      });
    }

    // Build human-readable message
    const merchantLabel = typeof label === "string" ? label : "Guava Payment";
    const paymentMessage = `${merchantLabel} - ${parsedAmount} USDC (Gasless)`;

    console.log(`[SOLANA-PAY] Transaction created successfully`);
    console.log(`[SOLANA-PAY] Message: ${paymentMessage}`);

    // Return Solana Pay response with base64-encoded transaction
    return res.status(200).json({
      transaction: transactionBase64,
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