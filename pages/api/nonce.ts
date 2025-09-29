import { Keypair } from "@solana/web3.js";
import base58 from "bs58";
import { NextApiRequest, NextApiResponse } from "next";
import createDurableNonce from "../../utils/nonce";
import { validateSecurity, createSecurityErrorResponse } from "../../utils/security";
import { createEncryptionMiddleware } from "../../utils/encrytption";
import { createRateLimiter, RateLimitConfigs } from "../../utils/rateLimiter";
import { createAdvancedSecurityMiddleware } from "../../utils/requestSigning";
type Data = {
  result: "success" | "error";
  message:
    | {
        nonceAccount: string;
        nonceAccountAuth: string;
      }
    | { error: Error };
};

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || 'default-key',
  process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
);

const rateLimiter = createRateLimiter(RateLimitConfigs.NONCE_CREATION);
const advancedSecurity = createAdvancedSecurityMiddleware();

async function nonceHandler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  try {
    // Security validation
    const securityValidation = validateSecurity(req);
    if (!securityValidation.isValid) {
      console.log(`[API] /api/nonce - Security validation failed: ${securityValidation.error}`);
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }

    // Advanced security validation (request signing)
    const advancedSecurityValidation = await advancedSecurity.validateRequest(req);
    if (!advancedSecurityValidation.valid) {
      console.log(`[API] /api/nonce - Advanced security validation failed: ${advancedSecurityValidation.error}`);
      return res.status(401).json(createSecurityErrorResponse(advancedSecurityValidation.error!));
    }
    const wallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET!));
    const { nonceAccount, nonceAccountAuth } = await createDurableNonce(wallet);
    console.log({
      nonceAccount: nonceAccount.publicKey.toString(),
      nonceAccountAuth: JSON.stringify(nonceAccountAuth),
    });
    res.json(
      encryptionMiddleware.processResponse({
        result: "success",
        message: {
          nonceAccount: nonceAccount.publicKey.toString(),
          nonceAccountAuth: base58.encode(nonceAccountAuth.secretKey),
        },
      }, req.headers)
    );
  } catch (error) {
    res
      .status(500)
      .json(
        encryptionMiddleware.processResponse(
          { result: "error", message: { error: error as Error } },
          req.headers
        )
      );
  }
}

// Keep IP-based rate limiting for nonce endpoint (no sender address in request)
export default rateLimiter.apply(nonceHandler);
