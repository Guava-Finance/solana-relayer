/**
 * POST /api/turnkey/verify-wallet
 *
 * Checks whether a given Solana address is managed by this Turnkey organisation.
 * Used during the "Restore from Turnkey" flow so the app can confirm the wallet
 * exists in the enclave before loading the Guava account.
 *
 * Body:
 *   walletAddress  string   Solana base58 public key to look up
 *
 * Response:
 *   exists         boolean  true if the address is found in any wallet in the org
 *   walletId       string?  Turnkey walletId of the matching wallet (when exists)
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { TurnkeyClient } from "@turnkey/http";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";

type SuccessResponse = {
  exists: boolean;
  walletId?: string;
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

  const { walletAddress } = req.body ?? {};

  if (!walletAddress || typeof walletAddress !== "string") {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  try {
    const orgId = process.env.TURNKEY_ORGANIZATION_ID!;
    const client = buildClient();

    // Fetch all wallets in the organisation.
    const walletsResp = await client.getWallets({ organizationId: orgId });

    for (const wallet of walletsResp.wallets) {
      const accountsResp = await client.getWalletAccounts({
        organizationId: orgId,
        walletId: wallet.walletId,
      });

      const match = accountsResp.accounts.find(
        (account) => account.address === walletAddress
      );

      if (match) {
        return res.status(200).json({ exists: true, walletId: wallet.walletId });
      }
    }

    return res.status(200).json({ exists: false });
  } catch (err: unknown) {
    console.error("[turnkey/verify-wallet]", err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
