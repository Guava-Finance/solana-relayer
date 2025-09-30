/**
 * Redis Blacklist Checker
 * 
 * Simple utility to check if addresses are blacklisted in Redis
 * Replaces emergency blacklist with dynamic Redis-based checking
 */

import { createClient } from 'redis';

// Redis client configuration
const redis = createClient({
  url: process.env.REDIS_URL,
});

// Connection state
let redisConnected = false;
let connectionAttempts = 0;
const maxConnectionAttempts = 5;

// Connect to Redis with retry logic
async function connectRedis() {
  if (redisConnected) return;
  
  try {
    if (connectionAttempts >= maxConnectionAttempts) {
      console.log('[RedisBlacklist] Max Redis reconnection attempts reached');
      return;
    }
    
    connectionAttempts++;
    await redis.connect();
    console.log('[RedisBlacklist] Connected to Redis');
    redisConnected = true;
  } catch (error) {
    console.error(`[RedisBlacklist] Failed to connect to Redis (attempt ${connectionAttempts}):`, error instanceof Error ? error.message : String(error));
    redisConnected = false;
    
    // Retry connection after 5 seconds
    if (connectionAttempts < maxConnectionAttempts) {
      setTimeout(connectRedis, 5000);
    }
  }
}

// Initialize connection
connectRedis();

// Handle Redis events
redis.on('error', (error) => {
  console.error('[RedisBlacklist] Redis error:', error.message);
  redisConnected = false;
});

redis.on('connect', () => {
  console.log('[RedisBlacklist] Redis connected');
  redisConnected = true;
});

redis.on('disconnect', () => {
  console.log('[RedisBlacklist] Redis disconnected');
  redisConnected = false;
});

export interface BlacklistCheckResult {
  blocked: boolean;
  address?: string;
  reason?: string;
}

/**
 * Check if an address is blacklisted in Redis
 */
export async function checkRedisBlacklist(address: string): Promise<BlacklistCheckResult> {
  try {
    // If Redis is not connected, allow the transaction (fail-open)
    if (!redisConnected) {
      console.warn(`[RedisBlacklist] Redis not connected - allowing transaction for ${address}`);
      return { blocked: false };
    }

    // Check if address is in blacklist
    const isBlacklisted = await redis.sIsMember('blacklist:addresses', address);
    
    if (isBlacklisted) {
      // Get the reason for blacklisting
      const reason = await redis.hGet('blacklist:reasons', address) || 'Address blacklisted';
      
      console.log(`[RedisBlacklist] Address blacklisted: ${address} - ${reason}`);
      
      return {
        blocked: true,
        address,
        reason
      };
    }

    return { blocked: false };
    
  } catch (error) {
    console.error(`[RedisBlacklist] Error checking blacklist for ${address}:`, error);
    // Fail-open: if Redis check fails, allow the transaction
    return { blocked: false };
  }
}

/**
 * Check multiple addresses against Redis blacklist
 */
export async function validateRedisBlacklist(senderAddress: string, receiverAddress: string): Promise<BlacklistCheckResult> {
  // Check sender first
  const senderCheck = await checkRedisBlacklist(senderAddress);
  if (senderCheck.blocked) {
    return senderCheck;
  }

  // Check receiver
  const receiverCheck = await checkRedisBlacklist(receiverAddress);
  if (receiverCheck.blocked) {
    return receiverCheck;
  }

  return { blocked: false };
}

/**
 * Add address to Redis blacklist
 */
export async function addToRedisBlacklist(address: string, reason: string): Promise<void> {
  try {
    if (!redisConnected) {
      console.warn(`[RedisBlacklist] Redis not connected - cannot blacklist ${address}`);
      return;
    }

    await redis.sAdd('blacklist:addresses', address);
    await redis.hSet('blacklist:reasons', address, reason);
    
    console.log(`[RedisBlacklist] Added to blacklist: ${address} - ${reason}`);
  } catch (error) {
    console.error(`[RedisBlacklist] Failed to blacklist address ${address}:`, error);
  }
}

/**
 * Remove address from Redis blacklist
 */
export async function removeFromRedisBlacklist(address: string): Promise<void> {
  try {
    if (!redisConnected) {
      console.warn(`[RedisBlacklist] Redis not connected - cannot remove ${address} from blacklist`);
      return;
    }

    await redis.sRem('blacklist:addresses', address);
    await redis.hDel('blacklist:reasons', address);
    
    console.log(`[RedisBlacklist] Removed from blacklist: ${address}`);
  } catch (error) {
    console.error(`[RedisBlacklist] Failed to remove address ${address} from blacklist:`, error);
  }
}

/**
 * Get blacklist statistics
 */
export async function getBlacklistStats(): Promise<{
  totalBlacklisted: number;
  isConnected: boolean;
}> {
  try {
    if (!redisConnected) {
      return { totalBlacklisted: 0, isConnected: false };
    }

    const count = await redis.sCard('blacklist:addresses');
    return { totalBlacklisted: count, isConnected: true };
  } catch (error) {
    console.error('[RedisBlacklist] Error getting blacklist stats:', error);
    return { totalBlacklisted: 0, isConnected: false };
  }
}
