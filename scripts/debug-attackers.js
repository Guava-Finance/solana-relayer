#!/usr/bin/env node

/**
 * Debug Attacking Addresses Script
 * 
 * Investigates why progressive rate limiting isn't working for specific attackers
 */

const { createClient } = require('redis');

// Try to load dotenv, but don't fail if it's not available
try {
  require('dotenv').config();
} catch (e) {
  // Use environment variables directly
}

const redis = createClient({
  url: process.env.REDIS_URL
});

const attackingAddresses = [
  '6B8erp3QahPMJMMomefnKttn7NdBg9WWXRZ8UMo8qoPV',
  'GnLvsDfC7wkGsLsigTLHe8LgZLNJCLmtxUYoFwq5NSsx'
];

async function connectRedis() {
  try {
    await redis.connect();
    console.log('✅ Connected to Redis');
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error.message);
    return false;
  }
}

async function debugAttacker(address) {
  console.log(`\n🔍 Debugging Attacker: ${address}`);
  console.log('═'.repeat(80));
  
  try {
    // 1. Check blacklist status
    const isBlacklisted = await redis.sIsMember('blacklist:addresses', address);
    const blacklistReason = await redis.hGet('blacklist:reasons', address);
    
    console.log(`📋 Blacklist Status:`);
    console.log(`   Blacklisted: ${isBlacklisted ? '✅ YES' : '❌ NO'}`);
    if (isBlacklisted && blacklistReason) {
      console.log(`   Reason: ${blacklistReason}`);
    }
    
    // 2. Check greylist status
    const isGreylisted = await redis.sIsMember('greylist:addresses', address);
    const greylistReason = await redis.hGet('greylist:reasons', address);
    
    console.log(`📋 Greylist Status:`);
    console.log(`   Greylisted: ${isGreylisted ? '✅ YES' : '❌ NO'}`);
    if (isGreylisted && greylistReason) {
      console.log(`   Reason: ${greylistReason}`);
    }
    
    // 3. Check rate limiting records
    const rateLimitKeys = [
      `ratelimit:sender:${address}`,
      `ratelimit:ip:${address}` // In case it's using IP-based
    ];
    
    console.log(`📊 Rate Limiting Records:`);
    for (const key of rateLimitKeys) {
      const record = await redis.get(key);
      if (record) {
        const data = JSON.parse(record);
        const now = Date.now();
        const resetTime = new Date(data.resetTime);
        const lastViolation = data.lastViolationTime ? new Date(data.lastViolationTime) : null;
        
        console.log(`   Key: ${key}`);
        console.log(`   Count: ${data.count}`);
        console.log(`   Violations: ${data.violations || 0}`);
        console.log(`   Reset Time: ${resetTime.toISOString()}`);
        console.log(`   Last Violation: ${lastViolation ? lastViolation.toISOString() : 'None'}`);
        console.log(`   Active: ${now < data.resetTime ? '✅ YES' : '❌ NO'}`);
        
        // Calculate progressive penalty
        if (data.violations > 0 && data.lastViolationTime) {
          const penalties = [1, 5, 15, 60]; // minutes
          const penaltyIndex = Math.min(data.violations - 1, penalties.length - 1);
          const penaltyMinutes = penalties[penaltyIndex];
          const penaltyEndTime = data.lastViolationTime + (penaltyMinutes * 60 * 1000);
          const inPenalty = now < penaltyEndTime;
          
          console.log(`   Progressive Penalty: ${penaltyMinutes} minutes`);
          console.log(`   Penalty Active: ${inPenalty ? '✅ YES' : '❌ NO'}`);
          if (inPenalty) {
            const remainingMs = penaltyEndTime - now;
            const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
            console.log(`   Remaining: ${remainingMinutes} minutes`);
          }
        }
        console.log('');
      } else {
        console.log(`   ${key}: No record found`);
      }
    }
    
    // 4. Check transaction patterns
    const senderPatternKey = `sender_pattern:${address}`;
    const senderPattern = await redis.get(senderPatternKey);
    
    if (senderPattern) {
      const pattern = JSON.parse(senderPattern);
      console.log(`📈 Transaction Patterns:`);
      console.log(`   Total Transactions: ${pattern.totalTransactions}`);
      console.log(`   Total Volume: ${pattern.totalVolume}`);
      console.log(`   Unique Receivers: ${pattern.uniqueReceivers ? pattern.uniqueReceivers.length : 0}`);
      console.log(`   Average Amount: ${pattern.averageAmount}`);
      console.log(`   Last Transaction: ${new Date(pattern.lastTransaction).toISOString()}`);
    } else {
      console.log(`📈 Transaction Patterns: No data found`);
    }
    
    // 5. Check suspicious transactions
    const suspiciousTransactions = await redis.lRange('suspicious_transactions', 0, -1);
    const addressTransactions = suspiciousTransactions
      .map(tx => JSON.parse(tx))
      .filter(tx => tx.sender === address || tx.receiver === address);
    
    console.log(`🚨 Suspicious Transactions: ${addressTransactions.length}`);
    addressTransactions.slice(0, 5).forEach((tx, index) => {
      console.log(`   ${index + 1}. Risk: ${tx.riskScore}, Flags: ${tx.flags.join(', ')}`);
      console.log(`      Time: ${new Date(tx.timestamp).toISOString()}`);
    });
    
    // 6. Check threat events
    const threatEvents = await redis.lRange('threat_events', 0, -1);
    const addressThreats = threatEvents
      .map(event => JSON.parse(event))
      .filter(event => event.details && event.details.includes && event.details.includes(address));
    
    console.log(`🛡️  Threat Events: ${addressThreats.length}`);
    
  } catch (error) {
    console.error(`❌ Error debugging ${address}:`, error);
  }
}

async function checkRateLimitingConfig() {
  console.log('\n⚙️  Rate Limiting Configuration');
  console.log('═'.repeat(50));
  
  // Check if there are any rate limit records at all
  const allRateLimitKeys = await redis.keys('ratelimit:*');
  console.log(`📊 Total rate limit records: ${allRateLimitKeys.length}`);
  
  if (allRateLimitKeys.length > 0) {
    console.log('Recent rate limit keys:');
    for (let i = 0; i < Math.min(5, allRateLimitKeys.length); i++) {
      const key = allRateLimitKeys[i];
      const record = await redis.get(key);
      if (record) {
        const data = JSON.parse(record);
        console.log(`   ${key}: count=${data.count}, violations=${data.violations || 0}`);
      }
    }
  }
  
  // Check progressive penalty configuration
  console.log('\n📋 Progressive Penalty Configuration:');
  console.log('   1st violation: 1 minute');
  console.log('   2nd violation: 5 minutes');
  console.log('   3rd violation: 15 minutes');
  console.log('   4th+ violations: 1 hour');
  console.log('   Violation reset: 24 hours');
}

async function simulateRateLimit(address) {
  console.log(`\n🧪 Simulating Rate Limit for: ${address}`);
  console.log('═'.repeat(60));
  
  const key = `ratelimit:sender:${address}`;
  const now = Date.now();
  
  // Create a test record with violations
  const testRecord = {
    count: 15, // Exceeds typical limit of 10
    resetTime: now + (60 * 60 * 1000), // 1 hour from now
    violations: 2, // Second violation
    lastViolationTime: now - (30 * 1000) // 30 seconds ago
  };
  
  await redis.setEx(key, 3600, JSON.stringify(testRecord));
  console.log('✅ Created test rate limit record');
  
  // Check progressive penalty
  const penalties = [1, 5, 15, 60]; // minutes
  const penaltyIndex = Math.min(testRecord.violations - 1, penalties.length - 1);
  const penaltyMinutes = penalties[penaltyIndex];
  const penaltyDuration = penaltyMinutes * 60 * 1000;
  const penaltyEndTime = testRecord.lastViolationTime + penaltyDuration;
  const inPenalty = now < penaltyEndTime;
  
  console.log(`📊 Test Record:`);
  console.log(`   Count: ${testRecord.count}`);
  console.log(`   Violations: ${testRecord.violations}`);
  console.log(`   Progressive Penalty: ${penaltyMinutes} minutes`);
  console.log(`   Penalty Active: ${inPenalty ? '✅ YES' : '❌ NO'}`);
  
  if (inPenalty) {
    const remainingMs = penaltyEndTime - now;
    const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
    console.log(`   Remaining: ${remainingMinutes} minutes`);
  }
  
  // Clean up test record
  await redis.del(key);
  console.log('🧹 Cleaned up test record');
}

async function main() {
  console.log('🔍 Debugging Attacking Addresses');
  console.log('═'.repeat(80));
  
  const connected = await connectRedis();
  if (!connected) {
    console.log('\n❌ Cannot debug without Redis connection');
    process.exit(1);
  }
  
  // Debug each attacking address
  for (const address of attackingAddresses) {
    await debugAttacker(address);
  }
  
  // Check overall rate limiting configuration
  await checkRateLimitingConfig();
  
  // Simulate rate limiting for testing
  await simulateRateLimit('TestAddress123');
  
  console.log('\n🎯 Summary:');
  console.log('1. Check if attackers are properly blacklisted');
  console.log('2. Verify rate limiting records exist');
  console.log('3. Confirm progressive penalties are being applied');
  console.log('4. Look for any gaps in the security system');
  
  await redis.disconnect();
}

main().catch(console.error);
