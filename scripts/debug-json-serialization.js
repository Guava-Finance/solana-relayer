#!/usr/bin/env node

/**
 * Debug script to compare JSON serialization between Dart and Node.js
 */

const crypto = require('crypto');

// Test data from the logs
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
const secretKey = 'R%Z515narhUmhGUBR$v1t^AkfN$khbF/QtnCBi9C@slUl5BwZvCu&TGk2nEhx#LQHFAR#/6vzZyEUZ5a#6iJ&QuH@YMZ3+sRdnVA&#R6wk#49$bq*J7TiTC!@!nh5G%X';

console.log('=== JSON Serialization Comparison ===\n');

// Node.js JSON.stringify (current server approach)
const nodeJsonString = JSON.stringify(testData);
console.log('Node.js JSON.stringify():');
console.log(nodeJsonString);
console.log(`Length: ${nodeJsonString.length}`);
console.log();

// Try different serialization approaches
const nodeJsonStringNoSpaces = JSON.stringify(testData, null, 0);
console.log('Node.js JSON.stringify() with no spaces:');
console.log(nodeJsonStringNoSpaces);
console.log(`Length: ${nodeJsonStringNoSpaces.length}`);
console.log();

// Check if they're the same
console.log('Are they the same?', nodeJsonString === nodeJsonStringNoSpaces);
console.log();

// Generate signatures with both approaches
function generateSignature(bodyString) {
  const payload = `${method}|${path}|${bodyString}|${timestamp}|${nonce}`;
  console.log(`Payload: ${payload}`);
  const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
  return signature;
}

console.log('=== Signature Generation ===\n');

console.log('With Node.js JSON.stringify():');
const sig1 = generateSignature(nodeJsonString);
console.log(`Signature: ${sig1}`);
console.log();

console.log('With Node.js JSON.stringify() no spaces:');
const sig2 = generateSignature(nodeJsonStringNoSpaces);
console.log(`Signature: ${sig2}`);
console.log();

console.log('=== Expected vs Received ===\n');
console.log('Expected (from server logs):', 'e9e7fa68eb65a9c7cd2d2e12136b79d2113d17bd0b11fab8ec03716ece1818c2');
console.log('Received (from Flutter):', '54145346b2bc2d8a41745e27646e28be7e85e7ccdeff78607c38a4c40d40240a');
console.log('Generated with JSON.stringify():', sig1);
console.log('Generated with JSON.stringify() no spaces:', sig2);
console.log();

// Check matches
console.log('=== Matches ===');
console.log('Expected matches JSON.stringify():', 'e9e7fa68eb65a9c7cd2d2e12136b79d2113d17bd0b11fab8ec03716ece1818c2' === sig1);
console.log('Received matches JSON.stringify():', '54145346b2bc2d8a41745e27646e28be7e85e7ccdeff78607c38a4c40d40240a' === sig1);
console.log('Expected matches JSON.stringify() no spaces:', 'e9e7fa68eb65a9c7cd2d2e12136b79d2113d17bd0b11fab8ec03716ece1818c2' === sig2);
console.log('Received matches JSON.stringify() no spaces:', '54145346b2bc2d8a41745e27646e28be7e85e7ccdeff78607c38a4c40d40240a' === sig2);

// Try to reverse engineer what Flutter might be doing
console.log('\n=== Trying Different Approaches ===\n');

// Maybe Flutter sorts the keys?
const sortedKeys = Object.keys(testData).sort();
const sortedData = {};
sortedKeys.forEach(key => {
  sortedData[key] = testData[key];
});

const sortedJsonString = JSON.stringify(sortedData);
console.log('With sorted keys:');
console.log(sortedJsonString);
const sig3 = generateSignature(sortedJsonString);
console.log(`Signature: ${sig3}`);
console.log('Received matches sorted keys:', '54145346b2bc2d8a41745e27646e28be7e85e7ccdeff78607c38a4c40d40240a' === sig3);
console.log();

// Maybe there's a different key order from Flutter?
const flutterOrder = {
  "senderAddress": testData.senderAddress,
  "receiverAddress": testData.receiverAddress,
  "tokenMint": testData.tokenMint,
  "amount": testData.amount,
  "transactionFee": testData.transactionFee,
  "transactionFeeAddress": testData.transactionFeeAddress,
  "narration": testData.narration
};

const flutterOrderString = JSON.stringify(flutterOrder);
console.log('With Flutter field order:');
console.log(flutterOrderString);
const sig4 = generateSignature(flutterOrderString);
console.log(`Signature: ${sig4}`);
console.log('Received matches Flutter order:', '54145346b2bc2d8a41745e27646e28be7e85e7ccdeff78607c38a4c40d40240a' === sig4);
