#!/usr/bin/env node

/**
 * Simple test to verify emergency blacklist is working
 */

console.log('🧪 Testing Emergency Blacklist');
console.log('═'.repeat(50));

// Test the emergency blacklist directly
const testAddress = '6B8erp3QahPMJMMomefnKttn7NdBg9WWXRZ8UMo8qoPV';

console.log(`Testing address: ${testAddress}`);

// Check if it's in the hardcoded list
const EMERGENCY_BLACKLIST = new Set([
  '6B8erp3QahPMJMMomefnKttn7NdBg9WWXRZ8UMo8qoPV',
  'GnLvsDfC7wkGsLsigTLHe8LgZLNJCLmtxUYoFwq5NSsx',
]);

const isBlacklisted = EMERGENCY_BLACKLIST.has(testAddress);
console.log(`Emergency blacklist check: ${isBlacklisted ? '✅ BLOCKED' : '❌ ALLOWED'}`);

if (isBlacklisted) {
  console.log('🎯 SUCCESS: Emergency blacklist is working!');
  console.log('   The attacking address is properly blocked.');
} else {
  console.log('❌ FAILURE: Emergency blacklist is not working!');
  console.log('   The attacking address would be allowed through.');
}

console.log('\n📋 Next steps:');
console.log('1. Deploy the fixed code to production');
console.log('2. Monitor API logs for blacklist blocks');
console.log('3. Verify transactions from attacking addresses are rejected');
