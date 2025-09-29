# Environment Configuration for Request Signing

## Required Environment Variables

### Request Signing Configuration

```bash
# Enable/disable request signing (set to 'true' to enable)
ENABLE_REQUEST_SIGNING=false

# Secret key for HMAC-SHA256 request signing
# IMPORTANT: Use a strong, unique secret key in production
REQUEST_SIGNING_SECRET=your-super-secret-signing-key-here
```

### Existing Configuration (Required)

```bash
# AES encryption for request/response data
AES_ENCRYPTION_KEY=your-aes-encryption-key
AES_ENCRYPTION_IV=your-aes-iv-16b!!

# Redis for nonce tracking (required when request signing is enabled)
REDIS_URL=redis://localhost:6379

# Solana wallet and RPC configuration
WALLET=your-base58-encoded-private-key
ALCHEMY=https://solana-mainnet.g.alchemy.com/v2/your-api-key

# Node environment
NODE_ENV=development
```

## Configuration Examples

### Development Environment (Request Signing Disabled)
```bash
ENABLE_REQUEST_SIGNING=false
REQUEST_SIGNING_SECRET=dev-secret-key
AES_ENCRYPTION_KEY=dev-aes-key
AES_ENCRYPTION_IV=dev-iv-16bytes!!
REDIS_URL=redis://localhost:6379
NODE_ENV=development
```

### Production Environment (Request Signing Enabled)
```bash
ENABLE_REQUEST_SIGNING=true
REQUEST_SIGNING_SECRET=prod-super-secure-signing-key-2024
AES_ENCRYPTION_KEY=prod-aes-encryption-key
AES_ENCRYPTION_IV=prod-iv-16bytes!!
REDIS_URL=redis://your-redis-host:6379
NODE_ENV=production
```

## Security Considerations

### Request Signing Secret
- **MUST** be at least 32 characters long
- **MUST** be unique per environment
- **MUST** be kept secret and secure
- **SHOULD** be rotated periodically
- **NEVER** commit to version control

### Redis Configuration
- Required when `ENABLE_REQUEST_SIGNING=true`
- Used for nonce tracking to prevent replay attacks
- Should be secured with authentication in production
- Monitor Redis performance and availability

## Testing Configuration

To test the configuration:

```bash
# Test with request signing disabled
ENABLE_REQUEST_SIGNING=false node scripts/test-request-signing.js

# Test with request signing enabled
ENABLE_REQUEST_SIGNING=true REQUEST_SIGNING_SECRET=test-secret node scripts/test-request-signing.js
```

## Deployment Checklist

### Before Enabling Request Signing in Production:

1. ✅ Set strong `REQUEST_SIGNING_SECRET`
2. ✅ Ensure Redis is available and secured
3. ✅ Update Flutter app with matching secret
4. ✅ Test with `ENABLE_REQUEST_SIGNING=true` in staging
5. ✅ Monitor logs for validation errors
6. ✅ Verify all API endpoints work correctly
7. ✅ Set up monitoring for Redis availability
8. ✅ Document rollback procedure

### Rollback Procedure:

If issues occur after enabling request signing:

1. Set `ENABLE_REQUEST_SIGNING=false`
2. Restart the relayer service
3. Monitor for normal operation
4. Investigate and fix issues
5. Re-enable with proper testing

## Monitoring

### Key Metrics to Monitor:

- Request signing validation success/failure rates
- Redis connection status and performance
- Nonce collision attempts
- Timestamp validation failures
- Overall API response times

### Log Messages to Watch:

```
[RequestSigning] Request signing is enabled, validating request
[RequestSigning] Request signing is disabled, skipping validation
[RequestSigning] Missing required security headers
[RequestSigning] Signature validation failed
[RequestSigning] Nonce validation error (Redis may be unavailable)
```

## Troubleshooting

### Common Issues:

1. **"Missing security headers" errors**
   - Ensure Flutter app is generating proper headers
   - Check that `generateSecurityHeaders()` is being called

2. **"Invalid request signature" errors**
   - Verify `REQUEST_SIGNING_SECRET` matches between client and server
   - Check timestamp synchronization
   - Ensure request body is identical on both sides

3. **"Nonce validation service unavailable" errors**
   - Check Redis connectivity
   - Verify `REDIS_URL` is correct
   - Monitor Redis server status

4. **Request signing not working**
   - Verify `ENABLE_REQUEST_SIGNING=true`
   - Check environment variable loading
   - Review server logs for configuration messages
