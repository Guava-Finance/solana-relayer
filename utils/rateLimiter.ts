import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from 'redis';

// Create Redis client with better error handling
const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 10000, // 10 seconds
        reconnectStrategy: (retries) => {
            if (retries > 3) {
                console.log('[RateLimit] Max Redis reconnection attempts reached');
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
        console.log('[RateLimit] Max connection attempts reached, using fallback mode');
        return;
    }
    
    try {
        connectionAttempts++;
        await redis.connect();
        console.log('[RateLimit] Connected to Redis');
        redisConnected = true;
    } catch (error) {
        console.error(`[RateLimit] Failed to connect to Redis (attempt ${connectionAttempts}):`, error instanceof Error ? error.message : String(error));
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
    console.error('[RateLimit] Redis error:', error.message);
    redisConnected = false;
});

redis.on('connect', () => {
    console.log('[RateLimit] Redis connected');
    redisConnected = true;
});

redis.on('disconnect', () => {
    console.log('[RateLimit] Redis disconnected');
    redisConnected = false;
});

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
    violations: number; // Track number of rate limit violations
    lastViolationTime: number; // When the last violation occurred
}

/**
 * Progressive penalty timeouts (in milliseconds)
 */
const PROGRESSIVE_PENALTIES = [
    30 * 60 * 1000,      // 1st violation: 30 minute
    45 * 60 * 1000,      // 2nd violation: 45 minutes  
    60 * 60 * 1000,     // 3rd violation: 1 hour
    3 * 60 * 60 * 1000,     // 4th+ violations: 3 hours
];

/**
 * Get progressive penalty timeout based on violation count
 */
function getProgressivePenalty(violations: number): number {
    const index = Math.min(violations - 1, PROGRESSIVE_PENALTIES.length - 1);
    return PROGRESSIVE_PENALTIES[index];
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

            if (!redisConnected) {
                console.log('[RateLimit] Redis not connected, allowing request');
                return {
                    allowed: true,
                    resetTime: now + windowMs,
                    remaining: maxRequests - 1,
                };
            }

            // Get current record from Redis
            const recordData = await redis.get(key);
            let record: RequestRecord | null = null;

            if (recordData) {
                try {
                    record = JSON.parse(recordData);
                } catch (parseError) {
                    console.error('[RateLimit] Failed to parse Redis data:', parseError);
                    record = null;
                }
            }

            console.log(`[RateLimit] Current record:`, record);

            // Initialize record if it doesn't exist
            if (!record) {
                record = {
                    count: 0,
                    resetTime: now + windowMs,
                    violations: 0,
                    lastViolationTime: 0,
                };
                console.log(`[RateLimit] New record created for key: ${key}`);
            }

            // Check if user is currently in a progressive penalty timeout
            if (record.violations > 0 && record.lastViolationTime > 0) {
                const penaltyDuration = getProgressivePenalty(record.violations);
                const penaltyEndTime = record.lastViolationTime + penaltyDuration;

                if (now < penaltyEndTime) {
                    const remainingPenaltyMs = penaltyEndTime - now;
                    const remainingMinutes = Math.ceil(remainingPenaltyMs / (60 * 1000));

                    console.log(`[RateLimit] User in progressive penalty timeout. Violation #${record.violations}, ${remainingMinutes} minutes remaining`);

                    return {
                        allowed: false,
                        resetTime: penaltyEndTime,
                        remaining: 0,
                    };
                } else {
                    // Penalty period has expired, reset violations if enough time has passed
                    const violationResetTime = 24 * 60 * 60 * 1000; // Reset violations after 24 hours
                    if (now - record.lastViolationTime > violationResetTime) {
                        record.violations = 0;
                        record.lastViolationTime = 0;
                        console.log(`[RateLimit] Violations reset for key: ${key} after 24 hours`);
                    }
                }
            }

            // Reset count if window has expired
            if (now >= record.resetTime) {
                record.count = 0;
                record.resetTime = now + windowMs;
                console.log(`[RateLimit] Rate limit window reset for key: ${key}`);
            }

            // Check if limit exceeded
            if (record.count >= maxRequests) {
                // Increment violation count and set violation time
                record.violations++;
                record.lastViolationTime = now;

                const penaltyDuration = getProgressivePenalty(record.violations);
                const penaltyMinutes = penaltyDuration / (60 * 1000);

                console.log(`[RateLimit] Rate limit exceeded for key: ${key}, count: ${record.count}, max: ${maxRequests}`);
                console.log(`[RateLimit] Progressive penalty applied: Violation #${record.violations}, timeout: ${penaltyMinutes} minutes`);

                // Save the updated record with violation info
                const ttlSeconds = Math.ceil(penaltyDuration / 1000);
                await redis.setEx(key, ttlSeconds, JSON.stringify(record));

                return {
                    allowed: false,
                    resetTime: now + penaltyDuration,
                    remaining: 0,
                };
            }

            // Increment counter and update Redis
            record.count++;

            // Set with expiration (TTL in seconds)
            const ttlSeconds = Math.ceil((record.resetTime - now) / 1000);
            await redis.setEx(key, ttlSeconds, JSON.stringify(record));

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
                const retryAfterSeconds = Math.ceil(((result.resetTime || 0) - Date.now()) / 1000);
                const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);

                console.log(`[RateLimit] Request blocked for sender: ${senderAddress}`);

                // Enhanced error message with progressive penalty info
                let errorMessage = message;
                if (retryAfterMinutes >= 60) {
                    errorMessage = `Rate limit exceeded. Please wait ${Math.ceil(retryAfterMinutes / 60)} hour(s) before trying again.`;
                } else if (retryAfterMinutes > 1) {
                    errorMessage = `Rate limit exceeded. Please wait ${retryAfterMinutes} minutes before trying again.`;
                } else {
                    errorMessage = `Rate limit exceeded. Please wait ${retryAfterSeconds} seconds before trying again.`;
                }

                res.status(429).json({
                    result: "error",
                    message: { error: new Error(errorMessage) },
                    retryAfter: retryAfterSeconds,
                    retryAfterMinutes: retryAfterMinutes,
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
                    const retryAfterSeconds = Math.ceil(((result.resetTime || 0) - Date.now()) / 1000);
                    const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);

                    console.log(`[RateLimit] Request blocked for ${getRateLimitKey(req)}`);

                    // Enhanced error message with progressive penalty info
                    let errorMessage = message;
                    if (retryAfterMinutes >= 60) {
                        errorMessage = `Rate limit exceeded. Please wait ${Math.ceil(retryAfterMinutes / 60)} hour(s) before trying again.`;
                    } else if (retryAfterMinutes > 1) {
                        errorMessage = `Rate limit exceeded. Please wait ${retryAfterMinutes} minutes before trying again.`;
                    } else {
                        errorMessage = `Rate limit exceeded. Please wait ${retryAfterSeconds} seconds before trying again.`;
                    }

                    return res.status(429).json({
                        result: "error",
                        message: { error: new Error(errorMessage) },
                        retryAfter: retryAfterSeconds,
                        retryAfterMinutes: retryAfterMinutes,
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
        windowMs: 30 * 60 * 1000, // 1 minute
        maxRequests: 2, // 2 requests per minute
        message: "Too many transaction requests. Please wait before trying again.",
    },

    // Moderate limits for account creation
    ACCOUNT_CREATION: {
        windowMs: 30 * 60 * 1000, // 1 minute
        maxRequests: 1, // 2 requests per minute
        message: "Too many account creation requests. Please wait before trying again.",
    },

    // Lenient limits for read operations
    READ_OPERATIONS: {
        windowMs: 30 * 60 * 1000, // 1 minute
        maxRequests: 10, // 10 requests per minute
        message: "Too many requests. Please wait before trying again.",
    },

    // Very strict limits for nonce creation (expensive operation)
    NONCE_CREATION: {
        windowMs: 45 * 60 * 1000, // 5 minutes
        maxRequests: 2, // 2 requests per 5 minutes
        message: "Too many nonce creation requests. Please wait before trying again.",
    },
} as const;

/**
 * Redis automatically handles cleanup via TTL (Time To Live)
 * No manual cleanup needed
 */
