// /**
//  * ATA Farming Detection Utility
//  * 
//  * Analyzes wallet transaction history to detect patterns of
//  * Associated Token Account (ATA) farming attacks.
//  * 
//  * Patterns Detected:
//  * - Rent Extraction: Create ATA → Close ATA → Extract Rent → Repeat
//  * - Airdrop Farming: Batch ATA creations (high volume initializes, low closures, possibly with dust transfers)
//  * - Sybil-like Behavior: Small SOL transfers out (funding multiple child wallets for farming)
//  * - Batch Creations: Multiple ATAs created in single transactions or clustered in time
//  * 
//  * Auto-Blacklisting:
//  * - Automatically adds suspicious wallets to Redis blacklist
//  * - Immediate blocking on subsequent transactions
//  */

// // Helius REST API configuration
// const HELIUS_API_URL = "https://api.helius.xyz/v0";
// const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
// const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
// const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

// // Import Redis blacklist functionality
// import { addToRedisBlacklist, checkRedisBlacklist } from './redisBlacklist';

// interface HeliusTransaction {
//   signature: string;
//   timestamp: number;
//   type: string;
//   instructions: Array<{
//     programId: string;
//     data: string;
//     accounts: string[];
//     innerInstructions: Array<{
//       programId: string;
//       data: string;
//       accounts: string[];
//     }>;
//   }>;
//   tokenTransfers: any[];
//   nativeTransfers: Array<{
//     fromUserAccount: string;
//     toUserAccount: string;
//     amount: number;
//   }>;
// }

// export interface AtaFarmingAnalysis {
//   isSuspicious: boolean;
//   riskScore: number;
//   flags: string[];
//   details: {
//     totalAccountCreations: number;
//     totalAccountClosures: number;
//     recentAccountCreations: number;
//     recentAccountClosures: number;
//     avgTimeBetweenCreateClose: number; // in seconds
//     maxCreationsPerTx: number;
//     batchCreationTxCount: number;
//     totalBatchedCreations: number;
//     batchPercentage: number;
//     totalSmallSolTransfers: number;
//     suspiciousPatterns: string[];
//     analysisTimestamp: number;
//   };
// }

// /**
//  * Analyze wallet's transaction history for ATA farming patterns
//  * Focused on recent activity (last 50 transactions)
//  */
// export async function analyzeAtaFarmingHistory(
//   walletAddress: string,
//   lookbackLimit: number = 50
// ): Promise<AtaFarmingAnalysis> {
//   console.log(`[ATA_DETECTOR] 🔍 Analyzing ${walletAddress} for farming patterns...`);
  
//   const flags: string[] = [];
//   let riskScore = 0;
  
//   try {
//     // Quick check: Skip analysis if wallet is already blacklisted
//     const existingBlacklist = await checkRedisBlacklist(walletAddress);
//     if (existingBlacklist.blocked) {
//       console.log(`[ATA_DETECTOR] ⚡ Wallet already blacklisted - skipping analysis: ${walletAddress}`);
//       return {
//         isSuspicious: true,
//         riskScore: 100,
//         flags: [`ALREADY_BLACKLISTED: ${existingBlacklist.reason}`],
//         details: {
//           totalAccountCreations: 0,
//           totalAccountClosures: 0,
//           recentAccountCreations: 0,
//           recentAccountClosures: 0,
//           avgTimeBetweenCreateClose: 0,
//           maxCreationsPerTx: 0,
//           batchCreationTxCount: 0,
//           totalBatchedCreations: 0,
//           batchPercentage: 0,
//           totalSmallSolTransfers: 0,
//           suspiciousPatterns: [],
//           analysisTimestamp: Math.floor(Date.now() / 1000),
//         },
//       };
//     }
//     // Validate Helius API key
//     const apiKey = process.env.HELIUS_API_KEY;
//     if (!apiKey || apiKey === "") {
//       console.warn(`[ATA_DETECTOR] ⚠️ HELIUS_API_KEY not configured - skipping analysis`);
//       return createSafeDefault("Helius API key not configured");
//     }

//     // Fetch transaction history from Helius REST API
//     const url = `${HELIUS_API_URL}/addresses/${walletAddress}/transactions?api-key=${apiKey}&limit=${lookbackLimit}`;
//     console.log(`[ATA_DETECTOR] 📡 Fetching transactions from Helius API...`);
    
//     const response = await fetch(url);
//     if (!response.ok) {
//       throw new Error(`Helius API error: ${response.status} ${response.statusText}`);
//     }
    
//     const transactions: HeliusTransaction[] = await response.json();
    
//     if (!transactions || transactions.length === 0) {
//       console.log(`[ATA_DETECTOR] ℹ️ No transaction history found for ${walletAddress}`);
//       return createSafeDefault("No transaction history");
//     }

//     console.log(`[ATA_DETECTOR] ✅ Successfully fetched ${transactions.length} transactions`);
    
//     // Track account operations
//     let accountCreations = 0;
//     let accountClosures = 0;
//     let recentCreations = 0; // Last 7 days
//     let recentClosures = 0; // Last 7 days
//     let maxCreationsPerTx = 0;
//     let totalSmallSolTransfers = 0;
//     let batchCreationTxCount = 0; // Count of transactions with multiple initializes
//     let totalBatchedCreations = 0; // Total creates that were batched
//     const createCloseEvents: Array<{ create: number; close: number | null }> = [];
//     const creationTimestamps: number[] = []; // For clustering analysis
    
//     const now = Math.floor(Date.now() / 1000);
//     const sevenDaysAgo = now - (7 * 24 * 60 * 60);
    
//     // Analyze each transaction
//     for (const tx of transactions) {
//       const timestamp = tx.timestamp || 0;
      
//       // DEBUG: Log first transaction to understand format
//       if (transactions.indexOf(tx) === 0 && tx.instructions) {
//         console.log(`[ATA_DETECTOR] 🔍 DEBUG - First tx:`, {
//           signature: tx.signature.substring(0, 16),
//           type: tx.type,
//           numInstructions: tx.instructions.length,
//           firstInstruction: tx.instructions[0]?.programId,
//         });
//       }
      
//       // Count ATA creations (ATA Program instructions with inner instructions)
//       // The ATA Program creates token accounts via CPI
//       let numInitializes = 0;
//       for (const ix of tx.instructions || []) {
//         if (ix.programId === ATA_PROGRAM_ID && ix.innerInstructions && ix.innerInstructions.length > 0) {
//           // Each ATA Program call creates one token account
//           numInitializes++;
//         }
//       }
      
//       // Count account closures (Token Program "closeAccount" instruction)
//       // CloseAccount instruction has data "A" (base58 encoded instruction discriminator)
//       let numCloses = 0;
//       for (const ix of tx.instructions || []) {
//         // Check top-level instructions
//         if (ix.programId === TOKEN_PROGRAM_ID && ix.data === "A") {
//           numCloses++;
//         }
        
//         // Check inner instructions
//         for (const inner of ix.innerInstructions || []) {
//           if (inner.programId === TOKEN_PROGRAM_ID && inner.data === "A") {
//             numCloses++;
//           }
//         }
//       }
      
//       // Count small SOL transfers (potential Sybil wallet funding)
//       const numSmallSolTransfers = (tx.nativeTransfers || []).filter((transfer: any) => {
//         const amountSOL = transfer.amount / 1e9;
//         return amountSOL > 0 && amountSOL < 0.01 && transfer.fromUserAccount === walletAddress;
//       }).length;
      
//       accountCreations += numInitializes;
//       accountClosures += numCloses;
//       totalSmallSolTransfers += numSmallSolTransfers;
      
//       if (numInitializes > 0) {
//         if (timestamp > sevenDaysAgo) recentCreations += numInitializes;
        
//         // Track for batch detection
//         if (numInitializes > maxCreationsPerTx) maxCreationsPerTx = numInitializes;
        
//         // Count batch transactions (2+ initializes in one tx)
//         if (numInitializes >= 2) {
//           batchCreationTxCount++;
//           totalBatchedCreations += numInitializes;
//         }
        
//         // Push timestamp for each creation (for clustering)
//         for (let i = 0; i < numInitializes; i++) {
//           creationTimestamps.push(timestamp);
//           createCloseEvents.push({ create: timestamp, close: null });
//         }
//       }
      
//       if (numCloses > 0) {
//         if (timestamp > sevenDaysAgo) recentClosures += numCloses;
        
//         // Match closes to recent creates (approximate LIFO)
//         for (let i = 0; i < numCloses; i++) {
//           const recentCreate = createCloseEvents
//             .filter(e => e.close === null)
//             .sort((a, b) => b.create - a.create)[0];
          
//           if (recentCreate) {
//             recentCreate.close = timestamp;
//           }
//         }
//       }
//     }
    
//     console.log(`[ATA_DETECTOR] 📈 Results:`, {
//       tokenAccountInitializations: accountCreations,
//       tokenAccountClosures: accountClosures,
//       recentInitializations: recentCreations,
//       recentClosures: recentClosures,
//       maxCreationsPerTx,
//       batchCreationTxCount,
//       totalBatchedCreations,
//       batchPercentage: accountCreations > 0 ? `${((totalBatchedCreations / accountCreations) * 100).toFixed(0)}%` : '0%',
//       totalSmallSolTransfers,
//       analyzedTransactions: transactions.length,
//     });
    
//     // Calculate average time between create and close
//     const completedCycles = createCloseEvents.filter(e => e.close !== null);
//     let avgTimeBetweenCreateClose = 0;
    
//     if (completedCycles.length > 0) {
//       const totalTime = completedCycles.reduce((sum, e) => {
//         return sum + (e.close! - e.create);
//       }, 0);
//       avgTimeBetweenCreateClose = totalTime / completedCycles.length;
//     }
    
//     // Simple clustering: Sort creation timestamps and check if >5 creations within 1 hour (3600s)
//     creationTimestamps.sort((a, b) => a - b);
//     let clusteredCreations = 0;
//     for (let i = 0; i < creationTimestamps.length; i++) {
//       let clusterSize = 1;
//       for (let j = i + 1; j < creationTimestamps.length && creationTimestamps[j] - creationTimestamps[i] < 3600; j++) {
//         clusterSize++;
//       }
//       if (clusterSize > clusteredCreations) clusteredCreations = clusterSize;
//     }
    
//     // ========================================
//     // RISK SCORING AND FLAG DETECTION
//     // Enhanced for multiple farming types
//     // ========================================
    
//     // Flag 1: High number of token account initializations (general farming indicator)
//     if (accountCreations > 5) {
//       flags.push(`HIGH_INITIALIZE_COUNT: ${accountCreations} token accounts initialized in last 50 txs`);
//       riskScore += 35;
//       if (accountCreations > 10) riskScore += 25;
//     }
    
//     // Flag 2: High closure rate (rent extraction farming)
//     const closureRate = accountCreations > 0 ? accountClosures / accountCreations : 0;
//     if (closureRate > 0.5 && accountCreations > 3) {
//       flags.push(`HIGH_CLOSE_RATE: ${(closureRate * 100).toFixed(0)}% of initialized accounts closed`);
//       riskScore += 45;
//       if (closureRate > 0.7 && accountCreations > 5) riskScore += 30;
//     }
    
//     // New Flag: Low closure rate with high creations (airdrop farming indicator)
//     if (closureRate < 0.3 && accountCreations > 5) {
//       flags.push(`LOW_CLOSE_RATE_HIGH_CREATES: Only ${(closureRate * 100).toFixed(0)}% closures with ${accountCreations} creates - possible airdrop farming`);
//       riskScore += 40;
//       if (accountCreations > 10) riskScore += 20;
//     }
    
//     // Flag 3: Recent suspicious activity (spike in last 7 days)
//     if (recentCreations > 3) {
//       flags.push(`RECENT_SPIKE: ${recentCreations} accounts initialized in 7 days`);
//       riskScore += 30;
//     }
    
//     // Flag 4: Quick initialize-close cycles (rent extraction)
//     if (avgTimeBetweenCreateClose > 0 && avgTimeBetweenCreateClose < 7200) { // 2 hours
//       const avgMinutes = (avgTimeBetweenCreateClose / 60).toFixed(0);
//       flags.push(`QUICK_INIT_CLOSE: avg ${avgMinutes} minutes between initialize-close`);
//       if (avgTimeBetweenCreateClose < 3600) riskScore += 60;
//       else riskScore += 40;
//     }
    
//     // Flag 5: Multiple complete initialize-close cycles (repeated rent farming)
//     if (completedCycles.length > 2) {
//       flags.push(`MULTIPLE_CYCLES: ${completedCycles.length} initialize-close cycles detected`);
//       riskScore += 40;
//       if (completedCycles.length > 5) riskScore += 30;
//     }
    
//     // Flag 6: Active farming pattern (current attack in progress)
//     if (recentCreations > 2 && recentClosures > 1) {
//       flags.push(`ACTIVE_FARMING: Recent initialize-close activity (${recentCreations} init, ${recentClosures} close)`);
//       riskScore += 25;
//     }
    
//     // Flag 7: Pure farming pattern (mostly creates and closes)
//     if (accountCreations > 3 && accountClosures > 2) {
//       const farmingRatio = (accountCreations + accountClosures) / transactions.length;
//       if (farmingRatio > 0.2) {
//         flags.push(`FARMING_DOMINANT: ${(farmingRatio * 100).toFixed(0)}% of last 50 txs are init-close operations`);
//         riskScore += 35;
//       }
//     }
    
//     // New Flag: Batch creations in single tx (STRONG airdrop farming indicator)
//     // Multiple initializes per tx is a clear farming pattern
//     if (maxCreationsPerTx >= 2) {
//       flags.push(`BATCH_CREATIONS: Up to ${maxCreationsPerTx} ATAs created in a single tx`);
//       riskScore += 40;
//       if (maxCreationsPerTx >= 3) riskScore += 25;
//       if (maxCreationsPerTx >= 5) riskScore += 20;
//     }
    
//     // New Flag: Repeated batch creation pattern (VERY SUSPICIOUS)
//     // If >3 transactions have multiple initializes, this is systematic farming
//     if (batchCreationTxCount >= 3) {
//       flags.push(`REPEATED_BATCHING: ${batchCreationTxCount} transactions with batch creations`);
//       riskScore += 50;
//       if (batchCreationTxCount >= 5) riskScore += 30;
//     }
    
//     // New Flag: High percentage of batched creations
//     // If >50% of all creates were done in batches, it's coordinated farming
//     if (accountCreations > 0 && totalBatchedCreations > 0) {
//       const batchPercentage = (totalBatchedCreations / accountCreations) * 100;
//       if (batchPercentage > 50 && accountCreations > 5) {
//         flags.push(`BATCHING_DOMINANT: ${batchPercentage.toFixed(0)}% of creates were batched`);
//         riskScore += 45;
//         if (batchPercentage > 80) riskScore += 25;
//       }
//     }
    
//     // New Flag: Clustered creations (time-based batching)
//     if (clusteredCreations > 5) {
//       flags.push(`CLUSTERED_CREATIONS: ${clusteredCreations} ATAs created within 1 hour`);
//       riskScore += 35;
//     }
    
//     // New Flag: Small SOL transfers (possible Sybil wallet funding for distributed farming)
//     if (totalSmallSolTransfers > 5) {
//       flags.push(`SMALL_SOL_TRANSFERS: ${totalSmallSolTransfers} small SOL transfers detected - possible Sybil funding`);
//       riskScore += 30;
//       if (totalSmallSolTransfers > 10) riskScore += 20;
//     }
    
//     // New Flag: Account creation is primary activity (farming-focused wallet)
//     // Real farming wallets have >40% of their activity as CREATE ACCOUNT
//     if (transactions.length > 0) {
//       const createRatio = accountCreations / transactions.length;
//       if (createRatio > 0.4 && accountCreations > 5) {
//         flags.push(`CREATE_DOMINANT: ${(createRatio * 100).toFixed(0)}% of transactions are account creations`);
//         riskScore += 40;
//         if (createRatio > 0.6) riskScore += 30; // More than 60% = extreme
//       }
//     }
    
//     // Calculate final risk assessment
//     const isSuspicious = riskScore >= 70;
    
//     if (isSuspicious) {
//       console.log(`[ATA_DETECTOR] 🚨 SUSPICIOUS WALLET DETECTED:`, {
//         address: walletAddress,
//         riskScore,
//         flags,
//       });
      
//       // AUTO-BLACKLIST: Add suspicious wallet to Redis blacklist immediately
//       try {
//         const blacklistReason = `ATA farming detected: Risk score ${riskScore}, Flags: ${flags.join(', ')}`;
//         await addToRedisBlacklist(walletAddress, blacklistReason);
//         console.log(`[ATA_DETECTOR] 🚫 AUTO-BLACKLISTED: ${walletAddress} - ${blacklistReason}`);
//       } catch (blacklistError) {
//         console.error(`[ATA_DETECTOR] ❌ Failed to blacklist ${walletAddress}:`, blacklistError);
//         // Continue with analysis even if blacklisting fails
//       }
//     } else {
//       console.log(`[ATA_DETECTOR] ✅ Clean wallet - Risk score: ${riskScore}`);
//     }
    
//     return {
//       isSuspicious,
//       riskScore,
//       flags,
//       details: {
//         totalAccountCreations: accountCreations,
//         totalAccountClosures: accountClosures,
//         recentAccountCreations: recentCreations,
//         recentAccountClosures: recentClosures,
//         avgTimeBetweenCreateClose,
//         maxCreationsPerTx,
//         batchCreationTxCount,
//         totalBatchedCreations,
//         batchPercentage: accountCreations > 0 ? (totalBatchedCreations / accountCreations) * 100 : 0,
//         totalSmallSolTransfers,
//         suspiciousPatterns: completedCycles.length > 0 
//           ? [`${completedCycles.length} create-close cycles detected`]
//           : [],
//         analysisTimestamp: now,
//       },
//     };
    
//   } catch (error) {
//     console.error(`[ATA_DETECTOR] ❌ Error analyzing wallet:`, error);
    
//     // On error, return safe default (don't block transaction due to analysis failure)
//     return createSafeDefault(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
//   }
// }

// /**
//  * Quick check if wallet has obvious farming pattern
//  * (Returns boolean for simple yes/no check)
//  */
// export async function hasAtaFarmingPattern(
//   walletAddress: string
// ): Promise<boolean> {
//   const analysis = await analyzeAtaFarmingHistory(walletAddress);
//   return analysis.isSuspicious;
// }

// /**
//  * Cache analysis results to avoid repeated API calls
//  * (5 minute TTL - balance between freshness and API costs)
//  */
// const analysisCache = new Map<string, { 
//   result: AtaFarmingAnalysis; 
//   timestamp: number 
// }>();

// const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// export async function getCachedAtaFarmingAnalysis(
//   walletAddress: string
// ): Promise<AtaFarmingAnalysis> {
//   const cached = analysisCache.get(walletAddress);
  
//   if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
//     console.log(`[ATA_DETECTOR] 📦 Using cached result for ${walletAddress.substring(0, 8)}...`);
//     return cached.result;
//   }
  
//   const result = await analyzeAtaFarmingHistory(walletAddress);
//   analysisCache.set(walletAddress, { result, timestamp: Date.now() });
  
//   // Clean up old cache entries (prevent memory leak)
//   cleanupCache();
  
//   return result;
// }

// /**
//  * Create safe default response when analysis cannot be performed
//  */
// function createSafeDefault(reason: string): AtaFarmingAnalysis {
//   return {
//     isSuspicious: false,
//     riskScore: 0,
//     flags: [`ANALYSIS_SKIPPED: ${reason}`],
//     details: {
//       totalAccountCreations: 0,
//       totalAccountClosures: 0,
//       recentAccountCreations: 0,
//       recentAccountClosures: 0,
//       avgTimeBetweenCreateClose: 0,
//       maxCreationsPerTx: 0,
//       batchCreationTxCount: 0,
//       totalBatchedCreations: 0,
//       batchPercentage: 0,
//       totalSmallSolTransfers: 0,
//       suspiciousPatterns: [],
//       analysisTimestamp: Math.floor(Date.now() / 1000),
//     },
//   };
// }

// /**
//  * Clean up old cache entries to prevent memory bloat
//  */
// function cleanupCache() {
//   const now = Date.now();
//   const entries = Array.from(analysisCache.entries());
  
//   for (const [address, data] of entries) {
//     if (now - data.timestamp > CACHE_TTL) {
//       analysisCache.delete(address);
//     }
//   }
// }

// /**
//  * Get cache statistics (for monitoring/debugging)
//  */
// export function getCacheStats() {
//   return {
//     size: analysisCache.size,
//     entries: Array.from(analysisCache.entries()).map(([address, data]) => ({
//       address: address.substring(0, 8) + '...',
//       age: Math.floor((Date.now() - data.timestamp) / 1000),
//       riskScore: data.result.riskScore,
//       isSuspicious: data.result.isSuspicious,
//     })),
//   };
// }

// /**
//  * Clear all cache (useful for testing/debugging)
//  */
// export function clearCache() {
//   analysisCache.clear();
//   console.log(`[ATA_DETECTOR] 🗑️ Cache cleared`);
// }