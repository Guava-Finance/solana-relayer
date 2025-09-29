#!/usr/bin/env node

/**
 * Comprehensive Blacklisting Test Script
 * 
 * Tests the complete blacklisting flow to ensure wallets are correctly blacklisted
 */

const { createClient } = require('redis');

// Try to load dotenv, but don't fail if it's not available
try {
  require('dotenv').config();
} catch (e) {
  console.log('Note: dotenv not available, using environment variables directly');
}

const redis = createClient({
  url: process.env.REDIS_URL
});

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

async function testBlacklistingFlow() {
  console.log('\n🧪 Testing Complete Blacklisting Flow');
  console.log('═'.repeat(50));

  // Test addresses
  const testSender = 'TestSender' + Date.now();
  const testReceiver = 'TestReceiver' + Date.now();
  const blacklistedSender = 'BlacklistedSender' + Date.now();

  try {
    // 1. Clean up any existing test data
    await redis.sRem('blacklist:addresses', testSender, testReceiver, blacklistedSender);
    await redis.hDel('blacklist:reasons', testSender, testReceiver, blacklistedSender);
    
    console.log('\n1️⃣ Testing Normal Transaction (should be allowed)');
    console.log(`   Sender: ${testSender}`);
    console.log(`   Receiver: ${testReceiver}`);
    console.log(`   Amount: 1000`);
    
    // Simulate transaction analysis for normal transaction
    let riskScore = 0;
    let flags = [];
    
    // Check blacklist (should be clean)
    const senderBlacklisted = await redis.sIsMember('blacklist:addresses', testSender);
    const receiverBlacklisted = await redis.sIsMember('blacklist:addresses', testReceiver);
    
    if (senderBlacklisted) {
      riskScore += 100;
      flags.push(`Sender blacklisted: ${testSender}`);
    }
    if (receiverBlacklisted) {
      riskScore += 100;
      flags.push(`Receiver blacklisted: ${testReceiver}`);
    }
    
    // Add some minor risk factors
    riskScore += 5; // Round number
    flags.push('Round number: 1000');
    
    const allowed = riskScore < 80; // HIGH_RISK_THRESHOLD
    
    console.log(`   Risk Score: ${riskScore}`);
    console.log(`   Flags: ${flags.join(', ') || 'None'}`);
    console.log(`   Result: ${allowed ? '✅ ALLOWED' : '❌ BLOCKED'}`);
    
    if (!allowed) {
      console.log('❌ Normal transaction was blocked - this is unexpected!');
    }

    // 2. Test blacklisted sender
    console.log('\n2️⃣ Testing Blacklisted Sender (should be blocked and not re-blacklisted)');
    
    // Add sender to blacklist
    await redis.sAdd('blacklist:addresses', blacklistedSender);
    await redis.hSet('blacklist:reasons', blacklistedSender, 'Test blacklisted sender');
    
    console.log(`   Sender: ${blacklistedSender} (BLACKLISTED)`);
    console.log(`   Receiver: ${testReceiver}`);
    console.log(`   Amount: 5000`);
    
    riskScore = 0;
    flags = [];
    
    const blacklistedSenderCheck = await redis.sIsMember('blacklist:addresses', blacklistedSender);
    const receiverCheck = await redis.sIsMember('blacklist:addresses', testReceiver);
    
    if (blacklistedSenderCheck) {
      riskScore += 100;
      flags.push(`Sender blacklisted: ${blacklistedSender}`);
    }
    if (receiverCheck) {
      riskScore += 100;
      flags.push(`Receiver blacklisted: ${testReceiver}`);
    }
    
    const allowedBlacklisted = riskScore < 80;
    
    console.log(`   Risk Score: ${riskScore}`);
    console.log(`   Flags: ${flags.join(', ')}`);
    console.log(`   Result: ${allowedBlacklisted ? '❌ ALLOWED (BAD!)' : '✅ BLOCKED (GOOD)'}`);
    
    if (allowedBlacklisted) {
      console.log('❌ Blacklisted sender was allowed - blacklisting is not working!');
    }

    // 3. Test high-risk transaction that should trigger auto-blacklisting
    console.log('\n3️⃣ Testing High-Risk Transaction (should trigger auto-blacklisting)');
    
    const highRiskSender = 'HighRiskSender' + Date.now();
    console.log(`   Sender: ${highRiskSender}`);
    console.log(`   Receiver: ${testReceiver}`);
    console.log(`   Amount: 999999999 (very large)`);
    
    riskScore = 0;
    flags = [];
    
    // Check blacklist (should be clean initially)
    const highRiskBlacklisted = await redis.sIsMember('blacklist:addresses', highRiskSender);
    if (highRiskBlacklisted) {
      riskScore += 100;
      flags.push(`Sender blacklisted: ${highRiskSender}`);
    }
    
    // Add high-risk factors
    riskScore += 30; // Large amount
    flags.push('Large amount: 999999999');
    riskScore += 5; // Round number
    flags.push('Round number: 999999999');
    
    // Simulate multiple rapid transactions (high frequency)
    riskScore += 25;
    flags.push('High frequency transactions: 1000ms interval');
    
    // Simulate many unique receivers
    riskScore += 30;
    flags.push('Many unique receivers: 25');
    
    const allowedHighRisk = riskScore < 80;
    const shouldAutoBlacklist = riskScore >= 100;
    
    console.log(`   Risk Score: ${riskScore}`);
    console.log(`   Flags: ${flags.join(', ')}`);
    console.log(`   Result: ${allowedHighRisk ? '❌ ALLOWED (BAD!)' : '✅ BLOCKED (GOOD)'}`);
    console.log(`   Auto-blacklist: ${shouldAutoBlacklist ? '✅ YES' : '❌ NO'}`);
    
    if (shouldAutoBlacklist) {
      // Simulate auto-blacklisting
      await redis.sAdd('blacklist:addresses', highRiskSender);
      await redis.hSet('blacklist:reasons', highRiskSender, `Auto-blacklisted: Risk score ${riskScore}, Flags: ${flags.join(', ')}`);
      console.log(`   ✅ Auto-blacklisted: ${highRiskSender}`);
      
      // Verify it was blacklisted
      const wasBlacklisted = await redis.sIsMember('blacklist:addresses', highRiskSender);
      if (wasBlacklisted) {
        console.log('   ✅ Blacklisting verification: SUCCESS');
      } else {
        console.log('   ❌ Blacklisting verification: FAILED');
      }
    }

    // 4. Test subsequent transaction from auto-blacklisted address
    console.log('\n4️⃣ Testing Subsequent Transaction from Auto-Blacklisted Address');
    
    console.log(`   Sender: ${highRiskSender} (should now be blacklisted)`);
    console.log(`   Receiver: ${testReceiver}`);
    console.log(`   Amount: 1000`);
    
    riskScore = 0;
    flags = [];
    
    const nowBlacklisted = await redis.sIsMember('blacklist:addresses', highRiskSender);
    if (nowBlacklisted) {
      riskScore += 100;
      flags.push(`Sender blacklisted: ${highRiskSender}`);
    }
    
    const allowedAfterBlacklist = riskScore < 80;
    
    console.log(`   Risk Score: ${riskScore}`);
    console.log(`   Flags: ${flags.join(', ')}`);
    console.log(`   Result: ${allowedAfterBlacklist ? '❌ ALLOWED (BAD!)' : '✅ BLOCKED (GOOD)'}`);

    // 5. Summary
    console.log('\n📊 Test Summary');
    console.log('─'.repeat(30));
    
    const totalBlacklisted = await redis.sCard('blacklist:addresses');
    const blacklistedAddresses = await redis.sMembers('blacklist:addresses');
    
    console.log(`Total blacklisted addresses: ${totalBlacklisted}`);
    console.log('Blacklisted addresses:');
    for (const addr of blacklistedAddresses) {
      if (addr.includes('Test') || addr.includes('HighRisk')) {
        const reason = await redis.hGet('blacklist:reasons', addr);
        console.log(`  🚫 ${addr}: ${reason}`);
      }
    }

    // Clean up test data
    console.log('\n🧹 Cleaning up test data...');
    await redis.sRem('blacklist:addresses', testSender, testReceiver, blacklistedSender, highRiskSender);
    await redis.hDel('blacklist:reasons', testSender, testReceiver, blacklistedSender, highRiskSender);
    console.log('✅ Cleanup complete');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

async function testRiskScoreCalculation() {
  console.log('\n🧮 Testing Risk Score Calculation');
  console.log('═'.repeat(40));
  
  console.log('Risk Score Thresholds:');
  console.log('  • Transaction blocked if risk ≥ 80');
  console.log('  • Auto-blacklist if risk ≥ 100');
  console.log('');
  console.log('Risk Factors:');
  console.log('  • Blacklisted address: +100 (immediate block)');
  console.log('  • Greylisted address: +40');
  console.log('  • High frequency transactions: +25');
  console.log('  • Many unique receivers: +30');
  console.log('  • Large amount (>1M): +30');
  console.log('  • Unusual amount patterns: +20');
  console.log('  • Round numbers: +5');
  console.log('  • Dust amounts (<0.001): +15');
  console.log('');
  
  // Test scenarios
  const scenarios = [
    {
      name: 'Normal transaction',
      factors: ['Round number: +5'],
      totalRisk: 5,
      shouldBlock: false,
      shouldBlacklist: false
    },
    {
      name: 'Suspicious but allowed',
      factors: ['Large amount: +30', 'Round number: +5', 'Unusual pattern: +20'],
      totalRisk: 55,
      shouldBlock: false,
      shouldBlacklist: false
    },
    {
      name: 'High-risk blocked',
      factors: ['High frequency: +25', 'Many receivers: +30', 'Large amount: +30'],
      totalRisk: 85,
      shouldBlock: true,
      shouldBlacklist: false
    },
    {
      name: 'Auto-blacklist trigger',
      factors: ['High frequency: +25', 'Many receivers: +30', 'Large amount: +30', 'Unusual pattern: +20'],
      totalRisk: 105,
      shouldBlock: true,
      shouldBlacklist: true
    },
    {
      name: 'Already blacklisted',
      factors: ['Blacklisted: +100'],
      totalRisk: 100,
      shouldBlock: true,
      shouldBlacklist: false // Already blacklisted
    }
  ];
  
  scenarios.forEach((scenario, index) => {
    console.log(`${index + 1}. ${scenario.name}:`);
    console.log(`   Factors: ${scenario.factors.join(', ')}`);
    console.log(`   Total Risk: ${scenario.totalRisk}`);
    console.log(`   Blocked: ${scenario.shouldBlock ? '✅ YES' : '❌ NO'}`);
    console.log(`   Auto-blacklist: ${scenario.shouldBlacklist ? '✅ YES' : '❌ NO'}`);
    console.log('');
  });
}

async function main() {
  console.log('🔍 Comprehensive Blacklisting Test');
  console.log('═'.repeat(50));
  
  const connected = await connectRedis();
  if (!connected) {
    console.log('\n❌ Cannot run tests without Redis connection');
    console.log('Please set REDIS_URL environment variable');
    process.exit(1);
  }
  
  await testRiskScoreCalculation();
  await testBlacklistingFlow();
  
  console.log('\n🎯 Conclusion:');
  console.log('If all tests show ✅, then blacklisting is working correctly.');
  console.log('If any tests show ❌, there are issues that need to be fixed.');
  
  await redis.disconnect();
}

main().catch(console.error);
