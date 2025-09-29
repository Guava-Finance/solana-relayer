#!/usr/bin/env node

/**
 * Try to find the exact secret key Flutter is using by brute force testing
 */

const crypto = require('crypto');

// Known values from logs
const testData = {
  "senderAddress": "t9RZDKfHYeJpLSCAKMiYNeJUASCtqZYck+DV4dwUWN47aN+Y3ar2t5TGcAHRWaTN",
  "receiverAddress": "OHtBhNNlPVPCdLk0HNJd2McbusKbjAUN+QOJXVYVEhSMM7tNT1rGwhF8NzXM48YR",
  "tokenMint": "CiHasI1B2Q55iTvTNGhGgfrAgcdDthHQnXP+zOJJWerE+ye+xpI3HSgC71IvGwrR",
  "amount": "S/0mciPECIBJYwTVmjMYAg==",
  "transactionFee": "4tRIqHHkazG9JaPgouAgyA==",
  "transactionFeeAddress": "1J4dSCdJciClnm30opjvnufiXFv3qW6ztkks3CvLRRO7UJ86r1NiSp2HSl9HE1w5",
  "narration": "WLsEC7IGvLNPPetkjHskJMYGxC+N1vEvmxlv8o1UJRY="
};

const method = 'POST';
const path = '/api/tx';
const timestamp = 1759147833939;
const nonce = '/mruQ+UmaGYJSyYasWcF8w==';
const flutterSignature = '54145346b2bc2d8a41745e27646e28be7e85e7ccdeff78607c38a4c40d40240a';

function generateSignature(method, path, bodyString, timestamp, nonce, secretKey) {
  const payload = `${method}|${path}|${bodyString}|${timestamp}|${nonce}`;
  const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
  return { payload, signature };
}

const bodyString = JSON.stringify(testData);

console.log('=== Brute Force Testing for Flutter Secret ===\n');
console.log('Target Flutter signature:', flutterSignature);
console.log('Body string length:', bodyString.length);
console.log();

// Test a wide range of possible secrets that might be used as defaults
const possibleSecrets = [
  // Empty and null values
  '',
  'null',
  'undefined',
  
  // Environment variable names
  'REQUEST_SIGNING_SECRET',
  '$REQUEST_SIGNING_SECRET',
  '${REQUEST_SIGNING_SECRET}',
  
  // Common defaults and placeholders
  'default',
  'default-secret',
  'secret',
  'key',
  'test',
  'dev',
  'development',
  'flutter',
  'dart',
  'guava',
  'mobile',
  'client',
  'app',
  
  // Longer defaults
  'default-signing-secret',
  'flutter-signing-secret',
  'guava-signing-secret',
  'mobile-signing-secret',
  'development-secret-key',
  'test-secret-key',
  'your-secret-key-here',
  'change-this-secret',
  'replace-with-actual-secret',
  
  // Technical terms
  'hmac-secret',
  'signing-key',
  'api-secret',
  'auth-secret',
  'request-secret',
  'signature-secret',
  
  // Common passwords/keys
  'password',
  'secret123',
  'key123',
  'test123',
  'dev123',
  '123456',
  'qwerty',
  
  // Base64 encoded versions of common strings
  Buffer.from('secret').toString('base64'),
  Buffer.from('default').toString('base64'),
  Buffer.from('flutter').toString('base64'),
  Buffer.from('guava').toString('base64'),
  
  // Hex encoded versions
  Buffer.from('secret').toString('hex'),
  Buffer.from('default').toString('hex'),
  Buffer.from('flutter').toString('hex'),
  Buffer.from('guava').toString('hex'),
  
  // UUID-like strings
  '00000000-0000-0000-0000-000000000000',
  '12345678-1234-1234-1234-123456789012',
  
  // Random common strings
  'lorem-ipsum',
  'hello-world',
  'test-string',
  'sample-key',
  'example-secret',
  
  // Variations with different cases
  'DEFAULT',
  'SECRET',
  'FLUTTER',
  'GUAVA',
  'Default',
  'Secret',
  'Flutter',
  'Guava',
];

console.log(`Testing ${possibleSecrets.length} possible secret keys...\n`);

let found = false;
for (let i = 0; i < possibleSecrets.length; i++) {
  const secret = possibleSecrets[i];
  const result = generateSignature(method, path, bodyString, timestamp, nonce, secret);
  
  if (result.signature === flutterSignature) {
    console.log(`🎯 FOUND THE SECRET KEY!`);
    console.log(`Secret: "${secret}"`);
    console.log(`Length: ${secret.length}`);
    console.log(`Signature: ${result.signature}`);
    console.log(`Payload: ${result.payload}`);
    found = true;
    break;
  }
  
  // Show progress every 10 attempts
  if ((i + 1) % 10 === 0) {
    console.log(`Tested ${i + 1}/${possibleSecrets.length} secrets...`);
  }
}

if (!found) {
  console.log('\n❌ No matching secret found in the test set.');
  console.log('\nThis suggests the Flutter app might be using:');
  console.log('1. A completely random/generated secret key');
  console.log('2. A secret that\'s not in our test set');
  console.log('3. A different payload construction method');
  console.log('4. A different HMAC implementation');
  
  console.log('\n=== Next Steps ===');
  console.log('1. Check if REQUEST_SIGNING_SECRET is set in Flutter\'s .env file');
  console.log('2. Add REQUEST_SIGNING_SECRET to setup_env_from_github_secrets.sh');
  console.log('3. Ensure both Flutter and server use the same secret key');
  console.log('4. Rebuild Flutter app after setting the correct secret');
}

console.log('\n=== Debug Info ===');
console.log('Expected payload format:');
console.log(`${method}|${path}|${bodyString}|${timestamp}|${nonce}`);
console.log('\nServer secret key (first 50 chars):');
console.log('R%Z515narhUmhGUBR$v1t^AkfN$khbF/QtnCBi9C@slUl5BwZv...');
console.log('\nServer expected signature:');
console.log('e9e7fa68eb65a9c7cd2d2e12136b79d2113d17bd0b11fab8ec03716ece1818c2');
