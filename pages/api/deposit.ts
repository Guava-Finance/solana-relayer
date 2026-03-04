import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  clusterApiUrl,
} from "@solana/web3.js";
import base58 from "bs58";
import type { NextApiRequest, NextApiResponse } from "next";
import { createEncryptionMiddleware } from "../../utils/encrytption";

interface InstructionKey {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface RawInstruction {
  keys: InstructionKey[];
  programId: string;
  data: string;
}

interface StepItem {
  status: string;
  data: {
    instructions: RawInstruction[];
  };
  check?: {
    endpoint: string;
    method: string;
  };
}

interface Step {
  id: string;
  action?: string;
  description?: string;
  kind?: string;
  items: StepItem[];
  requestId?: string;
  depositAddress?: string;
}

interface DepositRequest {
  steps: Step[];
}

interface DepositResponse {
  result: "success" | "error";
  message:
    | {
        tx: string;
        signatures: ({ key: string; signature: string | null } | null)[];
        priorityFee?: number;
        networkCongestion?: string;
        estimatedTotalCost?: number;
        ataCreationCost?: number;
        ataCreationCount?: number;
        ataCreationCostInUsdc?: number;
        senderPaysAtaCreation?: boolean;
      }
    | string;
}

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || 'default-key',
  process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
);

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

function buildTransactionInstruction(raw: RawInstruction): TransactionInstruction {
  const keys = raw.keys.map((k) => ({
    pubkey: new PublicKey(k.pubkey),
    isSigner: k.isSigner,
    isWritable: k.isWritable,
  }));

  return new TransactionInstruction({
    keys,
    programId: new PublicKey(raw.programId),
    data: Buffer.from(hexToBytes(raw.data)),
  });
}

async function depositHandler(
  req: NextApiRequest,
  res: NextApiResponse<DepositResponse>
) {
  console.log(`[API] /api/deposit - Request started - Method: ${req.method}`);

  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        result: "error",
        message: "Method not allowed",
      });
    }

    // The steps payload contains Solana instruction data (base58 pubkeys, hex data)
    // that must be preserved byte-for-byte. The recursive field-by-field decryption
    // in processRequest corrupts these values (e.g. parseDecryptedValue turns
    // the system program "111...1" into a JS number). So we use the raw body
    // directly and only encrypt the response.
    const body: DepositRequest = req.body;
    console.log(`[API] /api/deposit - Using raw request body (steps data must not be recursively decrypted)`);

    if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: "steps is required and must be a non-empty array",
      }, req.headers));
    }

    if (!process.env.WALLET) {
      return res.status(500).json(encryptionMiddleware.processResponse({
        result: "error",
        message: "Server wallet not configured",
      }, req.headers));
    }

    let relayerWallet: Keypair;
    try {
      relayerWallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
      console.log(
        `[API] /api/deposit - Relayer wallet loaded: ${relayerWallet.publicKey.toBase58()}`
      );
    } catch {
      return res.status(500).json(encryptionMiddleware.processResponse({
        result: "error",
        message: "Invalid relayer wallet configuration",
      }, req.headers));
    }

    const rpcEndpoint =
      process.env.ALCHEMY || clusterApiUrl("mainnet-beta");
    const connection = new Connection(rpcEndpoint, {
      commitment: "confirmed",
    });

    const instructions: TransactionInstruction[] = [];

    const priorityFee = 25_000;
    const computeUnits = 400_000;

    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })
    );
    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
    );

    for (const step of body.steps) {
      if (!step.items || !Array.isArray(step.items)) {
        continue;
      }

      for (const item of step.items) {
        if (
          !item.data ||
          !item.data.instructions ||
          !Array.isArray(item.data.instructions)
        ) {
          continue;
        }

        for (const rawIx of item.data.instructions) {
          if (!rawIx.keys || !rawIx.programId || !rawIx.data) {
            return res.status(400).json(encryptionMiddleware.processResponse({
              result: "error",
              message:
                "Each instruction must have keys, programId, and data fields",
            }, req.headers));
          }

          const ix = buildTransactionInstruction(rawIx);

          // Replace any key that matches the relayer pubkey to ensure it is recognized as fee payer signer
          ix.keys = ix.keys.map((k) => {
            if (k.pubkey.equals(relayerWallet.publicKey)) {
              return { ...k, isSigner: true };
            }
            return k;
          });

          instructions.push(ix);
        }
      }
    }

    if (instructions.length <= 2) {
      return res.status(400).json(encryptionMiddleware.processResponse({
        result: "error",
        message: "No valid instructions found in the provided steps",
      }, req.headers));
    }

    const transaction = new Transaction().add(...instructions);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("finalized");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = relayerWallet.publicKey;

    console.log(
      `[API] /api/deposit - Transaction configured with ${instructions.length} instructions`
    );
    console.log(
      `[API] /api/deposit - Fee payer: ${relayerWallet.publicKey.toBase58()}`
    );
    console.log(`[API] /api/deposit - Blockhash: ${blockhash}`);
    console.log(
      `[API] /api/deposit - Last valid block height: ${lastValidBlockHeight}`
    );

    transaction.partialSign(relayerWallet);
    console.log(
      `[API] /api/deposit - Transaction partially signed by relayer`
    );

    const serializedTx = base58.encode(
      Uint8Array.from(
        transaction.serialize({ requireAllSignatures: false })
      )
    );

    const signatures = transaction.signatures.map((s) => ({
      key: s.publicKey.toBase58(),
      signature: s.signature
        ? base58.encode(Uint8Array.from(s.signature))
        : null,
    }));

    const baseFee = 5000;
    const priorityFeeCost = Math.ceil((priorityFee * computeUnits) / 1_000_000);
    const estimatedTotalCost = baseFee + priorityFeeCost;

    console.log(`[API] /api/deposit - Transaction created successfully`);
    console.log(`[API] /api/deposit - Priority fee: ${priorityFee} microlamports`);
    console.log(`[API] /api/deposit - Estimated cost: ${estimatedTotalCost} lamports`);

    return res.json(encryptionMiddleware.processResponse({
      result: "success",
      message: {
        tx: serializedTx,
        signatures,
        priorityFee,
        networkCongestion: "medium",
        estimatedTotalCost,
        ataCreationCost: 0,
        ataCreationCount: 0,
        ataCreationCostInUsdc: 0,
        senderPaysAtaCreation: false,
      },
    }, req.headers));
  } catch (error) {
    console.error(`[API] /api/deposit - Error:`, error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return res.status(500).json(encryptionMiddleware.processResponse({
      result: "error",
      message: errorMessage,
    }, req.headers));
  }
}

export default depositHandler;
