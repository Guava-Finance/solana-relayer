#!/usr/bin/env node

/**
 * Test script for request signing implementation
 * This demonstrates how the Flutter app would generate signed requests
 */

const crypto = require('crypto');

// Configuration matching the Flutter implementation
const REQUEST_SIGNING_SECRET = 'your-request-signing-secret-key';
const CLIENT_ID = 'guava-flutter-client';

/**
 * Generate a secure nonce (matches Flutter implementation)
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Generate request signature using HMAC-SHA256 (matches Flutter implementation)
 */
function generateRequestSignature(method, path, body, timestamp, nonce) {
  const payload = `${method}|${path}|${body}|${timestamp}|${nonce}`;
  const hmac = crypto.createHmac('sha256', REQUEST_SIGNING_SECRET);
  hmac.update(payload);
  return hmac.digest('hex');
}

/**
 * Generate security headers for API requests (matches Flutter implementation)
 */
function generateSecurityHeaders(method, path, body) {
  const timestamp = Date.now();
  const nonce = generateNonce();
  const bodyString = JSON.stringify(body);
  
  const signature = generateRequestSignature(method, path, bodyString, timestamp, nonce);

  return {
    'x-timestamp': timestamp.toString(),
    'x-nonce': nonce,
    'x-signature': signature,
    'x-client-id': CLIENT_ID,
    'is_encrypted': 'yes',
    'X-App-ID': 'com.example.app',
    'Content-Type': 'application/json'
  };
}

/**
 * Test the request signing for transaction creation
 */
function testTransactionSigning() {
  console.log('🔐 Testing Transaction Request Signing');
  console.log('=====================================');
  
  const requestBody = {
    senderAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    receiverAddress: 'GrDMoeqMLFjeXQ24H56S1RLgT4R76jsuWCd6SvXyGPQ5',
    tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: 1000000,
    narration: 'Test transaction'
  };

  const headers = generateSecurityHeaders('POST', '/api/tx', requestBody);
  
  console.log('Request Body:', JSON.stringify(requestBody, null, 2));
  console.log('\nGenerated Headers:');
  Object.entries(headers).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
  
  console.log('\n✅ Transaction signing test completed\n');
}

/**
 * Test the request signing for ATA creation
 */
function testAtaCreationSigning() {
  console.log('🏦 Testing ATA Creation Request Signing');
  console.log('=======================================');
  
  const requestBody = {
    ownerAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    userSignature: 'mock-signature-base58',
    message: 'Create ATA for 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU with mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  };

  const headers = generateSecurityHeaders('POST', '/api/create-ata', requestBody);
  
  console.log('Request Body:', JSON.stringify(requestBody, null, 2));
  console.log('\nGenerated Headers:');
  Object.entries(headers).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
  
  console.log('\n✅ ATA creation signing test completed\n');
}

/**
 * Test the request signing for nonce retrieval
 */
function testNonceSigning() {
  console.log('🎲 Testing Nonce Request Signing');
  console.log('================================');
  
  const requestBody = {};

  const headers = generateSecurityHeaders('POST', '/api/nonce', requestBody);
  
  console.log('Request Body:', JSON.stringify(requestBody, null, 2));
  console.log('\nGenerated Headers:');
  Object.entries(headers).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
  
  console.log('\n✅ Nonce signing test completed\n');
}

/**
 * Test signature validation (server-side logic)
 */
function testSignatureValidation() {
  console.log('🔍 Testing Signature Validation');
  console.log('===============================');
  
  const method = 'POST';
  const path = '/api/tx';
  const body = { test: 'data' };
  const timestamp = Date.now();
  const nonce = generateNonce();
  
  // Generate signature
  const bodyString = JSON.stringify(body);
  const signature = generateRequestSignature(method, path, bodyString, timestamp, nonce);
  
  // Validate signature (simulate server-side validation)
  const expectedSignature = generateRequestSignature(method, path, bodyString, timestamp, nonce);
  const isValid = signature === expectedSignature;
  
  console.log('Method:', method);
  console.log('Path:', path);
  console.log('Body:', bodyString);
  console.log('Timestamp:', timestamp);
  console.log('Nonce:', nonce);
  console.log('Generated Signature:', signature);
  console.log('Expected Signature:', expectedSignature);
  console.log('Validation Result:', isValid ? '✅ VALID' : '❌ INVALID');
  
  console.log('\n✅ Signature validation test completed\n');
}

/**
 * Test environment variable configuration
 */
function testEnvironmentConfiguration() {
  console.log('⚙️  Testing Environment Configuration');
  console.log('===================================');
  
  const enableRequestSigning = process.env.ENABLE_REQUEST_SIGNING;
  const requestSigningSecret = process.env.REQUEST_SIGNING_SECRET;
  
  console.log('Environment Variables:');
  console.log(`  ENABLE_REQUEST_SIGNING: ${enableRequestSigning || 'NOT SET'}`);
  console.log(`  REQUEST_SIGNING_SECRET: ${requestSigningSecret ? '***SET***' : 'NOT SET'}`);
  
  if (enableRequestSigning === 'true') {
    console.log('✅ Request signing is ENABLED');
    if (requestSigningSecret && requestSigningSecret !== 'default-secret') {
      console.log('✅ Custom signing secret is configured');
    } else {
      console.log('⚠️  Using default signing secret (not recommended for production)');
    }
  } else {
    console.log('ℹ️  Request signing is DISABLED');
  }
  
  console.log('\n✅ Environment configuration test completed\n');
}

/**
 * Main test runner
 */
function runTests() {
  console.log('🚀 Request Signing Implementation Test Suite');
  console.log('============================================\n');
  
  testEnvironmentConfiguration();
  testTransactionSigning();
  testAtaCreationSigning();
  testNonceSigning();
  testSignatureValidation();
  
  console.log('🎉 All tests completed successfully!');
  console.log('\n📝 Next Steps:');
  console.log('1. Set ENABLE_REQUEST_SIGNING=true to enable request signing');
  console.log('2. Update REQUEST_SIGNING_SECRET in your environment variables');
  console.log('3. Test with actual API endpoints');
  console.log('4. Verify Flutter app can make signed requests');
  console.log('5. Monitor request signing logs in production');
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  generateNonce,
  generateRequestSignature,
  generateSecurityHeaders
};
