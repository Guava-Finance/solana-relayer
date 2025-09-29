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
    console.log('[RequestSigning] Max connection attempts reached, using fallback mode');
    return;
  }
  
  try {
    connectionAttempts++;
    await redis.connect();
    console.log('[RequestSigning] Connected to Redis');
    redisConnected = true;
  } catch (error) {
    console.error(`[RequestSigning] Failed to connect to Redis (attempt ${connectionAttempts}):`, error instanceof Error ? error.message : String(error));
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
  console.error('[RequestSigning] Redis error:', error.message);
  redisConnected = false;
});

redis.on('connect', () => {
  console.log('[RequestSigning] Redis connected');
  redisConnected = true;
});

redis.on('disconnect', () => {
  console.log('[RequestSigning] Redis disconnected');
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
    
    console.log(`[Security] Timestamp validation: now=${now}, request=${timestamp}, skew=${timeDiff}ms, maxAllowed=${maxSkew}ms`);
    
    if (timeDiff > maxSkew) {
      console.log(`[Security] Request timestamp too old/future: ${timeDiff}ms skew exceeds ${maxSkew}ms limit`);
      return false;
    }
    
    console.log(`[Security] Timestamp validation passed: ${timeDiff}ms skew within ${maxSkew}ms limit`);
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
      await redis.setEx(key, Math.ceil(this.NONCE_EXPIRY / 1000), 'used');
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
      // Check if request signing is enabled
      const isRequestSigningEnabled = process.env.ENABLE_REQUEST_SIGNING === 'true';
      
      if (!isRequestSigningEnabled) {
        console.log('[RequestSigning] Request signing is disabled, skipping validation');
        return { valid: true };
      }

      console.log('[RequestSigning] Request signing is enabled, validating request');

      const { 
        'x-timestamp': timestamp,
        'x-nonce': nonce,
        'x-signature': signature,
        'x-client-id': clientId 
      } = req.headers;

      // Validate required headers
      if (!timestamp || !nonce || !signature || !clientId) {
        console.log('[RequestSigning] Missing required security headers');
        return { valid: false, error: 'Missing security headers' };
      }

      // Validate timestamp
      if (!RequestSecurityManager.validateTimestamp(parseInt(timestamp))) {
        console.log('[RequestSigning] Invalid timestamp validation failed');
        return { valid: false, error: 'Invalid timestamp' };
      }

      // Validate nonce (only if Redis is available)
      try {
        if (!(await RequestSecurityManager.validateAndConsumeNonce(nonce, clientId))) {
          console.log('[RequestSigning] Nonce validation failed');
          return { valid: false, error: 'Invalid or reused nonce' };
        }
      } catch (error) {
        console.log('[RequestSigning] Nonce validation error (Redis may be unavailable):', error);
        // In production, you might want to fail here, but for development we'll continue
        if (process.env.NODE_ENV === 'production') {
          return { valid: false, error: 'Nonce validation service unavailable' };
        }
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
        console.log('[RequestSigning] Signature validation failed');
        return { valid: false, error: 'Invalid request signature' };
      }

      console.log('[RequestSigning] Request validation successful');
      return { valid: true };
    }
  };
}
