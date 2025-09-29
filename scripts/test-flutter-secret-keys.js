#!/usr/bin/env node

/**
 * Test what secret key Flutter might be using
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

console.log('=== Testing Possible Flutter Secret Keys ===\n');
console.log('Target Flutter signature:', flutterSignature);
console.log();

// Test various possible secret keys that Flutter might be using
const possibleFlutterSecrets = [
  '', // Empty string
  'null', // String "null"
  'undefined', // String "undefined"
  'REQUEST_SIGNING_SECRET', // The env var name itself
  'default-secret', // Default fallback
  'flutter-default', // Flutter-specific default
  'guava-secret', // App-specific
  'development-secret', // Development default
  'test-secret-key', // Test key
  'your-secret-key-here', // Placeholder
  'change-me', // Common placeholder
  'secret', // Simple
  'key', // Simple
  'flutter', // App name
  'guava', // App name
  'mobile-secret', // Platform-specific
  'client-secret', // Client-specific
  'signing-secret', // Descriptive
  'hmac-secret', // Technical
  'api-secret', // API-specific
];

console.log('Testing common default/placeholder values:\n');

possibleFlutterSecrets.forEach((secret, index) => {
  const result = generateSignature(method, path, bodyString, timestamp, nonce, secret);
  const matches = result.signature === flutterSignature;
  console.log(`${index + 1}. "${secret}" (length: ${secret.length})`);
  console.log(`   Signature: ${result.signature}`);
  console.log(`   Matches: ${matches ? '✅ YES!' : '❌ No'}`);
  if (matches) {
    console.log(`   🎯 FOUND THE SECRET KEY: "${secret}"`);
  }
  console.log();
});

// Also test some variations of the server secret
console.log('=== Testing Server Secret Variations ===\n');

const serverSecret = 'R%Z515narhUmhGUBR$v1t^AkfN$khbF/QtnCBi9C@slUl5BwZvCu&TGk2nEhx#LQHFAR#/6vzZyEUZ5a#6iJ&QuH@YMZ3+sRdnVA&#R6wk#49$bq*J7TiTC!@!nh5G%X';

const serverSecretVariations = [
  serverSecret,
  serverSecret.trim(),
  serverSecret.replace(/\s+/g, ''), // Remove all whitespace
  serverSecret.substring(0, 32), // First 32 chars
  serverSecret.substring(0, 64), // First 64 chars
  Buffer.from(serverSecret).toString('base64'), // Base64 encoded
  Buffer.from(serverSecret).toString('hex'), // Hex encoded
];

serverSecretVariations.forEach((secret, index) => {
  const result = generateSignature(method, path, bodyString, timestamp, nonce, secret);
  const matches = result.signature === flutterSignature;
  console.log(`Server variation ${index + 1} (length: ${secret.length})`);
  console.log(`   First 50 chars: ${secret.substring(0, 50)}...`);
  console.log(`   Signature: ${result.signature}`);
  console.log(`   Matches: ${matches ? '✅ YES!' : '❌ No'}`);
  if (matches) {
    console.log(`   🎯 FOUND THE SECRET KEY VARIATION!`);
  }
  console.log();
});

console.log('=== Summary ===');
console.log('If none of these matched, it suggests:');
console.log('1. Flutter\'s REQUEST_SIGNING_SECRET env var is not set or has a different value');
console.log('2. There might be an issue with how Flutter loads environment variables');
console.log('3. The Flutter app might be using a hardcoded fallback value');
console.log('4. There could be an encoding issue in the Flutter HMAC implementation');
