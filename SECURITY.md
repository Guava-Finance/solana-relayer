# 🛡️ Security Implementation Guide

## Overview
This document outlines the comprehensive security measures implemented in the Solana Relayer to protect against various attack vectors.

## 🔐 Security Layers

### 1. **Request Signing & Nonce Protection**
- **File**: `utils/requestSigning.ts`
- **Purpose**: Prevents replay attacks and ensures request authenticity
- **Features**:
  - HMAC-SHA256 request signatures
  - Nonce-based replay protection
  - Timestamp validation (2-minute window)
  - Redis-backed nonce storage

**Client Implementation Required:**
```typescript
// Generate signature on client side
const timestamp = Date.now();
const nonce = generateNonce();
const signature = generateRequestSignature(method, path, body, timestamp, nonce, secretKey);

// Include in headers
headers: {
  'x-timestamp': timestamp,
  'x-nonce': nonce,
  'x-signature': signature,
  'x-client-id': clientId
}
```

### 2. **Threat Detection System**
- **File**: `utils/threatDetection.ts`
- **Purpose**: Identifies and blocks suspicious behavior patterns
- **Detection Methods**:
  - IP behavior analysis (request rates, user agents)
  - Bot detection (suspicious headers, timing patterns)
  - Geographic anomaly detection
  - Automatic IP blocking for high-risk scores

**Threat Scoring:**
- Score 0-25: Low risk
- Score 26-50: Medium risk  
- Score 51-74: High risk
- Score 75+: Blocked automatically

### 3. **Transaction Monitoring**
- **File**: `utils/transactionMonitoring.ts`
- **Purpose**: Detects suspicious transaction patterns
- **Analysis Areas**:
  - Sender behavior (frequency, amounts, receivers)
  - Receiver patterns (volume, new account deposits)
  - Amount analysis (dust attacks, large transfers)
  - Blacklist/greylist checking

**Risk Factors:**
- High-frequency transactions
- Many unique receivers
- Unusual amount patterns
- Round number amounts (bot behavior)
- Blacklisted addresses

### 4. **Enhanced Security Manager**
- **File**: `utils/enhancedSecurity.ts`
- **Purpose**: Orchestrates all security layers
- **Features**:
  - Unified security validation
  - Configurable security thresholds
  - Comprehensive logging
  - Automatic threat response

## 🚀 Implementation in API Endpoints

### Example Integration:
```typescript
import { EnhancedSecurityManager } from '../utils/enhancedSecurity';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Basic security validation
  const securityCheck = await EnhancedSecurityManager.validateRequest(req, res);
  if (!securityCheck.allowed) {
    return res.status(403).json(
      EnhancedSecurityManager.createSecurityErrorResponse(securityCheck.error!)
    );
  }

  // 2. Transaction-specific validation (for tx endpoints)
  if (req.body.senderAddress) {
    const txValidation = await EnhancedSecurityManager.validateTransaction(
      req.body.senderAddress,
      req.body.receiverAddress,
      req.body.amount,
      req.body.tokenMint
    );
    
    if (!txValidation.allowed) {
      return res.status(403).json(
        EnhancedSecurityManager.createSecurityErrorResponse(txValidation.error!)
      );
    }
  }

  // Continue with normal endpoint logic...
}
```

## ⚙️ Configuration

### Environment Variables:
```bash
# Security Features
ENABLE_REQUEST_SIGNING=false          # Requires client-side implementation
ENABLE_THREAT_DETECTION=true         # Recommended: always enabled
ENABLE_TRANSACTION_MONITORING=true   # Recommended: always enabled

# Thresholds
THREAT_DETECTION_THRESHOLD=75        # 0-100 risk score
TRANSACTION_RISK_THRESHOLD=80        # 0-100 risk score
AUTO_BLOCK_HIGH_RISK=true           # Auto-block high-risk IPs
SECURITY_BLOCK_DURATION=3600        # Block duration in seconds

# Request Signing (if enabled)
REQUEST_SIGNING_SECRET=your_secret_here
```

## 📊 Monitoring & Analytics

### Redis Keys Used:
- `nonce:${clientId}:${nonce}` - Nonce tracking
- `ip_pattern:${ip}` - IP behavior patterns
- `timing:${ip}` - Request timing analysis
- `blocked:${ip}` - Blocked IP addresses
- `sender_pattern:${address}` - Transaction sender patterns
- `receiver_pattern:${address}` - Transaction receiver patterns
- `blacklist:addresses` - Blacklisted addresses
- `greylist:addresses` - Suspicious addresses
- `threat_events` - Security events log
- `suspicious_transactions` - Flagged transactions

### Monitoring Commands:
```bash
# Check threat events
redis-cli lrange threat_events 0 10

# Check suspicious transactions
redis-cli lrange suspicious_transactions 0 10

# Check blocked IPs
redis-cli keys "blocked:*"

# Check blacklisted addresses
redis-cli smembers blacklist:addresses
```

## 🎯 Attack Prevention

### **Griefing/Rent-Extraction Protection:**
- User signature verification for ATA creation
- Sender ATA existence check in transfers
- Progressive rate limiting

### **DDoS Protection:**
- IP-based rate limiting
- Progressive penalties
- Automatic IP blocking
- Request pattern analysis

### **Bot Detection:**
- User agent analysis
- Request timing patterns
- Header fingerprinting
- Behavioral analysis

### **Transaction Fraud Prevention:**
- Amount pattern analysis
- Blacklist checking
- Velocity monitoring
- Anomaly detection

## 🔧 Maintenance

### **Regular Tasks:**
1. **Review Security Logs:**
   ```bash
   # Check recent threats
   redis-cli lrange threat_events 0 50
   ```

2. **Update Blacklists:**
   ```typescript
   await TransactionMonitor.blacklistAddress(address, reason);
   ```

3. **Monitor Redis Usage:**
   ```bash
   redis-cli info memory
   redis-cli dbsize
   ```

4. **Adjust Thresholds:**
   - Monitor false positive rates
   - Adjust based on legitimate traffic patterns
   - Update threat detection rules

### **Security Incident Response:**
1. **Immediate Actions:**
   - Block malicious IPs
   - Blacklist suspicious addresses
   - Increase security thresholds temporarily

2. **Investigation:**
   - Review security logs
   - Analyze attack patterns
   - Update detection rules

3. **Recovery:**
   - Remove false positives
   - Restore legitimate access
   - Document lessons learned

## 📈 Performance Impact

### **Overhead Analysis:**
- **Threat Detection**: ~5-10ms per request
- **Transaction Monitoring**: ~10-15ms per transaction
- **Request Signing**: ~2-5ms per request
- **Redis Operations**: ~1-3ms per operation

### **Optimization Tips:**
- Use Redis pipelining for multiple operations
- Implement caching for frequently accessed data
- Monitor Redis memory usage
- Use appropriate TTL values

## 🚨 Security Alerts

### **High-Priority Alerts:**
- Multiple failed authentication attempts
- High-risk transaction patterns
- Unusual geographic access patterns
- Rapid account creation attempts

### **Alert Integration:**
```typescript
// Example webhook notification
if (riskScore > 90) {
  await sendSecurityAlert({
    type: 'HIGH_RISK_TRANSACTION',
    details: { sender, receiver, amount, riskScore, flags }
  });
}
```

## 📝 Best Practices

1. **Regular Security Reviews:**
   - Weekly log analysis
   - Monthly threshold adjustments
   - Quarterly security audits

2. **Incident Documentation:**
   - Log all security events
   - Document response actions
   - Track false positive rates

3. **Continuous Improvement:**
   - Monitor attack trends
   - Update detection algorithms
   - Enhance threat intelligence

4. **Client-Side Security:**
   - Implement request signing
   - Use secure key storage
   - Validate server responses

## 🔗 Additional Resources

- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [Solana Security Best Practices](https://docs.solana.com/developing/programming-model/security)
- [Redis Security Guidelines](https://redis.io/topics/security)
