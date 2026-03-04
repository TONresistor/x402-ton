# x402-ton Facilitator Server

Reference implementation of an x402 facilitator for the TON blockchain. Verifies and settles payments on behalf of vendors using the [`x402-ton`](../packages/ton/) SDK.

## Quick Start

```shell
git clone https://github.com/TONresistor/x402-ton.git
cd x402-ton
npm install --legacy-peer-deps

# Configure
export TON_MNEMONIC="your 24 word mnemonic here"
export TON_NETWORK="tvm:-239"
export PORT=4020

# Start
npm -w server run dev
```

The facilitator wallet must hold a small TON balance (~0.1 TON) to pay gas fees for routing transactions.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TON_MNEMONIC` | Yes | | 24-word wallet mnemonic (space-separated) |
| `TON_NETWORK` | Yes | | `tvm:-239` (mainnet) or `tvm:-3` (testnet) |
| `PORT` | No | `4020` | HTTP server port |
| `DB_PATH` | No | `./data/facilitator.db` | SQLite database path |
| `TONCENTER_URL` | No | Auto | TON RPC endpoint |
| `TONCENTER_API_KEY` | No | | Toncenter API key for higher rate limits |
| `FEE_PERCENTAGE` | No | `0.02` | Facilitator fee (0.02 = 2%) |
| `FEE_MINIMUM` | No | `10000` | Minimum fee in atomic units |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health and TON node connectivity |
| GET | `/supported` | Supported schemes, networks, assets, and facilitator config |
| POST | `/verify` | Verify a signed payment payload (no broadcast) |
| POST | `/settle` | Settle a verified payment (broadcast + route funds) |

## Docker

```shell
docker build -t x402-ton .
docker run -p 4020:4020 \
  -e TON_MNEMONIC="your 24 word mnemonic here" \
  -e TON_NETWORK="tvm:-239" \
  x402-ton
```

## Testing

```shell
npx vitest run --config server/vitest.config.ts
```

## Architecture

```
server/
├── src/
│   ├── index.ts              Entry point
│   ├── config.ts             Environment variable loading and validation
│   ├── health.ts             Health check route
│   ├── routes/
│   │   ├── supported.ts      GET /supported
│   │   ├── verify.ts         POST /verify
│   │   └── settle.ts         POST /settle
│   ├── middleware/
│   │   ├── idempotency.ts    Idempotency-Key enforcement for /settle
│   │   ├── logging.ts        Pino structured logging
│   │   └── rate-limit.ts     Per-IP, per-wallet, and global rate limiting
│   └── store/
│       ├── idempotency-store.ts   SQLite-backed idempotency key storage
│       └── tx-state.ts            Transaction state tracking (SETTLING → CONFIRMED/FAILED)
└── test/                     17 tests (security, idempotency, rate limiting)
```
