import type { NextApiRequest } from "next";
import { createEncryptionMiddleware } from "./encrytption";

export interface SecurityValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates security requirements for API requests
 * - Checks if encryption is enabled (is_encrypted header must be 'yes')
 * - Validates X-App-ID header matches expected value
 */
export function validateSecurity(req: NextApiRequest): SecurityValidationResult {
  const headers = req.headers;

  // Check encryption header
  const isEncrypted = headers['is_encrypted'] || headers['IS_ENCRYPTED'] || headers['Is-Encrypted'];

  if (!isEncrypted || (isEncrypted !== 'YES' && isEncrypted !== 'yes' && isEncrypted !== 'true')) {
    return {
      isValid: false,
      error: "Request must be encrypted."
    };
  }

  // Check X-App-ID header
  const appId = headers['x-app-id'] || headers['X-App-ID'] || headers['X-APP-ID'];
  const expectedAppId = 'com.example.app';

  if (!appId) {
    return {
      isValid: false,
      error: "Missing source."
    };
  }

  if (appId !== expectedAppId) {
    return {
      isValid: false,
      error: `Invalid source. Expected '${expectedAppId}', received '${appId}'.`
    };
  }

  return {
    isValid: true
  };
}

/**
 * Creates a standardized error response for security validation failures
 */
export function createSecurityErrorResponse(error: string) {
  const encryptionMiddleware = createEncryptionMiddleware(
    process.env.AES_ENCRYPTION_KEY || 'default-key',
    process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
  );

  // Create the error response object
  const errorResponse = {
    error: true,
    message: error
  };

  // Encrypt the response using the encryption service
  const encryptedResponse = encryptionMiddleware.getService().encryptData(errorResponse);

  return encryptedResponse;
}

/**
 * Creates an encrypted error response for request signing failures
 * Returns a generic "unauthorized access" message that is properly encrypted
 */
export function createEncryptedUnauthorizedResponse() {
  const encryptionMiddleware = createEncryptionMiddleware(
    process.env.AES_ENCRYPTION_KEY || 'default-key',
    process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
  );

  // Create the error response object
  const errorResponse = {
    error: true,
    message: 'unauthorized access'
  };

  // Encrypt the response using the encryption service
  const encryptedResponse = encryptionMiddleware.getService().encryptData(errorResponse);

  return encryptedResponse

}
