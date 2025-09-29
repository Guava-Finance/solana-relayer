#!/usr/bin/env node

/**
 * Quick Redis Connection Test
 */

console.log('🔍 Environment Variables:');
console.log('REDIS_URL:', process.env.REDIS_URL ? 'SET' : 'NOT SET');
console.log('AES_ENCRYPTION_KEY:', process.env.AES_ENCRYPTION_KEY ? 'SET' : 'NOT SET');
console.log('AES_ENCRYPTION_IV:', process.env.AES_ENCRYPTION_IV ? 'SET' : 'NOT SET');

if (!process.env.REDIS_URL) {
  console.log('\n❌ REDIS_URL is not set!');
  console.log('\n🔧 To fix this:');
  console.log('1. Create a .env file with your Redis URL:');
  console.log('   echo \'REDIS_URL="your-redis-url-here"\' > .env');
  console.log('2. Or export it in your shell:');
  console.log('   export REDIS_URL="your-redis-url-here"');
  console.log('3. Or add it to your Vercel environment variables');
  console.log('\n📝 Your Redis URL should be:');
  console.log('   redis://default:nlQGagAGQ3znILbZFs8Op2qfPplGHJZI@redis-15143.c16.us-east-1-3.ec2.redns.redis-cloud.com:15143');
  process.exit(1);
}

// Test Redis connection
const { createClient } = require('redis');

const redis = createClient({
  url: process.env.REDIS_URL
});

async function testConnection() {
  try {
    await redis.connect();
    console.log('✅ Redis connection successful!');
    
    // Test basic operations
    await redis.set('test_key', 'test_value');
    const value = await redis.get('test_key');
    await redis.del('test_key');
    
    if (value === 'test_value') {
      console.log('✅ Redis read/write operations working!');
      console.log('\n🎉 All security features should now work properly!');
    } else {
      console.log('❌ Redis read/write operations failed');
    }
    
    await redis.disconnect();
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    console.log('\n🔧 Check your Redis URL and network connectivity');
  }
}

testConnection();
