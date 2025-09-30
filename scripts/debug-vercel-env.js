#!/usr/bin/env node

/**
 * Debug script to check what secret key Vercel is using
 */

const crypto = require('crypto');

// Test data from the failing request
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
const timestamp = 1759147833939; // Use the same timestamp from logs
const nonce = '/mruQ+UmaGYJSyYasWcF8w=='; // Use the same nonce from logs
const flutterSignature = '54145346b2bc2d8a41745e27646e28be7e85e7ccdeff78607c38a4c40d40240a';

function generateSignature(method, path, bodyString, timestamp, nonce, secretKey) {
  const payload = `${method}|${path}|${bodyString}|${timestamp}|${nonce}`;
  const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
  return { payload, signature };
}

const bodyString = JSON.stringify(testData);

console.log('=== Vercel Environment Debug ===\n');

// Test what Vercel is likely using
const possibleVercelSecrets = [
  'default-secret', // Fallback when REQUEST_SIGNING_SECRET is not set
  '', // Empty string
  'undefined', // String "undefined"
  'null', // String "null"
];

console.log('Testing what Vercel might be using as secret key:\n');

possibleVercelSecrets.forEach((secret, index) => {
  const result = generateSignature(method, path, bodyString, timestamp, nonce, secret);
  const matches = result.signature === flutterSignature;
  
  console.log(`${index + 1}. Secret: "${secret}" (length: ${secret.length})`);
  console.log(`   Signature: ${result.signature}`);
  console.log(`   Matches Flutter: ${matches ? '✅ YES!' : '❌ No'}`);
  
  if (matches) {
    console.log(`   🎯 VERCEL IS USING: "${secret}"`);
  }
  console.log();
});

// Test with the correct server secret
const correctSecret = 'R%Z515narhUmhGUBR$v1t^AkfN$khbF/QtnCBi9C@slUl5BwZvCu&TGk2nEhx#LQHFAR#/6vzZyEUZ5a#6iJ&QuH@YMZ3+sRdnVA&#R6wk#49$bq*J7TiTC!@!nh5G%X';
const correctResult = generateSignature(method, path, bodyString, timestamp, nonce, correctSecret);

console.log('=== Expected Results ===\n');
console.log('With correct server secret:');
console.log(`Secret length: ${correctSecret.length}`);
console.log(`Signature: ${correctResult.signature}`);
console.log(`Matches Flutter: ${correctResult.signature === flutterSignature ? '✅ YES!' : '❌ No'}`);
console.log();

console.log('=== Diagnosis ===\n');
if (correctResult.signature === flutterSignature) {
  console.log('✅ Flutter is using the CORRECT secret key');
  console.log('❌ Vercel is missing REQUEST_SIGNING_SECRET environment variable');
  console.log('🔧 Solution: Add REQUEST_SIGNING_SECRET to Vercel environment variables');
} else {
  console.log('❌ Flutter is using a DIFFERENT secret key than the server');
  console.log('🔧 Solution: Ensure Flutter and server use the same REQUEST_SIGNING_SECRET');
}

console.log('\n=== Vercel Environment Setup Instructions ===\n');
console.log('1. Go to your Vercel dashboard');
console.log('2. Navigate to your solana-relayer project');
console.log('3. Go to Settings > Environment Variables');
console.log('4. Add a new environment variable:');
console.log('   Name: REQUEST_SIGNING_SECRET');
console.log(`   Value: ${correctSecret}`);
console.log('5. Redeploy your application');
console.log();
console.log('Or use Vercel CLI:');
console.log('vercel env add REQUEST_SIGNING_SECRET');
console.log(`Enter the value: ${correctSecret}`);
console.log('vercel --prod');
