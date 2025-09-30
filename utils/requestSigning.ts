import crypto from 'crypto';
import { createClient } from 'redis';

// Use existing Redis connection
const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 10000, // 10 seconds
    reconnectStrategy: (retries) => {
      if (retries > 3) {
        console.log('[RequestSigning] Max Redis reconnection attempts reached');
        return false;
      }
      return Math.min(retries * 100, 3000);
    }
  }
});

// Connect to Redis with retry logic
let redisConnected = false;
let connectionAttempts = 0;

async function connectRedis() {
  if (connectionAttempts >= 3) {
    return;
  }
  
  try {
    connectionAttempts++;
    await redis.connect();
    redisConnected = true;
  } catch (error) {
    redisConnected = false;
    
    // Retry after delay
    if (connectionAttempts < 3) {
      setTimeout(connectRedis, 5000);
    }
  }
}

// Initial connection attempt
connectRedis();

// Handle Redis errors
redis.on('error', (error) => {
  redisConnected = false;
});

redis.on('connect', () => {
  redisConnected = true;
});

redis.on('disconnect', () => {
  redisConnected = false;
});

/**
 * Advanced Request Security with Nonce and Timestamp Validation
 */
export class RequestSecurityManager {
  private static readonly NONCE_EXPIRY = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_TIMESTAMP_SKEW = 5 * 60 * 1000 + 5000; // 5 minutes + 5 seconds buffer (increased for production tolerance)

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
    
    // Allow configurable timestamp tolerance via environment variable
    const maxSkew = process.env.MAX_TIMESTAMP_SKEW_MS 
      ? parseInt(process.env.MAX_TIMESTAMP_SKEW_MS) 
      : this.MAX_TIMESTAMP_SKEW;
    
    if (timeDiff > maxSkew) {
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
        return false;
      }
      
      // Mark nonce as used
      const expirySeconds = Math.ceil(this.NONCE_EXPIRY / 1000);
      await redis.setEx(key, expirySeconds, 'used');
      return true;
      
    } catch (error) {
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
      return false;
    }
  }
}

/**
 * Middleware for advanced request security
 */
export function createAdvancedSecurityMiddleware() {
  return {
    validateRequest: async (req: any, decryptedBody?: any): Promise<{ valid: boolean; error?: string }> => {
      // Check if request signing is enabled
      const isRequestSigningEnabled = process.env.ENABLE_REQUEST_SIGNING === 'true';
      
      if (!isRequestSigningEnabled) {
        return { valid: true };
      }

      const { 
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-signature': signature,
        'x-client-id': clientId 
      } = req.headers;

      // Validate required headers
      const missingHeaders = [];
      if (!timestamp) missingHeaders.push('x-timestamp');
      if (!nonce) missingHeaders.push('x-nonce');
      if (!signature) missingHeaders.push('x-signature');
      if (!clientId) missingHeaders.push('x-client-id');
      
      if (missingHeaders.length > 0) {
        return { valid: false, error: `Missing security headers: ${missingHeaders.join(', ')}` };
      }

      // Validate timestamp
      if (!RequestSecurityManager.validateTimestamp(parseInt(timestamp))) {
        return { valid: false, error: 'Invalid timestamp' };
      }

      // Validate nonce (only if Redis is available)
      try {
        if (!(await RequestSecurityManager.validateAndConsumeNonce(nonce, clientId))) {
          return { valid: false, error: 'Invalid or reused nonce' };
        }
      } catch (error) {
        // In production, you might want to fail here, but for development we'll continue
        if (process.env.NODE_ENV === 'production') {
          return { valid: false, error: 'Nonce validation service unavailable' };
        }
      }

      // Validate signature
      const secretKey = process.env.REQUEST_SIGNING_SECRET || 'default-secret';
      
      // Use decrypted body if provided, otherwise use raw body
      const bodyToValidate = decryptedBody || req.body;
      
      // Sort keys alphabetically to match client-side sorting
      const sortedBody = Object.keys(bodyToValidate)
        .sort()
        .reduce((acc: any, key: string) => {
          acc[key] = bodyToValidate[key];
          return acc;
        }, {});
      
      const bodyString = JSON.stringify(sortedBody);
      
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
