#!/usr/bin/env node

/**
 * Test Emergency Blacklist Functionality
 */

// Import the emergency blacklist functions
const { 
  isEmergencyBlacklisted, 
  getEmergencyBlacklistReason, 
  validateEmergencyBlacklist 
} = require('../utils/emergencyBlacklist.ts');

const testAddresses = [
  '6B8erp3QahPMJMMomefnKttn7NdBg9WWXRZ8UMo8qoPV',
  'GnLvsDfC7wkGsLsigTLHe8LgZLNJCLmtxUYoFwq5NSsx',
  'SomeRandomAddress123456789'
];

console.log('🧪 Testing Emergency Blacklist Functionality');
console.log('═'.repeat(60));

testAddresses.forEach((address, index) => {
  console.log(`\n${index + 1}. Testing: ${address}`);
  
  try {
    const isBlacklisted = isEmergencyBlacklisted(address);
    const reason = getEmergencyBlacklistReason(address);
    const validation = validateEmergencyBlacklist(address);
    
    console.log(`   Is Blacklisted: ${isBlacklisted ? '✅ YES' : '❌ NO'}`);
    console.log(`   Reason: ${reason || 'None'}`);
    console.log(`   Validation Blocked: ${validation.blocked ? '✅ YES' : '❌ NO'}`);
    console.log(`   Validation Reason: ${validation.reason || 'None'}`);
    
  } catch (error) {
    console.error(`   ❌ Error testing ${address}:`, error.message);
  }
});

console.log('\n🎯 Expected Results:');
console.log('   First two addresses should be BLOCKED');
console.log('   Third address should be ALLOWED');
