// On-Ramp: Get Rate by Amount
import type { NextApiRequest, NextApiResponse } from "next";
import { getRateByAmount } from "paj_ramp";
import { createEncryptionMiddleware } from "../../../../utils/encrytption";
import { validateSecurity, createSecurityErrorResponse } from "../../../../utils/security";
import { ensurePajRampInitialized } from "../../../../utils/pajRamp";

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || "default-key",
  process.env.AES_ENCRYPTION_IV || "default-iv-16b!!"
);

type RateByAmountResponse = {
  result: "success" | "error";
  message: {
    rate?: {
      baseCurrency?: string;
      targetCurrency?: string;
      rate?: number;
    };
    amounts?: {
      userTax?: number;
      merchantTax?: number;
      amountUSD?: number;
      userAmountFiat?: number;
    };
    error?: string;
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RateByAmountResponse>
) {
  console.log(`[ONRAMP-RATES-AMOUNT] Request received - Method: ${req.method}`);

  try {
    // Allow both GET and POST requests
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({
        result: "error",
        message: { error: "Method not allowed" },
      });
    }

    // Security validation
    const securityValidation = validateSecurity(req);
    if (!securityValidation.isValid) {
      console.log(
        `[ONRAMP-RATES-AMOUNT] Security validation failed: ${securityValidation.error}`
      );
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }

    // Decrypt request body if encrypted (for POST) or get from query (for GET)
    let processedBody;
    let amount: number | undefined;

    if (req.method === "POST") {
      try {
        processedBody = encryptionMiddleware.processRequest(req.body || {}, req.headers);
        console.log(`[ONRAMP-RATES-AMOUNT] Processed request body:`, processedBody);
        amount = processedBody.amount;
      } catch (error) {
        if (error instanceof Error && error.message === "Encryption failed") {
          return res.status(400).json({
            result: "error",
            message: { error: "Encryption failed" },
          });
        }
        throw error;
      }
    } else {
      // GET request - get amount from query params
      amount = req.query.amount
        ? parseFloat(req.query.amount as string)
        : undefined;
    }

    // Validate required parameters
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        result: "error",
        message: { error: "Amount is required and must be a positive number" },
      });
    }

    // Check if PAJ_BUSINESS_API_KEY is configured
    if (!process.env.PAJ_BUSINESS_API_KEY) {
      console.error(`[ONRAMP-RATES-AMOUNT] PAJ_BUSINESS_API_KEY not configured`);
      return res.status(500).json({
        result: "error",
        message: { error: "PAJ business API key not configured" },
      });
    }

    // Ensure paj_ramp SDK is initialized
    ensurePajRampInitialized();

    console.log(`[ONRAMP-RATES-AMOUNT] Fetching rate for amount: ${amount}`);

    // Call paj_ramp getRateByAmount function with amount
    const result = await getRateByAmount(amount);

    console.log(`[ONRAMP-RATES-AMOUNT] Rate fetched successfully`);

    // Return encrypted response if encryption is enabled
    return res.status(200).json(
      encryptionMiddleware.processResponse(
        {
          result: "success",
          message: {
            rate: result.rate,
            amounts: result.amounts,
          },
        },
        req.headers
      )
    );
  } catch (error) {
    console.error(`[ONRAMP-RATES-AMOUNT] Error:`, error);

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

