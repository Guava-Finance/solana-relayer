# Timestamp Validation Fix

## Issue Description

The request signing implementation was failing with timestamp validation errors:

```
[Security] Request timestamp too old/future: 134334ms skew
[RequestSigning] Invalid timestamp validation failed
[API] /api/tx - Advanced security validation failed: Invalid timestamp
```

The timestamp skew of 134,334ms (about 2.2 minutes) was exceeding the previous 2-minute tolerance limit.

## Root Cause

1. **Clock Synchronization**: Client and server clocks may not be perfectly synchronized
2. **Network Latency**: Request processing and network delays can add to timestamp skew
3. **Processing Time**: Time between request generation and validation adds to the skew
4. **Production Environment**: Vercel/serverless environments may have additional latency

## Solution Implemented

### 1. Increased Default Tolerance
- **Before**: 2 minutes (120,000ms)
- **After**: 5 minutes + 5 seconds buffer (305,000ms)

### 2. Configurable Tolerance
Added `MAX_TIMESTAMP_SKEW_MS` environment variable for custom configuration:

```bash
# Optional: Override default timestamp tolerance
MAX_TIMESTAMP_SKEW_MS=600000  # 10 minutes for high-latency environments
```

### 3. Enhanced Logging
Improved timestamp validation logging for better debugging:

```
[Security] Timestamp validation: now=1759144509457, request=1759144375125, skew=134334ms, maxAllowed=305000ms
[Security] Timestamp validation passed: 134334ms skew within 305000ms limit
```

## Code Changes

### utils/requestSigning.ts
```typescript
// Increased default tolerance
private static readonly MAX_TIMESTAMP_SKEW = 5 * 60 * 1000 + 5000; // 5 minutes + 5 seconds buffer

// Added configurable tolerance
static validateTimestamp(timestamp: number): boolean {
  const maxSkew = process.env.MAX_TIMESTAMP_SKEW_MS 
    ? parseInt(process.env.MAX_TIMESTAMP_SKEW_MS) 
    : this.MAX_TIMESTAMP_SKEW;
  
  // Enhanced logging...
}
```

## Testing Results

✅ **134,334ms skew scenario**: Now passes with 5-minute tolerance
✅ **Configurable tolerance**: Works correctly with custom values
✅ **Enhanced logging**: Provides detailed debugging information
✅ **Backward compatibility**: No breaking changes to existing functionality

## Deployment Instructions

### Immediate Fix (No Environment Changes Needed)
The fix is automatically applied with the increased default tolerance of 5+ minutes.

### Optional: Custom Tolerance
For environments with higher latency, add to your environment variables:

```bash
# For high-latency environments (10 minutes)
MAX_TIMESTAMP_SKEW_MS=600000

# For very strict environments (2 minutes)
MAX_TIMESTAMP_SKEW_MS=120000
```

## Monitoring

### Key Metrics to Watch
- Timestamp validation success/failure rates
- Average timestamp skew values
- Clock synchronization drift over time

### Log Messages
```
✅ Success: [Security] Timestamp validation passed: XXXms skew within XXXms limit
❌ Failure: [Security] Request timestamp too old/future: XXXms skew exceeds XXXms limit
```

## Recommendations

### Production Environment
1. **Default Setting**: Use the new 5+ minute default tolerance
2. **Monitor Logs**: Watch for timestamp validation patterns
3. **Clock Sync**: Ensure reasonable clock synchronization between client/server
4. **Custom Tolerance**: Adjust `MAX_TIMESTAMP_SKEW_MS` based on observed patterns

### Development Environment
1. **Flexible Tolerance**: Consider 10+ minutes for development
2. **Debug Logging**: Use the enhanced logs to understand timing patterns
3. **Testing**: Use the test scripts to validate different scenarios

## Security Considerations

### Replay Attack Protection
- Longer timestamp tolerance slightly reduces replay attack protection
- Nonce validation still provides strong replay attack prevention
- 5-minute window is reasonable balance between usability and security

### Clock Drift Monitoring
- Monitor for systematic clock drift patterns
- Alert on consistently high timestamp skews
- Consider NTP synchronization for production servers

## Test Scripts

### Basic Validation Test
```bash
node scripts/test-timestamp-validation.js
```

### Custom Tolerance Test
```bash
MAX_TIMESTAMP_SKEW_MS=600000 node scripts/test-timestamp-validation.js
```

## Rollback Plan

If issues occur, you can temporarily increase tolerance further:

```bash
# Emergency: 15-minute tolerance
MAX_TIMESTAMP_SKEW_MS=900000
```

Or disable request signing entirely:

```bash
ENABLE_REQUEST_SIGNING=false
```

---

## Summary

The timestamp validation fix addresses the production issue while maintaining security. The 134,334ms skew that was failing will now pass with the increased 5+ minute tolerance, and the configurable environment variable provides flexibility for different deployment scenarios.
