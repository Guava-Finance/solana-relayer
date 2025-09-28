/**
 * Helper utilities for generating signatures required by the anti-griefing system
 * 
 * This file provides examples for client-side implementation
 */

/**
 * Generate the message that needs to be signed for ATA creation
 * 
 * @param ownerAddress - The wallet address that will own the ATA
 * @param tokenMint - The token mint address for the ATA
 * @returns The message string that should be signed
 */
export function generateAtaCreationMessage(ownerAddress: string, tokenMint: string): string {
  return `Create ATA for ${ownerAddress} with mint ${tokenMint}`;
}

/**
 * Example client-side code for signing the ATA creation message
 * 
 * This is for reference - implement this in your frontend/client code
 */
export const CLIENT_SIDE_EXAMPLE = `
// Example client-side implementation (React/TypeScript)
import { useWallet } from '@solana/wallet-adapter-react';
import { generateAtaCreationMessage } from './signatureHelper';

async function createAtaWithSignature(ownerAddress: string, tokenMint: string) {
  const { signMessage } = useWallet();
  
  if (!signMessage) {
    throw new Error('Wallet does not support message signing');
  }
  
  // Generate the message to sign
  const message = generateAtaCreationMessage(ownerAddress, tokenMint);
  const messageBytes = new TextEncoder().encode(message);
  
  // Sign the message
  const signature = await signMessage(messageBytes);
  const signatureBase58 = base58.encode(signature);
  
  // Send to your API
  const response = await fetch('/api/create-ata', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'is_encrypted': 'yes',
      'X-App-ID': 'com.example.app'
    },
    body: JSON.stringify({
      ownerAddress,
      tokenMint,
      userSignature: signatureBase58,
      message: message
    })
  });
  
  return response.json();
}
`;

/**
 * Validation function to check if a message matches the expected format
 * This is used server-side to prevent replay attacks
 */
export function validateAtaCreationMessage(
  message: string, 
  expectedOwner: string, 
  expectedMint: string
): boolean {
  const expectedMessage = generateAtaCreationMessage(expectedOwner, expectedMint);
  return message === expectedMessage;
}

/**
 * Security notes for implementation:
 * 
 * 1. ALWAYS verify the signature matches the owner address
 * 2. ALWAYS verify the message content matches expected format
 * 3. Consider adding timestamp to prevent old signature reuse
 * 4. Rate limit signature verification attempts
 * 5. Log all signature verification attempts for monitoring
 */
