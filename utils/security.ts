import type { NextApiRequest } from "next";

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
  return {
    result: "error" as const,
    message: { error: new Error(error) }
  };
}
