#!/usr/bin/env node

/**
 * Security Features Test Script
 * 
 * Tests all security components to ensure they're working properly
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
    console.log('✅ Redis connection successful');
    return true;
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    return false;
  }
}

async function testRateLimiting() {
  console.log('\n🔄 Testing Rate Limiting...');
  
  try {
    // Check if rate limiting keys exist
    const keys = await redis.keys('ratelimit:*');
    console.log(`📊 Found ${keys.length} rate limiting entries`);
    
    if (keys.length > 0) {
      console.log('✅ Rate limiting is active');
      // Show a few examples
      for (let i = 0; i < Math.min(3, keys.length); i++) {
        const data = await redis.get(keys[i]);
        const parsed = JSON.parse(data);
        console.log(`   ${keys[i]}: ${parsed.count} requests, next reset: ${new Date(parsed.resetTime)}`);
      }
    } else {
      console.log('⚠️  No rate limiting data found (may be normal if no recent requests)');
    }
  } catch (error) {
    console.error('❌ Rate limiting test failed:', error.message);
  }
}

async function testBlacklisting() {
  console.log('\n🚫 Testing Blacklisting...');
  
  try {
    const blacklistCount = await redis.sCard('blacklist:addresses');
    const greylistCount = await redis.sCard('greylist:addresses');
    
    console.log(`📊 Blacklisted addresses: ${blacklistCount}`);
    console.log(`📊 Greylisted addresses: ${greylistCount}`);
    
    if (blacklistCount > 0) {
      console.log('✅ Blacklisting system has data');
      const addresses = await redis.sMembers('blacklist:addresses');
      console.log(`   Sample blacklisted addresses: ${addresses.slice(0, 3).join(', ')}`);
    } else {
      console.log('⚠️  No blacklisted addresses (may be normal)');
    }
    
    // Test adding and removing a test address
    const testAddress = 'TEST_ADDRESS_' + Date.now();
    await redis.sAdd('blacklist:addresses', testAddress);
    await redis.hSet('blacklist:reasons', testAddress, 'Test entry');
    
    const isBlacklisted = await redis.sIsMember('blacklist:addresses', testAddress);
    if (isBlacklisted) {
      console.log('✅ Blacklist add/check functionality working');
    } else {
      console.log('❌ Blacklist add/check functionality failed');
    }
    
    // Clean up test entry
    await redis.sRem('blacklist:addresses', testAddress);
    await redis.hDel('blacklist:reasons', testAddress);
    
  } catch (error) {
    console.error('❌ Blacklisting test failed:', error.message);
  }
}

async function testTransactionMonitoring() {
  console.log('\n📊 Testing Transaction Monitoring...');
  
  try {
    const suspiciousCount = await redis.lLen('suspicious_transactions');
    const senderPatterns = await redis.keys('sender_pattern:*');
    const receiverPatterns = await redis.keys('receiver_pattern:*');
    
    console.log(`📊 Suspicious transactions logged: ${suspiciousCount}`);
    console.log(`📊 Sender patterns tracked: ${senderPatterns.length}`);
    console.log(`📊 Receiver patterns tracked: ${receiverPatterns.length}`);
    
    if (suspiciousCount > 0) {
      console.log('✅ Transaction monitoring is logging suspicious activity');
      const recent = await redis.lRange('suspicious_transactions', 0, 2);
      recent.forEach((tx, index) => {
        const data = JSON.parse(tx);
        console.log(`   ${index + 1}. ${data.sender} -> ${data.receiver} (Risk: ${data.riskScore})`);
      });
    } else {
      console.log('⚠️  No suspicious transactions logged (may be normal)');
    }
    
    if (senderPatterns.length > 0 || receiverPatterns.length > 0) {
      console.log('✅ Transaction pattern analysis is active');
    } else {
      console.log('⚠️  No transaction patterns tracked (may be normal if no recent transactions)');
    }
    
  } catch (error) {
    console.error('❌ Transaction monitoring test failed:', error.message);
  }
}

async function testThreatDetection() {
  console.log('\n🛡️  Testing Threat Detection...');
  
  try {
    const threatEvents = await redis.lLen('threat_events');
    const blockedIPs = await redis.keys('blocked:*');
    const ipPatterns = await redis.keys('ip_pattern:*');
    const timingPatterns = await redis.keys('timing:*');
    
    console.log(`📊 Threat events logged: ${threatEvents}`);
    console.log(`📊 Blocked IPs: ${blockedIPs.length}`);
    console.log(`📊 IP patterns tracked: ${ipPatterns.length}`);
    console.log(`📊 Timing patterns tracked: ${timingPatterns.length}`);
    
    if (threatEvents > 0) {
      console.log('✅ Threat detection is logging events');
      const recent = await redis.lRange('threat_events', 0, 2);
      recent.forEach((event, index) => {
        const data = JSON.parse(event);
        console.log(`   ${index + 1}. IP: ${data.ip}, Score: ${data.score}, Reasons: ${data.reasons.length}`);
      });
    } else {
      console.log('⚠️  No threat events logged (may be normal)');
    }
    
    if (blockedIPs.length > 0) {
      console.log('✅ IP blocking is active');
      console.log(`   Blocked IPs: ${blockedIPs.map(key => key.replace('blocked:', '')).join(', ')}`);
    } else {
      console.log('⚠️  No IPs currently blocked (may be normal)');
    }
    
  } catch (error) {
    console.error('❌ Threat detection test failed:', error.message);
  }
}

async function testEnvironmentVariables() {
  console.log('\n🔧 Testing Environment Variables...');
  
  const requiredVars = [
    'REDIS_URL',
    'AES_ENCRYPTION_KEY',
    'AES_ENCRYPTION_IV'
  ];
  
  const optionalVars = [
    'REQUEST_SIGNING_SECRET',
    'ENABLE_REQUEST_SIGNING',
    'ENABLE_THREAT_DETECTION',
    'ENABLE_TRANSACTION_MONITORING'
  ];
  
  console.log('Required variables:');
  requiredVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✅ ${varName}: Set`);
    } else {
      console.log(`❌ ${varName}: Missing`);
    }
  });
  
  console.log('\nOptional variables:');
  optionalVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✅ ${varName}: ${process.env[varName]}`);
    } else {
      console.log(`⚠️  ${varName}: Not set (using defaults)`);
    }
  });
}

async function generateTestReport() {
  console.log('\n📋 Security Test Report');
  console.log('═'.repeat(50));
  
  const redisConnected = await connectRedis();
  
  if (!redisConnected) {
    console.log('❌ Cannot run tests without Redis connection');
    process.exit(1);
  }
  
  await testEnvironmentVariables();
  await testRateLimiting();
  await testBlacklisting();
  await testTransactionMonitoring();
  await testThreatDetection();
  
  console.log('\n🎯 Recommendations:');
  console.log('1. If no data is shown, make some API requests to populate the security systems');
  console.log('2. Check server logs for security-related messages');
  console.log('3. Use the manage-blacklist.js script to test blacklisting manually');
  console.log('4. Monitor Redis memory usage with: redis-cli info memory');
  
  await redis.disconnect();
}

generateTestReport().catch(console.error);
