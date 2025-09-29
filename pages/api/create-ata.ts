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
import nacl from "tweetnacl";
import base58 from "bs58";
import type { NextApiRequest, NextApiResponse } from "next";
import { validateSecurity, createSecurityErrorResponse } from "../../utils/security";
import { createEncryptionMiddleware } from "../../utils/encrytption";
import { createRateLimiter, RateLimitConfigs } from "../../utils/rateLimiter";
import { TransactionMonitor } from "../../utils/transactionMonitoring";
import { validateEmergencyBlacklist } from "../../utils/emergencyBlacklist";
import { createAdvancedSecurityMiddleware } from "../../utils/requestSigning";

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

const encryptionMiddleware = createEncryptionMiddleware(
    process.env.AES_ENCRYPTION_KEY || 'default-key',
    process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
);

const rateLimiter = createRateLimiter(RateLimitConfigs.ACCOUNT_CREATION);
const advancedSecurity = createAdvancedSecurityMiddleware();

async function createAtaHandler(
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

        // Security validation
        const securityValidation = validateSecurity(req);
        if (!securityValidation.isValid) {
            console.log(`[API] /api/create-ata - Security validation failed: ${securityValidation.error}`);
            return res.status(401).json(createSecurityErrorResponse(securityValidation.error!));
        }

        // Advanced security validation (request signing)
        const advancedSecurityValidation = await advancedSecurity.validateRequest(req);
        if (!advancedSecurityValidation.valid) {
            console.log(`[API] /api/create-ata - Advanced security validation failed: ${advancedSecurityValidation.error}`);
            return res.status(401).json(createSecurityErrorResponse(advancedSecurityValidation.error!));
        }

        console.log(`[API] /api/create-ata - Request body:`, req.body);
        
        let processedBody;
        try {
            processedBody = encryptionMiddleware.processRequest(req.body, req.headers);
            console.log(`[API] /api/create-ata - Processed request body:`, processedBody);
        } catch (error) {
            if (error instanceof Error && error.message === 'Encryption failed') {
                console.log(`[API] /api/create-ata - Encryption failed during request processing`);
                return res.status(400).json({
                    result: "error",
                    message: { error: new Error("Encryption failed") }
                });
            }
            throw error;
        }
        
        const { ownerAddress, tokenMint, userSignature, message } = processedBody;

        // Apply rate limiting based on owner address (sender)
        if (!(await rateLimiter.checkWithSender(req, res, ownerAddress))) {
            return; // Rate limit exceeded, response already sent
        }

        // EMERGENCY BLACKLIST CHECK (works even when Redis is down)
        const emergencyCheck = validateEmergencyBlacklist(ownerAddress);
        if (emergencyCheck.blocked) {
            console.log(`[API] /api/create-ata - EMERGENCY BLACKLIST BLOCK:`, {
                address: emergencyCheck.address,
                reason: emergencyCheck.reason
            });
            
            return res.status(403).json(
                encryptionMiddleware.processResponse({
                    result: "error",
                    message: { 
                        error: new Error(`Address blocked: ${emergencyCheck.reason}`) 
                    }
                }, req.headers)
            );
        }

        // Check if owner address is blacklisted
        console.log(`[API] /api/create-ata - Checking blacklist for owner: ${ownerAddress}`);
        const blacklistCheck = await TransactionMonitor.analyzeTransaction(
            ownerAddress,
            ownerAddress, // For ATA creation, sender and receiver are the same
            0, // No amount for ATA creation
            tokenMint
        );

        if (!blacklistCheck.allowed) {
            console.log(`[API] /api/create-ata - ATA creation blocked for blacklisted address:`, {
                owner: ownerAddress,
                riskScore: blacklistCheck.riskScore,
                flags: blacklistCheck.flags
            });
            
            return res.status(403).json(
                encryptionMiddleware.processResponse({
                    result: "error",
                    message: { 
                        error: new Error(`ATA creation blocked: ${blacklistCheck.flags.join(', ')}`) 
                    }
                }, req.headers)
            );
        }

        console.log(`[API] /api/create-ata - Processing request for owner: ${ownerAddress}, mint: ${tokenMint}`);

        // ANTI-GRIEFING: Require user signature to prevent rent extraction attacks
        if (!userSignature || !message) {
            console.log(`[API] /api/create-ata - Missing user signature or message for owner: ${ownerAddress}`);
            return res.status(400).json(
                encryptionMiddleware.processResponse({
                    result: "error",
                    message: { error: new Error("User signature required to create ATA. This prevents rent extraction attacks.") }
                }, req.headers)
            );
        }

        // Verify the user signature
        try {
            const messageBytes = new TextEncoder().encode(message);
            const signatureBytes = base58.decode(userSignature);
            const ownerPublicKey = new PublicKey(ownerAddress);
            
            const isValidSignature = nacl.sign.detached.verify(
                messageBytes,
                signatureBytes,
                ownerPublicKey.toBytes()
            );
            
            if (!isValidSignature) {
                console.log(`[API] /api/create-ata - Invalid signature for owner: ${ownerAddress}`);
                return res.status(400).json(
                    encryptionMiddleware.processResponse({
                        result: "error",
                        message: { error: new Error("Invalid user signature. Cannot create ATA without valid authorization.") }
                    }, req.headers)
                );
            }
            
            // Verify the message contains the expected content to prevent replay attacks
            const expectedMessage = `Create ATA for ${ownerAddress} with mint ${tokenMint}`;
            if (message !== expectedMessage) {
                console.log(`[API] /api/create-ata - Invalid message content for owner: ${ownerAddress}`);
                return res.status(400).json(
                    encryptionMiddleware.processResponse({
                        result: "error",
                        message: { error: new Error("Invalid message content. Message must match expected format.") }
                    }, req.headers)
                );
            }
            
            console.log(`[API] /api/create-ata - Valid signature verified for owner: ${ownerAddress}`);
            
        } catch (error) {
            console.log(`[API] /api/create-ata - Signature verification failed for owner: ${ownerAddress}`, error);
            return res.status(400).json(
                encryptionMiddleware.processResponse({
                    result: "error",
                    message: { error: new Error("Signature verification failed. Cannot create ATA.") }
                }, req.headers)
            );
        }

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
            return res.json(
                encryptionMiddleware.processResponse({
                    result: "success",
                    message: {
                        ataAddress: ataAddress.toBase58(),
                        alreadyExists: true,
                    },
                }, req.headers)
            );
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

        res.json(
            encryptionMiddleware.processResponse({
                result: "success",
                message: {
                    ataAddress: ataAddress.toBase58(),
                    txHash: txHash,
                    alreadyExists: false,
                },
            }, req.headers)
        );

    } catch (error) {
        console.log(`[API] /api/create-ata - Error:`, error);

        // Handle specific Solana errors
        if (error instanceof Error) {
            // Check for common errors
            if (error.message.includes('0x0')) {
                return res.status(400).json(
                    encryptionMiddleware.processResponse({
                        result: "error",
                        message: { error: new Error("Account already exists") }
                    }, req.headers)
                );
            }

            if (error.message.includes('insufficient funds')) {
                return res.status(500).json(
                    encryptionMiddleware.processResponse({
                        result: "error",
                        message: { error: new Error("Relayer has insufficient funds") }
                    }, req.headers)
                );
            }

            if (error.message.includes('Invalid mint')) {
                return res.status(400).json(
                    encryptionMiddleware.processResponse({
                        result: "error",
                        message: { error: new Error("Invalid token mint address") }
                    }, req.headers)
                );
            }
        }

        res.status(500).json(
            encryptionMiddleware.processResponse({
                result: "error",
                message: { error: error as Error }
            }, req.headers)
        );
    }
}

// Export handler without automatic rate limiting (we'll do it manually after processing)
export default createAtaHandler;