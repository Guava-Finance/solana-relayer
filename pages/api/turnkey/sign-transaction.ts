/**
 * POST /api/turnkey/sign-transaction
 *
 * Signs a Solana transaction via Turnkey using the admin ApiKeyStamper.
 * Only wallets that live in the parent organisation (imported via
 * /api/turnkey/import-wallet) are eligible for server-side signing.
 *
 * Body:
 *   signWith          string   Solana public key (wallet address) to sign with
 *   unsignedTx        string   Unsigned transaction encoded as a hex string
 *                              (required by Turnkey's Solana signTransaction API)
 *
 * Response:
 *   signedTx          string   Signed transaction hex string returned by Turnkey
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { TurnkeyClient, createActivityPoller } from "@turnkey/http";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";

type SuccessResponse = {
  signedTx: string;
};

type ErrorResponse = {
  error: string;
};

function buildClient(): TurnkeyClient {
  const stamper = new ApiKeyStamper({
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
  });
  return new TurnkeyClient(
    { baseUrl: process.env.TURNKEY_API_BASE_URL! },
    stamper
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { signWith, unsignedTx } = req.body ?? {};

  if (!signWith || !unsignedTx) {
    return res.status(400).json({ error: "signWith and unsignedTx are required" });
  }

  try {
    const orgId = process.env.TURNKEY_ORGANIZATION_ID!;
    const client = buildClient();

    const poller = createActivityPoller({
      client,
      requestFn: client.signTransaction,
    });

    const activity = await poller({
      type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
      timestampMs: Date.now().toString(),
      organizationId: orgId,
      parameters: {
        signWith,
        unsignedTransaction: unsignedTx,
        type: "TRANSACTION_TYPE_SOLANA",
      },
    });

    const signedTx = activity.result.signTransactionResult?.signedTransaction;

    if (!signedTx) {
      return res.status(500).json({ error: "Turnkey did not return a signed transaction" });
    }

    return res.status(200).json({ signedTx });
  } catch (err: unknown) {
    console.error("[turnkey/sign-transaction]", err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
