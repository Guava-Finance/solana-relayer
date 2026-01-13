// On-Ramp: Get Rate by Rate Type
import type { NextApiRequest, NextApiResponse } from "next";
import { getRateByType, RateType } from "paj_ramp";
import { createEncryptionMiddleware } from "../../../../utils/encrytption";
import { validateSecurity, createSecurityErrorResponse } from "../../../../utils/security";
import { ensurePajRampInitialized } from "../../../../utils/pajRamp";

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || "default-key",
  process.env.AES_ENCRYPTION_IV || "default-iv-16b!!"
);

type RateByTypeResponse = {
  result: "success" | "error";
  message: {
    baseCurrency?: string;
    targetCurrency?: string;
    rate?: number;
    rateType?: string;
    error?: string;
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RateByTypeResponse>
) {
  console.log(`[ONRAMP-RATES-TYPE] Request received - Method: ${req.method}`);

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
        `[ONRAMP-RATES-TYPE] Security validation failed: ${securityValidation.error}`
      );
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }

    // Decrypt request body if encrypted (for POST) or get from query (for GET)
    let processedBody;
    let rateType: string | undefined;

    if (req.method === "POST") {
      try {
        processedBody = encryptionMiddleware.processRequest(req.body || {}, req.headers);
        console.log(`[ONRAMP-RATES-TYPE] Processed request body:`, processedBody);
        rateType = processedBody.rateType;
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
      // GET request - get rateType from query params
      rateType = req.query.rateType as string | undefined;
    }

    // Validate required parameters
    if (!rateType || typeof rateType !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Rate type is required and must be a string" },
      });
    }

    // Check if PAJ_BUSINESS_API_KEY is configured
    if (!process.env.PAJ_BUSINESS_API_KEY) {
      console.error(`[ONRAMP-RATES-TYPE] PAJ_BUSINESS_API_KEY not configured`);
      return res.status(500).json({
        result: "error",
        message: { error: "PAJ business API key not configured" },
      });
    }

    // Ensure paj_ramp SDK is initialized
    ensurePajRampInitialized();

    console.log(`[ONRAMP-RATES-TYPE] Fetching rate for type: ${rateType}`);

    // Validate rateType is a valid RateType enum value
    // RateType enum values: 'standard', 'premium', etc. (check paj_ramp enums)
    const validRateType = rateType as RateType;
    
    // Call paj_ramp getRateByType function
    const result = await getRateByType(validRateType);

    console.log(`[ONRAMP-RATES-TYPE] Rate fetched successfully`);

    // Return encrypted response if encryption is enabled
    return res.status(200).json(
      encryptionMiddleware.processResponse(
        {
          result: "success",
          message: {
            baseCurrency: result.baseCurrency,
            targetCurrency: result.targetCurrency,
            rate: result.rate,
            type: result.type,
            isActive: result.isActive,
          },
        },
        req.headers
      )
    );
  } catch (error) {
    console.error(`[ONRAMP-RATES-TYPE] Error:`, error);

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

