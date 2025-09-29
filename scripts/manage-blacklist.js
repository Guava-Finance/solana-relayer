#!/usr/bin/env node

/**
 * Blacklist Management Script
 * 
 * Usage:
 * node scripts/manage-blacklist.js add <address> <reason>
 * node scripts/manage-blacklist.js remove <address>
 * node scripts/manage-blacklist.js list
 * node scripts/manage-blacklist.js check <address>
 * node scripts/manage-blacklist.js stats
 * node scripts/manage-blacklist.js greylist <address> <reason>
 */

const { createClient } = require('redis');

// Try to load dotenv, but don't fail if it's not available
try {
  require('dotenv').config();
} catch (e) {
  // Use environment variables directly
}

const redis = createClient({
  url: process.env.REDIS_URL
});

async function connectRedis() {
  try {
    await redis.connect();
    console.log('✅ Connected to Redis');
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
    process.exit(1);
  }
}

async function addToBlacklist(address, reason) {
  try {
    await redis.sAdd('blacklist:addresses', address);
    await redis.hSet('blacklist:reasons', address, reason);
    console.log(`✅ Added ${address} to blacklist`);
    console.log(`   Reason: ${reason}`);
  } catch (error) {
    console.error('❌ Failed to add to blacklist:', error);
  }
}

async function removeFromBlacklist(address) {
  try {
    const removed = await redis.sRem('blacklist:addresses', address);
    await redis.hDel('blacklist:reasons', address);
    
    if (removed) {
      console.log(`✅ Removed ${address} from blacklist`);
    } else {
      console.log(`⚠️  ${address} was not in blacklist`);
    }
  } catch (error) {
    console.error('❌ Failed to remove from blacklist:', error);
  }
}

async function listBlacklist() {
  try {
    const addresses = await redis.sMembers('blacklist:addresses');
    
    if (addresses.length === 0) {
      console.log('📝 Blacklist is empty');
      return;
    }
    
    console.log(`📝 Blacklisted addresses (${addresses.length}):`);
    console.log('─'.repeat(80));
    
    for (const address of addresses) {
      const reason = await redis.hGet('blacklist:reasons', address);
      console.log(`🚫 ${address}`);
      console.log(`   Reason: ${reason || 'No reason provided'}`);
      console.log('');
    }
  } catch (error) {
    console.error('❌ Failed to list blacklist:', error);
  }
}

async function checkAddress(address) {
  try {
    const isBlacklisted = await redis.sIsMember('blacklist:addresses', address);
    const isGreylisted = await redis.sIsMember('greylist:addresses', address);
    
    console.log(`🔍 Status for ${address}:`);
    
    if (isBlacklisted) {
      const reason = await redis.hGet('blacklist:reasons', address);
      console.log(`🚫 BLACKLISTED`);
      console.log(`   Reason: ${reason || 'No reason provided'}`);
    } else if (isGreylisted) {
      const reason = await redis.hGet('greylist:reasons', address);
      console.log(`⚠️  GREYLISTED`);
      console.log(`   Reason: ${reason || 'No reason provided'}`);
    } else {
      console.log(`✅ CLEAN (not blacklisted or greylisted)`);
    }
  } catch (error) {
    console.error('❌ Failed to check address:', error);
  }
}

async function addToGreylist(address, reason) {
  try {
    await redis.sAdd('greylist:addresses', address);
    await redis.hSet('greylist:reasons', address, reason);
    console.log(`⚠️  Added ${address} to greylist`);
    console.log(`   Reason: ${reason}`);
  } catch (error) {
    console.error('❌ Failed to add to greylist:', error);
  }
}

async function getStats() {
  try {
    const blacklistCount = await redis.sCard('blacklist:addresses');
    const greylistCount = await redis.sCard('greylist:addresses');
    const suspiciousCount = await redis.lLen('suspicious_transactions');
    const threatCount = await redis.lLen('threat_events');
    
    console.log('📊 Security Statistics:');
    console.log('─'.repeat(40));
    console.log(`🚫 Blacklisted addresses: ${blacklistCount}`);
    console.log(`⚠️  Greylisted addresses: ${greylistCount}`);
    console.log(`🔍 Suspicious transactions: ${suspiciousCount}`);
    console.log(`🛡️  Threat events: ${threatCount}`);
    
    // Recent suspicious transactions
    if (suspiciousCount > 0) {
      console.log('\n🔍 Recent suspicious transactions:');
      const recent = await redis.lRange('suspicious_transactions', 0, 4);
      recent.forEach((tx, index) => {
        const data = JSON.parse(tx);
        console.log(`${index + 1}. ${data.sender} -> ${data.receiver} (Risk: ${data.riskScore})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Failed to get stats:', error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
🛡️  Blacklist Management Tool

Usage:
  node scripts/manage-blacklist.js add <address> <reason>     - Add address to blacklist
  node scripts/manage-blacklist.js remove <address>          - Remove address from blacklist
  node scripts/manage-blacklist.js list                      - List all blacklisted addresses
  node scripts/manage-blacklist.js check <address>           - Check if address is blacklisted
  node scripts/manage-blacklist.js greylist <address> <reason> - Add address to greylist
  node scripts/manage-blacklist.js stats                     - Show security statistics

Examples:
  node scripts/manage-blacklist.js add "ABC123..." "Griefing attack"
  node scripts/manage-blacklist.js check "ABC123..."
  node scripts/manage-blacklist.js list
    `);
    process.exit(0);
  }
  
  await connectRedis();
  
  const command = args[0];
  
  switch (command) {
    case 'add':
      if (args.length < 3) {
        console.error('❌ Usage: add <address> <reason>');
        process.exit(1);
      }
      await addToBlacklist(args[1], args.slice(2).join(' '));
      break;
      
    case 'remove':
      if (args.length < 2) {
        console.error('❌ Usage: remove <address>');
        process.exit(1);
      }
      await removeFromBlacklist(args[1]);
      break;
      
    case 'list':
      await listBlacklist();
      break;
      
    case 'check':
      if (args.length < 2) {
        console.error('❌ Usage: check <address>');
        process.exit(1);
      }
      await checkAddress(args[1]);
      break;
      
    case 'greylist':
      if (args.length < 3) {
        console.error('❌ Usage: greylist <address> <reason>');
        process.exit(1);
      }
      await addToGreylist(args[1], args.slice(2).join(' '));
      break;
      
    case 'stats':
      await getStats();
      break;
      
    default:
      console.error(`❌ Unknown command: ${command}`);
      process.exit(1);
  }
  
  await redis.disconnect();
}

main().catch(console.error);
