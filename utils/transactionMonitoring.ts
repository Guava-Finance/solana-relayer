import { Connection, PublicKey } from '@solana/web3.js';
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 10000, // 10 seconds
    reconnectStrategy: (retries) => {
      if (retries > 3) {
        console.log('[TransactionMonitor] Max Redis reconnection attempts reached');
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
    console.log('[TransactionMonitor] Max connection attempts reached, using fallback mode');
    return;
  }
  
  try {
    connectionAttempts++;
    await redis.connect();
    console.log('[TransactionMonitor] Connected to Redis');
    redisConnected = true;
  } catch (error) {
    console.error(`[TransactionMonitor] Failed to connect to Redis (attempt ${connectionAttempts}):`, error instanceof Error ? error.message : String(error));
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
  console.error('[TransactionMonitor] Redis error:', error.message);
  redisConnected = false;
});

redis.on('connect', () => {
  console.log('[TransactionMonitor] Redis connected');
  redisConnected = true;
});

redis.on('disconnect', () => {
  console.log('[TransactionMonitor] Redis disconnected');
  redisConnected = false;
});

interface TransactionPattern {
  totalTransactions: number;
  totalVolume: number;
  uniqueReceivers: Set<string>;
  averageAmount: number;
  lastTransaction: number;
  suspiciousPatterns: string[];
}

interface WalletRiskProfile {
  riskScore: number;
  flags: string[];
  firstSeen: number;
  transactionCount: number;
  totalVolume: number;
}

/**
 * Transaction Monitoring and Anomaly Detection
 */
export class TransactionMonitor {
  private static readonly HIGH_RISK_THRESHOLD = 80;
  private static readonly MONITORING_WINDOW = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Analyze transaction for suspicious patterns
   */
  static async analyzeTransaction(
    senderAddress: string,
    receiverAddress: string,
    amount: number,
    tokenMint: string
  ): Promise<{ allowed: boolean; riskScore: number; flags: string[] }> {
    
    const flags: string[] = [];
    let riskScore = 0;

    // Check Redis connection - but still do critical security checks
    if (!redisConnected) {
      console.warn('🚨 [TxMonitor] Redis not connected, using EMERGENCY FALLBACK security checks');
      
      // CRITICAL: Still check emergency blacklist even without Redis
      const { isEmergencyBlacklisted } = await import('./emergencyBlacklist');
      
      if (isEmergencyBlacklisted(senderAddress)) {
        riskScore += 100;
        flags.push(`🚫 EMERGENCY BLACKLIST: Sender blocked: ${senderAddress}`);
        console.error(`🚨 [TxMonitor] EMERGENCY BLACKLIST TRIGGERED: ${senderAddress}`);
      }
      
      if (isEmergencyBlacklisted(receiverAddress)) {
        riskScore += 100;
        flags.push(`🚫 EMERGENCY BLACKLIST: Receiver blocked: ${receiverAddress}`);
        console.error(`🚨 [TxMonitor] EMERGENCY BLACKLIST TRIGGERED: ${receiverAddress}`);
      }
      
      // Perform basic validation without Redis
      const basicAnalysis = this.analyzeAmountPatterns(amount, tokenMint);
      riskScore += basicAnalysis.riskScore;
      flags.push(...basicAnalysis.flags);
      
      const allowed = riskScore < this.HIGH_RISK_THRESHOLD;
      
      if (!allowed) {
        console.error(`🚨 [TxMonitor] EMERGENCY FALLBACK BLOCK: ${senderAddress} -> ${receiverAddress}, Risk: ${riskScore}`, flags);
      } else {
        console.log(`⚠️  [TxMonitor] FALLBACK MODE: Transaction allowed with basic validation only`);
      }
      
      return { allowed, riskScore, flags };
    }

    // 1. Analyze sender patterns
    const senderAnalysis = await this.analyzeSenderBehavior(senderAddress, amount, receiverAddress);
    riskScore += senderAnalysis.riskScore;
    flags.push(...senderAnalysis.flags);

    // 2. Analyze receiver patterns
    const receiverAnalysis = await this.analyzeReceiverBehavior(receiverAddress, amount);
    riskScore += receiverAnalysis.riskScore;
    flags.push(...receiverAnalysis.flags);

    // 3. Analyze amount patterns
    const amountAnalysis = this.analyzeAmountPatterns(amount, tokenMint);
    riskScore += amountAnalysis.riskScore;
    flags.push(...amountAnalysis.flags);

    // 4. Check against known bad actors
    const blacklistCheck = await this.checkBlacklists(senderAddress, receiverAddress);
    riskScore += blacklistCheck.riskScore;
    flags.push(...blacklistCheck.flags);

    const allowed = riskScore < this.HIGH_RISK_THRESHOLD;

    if (!allowed) {
      console.log(`[TxMonitor] High-risk transaction blocked: ${senderAddress} -> ${receiverAddress}, Risk: ${riskScore}`, flags);
      await this.recordSuspiciousTransaction(senderAddress, receiverAddress, amount, riskScore, flags);
    }

    return { allowed, riskScore, flags };
  }

  /**
   * Analyze sender behavior patterns
   */
  private static async analyzeSenderBehavior(
    senderAddress: string,
    amount: number,
    receiverAddress: string
  ): Promise<{ riskScore: number; flags: string[] }> {
    
    let riskScore = 0;
    const flags: string[] = [];

    try {
      const key = `sender_pattern:${senderAddress}`;
      const patternData = await redis.get(key);
      
      let pattern: TransactionPattern;
      if (patternData) {
        const parsed = JSON.parse(patternData);
        pattern = {
          ...parsed,
          uniqueReceivers: new Set(parsed.uniqueReceivers)
        };
      } else {
        pattern = {
          totalTransactions: 0,
          totalVolume: 0,
          uniqueReceivers: new Set(),
          averageAmount: 0,
          lastTransaction: 0,
          suspiciousPatterns: []
        };
      }

      // Update pattern
      pattern.totalTransactions++;
      pattern.totalVolume += amount;
      pattern.uniqueReceivers.add(receiverAddress);
      pattern.averageAmount = pattern.totalVolume / pattern.totalTransactions;
      const now = Date.now();
      const timeSinceLastTx = now - pattern.lastTransaction;
      pattern.lastTransaction = now;

      // Analysis
      
      // 1. High frequency transactions
      if (timeSinceLastTx < 10000 && pattern.totalTransactions > 5) { // Less than 10 seconds
        riskScore += 25;
        flags.push(`High frequency transactions: ${timeSinceLastTx}ms interval`);
      }

      // 2. Many unique receivers (potential distribution attack)
      if (pattern.uniqueReceivers.size > 20 && pattern.totalTransactions < 50) {
        riskScore += 30;
        flags.push(`Many unique receivers: ${pattern.uniqueReceivers.size}`);
      }

      // 3. Unusual amount patterns
      if (amount > pattern.averageAmount * 10 && pattern.totalTransactions > 3) {
        riskScore += 20;
        flags.push(`Unusual large amount: ${amount} vs avg ${pattern.averageAmount.toFixed(2)}`);
      }

      // 4. Round number amounts (often indicates automated behavior)
      if (this.isRoundNumber(amount)) {
        riskScore += 10;
        flags.push(`Round number amount: ${amount}`);
      }

      // Save updated pattern
      const serialized = {
        ...pattern,
        uniqueReceivers: Array.from(pattern.uniqueReceivers)
      };
      await redis.setEx(key, 86400, JSON.stringify(serialized)); // 24 hour TTL

    } catch (error) {
      console.error('[TxMonitor] Sender analysis error:', error);
    }

    return { riskScore, flags };
  }

  /**
   * Analyze receiver behavior patterns
   */
  private static async analyzeReceiverBehavior(
    receiverAddress: string,
    amount: number
  ): Promise<{ riskScore: number; flags: string[] }> {
    
    let riskScore = 0;
    const flags: string[] = [];

    try {
      const key = `receiver_pattern:${receiverAddress}`;
      const data = await redis.get(key);
      
      let receivedCount = 0;
      let totalReceived = 0;

      if (data) {
        const parsed = JSON.parse(data);
        receivedCount = parsed.count || 0;
        totalReceived = parsed.total || 0;
      }

      receivedCount++;
      totalReceived += amount;

      // Analysis
      
      // 1. High volume receiver (potential money laundering)
      if (receivedCount > 100 && totalReceived > 1000000) { // Adjust thresholds as needed
        riskScore += 25;
        flags.push(`High volume receiver: ${receivedCount} transactions, ${totalReceived} total`);
      }

      // 2. New account receiving large amounts
      if (receivedCount <= 3 && amount > 100000) { // Adjust threshold
        riskScore += 20;
        flags.push(`New account large deposit: ${amount} on transaction #${receivedCount}`);
      }

      // Save updated data
      await redis.setEx(key, 86400, JSON.stringify({
        count: receivedCount,
        total: totalReceived,
        lastUpdate: Date.now()
      }));

    } catch (error) {
      console.error('[TxMonitor] Receiver analysis error:', error);
    }

    return { riskScore, flags };
  }

  /**
   * Analyze amount patterns
   */
  private static analyzeAmountPatterns(
    amount: number,
    tokenMint: string
  ): { riskScore: number; flags: string[] } {
    
    let riskScore = 0;
    const flags: string[] = [];

    // 1. Suspiciously small amounts (dust attacks)
    if (amount < 0.001) {
      riskScore += 15;
      flags.push(`Dust amount: ${amount}`);
    }

    // 2. Suspiciously large amounts
    if (amount > 1000000) { // Adjust threshold based on your use case
      riskScore += 30;
      flags.push(`Large amount: ${amount}`);
    }

    // 3. Exact round numbers (often automated)
    if (this.isRoundNumber(amount)) {
      riskScore += 5;
      flags.push(`Round number: ${amount}`);
    }

    return { riskScore, flags };
  }

  /**
   * Check against blacklists and known bad actors
   */
  private static async checkBlacklists(
    senderAddress: string,
    receiverAddress: string
  ): Promise<{ riskScore: number; flags: string[] }> {
    
    let riskScore = 0;
    const flags: string[] = [];

    try {
      // Check internal blacklist
      const senderBlacklisted = await redis.sIsMember('blacklist:addresses', senderAddress);
      const receiverBlacklisted = await redis.sIsMember('blacklist:addresses', receiverAddress);

      if (senderBlacklisted) {
        riskScore += 100; // Immediate block
        flags.push(`Sender blacklisted: ${senderAddress}`);
      }

      if (receiverBlacklisted) {
        riskScore += 100; // Immediate block
        flags.push(`Receiver blacklisted: ${receiverAddress}`);
      }

      // Check greylist (suspicious but not blocked)
      const senderGreylisted = await redis.sIsMember('greylist:addresses', senderAddress);
      const receiverGreylisted = await redis.sIsMember('greylist:addresses', receiverAddress);

      if (senderGreylisted) {
        riskScore += 40;
        flags.push(`Sender greylisted: ${senderAddress}`);
        
        // Check if greylisted address should be promoted to blacklist
        await this.checkGreylistPromotion(senderAddress);
      }

      if (receiverGreylisted) {
        riskScore += 40;
        flags.push(`Receiver greylisted: ${receiverAddress}`);
        
        // Check if greylisted address should be promoted to blacklist
        await this.checkGreylistPromotion(receiverAddress);
      }

    } catch (error) {
      console.error('[TxMonitor] Blacklist check error:', error);
    }

    return { riskScore, flags };
  }

  /**
   * Check if amount is a round number
   */
  private static isRoundNumber(amount: number): boolean {
    // Check if it's a round number (ends in many zeros)
    const str = amount.toString();
    const decimalIndex = str.indexOf('.');
    
    if (decimalIndex === -1) {
      // Integer - check for trailing zeros
      return /0{2,}$/.test(str);
    } else {
      // Decimal - check if it's like 1.00000
      const decimalPart = str.substring(decimalIndex + 1);
      return /^0+$/.test(decimalPart) && decimalPart.length >= 2;
    }
  }

  /**
   * Record suspicious transaction for analysis
   */
  private static async recordSuspiciousTransaction(
    sender: string,
    receiver: string,
    amount: number,
    riskScore: number,
    flags: string[]
  ): Promise<void> {
    try {
      const event = {
        sender,
        receiver,
        amount,
        riskScore,
        flags,
        timestamp: Date.now()
      };

      await redis.lPush('suspicious_transactions', JSON.stringify(event));
      await redis.lTrim('suspicious_transactions', 0, 999); // Keep last 1000
    } catch (error) {
      console.error('[TxMonitor] Failed to record suspicious transaction:', error);
    }
  }

  /**
   * Add address to blacklist
   */
  static async blacklistAddress(address: string, reason: string): Promise<void> {
    try {
      await redis.sAdd('blacklist:addresses', address);
      await redis.hSet('blacklist:reasons', address, reason);
      console.log(`[TxMonitor] Blacklisted address: ${address} - ${reason}`);
    } catch (error) {
      console.error('[TxMonitor] Failed to blacklist address:', error);
    }
  }

  /**
   * Add address to greylist
   */
  static async greylistAddress(address: string, reason: string): Promise<void> {
    try {
      await redis.sAdd('greylist:addresses', address);
      await redis.hSet('greylist:reasons', address, reason);
      
      // Track greylist violations for promotion to blacklist
      const violationKey = `greylist_violations:${address}`;
      const violations = await redis.incr(violationKey);
      await redis.expire(violationKey, 24 * 60 * 60); // 24 hour window
      
      console.log(`[TxMonitor] Greylisted address: ${address} - ${reason} (violations: ${violations})`);
    } catch (error) {
      console.error('[TxMonitor] Failed to greylist address:', error);
    }
  }

  /**
   * Check if greylisted address should be promoted to blacklist
   */
  private static async checkGreylistPromotion(address: string): Promise<void> {
    try {
      const violationKey = `greylist_violations:${address}`;
      const violations = await redis.get(violationKey);
      const violationCount = violations ? parseInt(violations) : 0;
      
      // Promote to blacklist after 3 violations in 24 hours
      if (violationCount >= 3) {
        console.log(`[TxMonitor] Promoting greylisted address to blacklist: ${address} (${violationCount} violations)`);
        
        // Move from greylist to blacklist
        await redis.sRem('greylist:addresses', address);
        await redis.hDel('greylist:reasons', address);
        await redis.del(violationKey);
        
        await this.blacklistAddress(
          address, 
          `Promoted from greylist: ${violationCount} violations in 24 hours`
        );
      }
    } catch (error) {
      console.error('[TxMonitor] Failed to check greylist promotion:', error);
    }
  }

  /**
   * Get transaction statistics
   */
  static async getTransactionStats(): Promise<any> {
    try {
      const suspiciousCount = await redis.lLen('suspicious_transactions');
      const blacklistCount = await redis.sCard('blacklist:addresses');
      const greylistCount = await redis.sCard('greylist:addresses');

      return {
        suspiciousTransactions: suspiciousCount,
        blacklistedAddresses: blacklistCount,
        greylistedAddresses: greylistCount
      };
    } catch (error) {
      console.error('[TxMonitor] Failed to get stats:', error);
      return null;
    }
  }
}
