// On-Ramp: Verify Session
import type { NextApiRequest, NextApiResponse } from "next";
import { verify } from "paj_ramp";
import { createEncryptionMiddleware } from "../../../utils/encrytption";
import { validateSecurity, createSecurityErrorResponse } from "../../../utils/security";
import { ensurePajRampInitialized } from "../../../utils/pajRamp";

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || "default-key",
  process.env.AES_ENCRYPTION_IV || "default-iv-16b!!"
);

type VerifyResponse = {
  result: "success" | "error";
  message: {
    email?: string;
    isActive?: boolean;
    expiresAt?: string;
    token?: string;
    error?: string;
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerifyResponse>
) {
  console.log(`[ONRAMP-VERIFY] Request received - Method: ${req.method}`);

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
        `[ONRAMP-VERIFY] Security validation failed: ${securityValidation.error}`
      );
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }

    // Decrypt request body if encrypted
    let processedBody;
    try {
      processedBody = encryptionMiddleware.processRequest(req.body || {}, req.headers);
      console.log(`[ONRAMP-VERIFY] Processed request body:`, processedBody);
    } catch (error) {
      if (error instanceof Error && error.message === "Encryption failed") {
        return res.status(400).json({
          result: "error",
          message: { error: "Encryption failed" },
        });
      }
      throw error;
    }

    const { email, otp, deviceSignature } = processedBody;

    // Validate required parameters
    if (!email || typeof email !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Email is required and must be a string" },
      });
    }

    // if (!otp || typeof otp !== "string") {
    //   return res.status(400).json({
    //     result: "error",
    //     message: { error: "OTP is required and must be a string" },
    //   });
    // }

    // Validate deviceSignature is an object with required fields
    if (!deviceSignature || typeof deviceSignature !== "object" || Array.isArray(deviceSignature)) {
      return res.status(400).json({
        result: "error",
        message: { error: "Device signature is required and must be an object" },
      });
    }

    const deviceSig = deviceSignature as {
      uuid?: string;
      device?: string;
      os?: string;
      browser?: string;
      ip?: string;
    };

    if (!deviceSig.uuid || typeof deviceSig.uuid !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Device signature must include 'uuid' field" },
      });
    }

    if (!deviceSig.device || typeof deviceSig.device !== "string") {
      return res.status(400).json({
        result: "error",
        message: { error: "Device signature must include 'device' field" },
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
      console.error(`[ONRAMP-VERIFY] PAJ_BUSINESS_API_KEY not configured`);
      return res.status(500).json({
        result: "error",
        message: { error: "PAJ business API key not configured" },
      });
    }

    // Ensure paj_ramp SDK is initialized
    ensurePajRampInitialized();

    console.log(`[ONRAMP-VERIFY] Verifying session for email: ${email}`);

    // Prepare device signature object
    const deviceSignatureObj = {
      uuid: deviceSig.uuid,
      device: deviceSig.device,
      ...(deviceSig.os && { os: deviceSig.os }),
      ...(deviceSig.browser && { browser: deviceSig.browser }),
      ...(deviceSig.ip && { ip: deviceSig.ip }),
    };

    // Call paj_ramp verify function
    const result = await verify(email, otp.toString(), deviceSignatureObj, process.env.PAJ_BUSINESS_API_KEY);

    console.log(`[ONRAMP-VERIFY] Verify result:`, result);

    console.log(`[ONRAMP-VERIFY] Session verified successfully`);

    // Return encrypted response if encryption is enabled
    return res.status(200).json(
      encryptionMiddleware.processResponse(
        {
          result: "success",
          message: {
            email: result.recipient || email,
            isActive: result.isActive === "true" || result.isActive === "1",
            expiresAt: result.expiresAt,
            token: result.token,
          },
        },
        req.headers
      )
    );
  } catch (error) {
    console.error(`[ONRAMP-VERIFY] Error:`, error);

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

