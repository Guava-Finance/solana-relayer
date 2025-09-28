import { Connection, PublicKey } from '@solana/web3.js';
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL
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
      await redis.setex(key, 86400, JSON.stringify(serialized)); // 24 hour TTL

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
      await redis.setex(key, 86400, JSON.stringify({
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
      const senderBlacklisted = await redis.sismember('blacklist:addresses', senderAddress);
      const receiverBlacklisted = await redis.sismember('blacklist:addresses', receiverAddress);

      if (senderBlacklisted) {
        riskScore += 100; // Immediate block
        flags.push(`Sender blacklisted: ${senderAddress}`);
      }

      if (receiverBlacklisted) {
        riskScore += 100; // Immediate block
        flags.push(`Receiver blacklisted: ${receiverAddress}`);
      }

      // Check greylist (suspicious but not blocked)
      const senderGreylisted = await redis.sismember('greylist:addresses', senderAddress);
      const receiverGreylisted = await redis.sismember('greylist:addresses', receiverAddress);

      if (senderGreylisted) {
        riskScore += 40;
        flags.push(`Sender greylisted: ${senderAddress}`);
      }

      if (receiverGreylisted) {
        riskScore += 40;
        flags.push(`Receiver greylisted: ${receiverAddress}`);
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

      await redis.lpush('suspicious_transactions', JSON.stringify(event));
      await redis.ltrim('suspicious_transactions', 0, 999); // Keep last 1000
    } catch (error) {
      console.error('[TxMonitor] Failed to record suspicious transaction:', error);
    }
  }

  /**
   * Add address to blacklist
   */
  static async blacklistAddress(address: string, reason: string): Promise<void> {
    try {
      await redis.sadd('blacklist:addresses', address);
      await redis.hset('blacklist:reasons', address, reason);
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
      await redis.sadd('greylist:addresses', address);
      await redis.hset('greylist:reasons', address, reason);
      console.log(`[TxMonitor] Greylisted address: ${address} - ${reason}`);
    } catch (error) {
      console.error('[TxMonitor] Failed to greylist address:', error);
    }
  }

  /**
   * Get transaction statistics
   */
  static async getTransactionStats(): Promise<any> {
    try {
      const suspiciousCount = await redis.llen('suspicious_transactions');
      const blacklistCount = await redis.scard('blacklist:addresses');
      const greylistCount = await redis.scard('greylist:addresses');

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
