// On-Ramp: Get All Rates
import type { NextApiRequest, NextApiResponse } from "next";
import { getAllRate } from "paj_ramp";
import { createEncryptionMiddleware } from "../../../utils/encrytption";
import { validateSecurity, createSecurityErrorResponse } from "../../../utils/security";
import { ensurePajRampInitialized } from "../../../utils/pajRamp";

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || "default-key",
  process.env.AES_ENCRYPTION_IV || "default-iv-16b!!"
);

type RatesResponse = {
  result: "success" | "error";
  message: {
    baseCurrency?: string;
    targetCurrency?: string;
    rate?: number;
    error?: string;
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RatesResponse>
) {
  console.log(`[ONRAMP-RATES] Request received - Method: ${req.method}`);

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
        `[ONRAMP-RATES] Security validation failed: ${securityValidation.error}`
      );
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }

    // Check if PAJ_BUSINESS_API_KEY is configured
    if (!process.env.PAJ_BUSINESS_API_KEY) {
      console.error(`[ONRAMP-RATES] PAJ_BUSINESS_API_KEY not configured`);
      return res.status(500).json({
        result: "error",
        message: { error: "PAJ business API key not configured" },
      });
    }

    // Ensure paj_ramp SDK is initialized
    ensurePajRampInitialized();

    console.log(`[ONRAMP-RATES] Fetching all rates`);

    // Call paj_ramp getAllRate function to get all rates
    const result = await getAllRate();

    console.log(`[ONRAMP-RATES] Rates fetched successfully`);

    // Return encrypted response if encryption is enabled
    return res.status(200).json(
      encryptionMiddleware.processResponse(
        {
          result: "success",
          message: {
            onRampRate: result.onRampRate,
            offRampRate: result.offRampRate,
          },
        },
        req.headers
      )
    );
  } catch (error) {
    console.error(`[ONRAMP-RATES] Error:`, error);

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

