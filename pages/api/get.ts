// make a get api

import { Connection, NonceAccount, PublicKey } from "@solana/web3.js";
import { NextApiRequest, NextApiResponse } from "next";
import { validateSecurity, createSecurityErrorResponse } from "../../utils/security";
import { createEncryptionMiddleware } from "../../utils/encrytption";
import { createRateLimiter, RateLimitConfigs } from "../../utils/rateLimiter";

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || 'default-key',
  process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
);

const rateLimiter = createRateLimiter(RateLimitConfigs.READ_OPERATIONS);

async function getNonceAccount(
  req: NextApiRequest,
  res: NextApiResponse<any>
) {
  try {
    // Security validation
    const securityValidation = validateSecurity(req);
    if (!securityValidation.isValid) {
      console.log(`[API] /api/get - Security validation failed: ${securityValidation.error}`);
      return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
    }
    
    let processedBody;
    try {
      processedBody = encryptionMiddleware.processRequest(req.body, req.headers);
      console.log(`[API] /api/get - Processed request body:`, processedBody);
    } catch (error) {
      if (error instanceof Error && error.message === 'Encryption failed') {
        console.log(`[API] /api/get - Encryption failed during request processing`);
        return res.status(400).json({
          result: "error",
          message: { error: new Error("Encryption failed") }
        });
      }
      throw error;
    }
    
    const { address } = processedBody;

    // Apply rate limiting based on address (sender)
    if (!rateLimiter.checkWithSender(req, res, address)) {
      return; // Rate limit exceeded, response already sent
    }

    const con = new Connection(process.env.ALCHEMY!, { commitment: "recent" });
    const data = await con.getAccountInfo(new PublicKey(address), {
      commitment: "recent",
    });
    const nonce = NonceAccount.fromAccountData(data!.data);
    console.log(nonce.nonce);
    res.json(
      encryptionMiddleware.processResponse({
        result: "success",
        message: {
          nonceAccount: nonce.nonce,
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

// Export handler without automatic rate limiting (we'll do it manually after processing)
export default getNonceAccount;
