# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-04

### Added
- x402 payment mechanism for TON blockchain (native TON + USDT jetton)
- Client, Server, and Facilitator scheme classes
- 12-step BOC verification pipeline
- Settlement with fund routing
- Facilitator server with verify, settle, and health endpoints
- Idempotency and transaction state management (SQLite)
- Rate limiting middleware
