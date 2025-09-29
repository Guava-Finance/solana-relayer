#!/usr/bin/env node

/**
 * Diagnose Redis Connection Issues in API Context
 */

const { createClient } = require('redis');

async function diagnoseRedisAPI() {
  console.log('🔍 Diagnosing Redis Connection Issues in API Context');
  console.log('═'.repeat(60));
  
  console.log('📋 Environment Check:');
  console.log('─'.repeat(30));
  console.log(`REDIS_URL: ${process.env.REDIS_URL ? 'SET' : 'NOT SET'}`);
  if (process.env.REDIS_URL) {
    console.log(`URL: ${process.env.REDIS_URL.replace(/:[^:@]*@/, ':***@')}`);
  }
  
  console.log('\n🧪 Testing Different Connection Strategies:');
  console.log('─'.repeat(45));
  
  // Test 1: Basic connection (like in scripts)
  console.log('\n1. Testing Basic Connection (Script Style):');
  try {
    const basicClient = createClient({
      url: process.env.REDIS_URL
    });
    
    await basicClient.connect();
    console.log('   ✅ Basic connection successful');
    await basicClient.set('test_basic', 'success');
    const value = await basicClient.get('test_basic');
    console.log(`   ✅ Basic operations: ${value}`);
    await basicClient.del('test_basic');
    await basicClient.disconnect();
  } catch (error) {
    console.log(`   ❌ Basic connection failed: ${error.message}`);
  }
  
  // Test 2: Robust connection (like in our updated code)
  console.log('\n2. Testing Robust Connection (API Style):');
  try {
    const robustClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.log('   Max reconnection attempts reached');
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });
    
    // Add event listeners
    robustClient.on('error', (error) => {
      console.log(`   Redis error: ${error.message}`);
    });
    
    robustClient.on('connect', () => {
      console.log('   ✅ Connect event fired');
    });
    
    robustClient.on('disconnect', () => {
      console.log('   ⚠️  Disconnect event fired');
    });
    
    await robustClient.connect();
    console.log('   ✅ Robust connection successful');
    
    await robustClient.set('test_robust', 'success');
    const value = await robustClient.get('test_robust');
    console.log(`   ✅ Robust operations: ${value}`);
    await robustClient.del('test_robust');
    await robustClient.disconnect();
  } catch (error) {
    console.log(`   ❌ Robust connection failed: ${error.message}`);
  }
  
  // Test 3: Simulate API environment
  console.log('\n3. Testing API Environment Simulation:');
  try {
    // Simulate multiple clients (like in our API)
    const clients = [];
    for (let i = 0; i < 3; i++) {
      const client = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 10000,
          reconnectStrategy: (retries) => {
            if (retries > 3) return false;
            return Math.min(retries * 100, 3000);
          }
        }
      });
      clients.push(client);
    }
    
    // Connect all clients
    await Promise.all(clients.map(client => client.connect()));
    console.log('   ✅ Multiple clients connected successfully');
    
    // Test operations on all clients
    for (let i = 0; i < clients.length; i++) {
      await clients[i].set(`test_multi_${i}`, `client_${i}`);
      const value = await clients[i].get(`test_multi_${i}`);
      console.log(`   ✅ Client ${i} operations: ${value}`);
      await clients[i].del(`test_multi_${i}`);
    }
    
    // Disconnect all clients
    await Promise.all(clients.map(client => client.disconnect()));
    console.log('   ✅ All clients disconnected successfully');
  } catch (error) {
    console.log(`   ❌ API simulation failed: ${error.message}`);
  }
  
  console.log('\n🎯 Diagnosis Results:');
  console.log('─'.repeat(25));
  console.log('If all tests passed, Redis should work in API context.');
  console.log('If tests failed, check:');
  console.log('1. Redis server is running and accessible');
  console.log('2. REDIS_URL is correctly set in production environment');
  console.log('3. Network connectivity from API server to Redis');
  console.log('4. Redis server memory and connection limits');
  
  console.log('\n🔧 Recommended Actions:');
  console.log('1. Deploy the updated Redis connection code');
  console.log('2. Check production logs for connection attempts');
  console.log('3. Monitor Redis server metrics');
  console.log('4. The emergency blacklist will protect you even if Redis fails');
}

if (!process.env.REDIS_URL) {
  console.log('❌ REDIS_URL environment variable is not set');
  process.exit(1);
}

diagnoseRedisAPI().catch(console.error);
