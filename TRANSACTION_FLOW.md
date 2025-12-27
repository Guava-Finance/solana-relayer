# Guava Gasless Payment Transaction Flow

## 🔄 Complete Payment Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MERCHANT (Flutter App)                           │
│                                                                         │
│  1. Customer enters amount: 10.5 USDC                                  │
│  2. App generates Transaction Request URL:                             │
│     https://relayer.guava.finance/api/solana-pay?                      │
│         recipient=MERCHANT_WALLET                                       │
│         amount=10.5                                                     │
│         label=Sababa%20Cafe                                            │
│                                                                         │
│  3. Display as:                                                        │
│     ┌──────────────┐                                                   │
│     │  QR Code     │  ⚡ Gasless                                       │
│     │  [████████]  │  Fee paid by Guava ✨                            │
│     └──────────────┘                                                   │
│          OR                                                             │
│     📱 NFC Tag (Android HCE)                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Customer scans/taps
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CUSTOMER (Wallet App)                              │
│                  (Phantom, Solflare, etc.)                             │
│                                                                         │
│  4. Wallet detects Transaction Request URL                             │
│  5. Wallet adds 'account' parameter (customer's address)               │
│  6. Wallet makes GET request:                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP GET
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  SOLANA PAY ENDPOINT                                    │
│              /api/solana-pay (NEW!)                                     │
│                                                                         │
│  7. Validate parameters                                                │
│     ✓ Customer address                                                 │
│     ✓ Merchant address                                                 │
│     ✓ Amount > 0                                                       │
│                                                                         │
│  8. Convert amount: 10.5 USDC → 10,500,000 (raw units)                │
│                                                                         │
│  9. Prepare relayer payload:                                           │
│     {                                                                   │
│       senderAddress: CUSTOMER_WALLET,                                  │
│       receiverAddress: MERCHANT_WALLET,                                │
│       tokenMint: USDC_MINT,                                            │
│       amount: "10500000",                                              │
│       narration: "Sababa Cafe"                                         │
│     }                                                                   │
│                                                                         │
│  10. Call internal /api/tx →                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ POST (internal)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     RELAYER SERVICE                                     │
│                  /api/tx (Existing)                                     │
│                                                                         │
│  11. Detect network congestion                                         │
│      📊 Analyze recent slots                                           │
│      📊 Check priority fees                                            │
│      → Congestion level: MEDIUM                                        │
│      → Priority fee: 25,000 microlamports                              │
│                                                                         │
│  12. Check customer balances                                           │
│      ✓ USDC balance: 50 USDC (sufficient)                             │
│      ✓ USDC ATA exists                                                 │
│                                                                         │
│  13. Check merchant ATA                                                │
│      ❌ Merchant USDC ATA doesn't exist                                │
│      → Will create ATA (cost: 0.32 USDC from customer)                │
│                                                                         │
│  14. Build transaction:                                                │
│      ┌────────────────────────────────────┐                           │
│      │ Instruction 1: Set Compute Limit   │ ← Optimize performance    │
│      ├────────────────────────────────────┤                           │
│      │ Instruction 2: Set Priority Fee    │ ← Guava pays              │
│      ├────────────────────────────────────┤                           │
│      │ Instruction 3: Create Merchant ATA │ ← Guava pays SOL,        │
│      │                                     │   Customer pays 0.32 USDC│
│      ├────────────────────────────────────┤                           │
│      │ Instruction 4: Transfer 0.32 USDC  │ ← ATA creation cost      │
│      │   From: Customer → Guava            │                          │
│      ├────────────────────────────────────┤                           │
│      │ Instruction 5: Transfer 10.5 USDC  │ ← Actual payment         │
│      │   From: Customer → Merchant         │                          │
│      ├────────────────────────────────────┤                           │
│      │ Instruction 6: Memo                 │ ← "Sababa Cafe"          │
│      └────────────────────────────────────┘                           │
│                                                                         │
│  15. Set fee payer: GUAVA_WALLET ✨                                    │
│  16. Sign transaction with Guava's key                                 │
│  17. Serialize & encode to base64                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Return partially-signed tx
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  SOLANA PAY ENDPOINT                                    │
│                                                                         │
│  18. Return to wallet:                                                 │
│      {                                                                  │
│        "transaction": "base64_encoded_tx...",                          │
│        "message": "Sababa Cafe - 10.5 USDC (Gasless)"                 │
│      }                                                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Return transaction
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CUSTOMER (Wallet App)                              │
│                                                                         │
│  19. Wallet displays transaction details:                              │
│      ┌────────────────────────────────────┐                           │
│      │  Approve Transaction?              │                           │
│      │                                     │                           │
│      │  💰 Sababa Cafe - 10.5 USDC        │                           │
│      │                                     │                           │
│      │  From: YOUR_WALLET                  │                           │
│      │  To: MERCHANT_WALLET                │                           │
│      │  Amount: 10.5 USDC                  │                           │
│      │                                     │                           │
│      │  ⚡ Transaction Fee: 0 SOL          │ ← Customer sees this!    │
│      │     (Sponsored by Guava)            │                           │
│      │                                     │                           │
│      │  [Reject]  [Approve]                │                           │
│      └────────────────────────────────────┘                           │
│                                                                         │
│  20. Customer clicks "Approve"                                         │
│  21. Wallet adds customer's signature                                  │
│  22. Wallet submits to Solana network                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Submit transaction
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      SOLANA BLOCKCHAIN                                  │
│                                                                         │
│  23. Validators process transaction                                    │
│  24. Execute instructions in order                                     │
│  25. Deduct priority fee from Guava wallet                             │
│  26. Create merchant ATA (rent from Guava)                             │
│  27. Transfer 0.32 USDC (customer → Guava)                             │
│  28. Transfer 10.5 USDC (customer → merchant)                          │
│  29. Transaction confirmed! ✅                                         │
│                                                                         │
│  Signature: 2mEE1k7SKgheQEy5sQ3bjVzgs...                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket notification
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   MERCHANT (Flutter App)                                │
│                   WebSocket Monitoring                                  │
│                                                                         │
│  30. WebSocket connected to Helius                                     │
│  31. Subscribed to merchant's USDC ATA                                 │
│  32. Received logsNotification                                         │
│      → Detected "TransferChecked" instruction                          │
│      → Signature: 2mEE1k7SKgheQEy5sQ3bjVzgs...                         │
│                                                                         │
│  33. Fetch transaction details                                         │
│      (with retry for indexing delay)                                   │
│                                                                         │
│  34. Verify amount received: 10.5 USDC ✅                              │
│  35. Stop WebSocket                                                    │
│  36. Show success animation 🎉                                         │
│  37. Navigate to dashboard                                             │
│  38. Display notification:                                             │
│      "Payment Confirmed - 10.5 USDC from Customer"                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

## 💰 Cost Breakdown

### Customer Pays:
- **10.5 USDC** → Payment to merchant
- **0.32 USDC** → ATA creation (only if merchant's ATA doesn't exist)
- **0 SOL** → Transaction fee (sponsored by Guava!) ✨

**Total Customer Cost: 10.82 USDC** (or 10.5 USDC if ATA exists)

### Guava Pays:
- **~0.000025 SOL** → Base transaction fee
- **~0.000025 SOL** → Priority fee (varies with congestion)
- **~0.00203928 SOL** → Merchant ATA creation rent (recovered as 0.32 USDC)

**Total Guava Cost: ~0.00208928 SOL** (~$0.42 at $200/SOL)

**Revenue: 0.32 USDC** (if ATA created) → **Net cost: ~$0.10 per transaction**

### Merchant Receives:
- **10.5 USDC** → Clean payment
- **New ATA** → Can now receive USDC (if first time)
- **0 integration complexity** → Just works!

## 🎯 Key Advantages

### For Customers:
✅ No SOL needed
✅ Just USDC in wallet
✅ Works with any Solana Pay wallet
✅ Fast approval flow

### For Merchants:
✅ No rejected transactions due to missing SOL
✅ Higher conversion rates
✅ Professional UX
✅ Automatic payment monitoring

### For Guava:
✅ Own infrastructure (no external dependencies)
✅ Predictable costs
✅ Full control over logic
✅ Scalable architecture

## 🚀 Performance Metrics

- **QR Generation**: < 100ms
- **Endpoint Response**: < 500ms
- **Transaction Confirmation**: 5-15 seconds (finalized)
- **WebSocket Detection**: < 1 second
- **Total Flow**: ~20-30 seconds end-to-end

## 🔒 Security Layers

1. **Address Validation** → Prevent invalid addresses
2. **Balance Verification** → Ensure sufficient funds
3. **ATA Farming Detection** → Block abuse patterns
4. **Rate Limiting** → Prevent spam
5. **Encryption** → Protect sensitive data
6. **WebSocket Verification** → Confirm correct amount

---

**Every step is logged and monitored for maximum reliability! 📊**

