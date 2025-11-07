# Solana Relayer Service - Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Core Concepts](#core-concepts)
4. [API Reference](#api-reference)
5. [Security Architecture](#security-architecture)
6. [Infrastructure & Deployment](#infrastructure--deployment)
7. [Technical Stack](#technical-stack)
8. [Development Guide](#development-guide)
9. [Performance & Optimization](#performance--optimization)
10. [Monitoring & Observability](#monitoring--observability)
11. [Error Handling](#error-handling)
12. [Best Practices](#best-practices)

---

## Overview

### Purpose

The Solana Relayer Service is a production-grade Next.js serverless application that abstracts blockchain complexity and gas fees from end users. It acts as a trusted intermediary that pre-signs Solana transactions, paying for all network fees (SOL) while allowing users to transact with only their tokens (e.g., USDC).

### Key Capabilities

- **Gas Fee Abstraction**: Relayer pays all SOL network fees
- **Associated Token Account (ATA) Management**: Automatic creation of token accounts
- **Token Transfers**: SPL token transfers with optional transaction fees
- **Token Swapping**: Jupiter DEX aggregator integration
- **Security**: Multi-layer security with encryption, rate limiting, and threat detection
- **High Performance**: Network congestion adaptation with priority fees

### Target Users

- **Primary**: Guava Wallet mobile application (Flutter)
- **Secondary**: Any Solana application requiring gasless transactions
- **Use Cases**: 
  - Onboarding users without requiring SOL holdings
  - Payment processing without gas fee friction
  - Decentralized exchange operations
  - Token account management

---

## System Architecture

### High-Level Architecture

```
┌─────────────────┐
│   Mobile App    │
│  (Flutter)      │
└────────┬────────┘
         │ HTTPS (Encrypted)
         │ AES-256-CBC
         ▼
┌─────────────────────────────────────────┐
│       API Gateway (Vercel Edge)         │
│  - Request Validation                   │
│  - SSL/TLS Termination                  │
│  - DDoS Protection                      │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│      Relayer Service (Next.js)          │
│  ┌──────────────────────────────────┐   │
│  │   Security Middleware Layer      │   │
│  │  - Encryption/Decryption         │   │
│  │  - Request Signing Validation    │   │
│  │  - App ID Verification           │   │
│  │  - Rate Limiting                 │   │
│  │  - Blacklist Checking            │   │
│  │  - Threat Detection              │   │
│  └──────────────────────────────────┘   │
│                  │                       │
│                  ▼                       │
│  ┌──────────────────────────────────┐   │
│  │      API Endpoint Layer          │   │
│  │  - /api/tx (Transfers)           │   │
│  │  - /api/create-ata (Accounts)    │   │
│  │  - /api/swap (Token Swaps)       │   │
│  │  - /api/quote (Price Quotes)     │   │
│  │  - /api/nonce (Durable Nonces)   │   │
│  │  - /api/get (Account Info)       │   │
│  └──────────────────────────────────┘   │
│                  │                       │
│                  ▼                       │
│  ┌──────────────────────────────────┐   │
│  │   Business Logic Layer           │   │
│  │  - Transaction Construction      │   │
│  │  - Signature Management          │   │
│  │  - Fee Calculation               │   │
│  │  - Network Congestion Detection  │   │
│  └──────────────────────────────────┘   │
└─────────┬───────────────────────┬───────┘
          │                       │
          ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│   Redis Store    │    │  Solana Network  │
│  - Rate Limits   │    │  - Mainnet-Beta  │
│  - Blacklists    │    │  - RPC Endpoint  │
│  - Threat Data   │    │  (Alchemy/Helius)│
│  - Cache         │    └──────────────────┘
└──────────────────┘              │
                                  ▼
                        ┌──────────────────┐
                        │  Jupiter DEX     │
                        │  Aggregator API  │
                        └──────────────────┘
```

### Component Architecture

#### 1. **API Layer** (`/pages/api`)
- **RESTful Endpoints**: Next.js API routes
- **Serverless Functions**: Deployed on Vercel Edge network
- **Stateless Design**: No server-side session management
- **Request/Response Flow**: Encrypted communication

#### 2. **Security Layer** (`/utils`)
- **Encryption Service**: AES-256-CBC encryption
- **Request Signing**: HMAC-based request authentication
- **Rate Limiting**: Progressive penalty system
- **Blacklist Management**: Redis-based address blocking
- **Threat Detection**: Behavioral analysis and anomaly detection

#### 3. **Integration Layer**
- **Solana Web3.js**: Blockchain interaction
- **Jupiter API**: Token swap aggregation
- **Redis**: Distributed caching and rate limiting
- **Helius/Alchemy**: Enhanced RPC endpoints

#### 4. **Data Flow**

```
┌─────────────────────────────────────────────────────┐
│ 1. Client encrypts request → sends to API           │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 2. Middleware decrypts and validates request        │
│    - Check encryption header                         │
│    - Verify App ID                                   │
│    - Validate request signature                      │
│    - Check rate limits                               │
│    - Verify against blacklist                        │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 3. Business logic processes request                  │
│    - Parse parameters                                │
│    - Validate Solana addresses                       │
│    - Check account states                            │
│    - Construct transaction                           │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 4. Relayer signs transaction                         │
│    - Load relayer wallet                             │
│    - Pre-sign transaction                            │
│    - Set fee payer                                   │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 5. Return partially signed transaction              │
│    - Serialize transaction                           │
│    - Encrypt response                                │
│    - Send to client                                  │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 6. Client completes transaction                      │
│    - User signs transaction                          │
│    - Submits to blockchain                           │
│    - Awaits confirmation                             │
└─────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Gas Fee Relaying

**Problem**: Solana transactions require SOL for gas fees, creating a barrier for new users who only hold tokens like USDC.

**Solution**: The relayer service pre-signs transactions and designates itself as the fee payer, absorbing all network costs.

**How It Works**:
```typescript
// Relayer creates transaction
const transaction = new Transaction().add(instruction);

// Set relayer as fee payer
transaction.feePayer = relayerWallet.publicKey;

// Relayer signs first
transaction.sign(relayerWallet);

// Return to user for their signature
return transaction.serialize({ requireAllSignatures: false });
```

**Cost Management**:
- Relayer wallet must maintain SOL balance
- Transaction costs: 0.000005 SOL per signature (base)
- Priority fees: 0.00001 - 0.001 SOL (dynamic based on congestion)
- Account rent: ~0.002 SOL per token account

### 2. Associated Token Accounts (ATAs)

**What Are ATAs?**
- Deterministic addresses for holding SPL tokens
- Derived from: `hash(owner, tokenMint, ataProgram)`
- Each token requires a separate ATA
- Rent: ~0.00203928 SOL (rent-exempt minimum)

**Auto-Creation Flow**:
```typescript
// Check if ATA exists
const ataAddress = await getAssociatedTokenAddress(mint, owner);
const accountInfo = await connection.getAccountInfo(ataAddress);

if (!accountInfo) {
  // Create ATA instruction
  const createAtaIx = createAssociatedTokenAccountInstruction(
    relayerWallet.publicKey, // payer
    ataAddress,              // ata to create
    owner,                   // owner of the ATA
    mint                     // token mint
  );
  
  // Relayer pays rent
  transaction.add(createAtaIx);
}
```

**Anti-Griefing Protection**:
- User signature required for ATA creation
- Prevents rent extraction attacks
- Validates message content to prevent replay

### 3. Transaction Lifecycle

#### Phase 1: Client Preparation
1. User initiates action (transfer, swap)
2. Client prepares transaction parameters
3. Client encrypts request body
4. Client signs request with timestamp

#### Phase 2: Relayer Processing
1. Decrypt and validate request
2. Security checks (rate limit, blacklist)
3. Construct Solana transaction
4. Add necessary instructions (ATA creation, transfers)
5. Calculate and add priority fees
6. Relayer pre-signs transaction

#### Phase 3: Client Finalization
1. Client receives partially signed transaction
2. User reviews transaction details
3. User signs with their wallet
4. Client submits to Solana network
5. Client monitors confirmation status

#### Phase 4: Confirmation
1. Transaction lands in block
2. Network confirms transaction
3. Wallet balances update
4. Client displays success/failure

### 4. Multi-Signature Transactions

**Signature Requirements**:
- **Relayer Signature**: Always required (fee payer)
- **User Signature**: Required for token transfers, ATAs
- **Optional Signatures**: Multi-sig accounts, delegated accounts

**Transaction Structure**:
```typescript
interface PartiallySignedTransaction {
  tx: string; // Base58 encoded transaction
  signatures: Array<{
    publicKey: string;
    signature: string | null; // null if not signed yet
  }>;
}
```

### 5. Network Congestion Management

**Dynamic Priority Fees**:
```typescript
const PRIORITY_FEE_CONFIG = {
  LOW_CONGESTION: 5000,      // 0.000005 SOL
  MEDIUM_CONGESTION: 25000,  // 0.000025 SOL
  HIGH_CONGESTION: 75000,    // 0.000075 SOL
  EXTREME_CONGESTION: 150000 // 0.00015 SOL
};
```

**Congestion Detection**:
1. Query recent performance samples
2. Analyze slot timing and TPS
3. Check recent prioritization fees
4. Calculate optimal fee for success
5. Cap maximum fee at 0.001 SOL

**Adaptive Compute Units**:
```typescript
const COMPUTE_UNIT_CONFIG = {
  DEFAULT_UNITS: 200000,        // Standard transactions
  TOKEN_TRANSFER_UNITS: 150000, // Simple SPL transfers
  COMPLEX_TX_UNITS: 400000,     // Multi-instruction swaps
};
```

---

## API Reference

### Base URL

**Production**: `https://your-relayer.vercel.app`  
**Staging**: `https://your-relayer-staging.vercel.app`

### Common Headers

All API requests must include:

```http
Content-Type: application/json
IS_ENCRYPTED: YES
X-App-ID: com.example.app
X-Timestamp: 1699123456789
X-Signature: <HMAC signature>
```

### Authentication

The service uses a multi-layer authentication approach:

1. **App ID Verification**: `X-App-ID` header must match expected value
2. **Request Signing**: HMAC-SHA256 signature of request body
3. **Timestamp Validation**: Prevents replay attacks (5-minute window)
4. **Encryption**: All data encrypted with AES-256-CBC

---

### 1. Create Token Transfer

**Endpoint**: `POST /api/tx`

**Purpose**: Create a token transfer transaction with optional fees and memo.

#### Request Body

```typescript
interface TransferRequest {
  senderAddress: string;           // Sender's public key
  receiverAddress: string;         // Recipient's public key
  tokenMint: string;              // SPL token mint address
  amount: number;                 // Amount in token's base units
  transactionFee?: number;        // Optional: Fee amount (base units)
  transactionFeeAddress?: string; // Optional: Fee recipient address
  narration?: string;             // Optional: Transaction memo
}
```

#### Example Request

```bash
curl -X POST https://relayer.example.com/api/tx \
  -H "Content-Type: application/json" \
  -H "IS_ENCRYPTED: YES" \
  -H "X-App-ID: com.example.app" \
  -H "X-Timestamp: $(date +%s)000" \
  -H "X-Signature: $(echo -n '$REQUEST_BODY' | openssl dgst -sha256 -hmac '$SECRET_KEY' -binary | base64)" \
  -d '{
    "senderAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "receiverAddress": "BKipkearSqAUdNKa1WDstvcMjoPsSKBuNyvKDQDDu9WE",
    "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 1000000,
    "transactionFee": 10000,
    "transactionFeeAddress": "GuavaFeeCollectorAddress...",
    "narration": "Payment for services"
  }'
```

#### Response

**Success (200 OK)**:
```json
{
  "result": "success",
  "message": {
    "tx": "base58_encoded_transaction_string",
    "signatures": [
      {
        "key": "RelayerPublicKey...",
        "signature": "base58_signature..."
      },
      {
        "key": "SenderPublicKey...",
        "signature": null
      }
    ]
  }
}
```

**Error (400/403/429/500)**:
```json
{
  "result": "error",
  "message": {
    "error": "Insufficient funds in wallet"
  }
}
```

#### Transaction Instructions

The endpoint creates a transaction with the following instructions (in order):

1. **ATA Creation** (if sender's ATA doesn't exist):
   ```
   CreateAssociatedTokenAccount(
     payer: relayer,
     ata: senderTokenAccount,
     owner: sender,
     mint: tokenMint
   )
   ```

2. **ATA Creation** (if receiver's ATA doesn't exist):
   ```
   CreateAssociatedTokenAccount(
     payer: relayer,
     ata: receiverTokenAccount,
     owner: receiver,
     mint: tokenMint
   )
   ```

3. **Optional Fee Transfer**:
   ```
   Transfer(
     source: senderTokenAccount,
     destination: feeCollectorAccount,
     owner: sender,
     amount: transactionFee
   )
   ```

4. **Main Transfer**:
   ```
   Transfer(
     source: senderTokenAccount,
     destination: receiverTokenAccount,
     owner: sender,
     amount: amount
   )
   ```

5. **Optional Memo**:
   ```
   Memo(narration)
   ```

#### Error Codes

| Code | Message | Description |
|------|---------|-------------|
| 400 | Invalid public key format | Sender/receiver address is malformed |
| 400 | Amount must be positive | Transfer amount is zero or negative |
| 400 | Insufficient funds | Sender doesn't have enough tokens |
| 403 | Address blocked | Sender/receiver is blacklisted |
| 429 | Rate limit exceeded | Too many requests from this address |
| 500 | Relayer insufficient funds | Relayer wallet needs SOL |
| 500 | Transaction failed | Blockchain rejected transaction |

---

### 2. Create Associated Token Account

**Endpoint**: `POST /api/create-ata`

**Purpose**: Create an Associated Token Account for a user. The relayer pays the account rent (~0.00203928 SOL).

#### Request Body

```typescript
interface CreateATARequest {
  ownerAddress: string;    // ATA owner's public key
  tokenMint: string;       // Token mint address
  userSignature: string;   // User's signature (base58)
  message: string;         // Signed message for verification
}
```

#### Anti-Griefing Requirements

To prevent rent extraction attacks, users must sign a specific message:

```typescript
const message = `Create ATA for ${ownerAddress} with mint ${tokenMint}`;
const signature = nacl.sign.detached(
  new TextEncoder().encode(message),
  userSecretKey
);
const userSignature = base58.encode(signature);
```

#### Example Request

```bash
curl -X POST https://relayer.example.com/api/create-ata \
  -H "Content-Type: application/json" \
  -H "IS_ENCRYPTED: YES" \
  -H "X-App-ID: com.example.app" \
  -d '{
    "ownerAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "userSignature": "3Bv6cS8...",
    "message": "Create ATA for 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU with mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  }'
```

#### Response

**Success - Account Created (200 OK)**:
```json
{
  "result": "success",
  "message": {
    "ataAddress": "Computed_ATA_Address...",
    "txHash": "5Y8xZ...",
    "alreadyExists": false
  }
}
```

**Success - Account Exists (200 OK)**:
```json
{
  "result": "success",
  "message": {
    "ataAddress": "Computed_ATA_Address...",
    "alreadyExists": true
  }
}
```

**Error (400/403)**:
```json
{
  "result": "error",
  "message": {
    "error": "Invalid user signature. Cannot create ATA without valid authorization."
  }
}
```

#### Signature Verification Process

1. Decode base58 signature to bytes
2. Extract user's public key from address
3. Verify signature against message
4. Check message format matches expected pattern
5. Only proceed if signature is valid

---

### 3. Token Swap

**Endpoint**: `POST /api/swap`

**Purpose**: Execute token swaps using Jupiter DEX aggregator. Automatically creates destination ATA if needed.

#### Request Body

```typescript
interface SwapRequest {
  senderAddress: string;  // User's public key
  inputMint: string;      // Token to swap from
  amount: number;         // Amount to swap (base units)
}
```

**Note**: Output mint is always USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)

#### Example Request

```bash
curl -X POST https://relayer.example.com/api/swap \
  -H "Content-Type: application/json" \
  -H "IS_ENCRYPTED: YES" \
  -d '{
    "senderAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "inputMint": "So11111111111111111111111111111111111111112",
    "amount": 1000000000
  }'
```

#### Response

**Success (200 OK)**:
```json
{
  "result": "success",
  "message": {
    "tx": "base58_encoded_versioned_transaction",
    "destinationTokenAccount": "UserUSDC_ATA_Address...",
    "priorityFee": 50000,
    "networkCongestion": "medium"
  }
}
```

#### Swap Flow

1. **Validate Input**: Check sender address and token mint
2. **Ensure Destination ATA**: Create USDC ATA if doesn't exist
3. **Detect Network Congestion**: Analyze network performance
4. **Get Jupiter Quote**: Request optimal swap route
   ```typescript
   GET https://lite-api.jup.ag/swap/v1/quote?
     inputMint=<mint>&
     outputMint=<USDC>&
     amount=<amount>&
     swapMode=ExactIn
   ```
5. **Build Swap Transaction**: Request swap transaction from Jupiter
   ```typescript
   POST https://lite-api.jup.ag/swap/v1/swap
   {
     "userPublicKey": "<user>",
     "payer": "<relayer>",
     "prioritizationFeeLamports": {
       "priorityLevelWithMaxLamports": {
         "priorityLevel": "high",
         "maxLamports": 75000
       }
     },
     "destinationTokenAccount": "<userUsdcAta>",
     "quoteResponse": <quoteData>
   }
   ```
6. **Sign Transaction**: Relayer signs for gas payment
7. **Return to User**: User signs and submits

#### Priority Fee Strategy

```typescript
// Congestion-based priority fees
if (congestion === 'low') {
  priorityFee = 5000;      // Fast confirmation
} else if (congestion === 'medium') {
  priorityFee = 25000;     // Reliable confirmation
} else if (congestion === 'high') {
  priorityFee = 75000;     // High probability confirmation
} else {
  priorityFee = 150000;    // Guaranteed confirmation
}
```

---

### 4. Get Swap Quote

**Endpoint**: `POST /api/quote`

**Purpose**: Get a price quote for token swaps without executing the transaction.

#### Request Body

```typescript
interface QuoteRequest {
  inputMint: string;  // Token to swap from
  amount: number;     // Amount to swap (base units)
}
```

#### Example Request

```bash
curl -X POST https://relayer.example.com/api/quote \
  -H "Content-Type: application/json" \
  -H "IS_ENCRYPTED: YES" \
  -d '{
    "inputMint": "So11111111111111111111111111111111111111112",
    "amount": 1000000000
  }'
```

#### Response

**Success (200 OK)**:
```json
{
  "outAmount": "45230000",
  "outAmountWithDecimals": "45.23",
  "priceImpactPct": "0.15",
  "swapUsdValue": "45.23"
}
```

**Explanation**:
- `outAmount`: Raw amount in USDC base units (6 decimals)
- `outAmountWithDecimals`: Human-readable USDC amount
- `priceImpactPct`: Percentage price impact of the swap
- `swapUsdValue`: Estimated USD value of output

---

### 5. Create Durable Nonce

**Endpoint**: `POST /api/nonce`

**Purpose**: Create a durable transaction nonce for offline signing.

**Use Case**: Allows transactions to be valid indefinitely instead of ~2 minutes.

#### Request Body

```typescript
interface NonceRequest {
  // No parameters required
}
```

#### Response

**Success (200 OK)**:
```json
{
  "result": "success",
  "message": {
    "nonceAccount": "NonceAccountPublicKey...",
    "nonceAccountAuth": "base58_secret_key..."
  }
}
```

#### Durable Nonce Usage

```typescript
// 1. Create nonce account
const { nonceAccount, nonceAccountAuth } = await createNonce();

// 2. Use nonce in transaction
const transaction = new Transaction();
transaction.recentBlockhash = nonceValue;
transaction.add(
  SystemProgram.nonceAdvance({
    noncePubkey: nonceAccount,
    authorizedPubkey: nonceAccountAuth.publicKey
  })
);

// 3. Transaction never expires
// Can be signed offline and submitted later
```

---

### 6. Get Nonce Value

**Endpoint**: `POST /api/get`

**Purpose**: Retrieve the current nonce value from a nonce account.

#### Request Body

```typescript
interface GetNonceRequest {
  address: string;  // Nonce account address
}
```

#### Response

**Success (200 OK)**:
```json
{
  "result": "success",
  "message": {
    "nonceAccount": "current_nonce_value..."
  }
}
```

---

## Security Architecture

### Multi-Layer Security Model

```
┌────────────────────────────────────────────┐
│  Layer 1: Transport Security               │
│  - TLS 1.3                                 │
│  - Certificate Pinning (client-side)       │
└────────────────┬───────────────────────────┘
                 │
┌────────────────▼───────────────────────────┐
│  Layer 2: Encryption                       │
│  - AES-256-CBC                             │
│  - Request/Response Encryption             │
│  - Key Derivation (SHA-256)                │
└────────────────┬───────────────────────────┘
                 │
┌────────────────▼───────────────────────────┐
│  Layer 3: Authentication                   │
│  - App ID Verification                     │
│  - Request Signing (HMAC-SHA256)           │
│  - Timestamp Validation                    │
└────────────────┬───────────────────────────┘
                 │
┌────────────────▼───────────────────────────┐
│  Layer 4: Authorization                    │
│  - Address-Based Rate Limiting             │
│  - Blacklist Checking                      │
│  - Transaction Amount Limits               │
└────────────────┬───────────────────────────┘
                 │
┌────────────────▼───────────────────────────┐
│  Layer 5: Behavioral Analysis              │
│  - Threat Detection                        │
│  - Anomaly Detection                       │
│  - Pattern Recognition                     │
└────────────────────────────────────────────┘
```

### 1. Encryption Service

**Algorithm**: AES-256-CBC (compatible with Flutter `encrypt` package)

**Key Derivation**:
```typescript
// Server-side (Node.js)
const key = crypto.createHash('sha256')
  .update(encryptionKey, 'utf8')
  .digest(); // 32 bytes = 256 bits

// Client-side (Flutter)
final key = Key.fromUtf8(encryptionKey).sha256();
```

**Encryption Process**:
```typescript
// 1. String Encryption
function encryptString(plaintext: string): string {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

// 2. Object Encryption (recursive)
function encryptMap(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = encryptString(value);
    } else if (typeof value === 'object') {
      result[key] = encryptMap(value);
    } else {
      result[key] = encryptString(JSON.stringify(value));
    }
  }
  return result;
}
```

**Decryption Process**:
```typescript
function decryptString(ciphertext: string): string {
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    // Return original if decryption fails (graceful degradation)
    return ciphertext;
  }
}
```

**Type Preservation**:
```typescript
function parseDecryptedValue(value: string): any {
  // Integer
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  // Float
  if (/^-?\d*\.\d+$/.test(value)) {
    return parseFloat(value);
  }
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;
  // Null
  if (value === 'null') return null;
  // String
  return value;
}
```

**Middleware Integration**:
```typescript
const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY,
  process.env.AES_ENCRYPTION_IV
);

// In API handler
const decryptedBody = encryptionMiddleware.processRequest(
  req.body,
  req.headers
);

// Process business logic
const result = await handleRequest(decryptedBody);

// Encrypt response
const encryptedResponse = encryptionMiddleware.processResponse(
  result,
  req.headers
);

res.json(encryptedResponse);
```

### 2. Request Signing

**Purpose**: Prevent tampering, replay attacks, and unauthorized requests.

**Signature Generation (Client)**:
```typescript
// 1. Prepare canonical request
const timestamp = Date.now();
const method = 'POST';
const path = '/api/tx';
const bodyString = JSON.stringify(requestBody);
const canonicalRequest = `${method}\n${path}\n${timestamp}\n${bodyString}`;

// 2. Generate HMAC signature
const signature = crypto.createHmac('sha256', secretKey)
  .update(canonicalRequest)
  .digest('base64');

// 3. Add to headers
headers['X-Timestamp'] = timestamp;
headers['X-Signature'] = signature;
```

**Signature Verification (Server)**:
```typescript
async function validateRequest(
  req: NextApiRequest,
  body: any
): Promise<{ valid: boolean; error?: string }> {
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];
  
  // Check timestamp (5-minute window)
  const now = Date.now();
  if (Math.abs(now - Number(timestamp)) > 5 * 60 * 1000) {
    return { valid: false, error: 'Request expired' };
  }
  
  // Reconstruct canonical request
  const canonical = `${req.method}\n${req.url}\n${timestamp}\n${JSON.stringify(body)}`;
  
  // Calculate expected signature
  const expected = crypto.createHmac('sha256', secretKey)
    .update(canonical)
    .digest('base64');
  
  // Constant-time comparison
  if (signature !== expected) {
    return { valid: false, error: 'Invalid signature' };
  }
  
  return { valid: true };
}
```

### 3. Rate Limiting

**Strategy**: Progressive penalty system with address-based tracking

**Configuration**:
```typescript
export const RateLimitConfigs = {
  TRANSACTION: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 2,            // 2 requests per minute
  },
  ACCOUNT_CREATION: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 1,            // 1 request per minute
  },
  READ_OPERATIONS: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 10,           // 10 requests per minute
  },
  NONCE_CREATION: {
    windowMs: 5 * 60 * 1000,  // 5 minutes
    maxRequests: 2,            // 2 requests per 5 minutes
  },
};
```

**Progressive Penalties**:
```typescript
const PROGRESSIVE_PENALTIES = [
  30 * 60 * 1000,      // 1st violation: 30 minutes
  45 * 60 * 1000,      // 2nd violation: 45 minutes  
  60 * 60 * 1000,      // 3rd violation: 1 hour
  3 * 60 * 60 * 1000,  // 4th+ violations: 3 hours
];
```

**Rate Limit Storage**:
```typescript
interface RequestRecord {
  count: number;
  resetTime: number;
  violations: number;
  lastViolationTime: number;
}

// Redis key: ratelimit:sender:<address>
// TTL: Dynamic based on penalty level
```

**Implementation**:
```typescript
async function checkRateLimit(
  req: NextApiRequest,
  senderAddress: string
): Promise<{ allowed: boolean; resetTime: number }> {
  const key = `ratelimit:sender:${senderAddress}`;
  const now = Date.now();
  
  // Get current record
  const record: RequestRecord = await redis.get(key);
  
  // Check for active penalty
  if (record.violations > 0) {
    const penalty = getProgressivePenalty(record.violations);
    const penaltyEndTime = record.lastViolationTime + penalty;
    
    if (now < penaltyEndTime) {
      return {
        allowed: false,
        resetTime: penaltyEndTime
      };
    }
  }
  
  // Check rate limit
  if (record.count >= maxRequests) {
    record.violations++;
    record.lastViolationTime = now;
    await redis.setEx(key, getTTL(record.violations), record);
    
    return {
      allowed: false,
      resetTime: now + getProgressivePenalty(record.violations)
    };
  }
  
  // Increment and allow
  record.count++;
  await redis.setEx(key, windowMs / 1000, record);
  
  return { allowed: true, resetTime: record.resetTime };
}
```

**Response Headers**:
```http
X-RateLimit-Limit: 2
X-RateLimit-Remaining: 1
X-RateLimit-Reset: 1699123500
Retry-After: 1800
```

### 4. Blacklist Management

**Purpose**: Block malicious addresses and prevent abuse.

**Redis Structure**:
```
blacklist:addresses (Set)
├─ Address1
├─ Address2
└─ Address3

blacklist:reasons (Hash)
├─ Address1 → "Reason for blocking"
├─ Address2 → "Reason for blocking"
└─ Address3 → "Reason for blocking"
```

**Operations**:
```typescript
// Check if address is blacklisted
async function checkRedisBlacklist(
  address: string
): Promise<{ blocked: boolean; reason?: string }> {
  const isBlacklisted = await redis.sIsMember('blacklist:addresses', address);
  
  if (isBlacklisted) {
    const reason = await redis.hGet('blacklist:reasons', address);
    return { blocked: true, reason };
  }
  
  return { blocked: false };
}

// Add to blacklist
async function addToRedisBlacklist(
  address: string,
  reason: string
): Promise<void> {
  await redis.sAdd('blacklist:addresses', address);
  await redis.hSet('blacklist:reasons', address, reason);
  console.log(`Blacklisted: ${address} - ${reason}`);
}

// Remove from blacklist
async function removeFromRedisBlacklist(
  address: string
): Promise<void> {
  await redis.sRem('blacklist:addresses', address);
  await redis.hDel('blacklist:reasons', address);
}
```

**Auto-Blacklisting Triggers**:
1. ATA farming detected (commented out but available)
2. Repeated rate limit violations (5+ in 24 hours)
3. Invalid signature attempts (3+ failed attempts)
4. Threat detection score > 75
5. Manual admin addition

### 5. Threat Detection System

**Purpose**: Identify and block malicious behavior patterns.

**Threat Score Calculation**:
```typescript
interface ThreatScore {
  score: number;      // 0-100
  reasons: string[];
  blocked: boolean;   // true if score >= 75
}
```

**Detection Mechanisms**:

#### IP Behavior Analysis
```typescript
// Metrics tracked per IP
interface RequestPattern {
  count: number;
  firstSeen: number;
  lastSeen: number;
  userAgents: Set<string>;
  endpoints: Set<string>;
}

// Suspicious patterns
- Request rate > 5 req/sec: +30 score
- Multiple user agents (>5): +25 score
- Rapid endpoint scanning: +20 score
```

#### Bot Detection
```typescript
// Bot-like indicators
- Bot user agent patterns: +40 score
- Missing Accept-Language: +15 score
- Missing Accept-Encoding: +10 score
- Very short user agent (<10 chars): +20 score
```

#### Timing Analysis
```typescript
// Behavioral patterns
- Perfectly regular intervals: +35 score
- Request burst (>10 in 1 min): +25 score
- Low variance timing (bot-like): +35 score
```

#### Geographic Analysis
```typescript
// IP range checks
- Private IP ranges: +30 score
- Known VPN/proxy ranges: +20 score
- Suspicious geographic changes: +25 score
```

**Threat Response Actions**:
```typescript
if (threatScore >= 75) {
  // 1. Log threat event
  await recordThreatEvent(ip, score, reasons);
  
  // 2. Block IP temporarily (1 hour)
  await blockIP(ip, 3600);
  
  // 3. Alert monitoring system
  await sendAlert({
    type: 'HIGH_THREAT_SCORE',
    ip,
    score,
    reasons
  });
  
  // 4. Return 403 Forbidden
  return res.status(403).json({
    error: 'Access denied due to suspicious activity'
  });
}
```

### 6. Anti-Griefing Measures

**Problem**: Attackers could abuse free ATA creation to drain relayer funds.

**Solution**: User signature requirement

```typescript
// 1. User must sign specific message
const message = `Create ATA for ${ownerAddress} with mint ${tokenMint}`;
const signature = await wallet.signMessage(message);

// 2. Server verifies signature
const isValid = nacl.sign.detached.verify(
  messageBytes,
  signatureBytes,
  ownerPublicKey.toBytes()
);

// 3. Only proceed if valid
if (!isValid) {
  throw new Error('Invalid signature - cannot create ATA');
}
```

**Additional Protections**:
1. Rate limit ATA creation (1 per minute per address)
2. Monitor ATA creation patterns
3. Detect and blacklist farming behavior
4. Transaction amount validation

---

## Infrastructure & Deployment

### Hosting Platform

**Platform**: Vercel  
**Region**: Global Edge Network  
**Functions**: Serverless (AWS Lambda)

**Benefits**:
- **Zero-Downtime Deployments**: Atomic deployments with instant rollback
- **Global CDN**: Sub-100ms response times worldwide
- **Auto-Scaling**: Handles traffic spikes automatically
- **Built-in SSL**: Automatic HTTPS with certificate management

### Architecture Diagram

```
                    ┌─────────────────┐
                    │   DNS (Vercel)  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Edge Network   │
                    │  (Global CDN)   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
   │ Region  │         │ Region  │         │ Region  │
   │  US-E   │         │  EU-W   │         │  AP-SE  │
   └────┬────┘         └────┬────┘         └────┬────┘
        │                   │                    │
        └───────────────────┼────────────────────┘
                            │
                    ┌───────▼───────┐
                    │  Lambda@Edge  │
                    │  API Routes   │
                    └───────┬───────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────▼────┐        ┌────▼────┐        ┌────▼────┐
   │  Redis  │        │ Solana  │        │Jupiter  │
   │ (Upstash)│       │   RPC   │        │   API   │
   └─────────┘        └─────────┘        └─────────┘
```

### Environment Variables

**Required Variables**:
```bash
# Relayer Wallet (Base58 encoded secret key)
WALLET=your_base58_encoded_wallet_secret_key

# Encryption Configuration
AES_ENCRYPTION_KEY=your-super-secret-encryption-key-here
AES_ENCRYPTION_IV=exact-16-bytes!!  # Must be exactly 16 bytes

# RPC Endpoints
ALCHEMY=https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY
HELIUS_API_KEY=your_helius_api_key

# Redis Configuration (Upstash)
REDIS_URL=rediss://default:password@your-redis.upstash.io:6379

# Security
SECRET_KEY=your_hmac_secret_key_for_request_signing
EXPECTED_APP_ID=com.example.app
```

**Optional Variables**:
```bash
# Monitoring
SENTRY_DSN=your_sentry_dsn
LOG_LEVEL=info

# Feature Flags
ENABLE_THREAT_DETECTION=true
ENABLE_ATA_FARMING_DETECTION=false
ENABLE_BLACKLIST=true
```

### Redis Configuration (Upstash)

**Why Upstash?**
- Serverless-native (no connection pooling needed)
- Global replication
- Per-request pricing (cost-effective)
- REST API (edge-compatible)

**Setup**:
```bash
# 1. Create Upstash account
# 2. Create Redis database
# 3. Copy REDIS_URL
# 4. Add to Vercel environment variables
```

**Data Structures**:
```
# Rate Limiting
ratelimit:sender:<address> → JSON (RequestRecord)
ratelimit:ip:<ip> → JSON (RequestRecord)

# Blacklist
blacklist:addresses → Set<string>
blacklist:reasons → Hash<address, reason>

# Threat Detection
ip_pattern:<ip> → JSON (RequestPattern)
timing:<ip> → List<timestamp>
blocked:<ip> → "true" (with TTL)
threat_events → List<JSON> (last 1000)

# Caching
quote:<inputMint>:<amount> → JSON (5 min TTL)
```

### Solana RPC Configuration

**Recommended Providers**:

1. **Alchemy** (Primary)
   - Reliability: 99.9% uptime
   - Speed: <100ms avg latency
   - Free tier: 3M requests/month
   - Websocket support
   - Enhanced APIs

2. **Helius** (Secondary)
   - Transaction history API
   - Account change streams
   - DAS (Digital Asset Standard) API
   - Free tier: 100k requests/day

3. **QuickNode** (Fallback)
   - Global edge network
   - Load balancing
   - Dedicated nodes available

**Configuration**:
```typescript
const RPC_ENDPOINTS = {
  primary: process.env.ALCHEMY,
  secondary: process.env.HELIUS,
  fallback: 'https://api.mainnet-beta.solana.com'
};

// Automatic failover
async function getConnection(): Promise<Connection> {
  for (const endpoint of Object.values(RPC_ENDPOINTS)) {
    try {
      const conn = new Connection(endpoint, 'confirmed');
      await conn.getSlot(); // Health check
      return conn;
    } catch (error) {
      console.warn(`RPC endpoint ${endpoint} failed, trying next...`);
    }
  }
  throw new Error('All RPC endpoints unavailable');
}
```

### Deployment Workflow

**CI/CD Pipeline**:
```yaml
# .github/workflows/deploy.yml
name: Deploy to Vercel

on:
  push:
    branches: [main, staging]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Install Dependencies
        run: npm ci
      
      - name: Run Tests
        run: npm test
      
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
          vercel-args: '--prod'
```

**Deployment Steps**:
```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Link project
vercel link

# 3. Set environment variables
vercel env add WALLET production
vercel env add AES_ENCRYPTION_KEY production
# ... add all required variables

# 4. Deploy to production
vercel --prod

# 5. Verify deployment
curl https://your-relayer.vercel.app/api/health
```

### Monitoring & Alerts

**Vercel Analytics**:
- Request count
- Response times
- Error rates
- Geographic distribution

**Custom Monitoring**:
```typescript
// Log critical metrics
console.log(JSON.stringify({
  timestamp: Date.now(),
  endpoint: req.url,
  method: req.method,
  duration: Date.now() - startTime,
  status: res.statusCode,
  sender: senderAddress,
  amount: amount,
  success: res.statusCode < 400
}));
```

**Alert Triggers**:
1. Error rate > 5%
2. Avg response time > 2 seconds
3. Relayer SOL balance < 0.1 SOL
4. Redis connection failures
5. RPC endpoint failures
6. High threat detection activity

---

## Technical Stack

### Core Dependencies

```json
{
  "dependencies": {
    "@solana/web3.js": "^1.62.0",
    "@solana/spl-token": "^0.3.5",
    "@vercel/kv": "^1.0.1",
    "redis": "^5.8.2",
    "bs58": "^5.0.0",
    "tweetnacl": "^1.0.3",
    "axios": "^0.27.2",
    "next": "^15.4.7",
    "react": "18.2.0"
  },
  "devDependencies": {
    "typescript": "^5.9.2",
    "@types/node": "18.7.18",
    "eslint": "8.23.1"
  }
}
```

### Technology Choices

#### 1. Next.js
**Why**: 
- API routes as serverless functions
- Built-in TypeScript support
- Optimized for Vercel deployment
- File-based routing
- Middleware support

#### 2. Solana Web3.js
**Why**:
- Official Solana SDK
- Comprehensive transaction building
- RPC client included
- Active maintenance
- Large community

#### 3. Redis (Upstash)
**Why**:
- Serverless-compatible
- Global replication
- Sub-millisecond latency
- Cost-effective for serverless
- REST API compatibility

#### 4. TypeScript
**Why**:
- Type safety for blockchain operations
- Better IDE support
- Reduced runtime errors
- Self-documenting code
- Refactoring confidence

#### 5. TweetNaCl
**Why**:
- Lightweight crypto library
- Ed25519 signature verification
- Browser and Node.js compatible
- Audited implementation
- Zero dependencies

---

## Development Guide

### Prerequisites

- Node.js 18+
- npm or yarn
- Solana wallet with devnet/mainnet SOL
- Redis instance (local or Upstash)
- RPC endpoint credentials

### Local Setup

```bash
# 1. Clone repository
git clone <repository-url>
cd solana-relayer

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env.local

# 4. Edit .env.local
# Add your wallet, encryption keys, RPC endpoints, etc.

# 5. Start development server
npm run dev

# Server running at http://localhost:3000
```

### Environment Configuration

**.env.local**:
```bash
# Development Configuration
WALLET=your_devnet_wallet_base58_secret_key
ALCHEMY=https://solana-devnet.g.alchemy.com/v2/YOUR_KEY
AES_ENCRYPTION_KEY=dev-encryption-key
AES_ENCRYPTION_IV=dev-iv-16bytes!
REDIS_URL=redis://localhost:6379
SECRET_KEY=dev-secret-key-for-hmac
EXPECTED_APP_ID=com.example.app.dev
```

### Project Structure

```
solana-relayer/
├── pages/
│   ├── _app.tsx           # App wrapper
│   ├── index.tsx          # Home page
│   └── api/               # API endpoints
│       ├── tx.ts          # Token transfers
│       ├── create-ata.ts  # ATA creation
│       ├── swap.ts        # Token swaps
│       ├── quote.ts       # Swap quotes
│       ├── nonce.ts       # Nonce creation
│       └── get.ts         # Get nonce value
│
├── utils/                 # Utility modules
│   ├── encrytption.ts     # Encryption service
│   ├── security.ts        # Security validation
│   ├── requestSigning.ts  # Request signing
│   ├── rateLimiter.ts     # Rate limiting
│   ├── redisBlacklist.ts  # Blacklist management
│   ├── threatDetection.ts # Threat detection
│   ├── nonce.ts           # Nonce utilities
│   └── ataFarmingDetector.ts # ATA farming detection
│
├── components/            # React components
│   ├── provider.tsx       # Wallet provider
│   ├── at.tsx            # Address table
│   ├── ct.tsx            # Connection table
│   └── modal.tsx         # Modal component
│
├── styles/               # CSS modules
│   ├── globals.css
│   └── Home.module.css
│
├── public/               # Static assets
│   ├── favicon.ico
│   └── phantom.svg
│
├── scripts/              # Utility scripts
│   ├── test-security.js
│   ├── manage-blacklist.js
│   └── debug-*.js
│
├── next.config.js        # Next.js configuration
├── tsconfig.json         # TypeScript configuration
├── package.json          # Dependencies
└── vercel.json           # Vercel deployment config
```

### Testing

#### Unit Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- utils/encrytption.test.ts

# Watch mode
npm test -- --watch
```

#### Integration Tests

```bash
# Test API endpoints
node scripts/test-security.js
node scripts/test-blacklist-simple.js
node scripts/test-timestamp-validation.js
```

#### Manual API Testing

```bash
# Test transaction endpoint
curl -X POST http://localhost:3000/api/tx \
  -H "Content-Type: application/json" \
  -H "IS_ENCRYPTED: YES" \
  -H "X-App-ID: com.example.app.dev" \
  -d @test-data/transfer-request.json

# Test ATA creation
curl -X POST http://localhost:3000/api/create-ata \
  -H "Content-Type: application/json" \
  -H "IS_ENCRYPTED: YES" \
  -d @test-data/create-ata-request.json
```

### Common Development Tasks

#### 1. Add New API Endpoint

```typescript
// pages/api/my-endpoint.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createEncryptionMiddleware } from '../../utils/encrytption';
import { validateSecurity } from '../../utils/security';

const encryptionMiddleware = createEncryptionMiddleware(
  process.env.AES_ENCRYPTION_KEY || 'default-key',
  process.env.AES_ENCRYPTION_IV || 'default-iv-16b!!'
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Security validation
  const securityValidation = validateSecurity(req);
  if (!securityValidation.isValid) {
    return res.status(401).json({
      error: securityValidation.error
    });
  }

  // Decrypt request
  const body = encryptionMiddleware.processRequest(req.body, req.headers);

  // Business logic
  const result = await myBusinessLogic(body);

  // Encrypt response
  const encrypted = encryptionMiddleware.processResponse(result, req.headers);
  res.json(encrypted);
}
```

#### 2. Update Security Rules

```typescript
// utils/security.ts

// Add new validation
export function validateCustomRule(req: NextApiRequest): boolean {
  // Your validation logic
  return true;
}
```

#### 3. Manage Blacklist

```bash
# Add address to blacklist
node scripts/manage-blacklist.js add \
  7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU \
  "Reason for blocking"

# Remove from blacklist
node scripts/manage-blacklist.js remove \
  7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

# List all blacklisted addresses
node scripts/manage-blacklist.js list
```

#### 4. Monitor Rate Limits

```typescript
// Check rate limit status
const status = await rateLimiter.checkRateLimit(req, senderAddress);
console.log({
  allowed: status.allowed,
  remaining: status.remaining,
  resetTime: new Date(status.resetTime)
});
```

### Debugging

#### Enable Verbose Logging

```typescript
// Add at top of API endpoint
if (process.env.DEBUG === 'true') {
  console.log('[DEBUG] Request:', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body
  });
}
```

#### Common Issues

**1. Encryption Failures**
```
Problem: "Encryption failed" error
Solution: Verify IV is exactly 16 bytes
Check: process.env.AES_ENCRYPTION_IV.length === 16
```

**2. Redis Connection Issues**
```
Problem: "Redis not connected"
Solution: Check REDIS_URL format and credentials
Test: redis-cli -u $REDIS_URL ping
```

**3. Rate Limit False Positives**
```
Problem: Rate limit blocking valid requests
Solution: Clear rate limit data for address
Command: redis-cli DEL "ratelimit:sender:<address>"
```

**4. Transaction Failures**
```
Problem: "Transaction failed" after signing
Reasons:
- Insufficient relayer SOL balance
- Invalid token accounts
- Blockhash expired
- Network congestion

Debug:
- Check relayer balance
- Verify account states
- Increase priority fee
```

---

## Performance & Optimization

### Response Time Targets

| Endpoint | Target | P95 | P99 |
|----------|--------|-----|-----|
| /api/quote | <500ms | <800ms | <1200ms |
| /api/create-ata | <2s | <3s | <5s |
| /api/tx | <1.5s | <2.5s | <4s |
| /api/swap | <3s | <5s | <8s |

### Optimization Strategies

#### 1. Caching

**Quote Caching**:
```typescript
const cacheKey = `quote:${inputMint}:${amount}`;
const cached = await redis.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const quote = await fetchJupiterQuote(inputMint, amount);
await redis.setEx(cacheKey, 300, JSON.stringify(quote)); // 5 min TTL
return quote;
```

**Account Info Caching**:
```typescript
// Cache ATA existence checks
const ataKey = `ata:${owner}:${mint}`;
const exists = await redis.get(ataKey);

if (exists !== null) {
  return exists === 'true';
}

const accountInfo = await connection.getAccountInfo(ataAddress);
const doesExist = accountInfo !== null;

await redis.setEx(ataKey, 60, doesExist ? 'true' : 'false'); // 1 min TTL
return doesExist;
```

#### 2. Parallel Processing

**Concurrent ATA Checks**:
```typescript
const [senderAtaExists, receiverAtaExists] = await Promise.all([
  checkAtaExists(sender, tokenMint),
  checkAtaExists(receiver, tokenMint)
]);
```

**Batch RPC Calls**:
```typescript
const accounts = await connection.getMultipleAccountsInfo([
  senderAta,
  receiverAta,
  feeCollectorAta
]);
```

#### 3. Connection Pooling

```typescript
// Reuse RPC connections
let connectionCache: Connection | null = null;

function getConnection(): Connection {
  if (!connectionCache) {
    connectionCache = new Connection(
      process.env.ALCHEMY!,
      { commitment: 'confirmed' }
    );
  }
  return connectionCache;
}
```

#### 4. Compression

```typescript
// Enable gzip compression in responses
export default async function handler(req, res) {
  res.setHeader('Content-Encoding', 'gzip');
  // ... rest of handler
}
```

#### 5. Edge Caching

```typescript
// Vercel edge caching for quotes
export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Cache-Control': 's-maxage=300, stale-while-revalidate'
    }
  });
}
```

### Network Optimization

#### Priority Fee Optimization

```typescript
// Don't overpay for fees
async function getOptimalPriorityFee(
  connection: Connection
): Promise<number> {
  const recentFees = await connection.getRecentPrioritizationFees();
  
  // Use 90th percentile
  const sorted = recentFees.map(f => f.prioritizationFee).sort();
  const p90Index = Math.floor(sorted.length * 0.9);
  const p90Fee = sorted[p90Index] || 0;
  
  // Add 10% buffer, cap at 0.001 SOL
  return Math.min(p90Fee * 1.1, 1_000_000);
}
```

#### Compute Unit Optimization

```typescript
// Request only needed compute units
const computeUnits = transactionType === 'transfer' 
  ? 150000  // Simple transfer
  : 400000; // Complex swap

transaction.add(
  ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnits
  })
);
```

### Memory Optimization

```typescript
// Clean up large objects
async function processLargeTransaction(tx: Transaction) {
  // Process transaction
  const result = await processTransaction(tx);
  
  // Explicitly clear references
  tx = null as any;
  
  return result;
}
```

---

## Monitoring & Observability

### Logging Strategy

#### Log Levels

```typescript
enum LogLevel {
  DEBUG = 'debug',    // Development only
  INFO = 'info',      // Normal operations
  WARN = 'warn',      // Potential issues
  ERROR = 'error',    // Errors requiring attention
  CRITICAL = 'critical' // System-critical failures
}
```

#### Structured Logging

```typescript
console.log(JSON.stringify({
  level: 'info',
  timestamp: new Date().toISOString(),
  endpoint: req.url,
  method: req.method,
  sender: senderAddress,
  amount: amount,
  tokenMint: tokenMint,
  duration: processingTime,
  success: true,
  txHash: transactionHash
}));
```

### Metrics to Monitor

#### 1. Business Metrics
- Transactions per second (TPS)
- Total transaction volume (USD)
- Success rate by endpoint
- Average transaction amount
- Top users by volume

#### 2. Performance Metrics
- API response times (P50, P95, P99)
- RPC call latency
- Redis latency
- Jupiter API latency
- Time to confirmation

#### 3. Reliability Metrics
- Error rate by endpoint
- Error types distribution
- RPC failures
- Redis connection issues
- Rate limit violations

#### 4. Security Metrics
- Authentication failures
- Blacklisted address attempts
- Threat detection triggers
- Rate limit violations
- Invalid signature attempts

#### 5. Cost Metrics
- SOL spent on gas fees
- Account rent paid
- RPC request count
- Redis operations count
- Vercel function invocations

### Health Monitoring

#### Health Check Endpoint

```typescript
// pages/api/health.ts
export default async function handler(req, res) {
  const health = {
    status: 'healthy',
    timestamp: Date.now(),
    checks: {
      redis: await checkRedis(),
      rpc: await checkRPC(),
      relayerBalance: await checkRelayerBalance()
    }
  };
  
  const allHealthy = Object.values(health.checks).every(c => c.healthy);
  const status = allHealthy ? 200 : 503;
  
  res.status(status).json(health);
}
```

#### Automated Monitoring

```bash
# Cron job to check health
*/5 * * * * curl -f https://your-relayer.vercel.app/api/health || alert-team

# Monitor relayer balance
*/15 * * * * node scripts/check-relayer-balance.js || alert-finance-team
```

### Alert Configuration

#### Critical Alerts (Immediate Action)
- Relayer SOL balance < 0.05 SOL
- Error rate > 10%
- All RPC endpoints down
- Redis connection lost

#### Warning Alerts (Review within 1 hour)
- Relayer SOL balance < 0.1 SOL
- Error rate > 5%
- Avg response time > 3s
- High threat detection activity

#### Info Alerts (Review daily)
- High transaction volume
- New threat patterns detected
- Unusual rate limit activity

---

## Error Handling

### Error Types

#### 1. Client Errors (400-499)

**400 Bad Request**:
```json
{
  "result": "error",
  "message": {
    "error": "Invalid public key format"
  }
}
```

**401 Unauthorized**:
```json
{
  "error": true,
  "message": "Request must be encrypted"
}
```

**403 Forbidden**:
```json
{
  "result": "error",
  "message": {
    "error": "Address blocked: Suspicious activity detected"
  }
}
```

**429 Too Many Requests**:
```json
{
  "result": "error",
  "message": {
    "error": "Rate limit exceeded. Please wait 30 minutes before trying again."
  },
  "retryAfter": 1800,
  "retryAfterMinutes": 30
}
```

#### 2. Server Errors (500-599)

**500 Internal Server Error**:
```json
{
  "result": "error",
  "message": {
    "error": "Internal server error"
  }
}
```

**503 Service Unavailable**:
```json
{
  "result": "error",
  "message": {
    "error": "Service temporarily unavailable"
  }
}
```

### Error Recovery

#### Automatic Retry Logic

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      console.warn(`Retry ${i + 1}/${maxRetries} after error:`, error);
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
  throw new Error('All retries failed');
}

// Usage
const accountInfo = await withRetry(() => 
  connection.getAccountInfo(address)
);
```

#### Graceful Degradation

```typescript
// Fallback to default when Redis is unavailable
async function getRateLimitWithFallback(address: string) {
  try {
    return await checkRateLimit(address);
  } catch (error) {
    console.warn('Redis unavailable, allowing request');
    return { allowed: true };
  }
}
```

### Client-Side Error Handling

```dart
// Flutter client example
try {
  final response = await dio.post('/api/tx', data: encryptedData);
  final decrypted = encryptionService.decryptData(response.data);
  
  if (decrypted['result'] == 'success') {
    // Handle success
  } else {
    // Handle error response
    showError(decrypted['message']['error']);
  }
} on DioError catch (e) {
  if (e.response?.statusCode == 429) {
    // Rate limited - show retry timer
    final retryAfter = e.response?.data['retryAfter'];
    showRateLimitDialog(retryAfter);
  } else if (e.response?.statusCode == 403) {
    // Blacklisted - show support contact
    showBlacklistDialog();
  } else {
    // Generic error
    showError('Transaction failed. Please try again.');
  }
}
```

---

## Best Practices

### Security Best Practices

1. **Never Log Secrets**
   ```typescript
   // ❌ BAD
   console.log('Wallet:', process.env.WALLET);
   
   // ✅ GOOD
   console.log('Wallet loaded:', relayerWallet.publicKey.toBase58());
   ```

2. **Validate All Inputs**
   ```typescript
   // Always validate Solana addresses
   try {
     const pubkey = new PublicKey(address);
   } catch (error) {
     throw new Error('Invalid Solana address');
   }
   ```

3. **Use Constant-Time Comparisons**
   ```typescript
   // For signature verification
   import { timingSafeEqual } from 'crypto';
   
   const expected = Buffer.from(expectedSignature, 'base64');
   const received = Buffer.from(receivedSignature, 'base64');
   
   if (!timingSafeEqual(expected, received)) {
     throw new Error('Invalid signature');
   }
   ```

4. **Rate Limit Everything**
   ```typescript
   // Even read operations should have limits
   const rateLimiter = createRateLimiter(RateLimitConfigs.READ_OPERATIONS);
   ```

5. **Encrypt Sensitive Data**
   ```typescript
   // Always encrypt error messages that might contain sensitive info
   const error = encryptionMiddleware.processResponse({
     error: sensitiveErrorMessage
   }, req.headers);
   ```

### Performance Best Practices

1. **Minimize RPC Calls**
   ```typescript
   // Use getMultipleAccountsInfo instead of multiple getAccountInfo
   const accounts = await connection.getMultipleAccountsInfo([
     address1, address2, address3
   ]);
   ```

2. **Cache Aggressively**
   ```typescript
   // Cache immutable data indefinitely
   // Cache mutable data with appropriate TTL
   await redis.setEx(key, ttl, value);
   ```

3. **Use Parallel Processing**
   ```typescript
   // Process independent operations concurrently
   const [result1, result2] = await Promise.all([
     operation1(),
     operation2()
   ]);
   ```

4. **Optimize Compute Units**
   ```typescript
   // Request only what you need
   transaction.add(
     ComputeBudgetProgram.setComputeUnitLimit({
       units: estimatedUnits
     })
   );
   ```

### Code Quality Best Practices

1. **Type Everything**
   ```typescript
   // Define explicit types for all API interfaces
   interface TransferRequest {
     senderAddress: string;
     receiverAddress: string;
     tokenMint: string;
     amount: number;
   }
   ```

2. **Handle All Error Cases**
   ```typescript
   try {
     // Operation
   } catch (error) {
     if (error instanceof SpecificError) {
       // Handle specific error
     } else {
       // Handle generic error
     }
   } finally {
     // Cleanup
   }
   ```

3. **Document Complex Logic**
   ```typescript
   /**
    * Calculates optimal priority fee based on network congestion
    * 
    * @param connection - Solana RPC connection
    * @returns Priority fee in lamports (microLamports * 1000)
    * 
    * Algorithm:
    * 1. Query recent performance samples
    * 2. Calculate average slot time and TPS
    * 3. Query recent prioritization fees
    * 4. Use 90th percentile with 10% buffer
    * 5. Cap at maximum to prevent overpayment
    */
   async function getOptimalPriorityFee(connection: Connection): Promise<number> {
     // Implementation
   }
   ```

4. **Use Meaningful Names**
   ```typescript
   // ❌ BAD
   const a = await c.get(k);
   
   // ✅ GOOD
   const accountInfo = await connection.getAccountInfo(publicKey);
   ```

### Operational Best Practices

1. **Monitor Relayer Balance**
   ```bash
   # Set up alerting when balance is low
   THRESHOLD=0.1  # SOL
   ```

2. **Rotate Secrets Regularly**
   ```bash
   # Monthly secret rotation
   # 1. Generate new encryption key
   # 2. Deploy new key
   # 3. Support both keys for transition period
   # 4. Remove old key
   ```

3. **Test in Staging First**
   ```bash
   # Always deploy to staging before production
   vercel --staging
   # Run integration tests
   npm run test:integration
   # Deploy to production
   vercel --prod
   ```

4. **Backup Critical Data**
   ```bash
   # Regular Redis backups
   redis-cli --rdb /backup/redis-$(date +%Y%m%d).rdb
   ```

---

## Appendix

### Glossary

- **ATA (Associated Token Account)**: Deterministic address for holding SPL tokens
- **Base58**: Encoding format used by Solana for addresses and signatures
- **Compute Units**: Measure of computational resources used by a transaction
- **Devnet**: Solana test network for development
- **Fee Payer**: Account that pays transaction fees (gas)
- **Jupiter**: Solana DEX aggregator for optimal token swaps
- **Lamport**: Smallest unit of SOL (1 SOL = 1 billion lamports)
- **Mainnet**: Solana production network
- **Memo**: On-chain transaction note/description
- **Priority Fee**: Additional fee to prioritize transaction processing
- **Relayer**: Service that pre-signs and pays for transactions
- **RPC**: Remote Procedure Call endpoint for blockchain interaction
- **Signature**: Cryptographic proof of transaction authorization
- **SPL Token**: Solana Program Library token standard
- **Transaction**: Atomic operation on the Solana blockchain
- **USDC**: USD Coin stablecoin

### Common Token Mints

```typescript
const COMMON_MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SOL: 'So11111111111111111111111111111111111111112',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  SRM: 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt'
};
```

### Useful Solana CLI Commands

```bash
# Check relayer balance
solana balance <RELAYER_PUBLIC_KEY>

# View transaction details
solana confirm <TRANSACTION_SIGNATURE>

# Get account info
solana account <ACCOUNT_ADDRESS>

# Check token account balance
spl-token balance <TOKEN_MINT> --owner <OWNER_ADDRESS>

# List all token accounts for owner
spl-token accounts --owner <OWNER_ADDRESS>
```

### External Resources

- **Solana Documentation**: https://docs.solana.com
- **SPL Token Documentation**: https://spl.solana.com/token
- **Jupiter API Docs**: https://station.jup.ag/docs/apis/swap-api
- **Vercel Documentation**: https://vercel.com/docs
- **Next.js API Routes**: https://nextjs.org/docs/api-routes/introduction
- **Redis Commands**: https://redis.io/commands

---

## Document Information

**Version**: 1.0  
**Last Updated**: November 4, 2025  
**Document Owner**: Engineering Team  
**Review Cycle**: Quarterly

### Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Nov 4, 2025 | Initial comprehensive documentation |

---

**End of Documentation**

