// On-Ramp: Initiate Session
import type { NextApiRequest, NextApiResponse } from "next";
import { initiate } from "paj_ramp";
import { createEncryptionMiddleware } from "../../../utils/encrytption";
import { validateSecurity, createSecurityErrorResponse } from "../../../utils/security";
import { ensurePajRampInitialized } from "../../../utils/pajRamp";

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || "default-key",
  process.env.AES_ENCRYPTION_IV || "default-iv-16b!!"
);

type InitiateResponse = {
  result: "success" | "error";
  message: {
    email?: string;
    error?: string;
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<InitiateResponse>
) {
  console.log(`[ONRAMP-INITIATE] Request received - Method: ${req.method}`);

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
        `[ONRAMP-INITIATE] Security validation failed: ${securityValidation.error}`
      );
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }

    // Decrypt request body if encrypted
    let processedBody;
    try {
      processedBody = encryptionMiddleware.processRequest(req.body || {}, req.headers);
      console.log(`[ONRAMP-INITIATE] Processed request body:`, processedBody);
    } catch (error) {
      if (error instanceof Error && error.message === "Encryption failed") {
        return res.status(400).json({
          result: "error",
          message: { error: "Encryption failed" },
        });
      }
      throw error;
    }

    const { email } = processedBody;

    // Validate required parameters
    if (!email || typeof email !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Email is required and must be a string" },
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        result: "error",
        message: { error: "Invalid email format" },
      });
    }

    // Check if PAJ_BUSINESS_API_KEY is configured
    if (!process.env.PAJ_BUSINESS_API_KEY) {
      console.error(`[ONRAMP-INITIATE] PAJ_BUSINESS_API_KEY not configured`);
      return res.status(500).json({
        result: "error",
        message: { error: "PAJ business API key not configured" },
      });
    }

    // Ensure paj_ramp SDK is initialized
    ensurePajRampInitialized();

    console.log(`[ONRAMP-INITIATE] Initiating session for email: ${email}`);

    // Call paj_ramp initiate function
    const result = await initiate(email, process.env.PAJ_BUSINESS_API_KEY);

    console.log(`[ONRAMP-INITIATE] Session initiated successfully`);

    // Return encrypted response if encryption is enabled
    return res.status(200).json(
      encryptionMiddleware.processResponse(
        {
          result: "success",
          message: {
            email: result.email || email,
          },
        },
        req.headers
      )
    );
  } catch (error) {
    console.error(`[ONRAMP-INITIATE] Error:`, error);

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

