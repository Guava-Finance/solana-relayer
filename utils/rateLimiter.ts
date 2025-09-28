import type { NextApiRequest, NextApiResponse } from "next";
import { kv } from '@vercel/kv';

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

  const checkRateLimit = async (req: NextApiRequest, senderAddress?: string): Promise<{ allowed: boolean; resetTime?: number; remaining?: number }> => {
    const key = `ratelimit:${senderAddress ? `sender:${senderAddress}` : getRateLimitKey(req)}`;
    const now = Date.now();
    
    try {
      console.log(`[RateLimit] Checking rate limit for key: ${key}`);
      
      // Get current record from Redis
      const recordData = await kv.get<RequestRecord>(key);
      let record = recordData;
      
      console.log(`[RateLimit] Current record:`, record);
      
      // Reset if window has expired or no record exists
      if (!record || now >= record.resetTime) {
        record = {
          count: 0,
          resetTime: now + windowMs,
        };
        console.log(`[RateLimit] Reset/new window for key: ${key}`);
      }
      
      // Check if limit exceeded
      if (record.count >= maxRequests) {
        console.log(`[RateLimit] Rate limit exceeded for key: ${key}, count: ${record.count}, max: ${maxRequests}`);
        return {
          allowed: false,
          resetTime: record.resetTime,
          remaining: 0,
        };
      }
      
      // Increment counter and update Redis
      record.count++;
      
      // Set with expiration (TTL in seconds)
      const ttlSeconds = Math.ceil((record.resetTime - now) / 1000);
      await kv.setex(key, ttlSeconds, record);
      
      console.log(`[RateLimit] Request allowed for key: ${key}, count: ${record.count}/${maxRequests}, TTL: ${ttlSeconds}s`);
      
      return {
        allowed: true,
        resetTime: record.resetTime,
        remaining: maxRequests - record.count,
      };
    } catch (error) {
      console.error('[RateLimit] Redis error, allowing request:', error);
      // Fallback: allow request if Redis fails
      return {
        allowed: true,
        resetTime: now + windowMs,
        remaining: maxRequests - 1,
      };
    }
  };

  return {
    /**
     * Check if request should be rate limited
     */
    checkRateLimit,

    /**
     * Check rate limit with sender address (after request processing)
     */
    checkWithSender: async (req: NextApiRequest, res: NextApiResponse, senderAddress: string): Promise<boolean> => {
      const result = await checkRateLimit(req, senderAddress);
      
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
        const result = await checkRateLimit(req);
        
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
 * Redis automatically handles cleanup via TTL (Time To Live)
 * No manual cleanup needed
 */
