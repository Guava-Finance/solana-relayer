# Signature Validation Fix

## Issue Summary

The request signing implementation is working correctly, but signature validation is failing due to environment configuration issues.

### Current Status
✅ **Timestamp validation**: Fixed (2504ms skew within 305000ms limit)  
✅ **Flutter app signing**: Working correctly (generates proper headers)  
❌ **Signature validation**: Failing due to secret key mismatch  

### Error Details
```
[RequestSigning] Signature validation failed
[API] /api/tx - Advanced security validation failed: Invalid request signature
```

## Root Cause

The relayer is using `"default-secret"` (14 characters) instead of the proper `REQUEST_SIGNING_SECRET` environment variable. This indicates the environment variable is not set in the production deployment.

### Evidence from Debug Logs
- Relayer secret key length: 14 characters ("default-secret")
- Flutter app is generating signatures with `Env.requestSigningSecret`
- Signatures don't match because different secrets are being used

## Immediate Fix Options

### Option 1: Set Proper Environment Variable (Recommended)
Set the `REQUEST_SIGNING_SECRET` environment variable in your Vercel deployment:

```bash
# In Vercel dashboard or CLI
REQUEST_SIGNING_SECRET=your-actual-secret-key-here
```

### Option 2: Temporarily Disable Request Signing
If you need immediate functionality while configuring the environment:

```bash
# Set in Vercel environment variables
ENABLE_REQUEST_SIGNING=false
```

### Option 3: Use Default Secret Temporarily
Update the Flutter app to use the same default secret temporarily:

```dart
// In solana.dart - TEMPORARY FIX ONLY
final String _requestSigningSecret = 'default-secret';
```

## Recommended Implementation Steps

### Step 1: Configure Environment Variable
1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add `REQUEST_SIGNING_SECRET` with a strong secret key
4. Redeploy the application

### Step 2: Verify Secret Key Consistency
Ensure both Flutter app and relayer use the same secret:

**Flutter (.env file):**
```
REQUEST_SIGNING_SECRET=your-production-secret-key-2024
```

**Relayer (Vercel environment):**
```
REQUEST_SIGNING_SECRET=your-production-secret-key-2024
```

### Step 3: Test the Fix
After setting the environment variable, test with a transaction request.

## Debug Information

### Current Request Headers (from logs)
```
x-signature: 924d4b59725256e4fa0eee6e6acf86aecb6a88c5fff6e147e2363f24d40464ee
x-timestamp: 1759144856337
x-nonce: Q5cBLCo5HxvqZHx0OU6nRg==
x-client-id: guava-flutter-client
```

### Expected vs Actual Signatures
- **Flutter generated**: `924d4b59725256e4fa0eee6e6acf86aecb6a88c5fff6e147e2363f24d40464ee`
- **Relayer expected**: Different (due to "default-secret" vs actual secret)

## Security Considerations

### Production Secret Key Requirements
- **Length**: At least 32 characters
- **Complexity**: Mix of letters, numbers, and symbols
- **Uniqueness**: Different from any default or example values
- **Secrecy**: Never commit to version control

### Example Strong Secret
```
REQUEST_SIGNING_SECRET=prod-guava-hmac-sha256-secret-2024-v1-secure-key-xyz789
```

## Verification Steps

### 1. Check Environment Variable
Add temporary logging to verify the secret is loaded:

```typescript
// In requestSigning.ts (temporary debug)
console.log(`[DEBUG] Secret key loaded: ${secretKey.substring(0, 4)}...${secretKey.substring(secretKey.length-4)} (length: ${secretKey.length})`);
```

### 2. Test Signature Generation
Use the debug script to test with the actual secret:

```bash
REQUEST_SIGNING_SECRET=your-actual-secret node scripts/debug-signature-mismatch.js
```

### 3. Monitor Logs
Watch for successful signature validation:

```
[RequestSigning] Request validation successful
```

## Rollback Plan

If issues persist:

1. **Immediate**: Set `ENABLE_REQUEST_SIGNING=false`
2. **Debug**: Use enhanced logging to identify the exact mismatch
3. **Fix**: Correct the environment configuration
4. **Re-enable**: Set `ENABLE_REQUEST_SIGNING=true`

## Implementation Checklist

- [ ] Set `REQUEST_SIGNING_SECRET` in Vercel environment
- [ ] Verify Flutter app uses `Env.requestSigningSecret`
- [ ] Test signature generation with debug script
- [ ] Deploy and test with actual transaction
- [ ] Monitor logs for successful validation
- [ ] Remove debug logging after verification

## Expected Result

After fixing the environment variable, you should see:

```
[RequestSigning] Request signing is enabled, validating request
[Security] Timestamp validation passed: XXXms skew within 305000ms limit
[RequestSigning] Request validation successful
[API] /api/tx - Transaction created successfully
```

---

**Next Action**: Set the `REQUEST_SIGNING_SECRET` environment variable in your Vercel deployment with the same value used in the Flutter app's `.env` file.
