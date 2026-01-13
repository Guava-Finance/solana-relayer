// Utility for initializing paj_ramp SDK
import { initializeSDK, Environment } from "paj_ramp";

let isInitialized = false;

/**
 * Initialize paj_ramp SDK with environment selection
 * 
 * This function should be called before using any paj_ramp functions.
 * It initializes the SDK with the selected environment (staging or production).
 * 
 * @param environment - Environment to use: "staging" | "production" (default: "production")
 */
export function initializePajRamp(environment: "staging" | "production" = "production"): void {
  if (isInitialized) {
    return; // Already initialized, skip
  }

  const env = environment === "staging" ? Environment.Staging : Environment.Production;
  initializeSDK(env);
  isInitialized = true;
  console.log(`[PAJ-RAMP] SDK initialized with environment: ${environment}`);
}

/**
 * Ensure paj_ramp SDK is initialized
 * Reads environment from PAJ_ENVIRONMENT env var or defaults to production
 */
export function ensurePajRampInitialized(): void {
  if (isInitialized) {
    return;
  }

  const environment = (process.env.PAJ_ENVIRONMENT || "production") as "staging" | "production";
  initializePajRamp(environment);
}

/**
 * Get the business API key from environment variables
 */
export function getPajBusinessApiKey(): string {
  const apiKey = process.env.PAJ_BUSINESS_API_KEY;
  if (!apiKey) {
    throw new Error("PAJ_BUSINESS_API_KEY is not configured in environment variables");
  }
  return apiKey;
}

/**
 * Reset initialization state (useful for testing)
 */
export function resetPajRampInitialization(): void {
  isInitialized = false;
}

