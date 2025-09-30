# 🚀 Quick Setup: Helius ATA Farming Detection

## ⚡ 3-Step Setup

### **Step 1: Get API Key** (2 minutes)
1. Visit https://helius.dev
2. Sign up / Log in
3. Create new project
4. Copy API key

### **Step 2: Add to Environment** (1 minute)
```bash
# Add to your .env file:
HELIUS_API_KEY=your_helius_api_key_here
```

### **Step 3: Restart Server** (10 seconds)
```bash
npm run dev
# or
npm start
```

✅ **That's it!** ATA farming detection is now active.

---

## 🔍 Verify It's Working

Look for this in your logs:
```
[ATA_DETECTOR] 🔍 Analyzing sender for ATA farming patterns...
[ATA_DETECTOR] ✅ Clean wallet - Risk score: 15
```

Or if blocking a suspicious wallet:
```
[ATA_DETECTOR] 🚨 BLOCKING TRANSACTION - ATA farming pattern detected
```

---

## 💰 Pricing

| Tier | Requests/Day | Cost |
|------|--------------|------|
| **Free** | 100 | $0 |
| **Developer** ⭐ | 10,000 | $49/month |
| **Professional** | 100,000 | $249/month |

**Recommendation:** Start with Free, upgrade to Developer for production.

---

## 🛡️ What It Does

**Blocks wallets with suspicious patterns:**
- ❌ High account creation count (> 50)
- ❌ High closure rate (> 50%)
- ❌ Quick create-close cycles (< 1 hour)
- ❌ Recent suspicious activity (> 10 creates in 7 days)
- ❌ Multiple complete cycles (> 5)

**Threshold:** Risk score ≥ 70/100

---

## 📊 Expected Results

```
Normal user sending to new wallet:
  Risk Score: 0-20
  Result: ✅ ALLOWED

ATA farmer with history:
  Risk Score: 80-150
  Result: ❌ BLOCKED + BLACKLISTED
```

---

## ⚠️ Important Notes

1. **Only checks when ATAs need creation** (saves API calls)
2. **Caches results for 5 minutes** (reduces costs)
3. **Fails open if API is down** (doesn't block legitimate users)
4. **Auto-blacklists detected farmers** (permanent protection)

---

## 🔧 Quick Test

Send a transaction to a wallet without an ATA:
```bash
curl -X POST http://localhost:3000/api/tx \
  -H "Content-Type: application/json" \
  -d '{
    "senderAddress": "YOUR_WALLET",
    "receiverAddress": "NEW_WALLET",
    "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 1000000
  }'
```

Check logs for ATA detection activity.

---

## 📞 Need Help?

**Issue:** "HELIUS_API_KEY not configured"  
**Fix:** Add API key to `.env` file and restart server

**Issue:** Rate limit exceeded  
**Fix:** Upgrade to Developer tier ($49/month)

**Issue:** False positive (legitimate user blocked)  
**Fix:** Review logs, adjust threshold if needed

---

**Full documentation:** See `ATA_FARMING_SETUP.md`

---

**Status:** ✅ Ready for Production  
**Protection Level:** MAXIMUM 🛡️
