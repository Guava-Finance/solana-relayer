// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import {
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
    clusterApiUrl,
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import base58 from "bs58";
import type { NextApiRequest, NextApiResponse } from "next";

type Data = {
    result: "success" | "error";
    message:
    | {
        ataAddress: string;
        txHash?: string;
        alreadyExists: boolean;
    }
    | { error: Error };
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<Data>
) {
    console.log(`[API] /api/create-ata - Request started - Method: ${req.method}`);

    try {
        // Only allow POST requests
        if (req.method !== 'POST') {
            console.log(`[API] /api/create-ata - Method not allowed: ${req.method}`);
            return res.status(405).json({
                result: "error",
                message: { error: new Error("Method not allowed") }
            });
        }

        console.log(`[API] /api/create-ata - Request body:`, req.body);
        const { ownerAddress, tokenMint } = req.body;

        // Validate required parameters
        if (!ownerAddress || typeof ownerAddress !== 'string') {
            return res.status(400).json({
                result: "error",
                message: { error: new Error("Owner address is required and must be a string") }
            });
        }

        if (!tokenMint || typeof tokenMint !== 'string') {
            return res.status(400).json({
                result: "error",
                message: { error: new Error("Token mint address is required and must be a string") }
            });
        }

        // Validate public key formats
        let owner: PublicKey;
        let mint: PublicKey;

        try {
            owner = new PublicKey(ownerAddress);
            mint = new PublicKey(tokenMint);
        } catch (error) {
            console.log(`[API] /api/create-ata - Invalid public key format:`, error);
            return res.status(400).json({
                result: "error",
                message: { error: new Error("Invalid public key format") }
            });
        }

        console.log(`[API] /api/create-ata - Loading relayer wallet`);
        if (!process.env.WALLET) {
            console.log(`[API] /api/create-ata - WALLET environment variable not found`);
            return res.status(500).json({
                result: "error",
                message: { error: new Error("Wallet environment variable not configured") }
            });
        }

        let relayerWallet: Keypair;
        try {
            relayerWallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
            console.log(`[API] /api/create-ata - Relayer wallet loaded: ${relayerWallet.publicKey.toBase58()}`);
        } catch (error) {
            console.log(`[API] /api/create-ata - Failed to load relayer wallet:`, error);
            return res.status(500).json({
                result: "error",
                message: { error: new Error("Invalid relayer wallet configuration") }
            });
        }

        console.log(`[API] /api/create-ata - Creating connection to devnet`);
        const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

        console.log(`[API] /api/create-ata - Calculating ATA address`);
        const ataAddress = await getAssociatedTokenAddress(mint, owner);
        console.log(`[API] /api/create-ata - ATA address: ${ataAddress.toBase58()}`);

        // Check if ATA already exists
        console.log(`[API] /api/create-ata - Checking if ATA already exists`);
        const accountInfo = await connection.getAccountInfo(ataAddress);

        if (accountInfo) {
            console.log(`[API] /api/create-ata - ATA already exists for owner: ${owner.toBase58()}`);
            return res.json({
                result: "success",
                message: {
                    ataAddress: ataAddress.toBase58(),
                    alreadyExists: true,
                },
            });
        }

        console.log(`[API] /api/create-ata - ATA does not exist, creating new account`);

        // Create the ATA creation instruction
        const createAtaInstruction = createAssociatedTokenAccountInstruction(
            relayerWallet.publicKey, // payer (relayer pays for creation)
            ataAddress,              // ata address
            owner,                   // owner of the ATA
            mint                     // token mint
        );

        // Create transaction
        const transaction = new Transaction().add(createAtaInstruction);

        // Get recent blockhash
        console.log(`[API] /api/create-ata - Getting recent blockhash`);
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;

        // Set relayer as fee payer
        transaction.feePayer = relayerWallet.publicKey;

        console.log(`[API] /api/create-ata - Fee payer set to relayer: ${relayerWallet.publicKey.toBase58()}`);

        // Sign transaction with relayer wallet
        transaction.sign(relayerWallet);
        console.log(`[API] /api/create-ata - Transaction signed by relayer`);

        // Send and confirm transaction - Method 1: Using imported function
        console.log(`[API] /api/create-ata - Sending transaction to network`);
        let txHash: string;
        
        try {
            // Try the standalone function first
            txHash = await sendAndConfirmTransaction(
                connection,
                transaction,
                [relayerWallet],
                {
                    commitment: 'confirmed',
                    preflightCommitment: 'confirmed',
                }
            );
        } catch (error) {
            console.log(`[API] /api/create-ata - Trying alternative method...`);
            
            // Method 2: Manual send and confirm
            const signature = await connection.sendTransaction(transaction, [relayerWallet], {
                preflightCommitment: 'confirmed',
            });
            
            // Wait for confirmation
            const confirmation = await connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
            }, 'confirmed');
            
            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${confirmation.value.err}`);
            }
            
            txHash = signature;
        }

        console.log(`[API] /api/create-ata - ATA created successfully!`);
        console.log(`[API] /api/create-ata - Transaction hash: ${txHash}`);
        console.log(`[API] /api/create-ata - ATA address: ${ataAddress.toBase58()}`);
        console.log(`[API] /api/create-ata - Owner: ${owner.toBase58()}`);
        console.log(`[API] /api/create-ata - Token mint: ${mint.toBase58()}`);

        res.json({
            result: "success",
            message: {
                ataAddress: ataAddress.toBase58(),
                txHash: txHash,
                alreadyExists: false,
            },
        });

    } catch (error) {
        console.log(`[API] /api/create-ata - Error:`, error);

        // Handle specific Solana errors
        if (error instanceof Error) {
            // Check for common errors
            if (error.message.includes('0x0')) {
                return res.status(400).json({
                    result: "error",
                    message: { error: new Error("Account already exists") }
                });
            }

            if (error.message.includes('insufficient funds')) {
                return res.status(500).json({
                    result: "error",
                    message: { error: new Error("Relayer has insufficient funds") }
                });
            }

            if (error.message.includes('Invalid mint')) {
                return res.status(400).json({
                    result: "error",
                    message: { error: new Error("Invalid token mint address") }
                });
            }
        }

        res.status(500).json({
            result: "error",
            message: { error: error as Error }
        });
    }
}