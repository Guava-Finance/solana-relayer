#!/usr/bin/env node

/**
 * Reverse engineer what Flutter might be doing differently
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
const serverSecretKey = 'R%Z515narhUmhGUBR$v1t^AkfN$khbF/QtnCBi9C@slUl5BwZvCu&TGk2nEhx#LQHFAR#/6vzZyEUZ5a#6iJ&QuH@YMZ3+sRdnVA&#R6wk#49$bq*J7TiTC!@!nh5G%X';

const flutterSignature = '54145346b2bc2d8a41745e27646e28be7e85e7ccdeff78607c38a4c40d40240a';
const serverExpectedSignature = 'e9e7fa68eb65a9c7cd2d2e12136b79d2113d17bd0b11fab8ec03716ece1818c2';

function generateSignature(method, path, bodyString, timestamp, nonce, secretKey) {
  const payload = `${method}|${path}|${bodyString}|${timestamp}|${nonce}`;
  const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
  return { payload, signature };
}

console.log('=== Reverse Engineering Flutter Signature ===\n');

const bodyString = JSON.stringify(testData);
console.log('Body string:', bodyString);
console.log();

// Test 1: Maybe Flutter is using a different secret key
console.log('=== Testing Different Secret Keys ===\n');

const possibleSecrets = [
  'default-secret',
  'R%Z515narhUmhGUBR$v1t^AkfN$khbF/QtnCBi9C@slUl5BwZvCu&TGk2nEhx#LQHFAR#/6vzZyEUZ5a#6iJ&QuH@YMZ3+sRdnVA&#R6wk#49$bq*J7TiTC!@!nh5G%X',
  'test-secret',
  'flutter-secret',
  process.env.REQUEST_SIGNING_SECRET || 'env-not-set'
];

possibleSecrets.forEach((secret, index) => {
  const result = generateSignature(method, path, bodyString, timestamp, nonce, secret);
  console.log(`Secret ${index + 1} (${secret.substring(0, 20)}...): ${result.signature}`);
  console.log(`  Matches Flutter: ${result.signature === flutterSignature}`);
  console.log(`  Matches Server: ${result.signature === serverExpectedSignature}`);
  console.log();
});

// Test 2: Maybe Flutter is using a different path
console.log('=== Testing Different Paths ===\n');

const possiblePaths = [
  '/api/tx',
  'api/tx',
  '/tx',
  'tx',
  '/api/tx/',
  'https://relayer.guava.finance/api/tx'
];

possiblePaths.forEach((testPath, index) => {
  const result = generateSignature(method, testPath, bodyString, timestamp, nonce, serverSecretKey);
  console.log(`Path ${index + 1} (${testPath}): ${result.signature}`);
  console.log(`  Matches Flutter: ${result.signature === flutterSignature}`);
  console.log();
});

// Test 3: Maybe Flutter is using a different method
console.log('=== Testing Different Methods ===\n');

const possibleMethods = ['POST', 'post', 'Post'];

possibleMethods.forEach((testMethod, index) => {
  const result = generateSignature(testMethod, path, bodyString, timestamp, nonce, serverSecretKey);
  console.log(`Method ${index + 1} (${testMethod}): ${result.signature}`);
  console.log(`  Matches Flutter: ${result.signature === flutterSignature}`);
  console.log();
});

// Test 4: Maybe Flutter is using unencrypted data
console.log('=== Testing With Unencrypted Data ===\n');

// Simulate what the unencrypted data might look like
const unencryptedData = {
  "senderAddress": "RtsKQm3gAGL1Tayhs7ojWE9qytWqVh4G7eJTaNJs7vX",
  "receiverAddress": "SomeReceiverAddress123456789",
  "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": "1000000",
  "transactionFee": "5000",
  "transactionFeeAddress": "SomeFeeAddress123456789",
  "narration": "Test transfer"
};

const unencryptedBodyString = JSON.stringify(unencryptedData);
const result = generateSignature(method, path, unencryptedBodyString, timestamp, nonce, serverSecretKey);
console.log('With unencrypted data:', result.signature);
console.log(`  Matches Flutter: ${result.signature === flutterSignature}`);
console.log();

// Test 5: Maybe there's a different timestamp or nonce format
console.log('=== Testing Different Timestamp/Nonce Formats ===\n');

// Try with string timestamp
const result2 = generateSignature(method, path, bodyString, timestamp.toString(), nonce, serverSecretKey);
console.log('With string timestamp:', result2.signature);
console.log(`  Matches Flutter: ${result2.signature === flutterSignature}`);
console.log();

// Test 6: Maybe Flutter is missing some fields or has extra fields
console.log('=== Testing Different Body Structures ===\n');

// Try without some fields
const minimalData = {
  "senderAddress": testData.senderAddress,
  "receiverAddress": testData.receiverAddress,
  "amount": testData.amount
};

const minimalBodyString = JSON.stringify(minimalData);
const result3 = generateSignature(method, path, minimalBodyString, timestamp, nonce, serverSecretKey);
console.log('With minimal data:', result3.signature);
console.log(`  Matches Flutter: ${result3.signature === flutterSignature}`);
console.log();

console.log('=== Summary ===');
console.log('Flutter signature:', flutterSignature);
console.log('Server expected:', serverExpectedSignature);
console.log('None of the variations matched the Flutter signature.');
console.log('This suggests either:');
console.log('1. Flutter is using a completely different secret key');
console.log('2. Flutter is constructing the payload differently');
console.log('3. There\'s an encoding issue in Flutter');
console.log('4. Flutter is using different timestamp/nonce values than logged');
