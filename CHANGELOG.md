# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-15

### Added
- x402 payment SDK for TON blockchain (native TON + USDT jetton)
- Client, Server, and Facilitator scheme classes (`SchemeNetworkClient`, `SchemeNetworkServer`, `SchemeNetworkFacilitator`)
- USDT gasless relay via TONAPI (`/v2/gasless/send`) — client pays zero TON for gas
- Auto-detection of gasless vs direct broadcast from W5 opcode (`0x73696e74` internal / `0x7369676e` external)
- Self-relay fallback with circuit breaker (3 failures / 60s window / 300s cooldown)
- Daily self-relay budget tracking with SQLite persistence (`BudgetStore`)
- TonAPI transaction emulation (step 12) with graceful degradation
- Facilitator server with `/supported`, `/verify`, `/settle`, `/health` endpoints
- Idempotency and transaction state management (SQLite)
- Rate limiting middleware (per-IP, per-wallet, global, with memory cap)
- Input validation layer (`validation.ts`, `error-codes.ts`)
- W5 v5r1 stateInit code hash validation
- Commission cap (10 USDT absolute maximum)
- 143 SDK unit tests + 77 server tests (220 total)
- E2E test scripts for native TON and USDT gasless
- Docker multi-stage build
- GitHub Actions CI/CD (test + release)

### Security
- BOC validation: 64KB size, 256 depth, 1024 cells limits
- Ed25519 signature verification before any broadcast
- Exact amount equality (no overpayment accepted)
- Max 2 W5 actions per transaction
- Relay address cannot be facilitator (self-payment prevention)
- Pino structured logging with BOC/key redaction
- x402Version validation (must be 2)
