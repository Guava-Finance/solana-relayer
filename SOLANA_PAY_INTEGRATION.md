# Guava Solana Pay Integration

## Overview

Guava's Solana Pay Transaction Request endpoint enables **gasless USDC payments** by sponsoring transaction fees on behalf of customers. This allows merchants to accept USDC payments without requiring customers to hold SOL for transaction fees.

## 🎯 How It Works

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Customer  │         │    Guava     │         │   Relayer   │
│   Wallet    │────1───▶│  Solana Pay  │────2───▶│   Service   │
│             │         │   Endpoint   │         │             │
│             │◀───3────│              │◀───4────│             │
│             │         │              │         │             │
│             │─────────5────────────────────────▶│   Solana    │
│             │                                   │   Network   │
└─────────────┘                                   └─────────────┘

1. Customer scans QR/NFC with Transaction Request URL
2. Guava endpoint calls relayer with payment details
3. Relayer returns partially-signed transaction (fee already paid!)
4. Guava sends transaction to customer wallet
5. Customer signs & submits to Solana (no SOL needed!)
```

## 📡 API Endpoint

### URL
```
GET https://relayer.guava.finance/api/solana-pay
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account` | string | ✅ | Customer's wallet address (automatically provided by wallet) |
| `recipient` | string | ✅ | Merchant's wallet address |
| `amount` | string | ✅ | Payment amount in USDC (e.g., "1.5") |
| `label` | string | ❌ | Payment description (e.g., "Sababa Cafe") |
| `reference` | string | ❌ | Transaction reference for tracking |

### Response (Success)

```json
{
  "transaction": "base64_encoded_partially_signed_transaction",
  "message": "Sababa Cafe - 1.5 USDC (Gasless)"
}
```

### Response (Error)

```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

## 🔧 Implementation Examples

### 1. Generate Transaction Request URL (Flutter)

```dart
String generateGaslessPaymentUrl({
  required String recipient,
  required double amount,
  required String label,
}) {
  // Format amount to 6 decimals (USDC precision)
  final formattedAmount = amount.toStringAsFixed(6).replaceAll(RegExp(r'\.?0+$'), '');
  
  // Generate unique reference
  final reference = _generateReference(recipient);
  
  // Build Transaction Request URL
  final uri = Uri.https(
    'relayer.guava.finance',
    '/api/solana-pay',
    {
      'recipient': recipient,
      'amount': formattedAmount,
      'label': label,
      'reference': reference,
    },
  );
  
  return uri.toString();
}
```

### 2. Generate QR Code

```dart
import 'package:pretty_qr_code/pretty_qr_code.dart';

Widget buildGaslessPaymentQR(String paymentUrl) {
  return PrettyQrView.data(
    data: paymentUrl,
    decoration: PrettyQrDecoration(
      shape: PrettyQrSmoothSymbol(
        color: Colors.black,
      ),
    ),
  );
}
```

### 3. Encode in NFC (Android HCE)

```kotlin
// In MainActivity.kt
private fun startNfcTagEmulation(uri: String, result: MethodChannel.Result) {
    try {
        NfcHostApduService.ndefMessage = createNdefMessageBytes(uri)
        result.success(true)
    } catch (e: Exception) {
        result.error("START_ERROR", e.message, null)
    }
}
```

## 🔐 Security Features

### 1. Built-in Protections
- ✅ Address validation (sender & recipient)
- ✅ Amount validation (positive numbers only)
- ✅ Balance verification (sufficient USDC)
- ✅ ATA farming detection (prevents abuse)
- ✅ Rate limiting (prevents spam)

### 2. Encrypted Communication
The relayer uses AES encryption for sensitive data:
```typescript
const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY,
  process.env.AES_ENCRYPTION_IV
);
```

## 💰 Fee Structure

| Fee Type | Who Pays | Amount |
|----------|----------|---------|
| **Transaction Fee** | Guava | ~0.00001-0.001 SOL (dynamic) |
| **Priority Fee** | Guava | Based on network congestion |
| **ATA Creation** | Customer | 0.32 USDC (if needed) |

> **Note:** ATA (Associated Token Account) creation is only charged if the recipient doesn't have a USDC account yet.

## 📱 Wallet Compatibility

The endpoint follows the official Solana Pay specification and is compatible with:
- ✅ Phantom
- ✅ Solflare
- ✅ Backpack
- ✅ Ultimate
- ✅ Any wallet supporting Solana Pay Transaction Requests

## 🧪 Testing

### Test with cURL

```bash
# 1. Test the endpoint directly
curl "https://relayer.guava.finance/api/solana-pay?\
account=CUSTOMER_WALLET_ADDRESS&\
recipient=MERCHANT_WALLET_ADDRESS&\
amount=1.5&\
label=Test%20Payment"

# Expected response:
{
  "transaction": "base64_string...",
  "message": "Test Payment - 1.5 USDC (Gasless)"
}
```

### Test with Real Wallet

1. Generate a Transaction Request URL
2. Encode as QR code
3. Scan with Phantom/Solflare
4. Wallet fetches transaction from endpoint
5. Customer reviews and approves
6. Transaction submitted (gasless!)

## 🔍 Monitoring Payments

Use WebSocket to monitor incoming payments:

```dart
void monitorPayments(String merchantWallet) async {
  // Connect to Helius WebSocket
  final channel = WebSocketChannel.connect(
    Uri.parse('wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY'),
  );

  // Calculate ATA
  final ata = await getAssociatedTokenAddress(
    usdcMint,
    merchantWallet,
  );

  // Subscribe to logs
  channel.sink.add(jsonEncode({
    'jsonrpc': '2.0',
    'id': 1,
    'method': 'logsSubscribe',
    'params': [
      {'mentions': [ata]},
      {'commitment': 'finalized'}
    ]
  }));

  // Listen for payments
  channel.stream.listen((message) {
    final data = jsonDecode(message);
    
    if (data['method'] == 'logsNotification') {
      final signature = data['params']['result']['value']['signature'];
      verifyAndProcessPayment(signature);
    }
  });
}
```

## 🚀 Deployment

### Environment Variables

```bash
# Required
WALLET=<relayer_wallet_private_key_base58>
ALCHEMY=<solana_rpc_endpoint>
AES_ENCRYPTION_KEY=<encryption_key>
AES_ENCRYPTION_IV=<encryption_iv>

# Optional
HELIUS_API_KEY=<helius_api_key>
RELAYER_URL=https://relayer.guava.finance
```

### Deploy to Vercel

```bash
cd solana-relayer
vercel --prod
```

## 🎨 Branding

### Logo & Icon
- **Logo URL**: `https://guava.finance/assets/logo.svg`
- **Icon URL**: `https://guava.finance/assets/logo.svg`

### Brand Colors
```dart
primary: Color(0xFF1A1A1A)      // Dark green
secondary: Color(0xFF28443F)    // Forest green
accent: Color(0xFFFFD700)       // Gold
```

## 📊 Analytics

Track gasless payment metrics:
- Total gasless transactions
- Total fees sponsored by Guava
- Average transaction time
- Network congestion impact
- ATA creation costs

## 🐛 Troubleshooting

### Issue: Transaction fails with "Insufficient funds"
**Solution**: Ensure relayer wallet has enough SOL for fees.

### Issue: "Invalid address" error
**Solution**: Verify wallet addresses are valid Solana public keys.

### Issue: "Transaction expired"
**Solution**: Network congestion caused delay. The endpoint will automatically retry.

### Issue: ATA creation cost too high
**Solution**: The 0.32 USDC charge is fixed. Customer must have sufficient balance.

## 📚 Resources

- [Solana Pay Specification](https://docs.solanapay.com/spec)
- [Guava Documentation](https://docs.guava.finance)
- [Helius RPC Docs](https://docs.helius.dev/)

## 🤝 Support

For issues or questions:
- **Email**: support@guava.finance
- **Discord**: [Join our community](https://discord.gg/guava)
- **GitHub**: [Report issues](https://github.com/guava-finance/relayer/issues)

---

**Built with ❤️ by Guava Finance**

*Enabling gasless crypto payments for everyone*

