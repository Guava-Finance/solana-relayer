import { createClient } from 'redis';
import type { NextApiRequest } from 'next';

const redis = createClient({
  url: process.env.REDIS_URL
});

// Connect to Redis
let redisConnected = false;
redis.connect().then(() => {
  console.log('[ThreatDetection] Connected to Redis');
  redisConnected = true;
}).catch((error) => {
  console.error('[ThreatDetection] Failed to connect to Redis:', error);
  redisConnected = false;
});

interface ThreatScore {
  score: number;
  reasons: string[];
  blocked: boolean;
}

interface RequestPattern {
  count: number;
  firstSeen: number;
  lastSeen: number;
  userAgents: Set<string>;
  endpoints: Set<string>;
}

/**
 * Advanced Threat Detection System
 */
export class ThreatDetectionSystem {
  private static readonly THREAT_THRESHOLD = 75;
  private static readonly ANALYSIS_WINDOW = 60 * 60 * 1000; // 1 hour

  /**
   * Analyze request for suspicious patterns
   */
  static async analyzeRequest(req: NextApiRequest): Promise<ThreatScore> {
    const ip = this.getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const endpoint = req.url || 'unknown';
    
    let score = 0;
    const reasons: string[] = [];

    // 1. Check for suspicious IP patterns
    const ipScore = await this.analyzeIPBehavior(ip, userAgent, endpoint);
    score += ipScore.score;
    reasons.push(...ipScore.reasons);

    // 2. Check for bot-like behavior
    const botScore = this.analyzeBotBehavior(req);
    score += botScore.score;
    reasons.push(...botScore.reasons);

    // 3. Check for suspicious timing patterns
    const timingScore = await this.analyzeTimingPatterns(ip);
    score += timingScore.score;
    reasons.push(...timingScore.reasons);

    // 4. Check for geographic anomalies (if you have geolocation data)
    const geoScore = await this.analyzeGeographicPatterns(ip);
    score += geoScore.score;
    reasons.push(...geoScore.reasons);

    const blocked = score >= this.THREAT_THRESHOLD;
    
    if (blocked) {
      console.log(`[ThreatDetection] High threat score: ${score} for IP: ${ip}`, reasons);
      await this.recordThreatEvent(ip, score, reasons);
    }

    return { score, reasons, blocked };
  }

  /**
   * Analyze IP behavior patterns
   */
  private static async analyzeIPBehavior(
    ip: string, 
    userAgent: string, 
    endpoint: string
  ): Promise<{ score: number; reasons: string[] }> {
    const key = `ip_pattern:${ip}`;
    let score = 0;
    const reasons: string[] = [];

    try {
      const patternData = await redis.get(key);
      let pattern: RequestPattern;

      if (patternData) {
        const parsed = JSON.parse(patternData);
        pattern = {
          ...parsed,
          userAgents: new Set(parsed.userAgents),
          endpoints: new Set(parsed.endpoints)
        };
      } else {
        pattern = {
          count: 0,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          userAgents: new Set(),
          endpoints: new Set()
        };
      }

      // Update pattern
      pattern.count++;
      pattern.lastSeen = Date.now();
      pattern.userAgents.add(userAgent);
      pattern.endpoints.add(endpoint);

      // Analyze patterns
      const timeWindow = pattern.lastSeen - pattern.firstSeen;
      const requestRate = pattern.count / (timeWindow / 1000); // requests per second

      // High request rate from single IP
      if (requestRate > 5) {
        score += 30;
        reasons.push(`High request rate: ${requestRate.toFixed(2)} req/sec`);
      }

      // Multiple user agents from same IP (suspicious)
      if (pattern.userAgents.size > 5) {
        score += 25;
        reasons.push(`Multiple user agents: ${pattern.userAgents.size}`);
      }

      // Targeting multiple endpoints rapidly
      if (pattern.endpoints.size > 3 && timeWindow < 60000) {
        score += 20;
        reasons.push(`Rapid endpoint scanning: ${pattern.endpoints.size} endpoints`);
      }

      // Save updated pattern
      const serialized = {
        ...pattern,
        userAgents: Array.from(pattern.userAgents),
        endpoints: Array.from(pattern.endpoints)
      };
      await redis.setex(key, 3600, JSON.stringify(serialized)); // 1 hour TTL

    } catch (error) {
      console.error('[ThreatDetection] IP analysis error:', error);
    }

    return { score, reasons };
  }

  /**
   * Analyze for bot-like behavior
   */
  private static analyzeBotBehavior(req: NextApiRequest): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    const userAgent = req.headers['user-agent'] || '';

    // Suspicious user agents
    const botPatterns = [
      /bot/i, /crawler/i, /spider/i, /scraper/i,
      /curl/i, /wget/i, /python/i, /node/i
    ];

    if (botPatterns.some(pattern => pattern.test(userAgent))) {
      score += 40;
      reasons.push(`Bot-like user agent: ${userAgent}`);
    }

    // Missing common headers
    if (!req.headers['accept-language']) {
      score += 15;
      reasons.push('Missing Accept-Language header');
    }

    if (!req.headers['accept-encoding']) {
      score += 10;
      reasons.push('Missing Accept-Encoding header');
    }

    // Suspicious header combinations
    if (userAgent === '' || userAgent.length < 10) {
      score += 20;
      reasons.push('Suspicious or missing user agent');
    }

    return { score, reasons };
  }

  /**
   * Analyze timing patterns
   */
  private static async analyzeTimingPatterns(ip: string): Promise<{ score: number; reasons: string[] }> {
    let score = 0;
    const reasons: string[] = [];

    try {
      const key = `timing:${ip}`;
      const now = Date.now();
      
      // Get recent request timestamps
      const timestamps = await redis.lrange(key, 0, -1);
      const timestampArray = Array.isArray(timestamps) ? timestamps : [];
      const recentTimestamps = timestampArray
        .filter((ts): ts is string => typeof ts === 'string')
        .map((ts: string) => parseInt(ts))
        .filter((ts: number) => !isNaN(ts) && now - ts < 60000) // Last minute
        .sort((a: number, b: number) => b - a);

      if (recentTimestamps.length > 0) {
        // Check for perfectly regular intervals (bot behavior)
        if (recentTimestamps.length >= 3) {
          const intervals = [];
          for (let i = 0; i < recentTimestamps.length - 1; i++) {
            intervals.push(recentTimestamps[i] - recentTimestamps[i + 1]);
          }
          
          const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((sum, interval) => {
            return sum + Math.pow(interval - avgInterval, 2);
          }, 0) / intervals.length;
          
          // Very low variance indicates bot-like regular timing
          if (variance < 100 && intervals.length >= 5) {
            score += 35;
            reasons.push(`Bot-like regular timing: ${variance.toFixed(2)} variance`);
          }
        }

        // Burst detection
        if (recentTimestamps.length > 10) {
          score += 25;
          reasons.push(`Request burst: ${recentTimestamps.length} requests in 1 minute`);
        }
      }

      // Store current timestamp
      await redis.lpush(key, now.toString());
      await redis.ltrim(key, 0, 19); // Keep last 20 timestamps
      await redis.expire(key, 300); // 5 minute TTL

    } catch (error) {
      console.error('[ThreatDetection] Timing analysis error:', error);
    }

    return { score, reasons };
  }

  /**
   * Analyze geographic patterns (basic implementation)
   */
  private static async analyzeGeographicPatterns(ip: string): Promise<{ score: number; reasons: string[] }> {
    let score = 0;
    const reasons: string[] = [];

    // Basic checks for known problematic IP ranges
    const suspiciousRanges = [
      /^10\./, /^192\.168\./, /^172\.16\./, // Private IPs (suspicious for public API)
      /^127\./, // Localhost
    ];

    if (suspiciousRanges.some(range => range.test(ip))) {
      score += 30;
      reasons.push(`Suspicious IP range: ${ip}`);
    }

    // You could integrate with IP geolocation services here
    // Example: MaxMind, IPinfo, etc.

    return { score, reasons };
  }

  /**
   * Record threat event for analysis
   */
  private static async recordThreatEvent(ip: string, score: number, reasons: string[]): Promise<void> {
    try {
      const event = {
        ip,
        score,
        reasons,
        timestamp: Date.now()
      };

      await redis.lpush('threat_events', JSON.stringify(event));
      await redis.ltrim('threat_events', 0, 999); // Keep last 1000 events
    } catch (error) {
      console.error('[ThreatDetection] Failed to record threat event:', error);
    }
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
   * Check if IP is currently blocked
   */
  static async isBlocked(ip: string): Promise<boolean> {
    try {
      const blocked = await redis.get(`blocked:${ip}`);
      return blocked === 'true';
    } catch (error) {
      console.error('[ThreatDetection] Block check error:', error);
      return false;
    }
  }

  /**
   * Block IP temporarily
   */
  static async blockIP(ip: string, duration: number = 3600): Promise<void> {
    try {
      await redis.setex(`blocked:${ip}`, duration, 'true');
      console.log(`[ThreatDetection] Blocked IP: ${ip} for ${duration} seconds`);
    } catch (error) {
      console.error('[ThreatDetection] Block IP error:', error);
    }
  }
}
