import type { NextApiRequest, NextApiResponse } from "next";

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  message?: string; // Custom error message
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
}

interface RequestRecord {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting (in production, use Redis or similar)
const requestStore = new Map<string, RequestRecord>();

/**
 * Creates a rate limiting middleware
 */
export function createRateLimiter(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    message = "Too many requests, please try again later.",
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = config;

  const checkRateLimit = (req: NextApiRequest, senderAddress?: string): { allowed: boolean; resetTime?: number; remaining?: number } => {
    const key = senderAddress ? `sender:${senderAddress}` : getRateLimitKey(req);
    const now = Date.now();
    
    // Get or create request record
    let record = requestStore.get(key);
    
    // Reset if window has expired
    if (!record || now >= record.resetTime) {
      record = {
        count: 0,
        resetTime: now + windowMs,
      };
    }
    
    // Check if limit exceeded
    if (record.count >= maxRequests) {
      return {
        allowed: false,
        resetTime: record.resetTime,
        remaining: 0,
      };
    }
    
    // Increment counter and update store
    record.count++;
    requestStore.set(key, record);
    
    return {
      allowed: true,
      resetTime: record.resetTime,
      remaining: maxRequests - record.count,
    };
  };

  return {
    /**
     * Check if request should be rate limited
     */
    checkRateLimit,

    /**
     * Check rate limit with sender address (after request processing)
     */
    checkWithSender: (req: NextApiRequest, res: NextApiResponse, senderAddress: string): boolean => {
      const result = checkRateLimit(req, senderAddress);
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining || 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil((result.resetTime || 0) / 1000));
      
      if (!result.allowed) {
        console.log(`[RateLimit] Request blocked for sender: ${senderAddress}`);
        res.status(429).json({
          result: "error",
          message: { error: new Error(message) },
          retryAfter: Math.ceil(((result.resetTime || 0) - Date.now()) / 1000),
        });
        return false;
      }
      
      return true;
    },

    /**
     * Apply rate limiting to an API handler
     */
    apply: (handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void) => {
      return async (req: NextApiRequest, res: NextApiResponse) => {
        const result = checkRateLimit(req);
        
        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', result.remaining || 0);
        res.setHeader('X-RateLimit-Reset', Math.ceil((result.resetTime || 0) / 1000));
        
        if (!result.allowed) {
          console.log(`[RateLimit] Request blocked for ${getRateLimitKey(req)}`);
          return res.status(429).json({
            result: "error",
            message: { error: new Error(message) },
            retryAfter: Math.ceil(((result.resetTime || 0) - Date.now()) / 1000),
          });
        }
        
        return handler(req, res);
      };
    },
  };
}

/**
 * Generate a unique key for rate limiting based on sender address
 */
function getRateLimitKey(req: NextApiRequest): string {
  // Try to extract senderAddress from request body
  let senderAddress = 'unknown';
  
  if (req.body && typeof req.body === 'object') {
    // Direct access to senderAddress
    if (req.body.senderAddress && typeof req.body.senderAddress === 'string') {
      senderAddress = req.body.senderAddress;
    }
    // For encrypted requests, we might need to check if it's already decrypted
    // The encryption middleware should have already processed the request by this point
    else if (req.body.message && req.body.message.senderAddress) {
      senderAddress = req.body.message.senderAddress;
    }
  }
  
  // Fallback to IP-based rate limiting if no sender address found
  if (senderAddress === 'unknown') {
    const forwarded = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    const ip = forwarded 
      ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0])
      : realIp 
      ? (Array.isArray(realIp) ? realIp[0] : realIp)
      : req.socket.remoteAddress || 'unknown';
    
    console.log(`[RateLimit] No sender address found, using IP: ${ip}`);
    return `ip:${ip}`;
  }
  
  console.log(`[RateLimit] Using sender address for rate limiting: ${senderAddress}`);
  return `sender:${senderAddress}`;
}

/**
 * Predefined rate limit configurations
 */
export const RateLimitConfigs = {
  // Strict limits for transaction endpoints
  TRANSACTION: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 2, // 10 requests per minute
    message: "Too many transaction requests. Please wait before trying again.",
  },
  
  // Moderate limits for account creation
  ACCOUNT_CREATION: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 2, // 5 requests per minute
    message: "Too many account creation requests. Please wait before trying again.",
  },
  
  // Lenient limits for read operations
  READ_OPERATIONS: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10, // 30 requests per minute
    message: "Too many requests. Please wait before trying again.",
  },
  
  // Very strict limits for nonce creation (expensive operation)
  NONCE_CREATION: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 2, // 3 requests per 5 minutes
    message: "Too many nonce creation requests. Please wait before trying again.",
  },
} as const;

/**
 * Clean up expired entries from the request store
 * Should be called periodically to prevent memory leaks
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  let cleaned = 0;
  
  requestStore.forEach((record, key) => {
    if (now >= record.resetTime) {
      requestStore.delete(key);
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`[RateLimit] Cleaned up ${cleaned} expired entries`);
  }
}

// Auto-cleanup every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
