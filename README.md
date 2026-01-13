# Solana Relayer Service

A Next.js-based relayer service for Solana blockchain operations with optional end-to-end encryption. This service acts as a gas fee relayer, allowing users to perform token operations without holding SOL for transaction fees.

## Features

- **Gas Fee Relaying**: Relayer pays for all transaction fees (SOL)
- **Solana Pay Integration**: Transaction Request endpoint for gasless payments ⚡
- **Associated Token Account (ATA) Creation**: Automatic creation of token accounts
- **Token Transfers**: SPL token transfers with optional transaction fees
- **Memo Support**: Add transaction narrations/memos
- **End-to-End Encryption**: Optional AES-256-CBC encryption for sensitive data
- **Multi-Instruction Transactions**: Combines multiple operations in single transactions

## Getting Started

### Prerequisites

- Node.js 16+ 
- npm or yarn
- Solana wallet with SOL for gas fees (devnet/mainnet)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd solana-relayer
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Configure environment variables:
```bash
cp .env.example .env.local
```

4. Set up your environment variables in `.env.local`:
```env
# Required: Relayer wallet (base58 encoded secret key)
WALLET=your_base58_encoded_wallet_secret_key

# Optional: Encryption settings
AES_ENCRYPTION_KEY=your-super-secret-encryption-key-here
AES_ENCRYPTION_IV=exact-16-bytes!! # Must be exactly 16 characters

# Optional: PAJ On-Ramp API Key
PAJ_BUSINESS_API_KEY=your_paj_business_api_key
PAJ_ENVIRONMENT=production # or "staging" (default: "production")
```

5. Run the development server:
```bash
npm run dev
# or
yarn dev
```

The server will be available at [http://localhost:3000](http://localhost:3000).

## API Endpoints

### 🆕 Solana Pay Transaction Request (Gasless Payments)

**Endpoint:** `GET /api/solana-pay`

**NEW!** This endpoint enables gasless USDC payments following the Solana Pay specification. Customers can pay without holding SOL for transaction fees - Guava sponsors all fees!

#### Query Parameters

```typescript
{
  account: string;      // Customer's wallet address (auto-provided by wallet)
  recipient: string;    // Merchant's wallet address (required)
  amount: string;       // Payment amount in USDC, e.g., "1.5" (required)
  label?: string;       // Payment description (optional)
  reference?: string;   // Transaction reference for tracking (optional)
}
```

#### Example Request

```bash
GET https://relayer.guava.finance/api/solana-pay?
    account=CUSTOMER_WALLET&
    recipient=MERCHANT_WALLET&
    amount=10.5&
    label=Sababa%20Cafe
```

#### Response

**Success (200):**
```json
{
  "transaction": "base64_encoded_partially_signed_transaction",
  "message": "Sababa Cafe - 10.5 USDC (Gasless)"
}
```

**Error (400/500):**
```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

#### Integration Examples

**Flutter (Generate Transaction Request URL):**
```dart
final uri = Uri.https(
  'relayer.guava.finance',
  '/api/solana-pay',
  {
    'recipient': merchantWallet,
    'amount': amount.toString(),
    'label': 'Sababa Cafe',
  },
);
// Generate QR code or NFC tag with this URL
```

**Test with cURL:**
```bash
./test-solana-pay.sh production
```

**Compatible Wallets:**
- ✅ Phantom
- ✅ Solflare  
- ✅ Backpack
- ✅ Any wallet supporting Solana Pay Transaction Requests

📚 **Full Documentation:** See [SOLANA_PAY_INTEGRATION.md](./SOLANA_PAY_INTEGRATION.md) and [GASLESS_PAYMENTS_SUMMARY.md](./GASLESS_PAYMENTS_SUMMARY.md)

---

### 🆕 On-Ramp Endpoints (PAJ Integration)

The service includes on-ramp functionality powered by [paj_ramp](https://www.npmjs.com/package/paj_ramp) for converting fiat currency to cryptocurrency.

#### 1. Initiate Session

**Endpoint:** `POST /api/onramp/initiate`

Initiates a new on-ramp session for a user.

**Request:**
```typescript
{
  email: string;  // User's email address (required)
}
```

**Response:**
```typescript
{
  result: "success",
  message: {
    email: string;
  }
}
```

#### 2. Verify Session

**Endpoint:** `POST /api/onramp/verify`

Verifies a session using OTP and device signature.

**Request:**
```typescript
{
  email: string;           // User's email address (required)
  otp: string;             // One-time password (required)
  deviceSignature: string; // Device signature (required)
}
```

**Response:**
```typescript
{
  result: "success",
  message: {
    email: string;
    isActive: boolean;
    expiresAt: string;
    token: string;
  }
}
```

#### 3. Get All Rates

**Endpoint:** `GET /api/onramp/rates` or `POST /api/onramp/rates`

Retrieves the current exchange rates.

**Response:**
```typescript
{
  result: "success",
  message: {
    baseCurrency: string;
    targetCurrency: string;
    rate: number;
  }
}
```

#### 4. Get Rate by Amount

**Endpoint:** `GET /api/onramp/rates/amount?amount=50000` or `POST /api/onramp/rates/amount`

Retrieves exchange rate and calculated amounts for a specific amount.

**Query Parameters (GET):**
- `amount`: number (required) - Amount to calculate rate for

**Request Body (POST):**
```typescript
{
  amount: number;  // Amount to calculate rate for (required)
}
```

**Response:**
```typescript
{
  result: "success",
  message: {
    rate: {
      baseCurrency: string;
      targetCurrency: string;
      rate: number;
    };
    amounts: {
      userTax: number;
      merchantTax: number;
      amountUSD: number;
      userAmountFiat: number;
    };
  }
}
```

#### 5. Get Rate by Rate Type

**Endpoint:** `GET /api/onramp/rates/type?rateType=standard` or `POST /api/onramp/rates/type`

Retrieves exchange rate for a specific rate type.

**Query Parameters (GET):**
- `rateType`: string (required) - Type of rate to retrieve

**Request Body (POST):**
```typescript
{
  rateType: string;  // Rate type (required)
}
```

**Response:**
```typescript
{
  result: "success",
  message: {
    baseCurrency: string;
    targetCurrency: string;
    rate: number;
    rateType: string;
  }
}
```

#### 6. Create On-Ramp Order

**Endpoint:** `POST /api/onramp/order`

Creates a new on-ramp order.

**Request:**
```typescript
{
  email: string;          // User's email address (required)
  amount: number;         // Order amount (required)
  currency?: string;      // Currency code (default: "NGN")
  paymentMethod?: string; // Payment method (default: "card")
  walletAddress?: string; // Destination wallet address
  // ... other order parameters
}
```

**Response:**
```typescript
{
  result: "success",
  message: {
    orderId: string;
    status: string;
    // ... other order details
  }
}
```

**Note:** All on-ramp endpoints support optional encryption via the `IS_ENCRYPTED: YES` header, consistent with other API endpoints.

---

### 1. Create Associated Token Account (ATA)

**Endpoint:** `POST /api/create-ata`

Creates an Associated Token Account for a user. The relayer pays for the account creation fee.

#### Request

```typescript
{
  ownerAddress: string;    // Public key of the account owner
  tokenMint: string;       // Token mint address
}
```

#### Headers (Optional)
```
IS_ENCRYPTED: YES|NO     // Enable/disable encryption
Content-Type: application/json
```

#### Response

**Success (200):**
```typescript
{
  result: "success",
  message: {
    ataAddress: string;      // Created ATA address
    txHash?: string;         // Transaction hash (if created)
    alreadyExists: boolean;  // Whether ATA already existed
  }
}
```

**Error (400/500):**
```typescript
{
  result: "error",
  message: {
    error: Error;           // Error details
  }
}
```

#### Example Usage

```javascript
// Regular request
const response = await fetch('/api/create-ata', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    ownerAddress: "5iip7fcx7b6dAJhGrLDQkS4bxAo8wcweJNUcqsGJz3Se",
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  })
});

// Encrypted request
const response = await fetch('/api/create-ata', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'IS_ENCRYPTED': 'YES'
  },
  body: JSON.stringify({
    ownerAddress: "encrypted_owner_address_base64",
    tokenMint: "encrypted_token_mint_base64"
  })
});
```

### 2. Create Transaction

**Endpoint:** `POST /api/tx`

Creates a transaction for token transfers with optional fees and memo. Returns a partially signed transaction that requires user authorization.

#### Request

```typescript
{
  senderAddress: string;           // Sender's public key
  receiverAddress: string;         // Receiver's public key  
  tokenMint: string;              // Token mint address
  amount: number;                 // Transfer amount (in token's smallest unit)
  transactionFee?: number;        // Optional: Fee amount
  transactionFeeAddress?: string; // Optional: Fee recipient address
  narration?: string;             // Optional: Transaction memo/description
}
```

#### Headers (Optional)
```
IS_ENCRYPTED: YES|NO     // Enable/disable encryption
Content-Type: application/json
```

#### Response

**Success (200):**
```typescript
{
  result: "success",
  message: {
    tx: string;                    // Base58 encoded transaction
    signatures: Array<{           // Required signatures
      key: string;                 // Public key
      signature: string | null;    // Signature (null if not signed)
    }>;
  }
}
```

**Error (400/500):**
```typescript
{
  result: "error",
  message: {
    error: Error;                 // Error details
  }
}
```

#### Example Usage

```javascript
// Basic token transfer
const response = await fetch('/api/tx', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    senderAddress: "SenderPublicKey...",
    receiverAddress: "ReceiverPublicKey...",
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: 1000000, // 1 USDC (6 decimals)
  })
});

// Transfer with transaction fee and memo
const response = await fetch('/api/tx', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    senderAddress: "SenderPublicKey...",
    receiverAddress: "ReceiverPublicKey...",
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: 1000000,
    transactionFee: 50000,        // 0.05 USDC fee
    transactionFeeAddress: "FeeCollectorAddress...",
    narration: "Payment for services"
  })
});

// Encrypted request
const response = await fetch('/api/tx', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'IS_ENCRYPTED': 'YES'
  },
  body: JSON.stringify({
    senderAddress: "encrypted_sender_base64",
    receiverAddress: "encrypted_receiver_base64",
    tokenMint: "encrypted_mint_base64",
    amount: 1000000,
    transactionFee: 50000,
    transactionFeeAddress: "encrypted_fee_address_base64",
    narration: "encrypted_narration_base64"
  })
});
```

## Encryption

The service supports optional end-to-end encryption using AES-256-CBC algorithm.

### How Encryption Works

1. **Request Encryption**: If `IS_ENCRYPTED: YES` header is present, the API automatically decrypts the request body
2. **Response Encryption**: If `IS_ENCRYPTED: YES` header is present, the API encrypts the response
3. **Algorithm**: AES-256-CBC with SHA-256 key derivation (compatible with Flutter encrypt package)

### Encryption Headers

Accept any of these header formats:
- `IS_ENCRYPTED: YES|NO`
- `Is-Encrypted: yes|no`
- `is_encrypted: true|false`

### Flutter Integration

Since the encryption service matches the Flutter `encrypt` package implementation:

```dart
// Encrypt request data
final encryptedData = encryptionService.encryptData(requestData);

// Send with encryption header
final response = await http.post(
  Uri.parse('${baseUrl}/api/tx'),
  headers: {
    'Content-Type': 'application/json',
    'IS_ENCRYPTED': 'YES',
  },
  body: jsonEncode(encryptedData),
);

// Decrypt response
final decryptedResponse = encryptionService.decryptData(
  jsonDecode(response.body)
);
```

## Transaction Flow

### For ATA Creation:
1. Client calls `/api/create-ata`
2. Relayer checks if ATA exists
3. If not, relayer creates and pays for ATA
4. Returns ATA address and transaction hash

### For Token Transfers:
1. Client calls `/api/tx` with transfer details
2. Relayer creates transaction with required instructions:
   - ATA creation (if needed)
   - Token transfer
   - Fee transfer (if specified)
   - Memo (if specified)
3. Relayer pre-signs transaction (for gas payment)
4. Returns partially signed transaction
5. Client signs transaction and broadcasts

## Error Handling

Common error responses:

### 400 Bad Request
- Invalid public key format
- Missing required parameters
- Invalid parameter types
- Account already exists (for ATA creation)

### 405 Method Not Allowed
- Using GET instead of POST

### 500 Internal Server Error
- Relayer wallet configuration issues
- Insufficient funds in relayer wallet
- Network connectivity issues
- Invalid token mint address

## Security Considerations

1. **Relayer Wallet**: Keep the relayer wallet secret key secure and well-funded
2. **Encryption Keys**: Use strong encryption keys and rotate them regularly
3. **HTTPS**: Always use HTTPS in production
4. **Rate Limiting**: Consider implementing rate limiting for production use
5. **Validation**: All inputs are validated before processing

## Network Configuration

Currently configured for Solana Devnet. To change networks:

1. Update the `clusterApiUrl()` parameter in the API files
2. Ensure relayer wallet has sufficient SOL on the target network
3. Update token mint addresses for the target network

```typescript
// For mainnet
const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

// For custom RPC
const connection = new Connection("https://your-rpc-endpoint.com", "confirmed");
```

## Development

### Project Structure
```
├── pages/api/
│   ├── create-ata.ts       # ATA creation endpoint
│   ├── tx.ts               # Transaction creation endpoint
│   └── encryption-service.ts # Encryption utilities
├── .env.local              # Environment variables
└── README.md               # This file
```

### Testing

Test endpoints using curl or your preferred HTTP client:

```bash
# Test ATA creation
curl -X POST http://localhost:3000/api/create-ata \
  -H "Content-Type: application/json" \
  -d '{"ownerAddress":"PublicKey...","tokenMint":"MintAddress..."}'

# Test transaction creation
curl -X POST http://localhost:3000/api/tx \
  -H "Content-Type: application/json" \
  -d '{"senderAddress":"Sender...","receiverAddress":"Receiver...","tokenMint":"Mint...","amount":1000000}'

# Test with encryption
curl -X POST http://localhost:3000/api/tx \
  -H "Content-Type: application/json" \
  -H "IS_ENCRYPTED: YES" \
  -d '{"senderAddress":"encrypted_data..."}'
```

## Deployment

### Vercel (Recommended)

1. Push to GitHub repository
2. Connect to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy

### Other Platforms

Ensure environment variables are properly set:
- `WALLET`: Base58 encoded relayer wallet secret key
- `AES_ENCRYPTION_KEY`: Encryption key (if using encryption)
- `AES_ENCRYPTION_IV`: 16-byte encryption IV (if using encryption)
- `PAJ_BUSINESS_API_KEY`: PAJ on-ramp business API key (if using on-ramp endpoints)

## Support

For issues or questions:
1. Check the error messages and logs
2. Verify environment variable configuration
3. Ensure relayer wallet has sufficient SOL
4. Validate input parameters and public key formats
