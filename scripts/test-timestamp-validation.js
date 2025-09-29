#!/usr/bin/env node

/**
 * Test script for timestamp validation with different skew scenarios
 */

const crypto = require('crypto');

/**
 * Simulate the timestamp validation logic
 */
function validateTimestamp(timestamp) {
  const now = Date.now();
  const timeDiff = Math.abs(now - timestamp);
  
  // Allow configurable timestamp tolerance via environment variable
  const DEFAULT_MAX_SKEW = 5 * 60 * 1000; // 5 minutes
  const maxSkew = process.env.MAX_TIMESTAMP_SKEW_MS 
    ? parseInt(process.env.MAX_TIMESTAMP_SKEW_MS) 
    : DEFAULT_MAX_SKEW;
  
  console.log(`[Security] Timestamp validation: now=${now}, request=${timestamp}, skew=${timeDiff}ms, maxAllowed=${maxSkew}ms`);
  
  if (timeDiff > maxSkew) {
    console.log(`[Security] Request timestamp too old/future: ${timeDiff}ms skew exceeds ${maxSkew}ms limit`);
    return false;
  }
  
  console.log(`[Security] Timestamp validation passed: ${timeDiff}ms skew within ${maxSkew}ms limit`);
  return true;
}

/**
 * Test various timestamp scenarios
 */
function testTimestampScenarios() {
  console.log('🕐 Testing Timestamp Validation Scenarios');
  console.log('=========================================\n');
  
  const now = Date.now();
  
  // Test scenarios
  const scenarios = [
    {
      name: 'Current timestamp',
      timestamp: now,
      expected: true
    },
    {
      name: '1 minute ago',
      timestamp: now - (1 * 60 * 1000),
      expected: true
    },
    {
      name: '2.2 minutes ago (like the failing request)',
      timestamp: now - (2.2 * 60 * 1000),
      expected: true
    },
    {
      name: '5 minutes ago (at limit)',
      timestamp: now - (5 * 60 * 1000),
      expected: true
    },
    {
      name: '6 minutes ago (should fail with default)',
      timestamp: now - (6 * 60 * 1000),
      expected: false
    },
    {
      name: '1 minute in future',
      timestamp: now + (1 * 60 * 1000),
      expected: true
    },
    {
      name: '5 minutes in future (at limit)',
      timestamp: now + (5 * 60 * 1000),
      expected: true
    },
    {
      name: '6 minutes in future (should fail)',
      timestamp: now + (6 * 60 * 1000),
      expected: false
    }
  ];
  
  let passed = 0;
  let failed = 0;
  
  scenarios.forEach((scenario, index) => {
    console.log(`Test ${index + 1}: ${scenario.name}`);
    const result = validateTimestamp(scenario.timestamp);
    const success = result === scenario.expected;
    
    if (success) {
      console.log(`✅ PASSED (expected: ${scenario.expected}, got: ${result})\n`);
      passed++;
    } else {
      console.log(`❌ FAILED (expected: ${scenario.expected}, got: ${result})\n`);
      failed++;
    }
  });
  
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

/**
 * Test with custom environment variable
 */
function testWithCustomTolerance() {
  console.log('⚙️  Testing with Custom Timestamp Tolerance');
  console.log('===========================================\n');
  
  // Set custom tolerance to 10 minutes
  process.env.MAX_TIMESTAMP_SKEW_MS = '600000'; // 10 minutes
  
  const now = Date.now();
  const eightMinutesAgo = now - (8 * 60 * 1000);
  
  console.log('Testing 8 minutes ago with 10-minute tolerance:');
  const result = validateTimestamp(eightMinutesAgo);
  
  if (result) {
    console.log('✅ PASSED - Custom tolerance working correctly\n');
    return true;
  } else {
    console.log('❌ FAILED - Custom tolerance not working\n');
    return false;
  }
}

/**
 * Simulate the exact failing scenario from the logs
 */
function testFailingScenario() {
  console.log('🔍 Testing Exact Failing Scenario from Logs');
  console.log('===========================================\n');
  
  // From the logs: skew was 134334ms (about 2.2 minutes)
  const now = Date.now();
  const failingTimestamp = now - 134334; // Simulate the exact skew
  
  console.log('Simulating the exact failing scenario (134334ms skew):');
  
  // Test with default settings (5 minutes = 300000ms)
  delete process.env.MAX_TIMESTAMP_SKEW_MS;
  const resultDefault = validateTimestamp(failingTimestamp);
  
  if (resultDefault) {
    console.log('✅ PASSED - The failing scenario should now pass with 5-minute tolerance\n');
    return true;
  } else {
    console.log('❌ FAILED - The scenario is still failing\n');
    return false;
  }
}

/**
 * Main test runner
 */
function runTests() {
  console.log('🧪 Timestamp Validation Test Suite');
  console.log('==================================\n');
  
  const maxSkew = process.env.MAX_TIMESTAMP_SKEW_MS || '300000 (default)';
  console.log(`Current MAX_TIMESTAMP_SKEW_MS: ${maxSkew}ms\n`);
  
  let allPassed = true;
  
  allPassed &= testTimestampScenarios();
  allPassed &= testWithCustomTolerance();
  allPassed &= testFailingScenario();
  
  if (allPassed) {
    console.log('🎉 All timestamp validation tests passed!');
    console.log('\n📝 Recommendations:');
    console.log('1. The default 5-minute tolerance should handle most cases');
    console.log('2. For high-latency environments, consider increasing to 10 minutes');
    console.log('3. Monitor timestamp validation logs to tune the tolerance');
    console.log('4. Ensure client and server clocks are reasonably synchronized');
  } else {
    console.log('❌ Some tests failed. Please review the implementation.');
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  validateTimestamp,
  testTimestampScenarios,
  testWithCustomTolerance,
  testFailingScenario
};
