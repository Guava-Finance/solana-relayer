#!/bin/bash

# Test script for Guava Solana Pay endpoint
# Usage: ./test-solana-pay.sh [environment]
# Example: ./test-solana-pay.sh production
# Example: ./test-solana-pay.sh local

set -e

ENVIRONMENT=${1:-production}

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test wallet addresses (replace with your test wallets)
CUSTOMER_WALLET="RtsKQm3gAGL1Tayhs7ojWE9qytWqVh4G7eJTaNJs7vX"
MERCHANT_WALLET="Acau8iLY9Rv115UDzWPkDAopB6t9iFxGQuebZxffqoMv"
AMOUNT="1.0"
LABEL="Test Payment"

# Set endpoint based on environment
if [ "$ENVIRONMENT" = "production" ]; then
    ENDPOINT="https://relayer.guava.finance"
elif [ "$ENVIRONMENT" = "local" ]; then
    ENDPOINT="http://localhost:3000"
else
    echo -e "${RED}❌ Unknown environment: $ENVIRONMENT${NC}"
    echo "Usage: $0 [production|local]"
    exit 1
fi

echo -e "${YELLOW}🧪 Testing Guava Solana Pay Endpoint${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Environment: $ENVIRONMENT"
echo "Endpoint: $ENDPOINT/api/solana-pay"
echo "Customer: $CUSTOMER_WALLET"
echo "Merchant: $MERCHANT_WALLET"
echo "Amount: $AMOUNT USDC"
echo "Label: $LABEL"
echo ""

# URL encode the label
ENCODED_LABEL=$(echo "$LABEL" | sed 's/ /%20/g')

# Build request URL
REQUEST_URL="${ENDPOINT}/api/solana-pay?account=${CUSTOMER_WALLET}&recipient=${MERCHANT_WALLET}&amount=${AMOUNT}&label=${ENCODED_LABEL}"

echo -e "${YELLOW}📤 Sending request...${NC}"
echo ""

# Make request and save response
RESPONSE=$(curl -s -w "\n%{http_code}" "$REQUEST_URL")

# Extract HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

# Extract response body (everything except last line)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "${YELLOW}📥 Response:${NC}"
echo ""

# Check HTTP status code
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Success! HTTP $HTTP_CODE${NC}"
    echo ""
    echo "$BODY" | jq '.' || echo "$BODY"
    echo ""
    
    # Extract transaction and message
    TRANSACTION=$(echo "$BODY" | jq -r '.transaction // empty')
    MESSAGE=$(echo "$BODY" | jq -r '.message // empty')
    
    if [ -n "$TRANSACTION" ]; then
        echo -e "${GREEN}✅ Transaction created successfully${NC}"
        echo "Message: $MESSAGE"
        echo "Transaction length: ${#TRANSACTION} characters"
        echo ""
        echo -e "${GREEN}🎉 Test PASSED!${NC}"
        echo ""
        echo -e "${YELLOW}Next steps:${NC}"
        echo "1. Test with a real wallet (Phantom, Solflare)"
        echo "2. Scan this URL as a QR code:"
        echo "   $REQUEST_URL"
        echo "3. Monitor the transaction on Solscan"
    else
        echo -e "${RED}❌ No transaction in response${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Failed! HTTP $HTTP_CODE${NC}"
    echo ""
    echo "$BODY" | jq '.' || echo "$BODY"
    echo ""
    exit 1
fi

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✨ Testing complete!${NC}"

