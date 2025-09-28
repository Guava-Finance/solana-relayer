import crypto from 'crypto';
import { createClient } from 'redis';

// Use existing Redis connection
const redis = createClient({
  url: process.env.REDIS_URL
});

/**
 * Advanced Request Security with Nonce and Timestamp Validation
 */
export class RequestSecurityManager {
  private static readonly NONCE_EXPIRY = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_TIMESTAMP_SKEW = 2 * 60 * 1000; // 2 minutes

  /**
   * Generate a secure nonce for request
   */
  static generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Validate request timestamp to prevent replay attacks
   */
  static validateTimestamp(timestamp: number): boolean {
    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    
    if (timeDiff > this.MAX_TIMESTAMP_SKEW) {
      console.log(`[Security] Request timestamp too old/future: ${timeDiff}ms skew`);
      return false;
    }
    
    return true;
  }

  /**
   * Validate and consume nonce (prevents replay attacks)
   */
  static async validateAndConsumeNonce(nonce: string, clientId: string): Promise<boolean> {
    try {
      const key = `nonce:${clientId}:${nonce}`;
      
      // Check if nonce already used
      const exists = await redis.exists(key);
      if (exists) {
        console.log(`[Security] Nonce replay attack detected: ${nonce}`);
        return false;
      }
      
      // Mark nonce as used
      await redis.setex(key, Math.ceil(this.NONCE_EXPIRY / 1000), 'used');
      return true;
      
    } catch (error) {
      console.error('[Security] Nonce validation error:', error);
      return false;
    }
  }

  /**
   * Generate request signature for client
   */
  static generateRequestSignature(
    method: string,
    path: string,
    body: string,
    timestamp: number,
    nonce: string,
    secretKey: string
  ): string {
    const payload = `${method}|${path}|${body}|${timestamp}|${nonce}`;
    return crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
  }

  /**
   * Validate request signature
   */
  static validateRequestSignature(
    method: string,
    path: string,
    body: string,
    timestamp: number,
    nonce: string,
    signature: string,
    secretKey: string
  ): boolean {
    const expectedSignature = this.generateRequestSignature(
      method, path, body, timestamp, nonce, secretKey
    );
    
    // Use timing-safe comparison
    try {
      const sigBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      
      if (sigBuffer.length !== expectedBuffer.length) {
        return false;
      }
      
      // Convert to Uint8Array for timingSafeEqual
      return crypto.timingSafeEqual(
        new Uint8Array(sigBuffer),
        new Uint8Array(expectedBuffer)
      );
    } catch (error) {
      console.error('[Security] Signature validation error:', error);
      return false;
    }
  }
}

/**
 * Middleware for advanced request security
 */
export function createAdvancedSecurityMiddleware() {
  return {
    validateRequest: async (req: any): Promise<{ valid: boolean; error?: string }> => {
      const { 
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-signature': signature,
        'x-client-id': clientId 
      } = req.headers;

      // Validate required headers
      if (!timestamp || !nonce || !signature || !clientId) {
        return { valid: false, error: 'Missing security headers' };
      }

      // Validate timestamp
      if (!RequestSecurityManager.validateTimestamp(parseInt(timestamp))) {
        return { valid: false, error: 'Invalid timestamp' };
      }

      // Validate nonce
      if (!(await RequestSecurityManager.validateAndConsumeNonce(nonce, clientId))) {
        return { valid: false, error: 'Invalid or reused nonce' };
      }

      // Validate signature
      const secretKey = process.env.REQUEST_SIGNING_SECRET || 'default-secret';
      const bodyString = JSON.stringify(req.body);
      
      if (!RequestSecurityManager.validateRequestSignature(
        req.method,
        req.url,
        bodyString,
        parseInt(timestamp),
        nonce,
        signature,
        secretKey
      )) {
        return { valid: false, error: 'Invalid request signature' };
      }

      return { valid: true };
    }
  };
}
