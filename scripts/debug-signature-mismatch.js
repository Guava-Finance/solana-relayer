#!/usr/bin/env node

/**
 * Debug script to help identify signature generation mismatches
 * between Flutter app and Node.js relayer
 */

const crypto = require('crypto');

/**
 * Generate request signature (Node.js version)
 */
function generateRequestSignature(method, path, body, timestamp, nonce, secretKey) {
  const payload = `${method}|${path}|${body}|${timestamp}|${nonce}`;
  console.log(`[Node.js] Payload: ${payload}`);
  console.log(`[Node.js] Secret key: ${secretKey}`);
  
  const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
  console.log(`[Node.js] Generated signature: ${signature}`);
  
  return signature;
}

/**
 * Test signature generation with sample data from the logs
 */
function testSignatureGeneration() {
  console.log('🔍 Debugging Signature Generation Mismatch');
  console.log('==========================================\n');
  
  // Sample data from the failing request logs
  const testData = {
    method: 'POST',
    path: '/api/tx',
    body: '{"test":"sample body"}', // We need the actual body from the request
    timestamp: 1759144856337,
    nonce: 'Q5cBLCo5HxvqZHx0OU6nRg==',
    receivedSignature: '924d4b59725256e4fa0eee6e6acf86aecb6a88c5fff6e147e2363f24d40464ee',
    secretKey: process.env.REQUEST_SIGNING_SECRET || 'default-secret'
  };
  
  console.log('Test Data:');
  console.log(`  Method: ${testData.method}`);
  console.log(`  Path: ${testData.path}`);
  console.log(`  Body: ${testData.body}`);
  console.log(`  Timestamp: ${testData.timestamp}`);
  console.log(`  Nonce: ${testData.nonce}`);
  console.log(`  Received Signature: ${testData.receivedSignature}`);
  console.log(`  Secret Key Length: ${testData.secretKey.length}\n`);
  
  // Generate expected signature
  const expectedSignature = generateRequestSignature(
    testData.method,
    testData.path,
    testData.body,
    testData.timestamp,
    testData.nonce,
    testData.secretKey
  );
  
  console.log('\nComparison:');
  console.log(`  Expected:  ${expectedSignature}`);
  console.log(`  Received:  ${testData.receivedSignature}`);
  console.log(`  Match:     ${expectedSignature === testData.receivedSignature ? '✅ YES' : '❌ NO'}\n`);
  
  if (expectedSignature !== testData.receivedSignature) {
    console.log('🔧 Troubleshooting Steps:');
    console.log('1. Check if REQUEST_SIGNING_SECRET matches between Flutter and Node.js');
    console.log('2. Verify the request body JSON serialization is identical');
    console.log('3. Ensure the URL path is exactly the same');
    console.log('4. Check for any encoding differences (UTF-8)');
    console.log('5. Verify timestamp and nonce are identical');
  }
}

/**
 * Test different body serialization formats
 */
function testBodySerialization() {
  console.log('📝 Testing Body Serialization Formats');
  console.log('=====================================\n');
  
  const sampleBody = {
    senderAddress: 'RtsKQm3gAGL1Tayhs7ojWE9qytWqVh4G7eJTaNJs7vX',
    receiverAddress: 'GrDMoeqMLFjeXQ24H56S1RLgT4R76jsuWCd6SvXyGPQ5',
    tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: 1000000
  };
  
  const serializations = [
    {
      name: 'JSON.stringify (default)',
      value: JSON.stringify(sampleBody)
    },
    {
      name: 'JSON.stringify with no spaces',
      value: JSON.stringify(sampleBody, null, 0)
    },
    {
      name: 'JSON.stringify with sorted keys',
      value: JSON.stringify(sampleBody, Object.keys(sampleBody).sort())
    }
  ];
  
  const testParams = {
    method: 'POST',
    path: '/api/tx',
    timestamp: 1759144856337,
    nonce: 'Q5cBLCo5HxvqZHx0OU6nRg==',
    secretKey: 'test-secret-key'
  };
  
  serializations.forEach((serialization, index) => {
    console.log(`${index + 1}. ${serialization.name}:`);
    console.log(`   Body: ${serialization.value}`);
    
    const signature = generateRequestSignature(
      testParams.method,
      testParams.path,
      serialization.value,
      testParams.timestamp,
      testParams.nonce,
      testParams.secretKey
    );
    
    console.log(`   Signature: ${signature}\n`);
  });
}

/**
 * Test with different secret keys
 */
function testSecretKeys() {
  console.log('🔑 Testing Different Secret Key Scenarios');
  console.log('========================================\n');
  
  const testParams = {
    method: 'POST',
    path: '/api/tx',
    body: '{"test":"data"}',
    timestamp: 1759144856337,
    nonce: 'Q5cBLCo5HxvqZHx0OU6nRg=='
  };
  
  const secretKeys = [
    'default-secret',
    'your-request-signing-secret-key',
    'your-super-secret-signing-key-here',
    process.env.REQUEST_SIGNING_SECRET || 'env-not-set'
  ];
  
  secretKeys.forEach((secretKey, index) => {
    console.log(`${index + 1}. Secret Key: "${secretKey}"`);
    
    const signature = generateRequestSignature(
      testParams.method,
      testParams.path,
      testParams.body,
      testParams.timestamp,
      testParams.nonce,
      secretKey
    );
    
    console.log(`   Signature: ${signature}\n`);
  });
}

/**
 * Main debug runner
 */
function runDebug() {
  console.log('🐛 Signature Generation Debug Suite');
  console.log('===================================\n');
  
  testSignatureGeneration();
  testBodySerialization();
  testSecretKeys();
  
  console.log('💡 Next Steps:');
  console.log('1. Compare the generated signatures with what the Flutter app produces');
  console.log('2. Check the actual request body from the logs');
  console.log('3. Verify the REQUEST_SIGNING_SECRET environment variable');
  console.log('4. Test with the exact parameters from the failing request');
}

// Run debug if this script is executed directly
if (require.main === module) {
  runDebug();
}

module.exports = {
  generateRequestSignature,
  testSignatureGeneration,
  testBodySerialization,
  testSecretKeys
};
