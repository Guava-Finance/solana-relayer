/**
 * Emergency Hardcoded Blacklist
 * 
 * This is a backup security measure when Redis is unavailable.
 * These addresses are immediately blocked without any Redis dependency.
 */

export const EMERGENCY_BLACKLIST = new Set([
  // Known attacking addresses
  '6B8erp3QahPMJMMomefnKttn7NdBg9WWXRZ8UMo8qoPV',
  'GnLvsDfC7wkGsLsigTLHe8LgZLNJCLmtxUYoFwq5NSsx',
  
  // Add more attacking addresses here as they are discovered
]);

export const EMERGENCY_BLACKLIST_REASONS = new Map([
  ['6B8erp3QahPMJMMomefnKttn7NdBg9WWXRZ8UMo8qoPV', 'Griefing attack - rent extraction'],
  ['GnLvsDfC7wkGsLsigTLHe8LgZLNJCLmtxUYoFwq5NSsx', 'Griefing attack - rent extraction'],
]);

/**
 * Check if an address is in the emergency blacklist
 */
export function isEmergencyBlacklisted(address: string): boolean {
  return EMERGENCY_BLACKLIST.has(address);
}

/**
 * Get the reason for emergency blacklisting
 */
export function getEmergencyBlacklistReason(address: string): string | undefined {
  return EMERGENCY_BLACKLIST_REASONS.get(address);
}

/**
 * Add address to emergency blacklist (runtime addition)
 */
export function addToEmergencyBlacklist(address: string, reason: string): void {
  EMERGENCY_BLACKLIST.add(address);
  EMERGENCY_BLACKLIST_REASONS.set(address, reason);
  console.log(`[EmergencyBlacklist] Added ${address}: ${reason}`);
}

/**
 * Emergency blacklist validation for API endpoints
 */
export function validateEmergencyBlacklist(senderAddress: string, receiverAddress?: string): {
  blocked: boolean;
  reason?: string;
  address?: string;
} {
  // Check sender
  if (isEmergencyBlacklisted(senderAddress)) {
    return {
      blocked: true,
      reason: getEmergencyBlacklistReason(senderAddress),
      address: senderAddress
    };
  }
  
  // Check receiver if provided
  if (receiverAddress && isEmergencyBlacklisted(receiverAddress)) {
    return {
      blocked: true,
      reason: getEmergencyBlacklistReason(receiverAddress),
      address: receiverAddress
    };
  }
  
  return { blocked: false };
}
