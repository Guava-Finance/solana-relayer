# New Transaction Flow

## ✅ Reorganized Flow

Successfully reorganized the transaction processing flow to match the requested sequence.

---

## 🔄 New Flow Order

### **STEP 1: Rate Limiting** ⚡
```typescript
if (!(await rateLimiter.checkWithSender(req, res, senderAddress))) {
  return; // Rate limit exceeded, response already sent
}
```
- **Purpose**: Prevent spam/DoS attacks
- **Action**: Block if rate limit exceeded

---

### **STEP 2: Emergency Blacklist Check** 🚫
```typescript
const emergencyCheck = validateEmergencyBlacklist(senderAddress, receiverAddress);
if (emergencyCheck.blocked) {
  return res.status(403).json(/* blocked response */);
}
```
- **Purpose**: Block known bad actors
- **Action**: Immediate rejection if blacklisted

---

### **STEP 3: Check if ATA Needs to be Created** 🔍
```typescript
const receiverAccountInfo = await connection.getAccountInfo(receiverAta);
if (!receiverAccountInfo) {
  receiverNeedsAta = true; // Flag for farming detection
}
```
- **Purpose**: Determine if receiver needs ATA creation
- **Action**: Set flag for farming detection

---

### **STEP 4: ATA Farming Detection** 🛡️
```typescript
if (receiverNeedsAta) {
  const farmingAnalysis = await getCachedAtaFarmingAnalysis(senderAddress);
  if (farmingAnalysis.isSuspicious) {
    return res.status(403).json(createSecurityErrorResponse(errorMessage));
  }
}
```
- **Purpose**: Block wallets with farming patterns
- **Action**: **Immediate blacklist** if high risk score detected
- **Only runs**: When receiver needs ATA creation

---

### **STEP 5: Setup Relayer Wallet** 🔑
```typescript
relayerWallet = Keypair.fromSecretKey(base58.decode(process.env.WALLET));
```
- **Purpose**: Prepare relayer for transaction signing
- **Action**: Load and validate relayer wallet

---

### **STEP 6: Validation** ✅
```typescript
// Validate all input parameters
if (!senderAddress || !receiverAddress || !tokenMint || !parsedAmount) {
  return res.status(400).json(/* validation error */);
}
```
- **Purpose**: Validate all transaction parameters
- **Action**: Reject if validation fails

---

### **STEP 7: Transaction Processing** ⚙️
```typescript
// Build and execute transaction
const instructions = [];
// ... transaction building logic
```
- **Purpose**: Execute the actual transaction
- **Action**: Process if all checks pass

---

## 🎯 Key Benefits

### **1. Early Blocking** 🚨
- **Rate limiting** blocks spam immediately
- **Blacklist** blocks known bad actors instantly
- **ATA farming detection** blocks suspicious wallets before processing

### **2. Optimized Performance** ⚡
- **ATA farming detection** only runs when receiver needs ATA
- **No unnecessary API calls** for existing receivers
- **Early exits** prevent wasted processing

### **3. Clear Flow** 📋
- **Step-by-step** progression
- **Clear logging** at each step
- **Easy to debug** and maintain

### **4. Security Focus** 🔒
- **Multiple layers** of protection
- **Immediate blocking** of threats
- **Focused detection** on actual risks

---

## 📊 Flow Diagram

```
Request
    ↓
[1] Rate Limiting
    ↓ (if passed)
[2] Emergency Blacklist Check
    ↓ (if passed)
[3] Check ATA Requirements
    ↓ (if receiver needs ATA)
[4] ATA Farming Detection
    ↓ (if clean wallet)
[5] Setup Relayer Wallet
    ↓
[6] Validation
    ↓ (if valid)
[7] Process Transaction
    ↓
Success Response
```

---

## 🚨 Blocking Points

| Step | Blocking Condition | Response |
|------|-------------------|----------|
| **1** | Rate limit exceeded | 429 Too Many Requests |
| **2** | Address blacklisted | 403 Forbidden |
| **4** | High risk score (≥70) | 403 Forbidden + Encrypted Error |
| **6** | Invalid parameters | 400 Bad Request |

---

## 📝 Logging Output

```
[API] /api/tx - STEP 1: Rate Limiting ✅
[API] /api/tx - STEP 2: Emergency Blacklist Check ✅
[API] /api/tx - STEP 3: Checking ATA requirements...
[API] /api/tx - Receiver ATA needs creation (relayer will pay)
[API] /api/tx - STEP 4: ATA Farming Detection: ENABLED ✅
[API] /api/tx - 🔍 Receiver ATA needs creation - Running farming detection...
[API] /api/tx - Analysis complete: { riskScore: 0, isSuspicious: false }
[API] /api/tx - ✅ No ATA farming patterns detected - proceeding with transaction
[API] /api/tx - STEP 5: Setup Relayer Wallet ✅
[API] /api/tx - STEP 6: Validation ✅
[API] /api/tx - STEP 7: Processing transaction...
```

---

## ✅ Result

The new flow provides **optimal security** with **maximum efficiency**:

- ✅ **Fast blocking** of threats
- ✅ **Minimal API calls** (only when needed)
- ✅ **Clear progression** through security checks
- ✅ **Immediate blacklisting** of high-risk wallets
- ✅ **Focused detection** on actual farming scenarios

**Perfect balance of security and performance!** 🎯
