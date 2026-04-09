/**
 * POST /api/turnkey/import-wallet
 *
 * Completes the wallet import by submitting the client-encrypted bundle to Turnkey.
 * The bundle was created on the Flutter side using `encryptWalletToBundle` from
 * `turnkey_crypto` — the plaintext mnemonic never leaves the user's device.
 *
 * Body:
 *   encryptedBundle  string   HPKE-encrypted mnemonic bundle from the Flutter client
 *   userId           string   userId returned by /api/turnkey/init-import
 *   walletName       string   Human-readable wallet label (e.g. "Guava Wallet")
 *   derivationPath   string   BIP-32 path (e.g. "m/44'/501'/0'/0'")
 *
 * Response:
 *   walletAddress    string   Derived Solana address for the imported wallet
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { TurnkeyClient, createActivityPoller } from "@turnkey/http";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";

type SuccessResponse = {
  walletAddress: string;
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

  const { encryptedBundle, userId, walletName, derivationPath } = req.body ?? {};

  if (!encryptedBundle || !userId || !walletName || !derivationPath) {
    return res.status(400).json({
      error: "encryptedBundle, userId, walletName, and derivationPath are required",
    });
  }

  try {
    const orgId = process.env.TURNKEY_ORGANIZATION_ID!;
    const client = buildClient();

    const poller = createActivityPoller({
      client,
      requestFn: client.importWallet,
    });

    const activity = await poller({
      type: "ACTIVITY_TYPE_IMPORT_WALLET",
      timestampMs: Date.now().toString(),
      organizationId: orgId,
      parameters: {
        userId,
        walletName,
        encryptedBundle,
        accounts: [
          {
            curve: "CURVE_ED25519",
            pathFormat: "PATH_FORMAT_BIP32",
            path: derivationPath,
            addressFormat: "ADDRESS_FORMAT_SOLANA",
          },
        ],
      },
    });

    const walletId = activity.result.importWalletResult?.walletId;

    if (!walletId) {
      return res.status(500).json({ error: "Turnkey did not return a walletId after import" });
    }

    // Fetch wallet accounts to get the derived Solana address.
    const accountsResp = await client.getWalletAccounts({
      organizationId: orgId,
      walletId,
    });

    const address = accountsResp.accounts[0]?.address;
    if (!address) {
      return res.status(500).json({ error: "No Solana account found on imported wallet" });
    }

    return res.status(200).json({ walletAddress: address });
  } catch (err: unknown) {
    console.error("[turnkey/import-wallet]", err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
