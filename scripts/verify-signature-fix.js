#!/usr/bin/env node

/**
 * Verification script to test signature generation with the actual failing request data
 */

const crypto = require('crypto');

/**
 * Generate request signature (matching the relayer implementation)
 */
function generateRequestSignature(method, path, body, timestamp, nonce, secretKey) {
  const payload = `${method}|${path}|${body}|${timestamp}|${nonce}`;
  return crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
}

/**
 * Test with the exact failing request data from logs
 */
function testFailingRequest() {
  console.log('🔍 Testing Exact Failing Request Data');
  console.log('====================================\n');
  
  // Exact data from the failing request logs
  const requestData = {
    method: 'POST',
    path: '/api/tx',
    timestamp: 1759144856337,
    nonce: 'Q5cBLCo5HxvqZHx0OU6nRg==',
    receivedSignature: '924d4b59725256e4fa0eee6e6acf86aecb6a88c5fff6e147e2363f24d40464ee',
    // We need to reconstruct the body - this is likely the transaction data
    body: JSON.stringify({
      senderAddress: 'RtsKQm3gAGL1Tayhs7ojWE9qytWqVh4G7eJTaNJs7vX',
      receiverAddress: 'some-receiver-address',
      tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: 1000000,
      narration: 'Powered by Guava'
    })
  };
  
  console.log('Request Data:');
  console.log(`  Method: ${requestData.method}`);
  console.log(`  Path: ${requestData.path}`);
  console.log(`  Timestamp: ${requestData.timestamp}`);
  console.log(`  Nonce: ${requestData.nonce}`);
  console.log(`  Received Signature: ${requestData.receivedSignature}`);
  console.log(`  Body: ${requestData.body}\n`);
  
  // Test with different possible secret keys
  const possibleSecrets = [
    'default-secret',
    process.env.REQUEST_SIGNING_SECRET || 'env-not-set',
    'your-request-signing-secret-key',
    'your-super-secret-signing-key-here'
  ];
  
  console.log('Testing with different secret keys:\n');
  
  possibleSecrets.forEach((secret, index) => {
    const expectedSignature = generateRequestSignature(
      requestData.method,
      requestData.path,
      requestData.body,
      requestData.timestamp,
      requestData.nonce,
      secret
    );
    
    const matches = expectedSignature === requestData.receivedSignature;
    
    console.log(`${index + 1}. Secret: "${secret}"`);
    console.log(`   Expected:  ${expectedSignature}`);
    console.log(`   Received:  ${requestData.receivedSignature}`);
    console.log(`   Match:     ${matches ? '✅ YES' : '❌ NO'}\n`);
    
    if (matches) {
      console.log(`🎉 FOUND MATCHING SECRET: "${secret}"`);
      console.log('This is the secret key the Flutter app is using.\n');
    }
  });
}

/**
 * Generate the correct signature for the Flutter app to use
 */
function generateCorrectSignature() {
  console.log('🔧 Generate Correct Signature for Testing');
  console.log('=========================================\n');
  
  const testData = {
    method: 'POST',
    path: '/api/tx',
    body: JSON.stringify({
      senderAddress: 'RtsKQm3gAGL1Tayhs7ojWE9qytWqVh4G7eJTaNJs7vX',
      receiverAddress: 'GrDMoeqMLFjeXQ24H56S1RLgT4R76jsuWCd6SvXyGPQ5',
      tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: 1000000,
      narration: 'Powered by Guava'
    }),
    timestamp: Date.now(),
    nonce: 'test-nonce-12345',
    secretKey: process.env.REQUEST_SIGNING_SECRET || 'default-secret'
  };
  
  const signature = generateRequestSignature(
    testData.method,
    testData.path,
    testData.body,
    testData.timestamp,
    testData.nonce,
    testData.secretKey
  );
  
  console.log('Test Request Data:');
  console.log(`  Method: ${testData.method}`);
  console.log(`  Path: ${testData.path}`);
  console.log(`  Body: ${testData.body}`);
  console.log(`  Timestamp: ${testData.timestamp}`);
  console.log(`  Nonce: ${testData.nonce}`);
  console.log(`  Secret: ${testData.secretKey}`);
  console.log(`  Generated Signature: ${signature}\n`);
  
  console.log('Use this data to test the Flutter app signature generation.');
}

/**
 * Main verification runner
 */
function runVerification() {
  console.log('🧪 Signature Verification Suite');
  console.log('===============================\n');
  
  const secretKey = process.env.REQUEST_SIGNING_SECRET;
  if (secretKey) {
    console.log(`✅ REQUEST_SIGNING_SECRET is set (length: ${secretKey.length})`);
  } else {
    console.log('⚠️  REQUEST_SIGNING_SECRET is not set, using default');
  }
  console.log('');
  
  testFailingRequest();
  generateCorrectSignature();
  
  console.log('💡 Next Steps:');
  console.log('1. If a matching secret was found, set it in Vercel environment');
  console.log('2. If no match, check the Flutter app\'s actual secret key');
  console.log('3. Ensure both Flutter and relayer use the same secret');
  console.log('4. Test with a new transaction after fixing the environment');
}

// Run verification if this script is executed directly
if (require.main === module) {
  runVerification();
}

module.exports = {
  generateRequestSignature,
  testFailingRequest,
  generateCorrectSignature
};
