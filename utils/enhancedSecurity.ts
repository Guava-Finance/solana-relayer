import type { NextApiRequest, NextApiResponse } from 'next';
import { ThreatDetectionSystem } from './threatDetection';
import { validateRedisBlacklist } from './redisBlacklist';
import { createAdvancedSecurityMiddleware } from './requestSigning';

/**
 * Enhanced Security Middleware that combines all security layers
 */
export class EnhancedSecurityManager {
  private static advancedSecurity = createAdvancedSecurityMiddleware();

  /**
   * Comprehensive security check for all API endpoints
   */
  static async validateRequest(req: NextApiRequest, res: NextApiResponse): Promise<{
    allowed: boolean;
    error?: string;
    riskScore?: number;
  }> {
    
    // 1. Threat Detection Analysis
    const threatAnalysis = await ThreatDetectionSystem.analyzeRequest(req);
    
    if (threatAnalysis.blocked) {
      // Block IP temporarily for high threat score
      const ip = this.getClientIP(req);
      await ThreatDetectionSystem.blockIP(ip, 3600); // 1 hour block
      
      return {
        allowed: false,
        error: 'Request blocked due to suspicious activity',
        riskScore: threatAnalysis.score
      };
    }

    // 2. Advanced Request Security (if enabled)
    if (process.env.ENABLE_REQUEST_SIGNING === 'true') {
      const securityCheck = await this.advancedSecurity.validateRequest(req);
      
      if (!securityCheck.valid) {
        return {
          allowed: false,
          error: securityCheck.error || 'Security validation failed'
        };
      }
    }

    // 3. IP Block Check
    const ip = this.getClientIP(req);
    const isBlocked = await ThreatDetectionSystem.isBlocked(ip);
    
    if (isBlocked) {
      return {
        allowed: false,
        error: 'IP address is temporarily blocked'
      };
    }

    return { allowed: true, riskScore: threatAnalysis.score };
  }

  /**
   * Transaction-specific security validation
   */
  static async validateTransaction(
    senderAddress: string,
    receiverAddress: string,
    amount: number,
    tokenMint: string
  ): Promise<{
    allowed: boolean;
    error?: string;
    riskScore?: number;
    flags?: string[];
  }> {
    
    // Check Redis blacklist
    const blacklistCheck = await validateRedisBlacklist(senderAddress, receiverAddress);
    
    if (blacklistCheck.blocked) {
      return {
        allowed: false,
        error: `Address blocked: ${blacklistCheck.reason}`,
        riskScore: 100,
        flags: ['BLACKLISTED']
      };
    }

    return {
      allowed: true,
      riskScore: 0,
      flags: []
    };
  }

  /**
   * Create security error response
   */
  static createSecurityErrorResponse(error: string, riskScore?: number): any {
    return {
      success: false,
      error,
      timestamp: new Date().toISOString(),
      ...(riskScore && { riskScore })
    };
  }

  /**
   * Get client IP address
   */
  private static getClientIP(req: NextApiRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    
    if (forwarded) {
      return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    }
    
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }
    
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * Log security event
   */
  static logSecurityEvent(
    type: 'THREAT_DETECTED' | 'TRANSACTION_BLOCKED' | 'IP_BLOCKED' | 'SECURITY_VIOLATION',
    details: any
  ): void {
    console.log(`[EnhancedSecurity] ${type}:`, {
      timestamp: new Date().toISOString(),
      ...details
    });
  }
}

/**
 * Security configuration interface
 */
export interface SecurityConfig {
  enableThreatDetection: boolean;
  enableRequestSigning: boolean;
  threatThreshold: number;
  transactionRiskThreshold: number;
  autoBlockHighRisk: boolean;
  blockDuration: number; // seconds
}

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enableThreatDetection: true,
  enableRequestSigning: false, // Requires client-side implementation
  threatThreshold: 75,
  transactionRiskThreshold: 80,
  autoBlockHighRisk: true,
  blockDuration: 3600 // 1 hour
};

/**
 * Security middleware factory
 */
export function createEnhancedSecurityMiddleware(config: Partial<SecurityConfig> = {}) {
  const finalConfig = { ...DEFAULT_SECURITY_CONFIG, ...config };

  return {
    validateRequest: async (req: NextApiRequest, res: NextApiResponse) => {
      return await EnhancedSecurityManager.validateRequest(req, res);
    },
    
    validateTransaction: async (
      senderAddress: string,
      receiverAddress: string,
      amount: number,
      tokenMint: string
    ) => {
      
      return await EnhancedSecurityManager.validateTransaction(
        senderAddress,
        receiverAddress,
        amount,
        tokenMint
      );
    },

    config: finalConfig
  };
}
