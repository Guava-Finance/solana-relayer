// On-Ramp: Create Onramp Order
import type { NextApiRequest, NextApiResponse } from "next";
import { createOnrampOrder } from "paj_ramp";
import { createEncryptionMiddleware } from "../../../utils/encrytption";
import { validateSecurity, createSecurityErrorResponse } from "../../../utils/security";
import { ensurePajRampInitialized } from "../../../utils/pajRamp";

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || "default-key",
  process.env.AES_ENCRYPTION_IV || "default-iv-16b!!"
);

type CreateOrderResponse = {
  result: "success" | "error";
  message: {
    orderId?: string;
    status?: string;
    [key: string]: any;
    error?: string;
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CreateOrderResponse>
) {
  console.log(`[ONRAMP-ORDER] Request received - Method: ${req.method}`);

  try {
    // Only allow POST requests
    if (req.method !== "POST") {
      return res.status(405).json({
        result: "error",
        message: { error: "Method not allowed" },
      });
    }

    // Security validation
    const securityValidation = validateSecurity(req);
    if (!securityValidation.isValid) {
      console.log(
        `[ONRAMP-ORDER] Security validation failed: ${securityValidation.error}`
      );
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }

    // Decrypt request body if encrypted
    let processedBody;
    try {
      processedBody = encryptionMiddleware.processRequest(req.body || {}, req.headers);
      console.log(`[ONRAMP-ORDER] Processed request body:`, processedBody);
    } catch (error) {
      if (error instanceof Error && error.message === "Encryption failed") {
        return res.status(400).json({
          result: "error",
          message: { error: "Encryption failed" },
        });
      }
      throw error;
    }

    // Extract order parameters
    // createOnrampOrder requires: amount, fiatAmount, currency, recipient, mint, chain, webhookURL, and sessionToken
    const {
      amount,
      fiatAmount,
      currency,
      recipient,
      mint,
      chain,
      webhookURL,
      sessionToken,
    } = processedBody;

    // Validate required parameters
    if (!currency || typeof currency !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Currency is required and must be a string" },
      });
    }

    if (!recipient || typeof recipient !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Recipient wallet address is required and must be a string" },
      });
    }

    if (!mint || typeof mint !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Token mint address is required and must be a string" },
      });
    }

    if (!chain || typeof chain !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Chain is required and must be a string" },
      });
    }

    if (!webhookURL || typeof webhookURL !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Webhook URL is required and must be a string" },
      });
    }

    if (!sessionToken || typeof sessionToken !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Session token is required. Please verify your session first." },
      });
    }

    // Validate amount or fiatAmount is provided
    if (!amount && !fiatAmount) {
      return res.status(400).json({
        result: "error",
        message: { error: "Either amount or fiatAmount is required" },
      });
    }

    // Check if PAJ_BUSINESS_API_KEY is configured
    if (!process.env.PAJ_BUSINESS_API_KEY) {
      console.error(`[ONRAMP-ORDER] PAJ_BUSINESS_API_KEY not configured`);
      return res.status(500).json({
        result: "error",
        message: { error: "PAJ business API key not configured" },
      });
    }

    // Ensure paj_ramp SDK is initialized
    ensurePajRampInitialized();

    console.log(`[ONRAMP-ORDER] Creating order for recipient: ${recipient}`);

    // Prepare order data according to CreateOnrampOrder interface
    const orderData = {
      currency,
      recipient,
      mint,
      chain,
      webhookURL,
      ...(amount && { amount: typeof amount === "string" ? parseFloat(amount) : amount }),
      ...(fiatAmount && { fiatAmount: typeof fiatAmount === "string" ? parseFloat(fiatAmount) : fiatAmount }),
    };

    // Call paj_ramp createOnrampOrder function with order data and session token
    const result = await createOnrampOrder(orderData, sessionToken);

    console.log(`[ONRAMP-ORDER] Order created successfully`);

    // Return encrypted response if encryption is enabled
    return res.status(200).json(
      encryptionMiddleware.processResponse(
        {
          result: "success",
          message: {
            id: result.id,
            accountNumber: result.accountNumber,
            accountName: result.accountName,
            amount: result.amount,
            fiatAmount: result.fiatAmount,
            bank: result.bank,
            rate: result.rate,
            recipient: result.recipient,
            currency: result.currency,
            mint: result.mint,
            fee: result.fee,
          },
        },
        req.headers
      )
    );
  } catch (error) {
    console.error(`[ONRAMP-ORDER] Error:`, error);

    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";

    return res.status(500).json(
      encryptionMiddleware.processResponse(
        {
          result: "error",
          message: { error: errorMessage },
        },
        req.headers
      )
    );
  }
}

