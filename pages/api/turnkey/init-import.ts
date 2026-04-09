/**
 * POST /api/turnkey/init-import
 *
 * Initiates a Turnkey wallet import session using the admin ApiKeyStamper.
 * Returns the `importBundle` (enclave public key), `userId`, and `organizationId`
 * needed for the client to encrypt the mnemonic locally before calling
 * /api/turnkey/import-wallet.
 *
 * The mnemonic is NEVER sent to this endpoint — it stays on the device.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { TurnkeyClient, createActivityPoller } from "@turnkey/http";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";

type SuccessResponse = {
  importBundle: string;
  userId: string;
  organizationId: string;
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

  try {
    const orgId = process.env.TURNKEY_ORGANIZATION_ID!;
    const client = buildClient();

    // Resolve admin userId.
    const whoami = await client.getWhoami({ organizationId: orgId });
    const userId = whoami.userId;

    // Ask Turnkey's enclave to generate an import bundle (HPKE public key).
    // createActivityPoller polls until the activity reaches a terminal state
    // and returns the activity object directly.
    const poller = createActivityPoller({
      client,
      requestFn: client.initImportWallet,
    });

    const activity = await poller({
      type: "ACTIVITY_TYPE_INIT_IMPORT_WALLET",
      timestampMs: Date.now().toString(),
      organizationId: orgId,
      parameters: { userId },
    });

    const importBundle = activity.result.initImportWalletResult?.importBundle;

    if (!importBundle) {
      return res.status(500).json({ error: "Turnkey did not return an import bundle" });
    }

    return res.status(200).json({ importBundle, userId, organizationId: orgId });
  } catch (err: unknown) {
    console.error("[turnkey/init-import]", err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
