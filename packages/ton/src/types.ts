/** Supported TON wallet contract versions */
export type WalletVersion = 'v4r2' | 'v5r1';

/** Standardized error codes for x402ton verification and settlement */
export const X402ErrorCode = {
  /** Payment scheme is not "exact" */
  invalid_scheme: 'invalid_scheme',
  /** Network is not recognized or unsupported */
  invalid_network: 'invalid_network',
  /** BOC failed to parse or is malformed */
  invalid_boc: 'invalid_exact_ton_boc',
  /** BOC exceeds maximum size limit (64KB) */
  boc_too_large: 'boc_too_large',
  /** BOC cell tree exceeds maximum depth */
  boc_depth_exceeded: 'invalid_exact_ton_boc_depth',
  /** BOC cell tree exceeds maximum cell count */
  boc_cells_exceeded: 'invalid_exact_ton_boc_cells',
  /** BOC failed initial parsing */
  boc_parse_failed: 'boc_parse_failed',
  /** Wallet version not in supported list */
  invalid_wallet_version: 'invalid_exact_ton_wallet_version',
  /** Ed25519 signature verification failed */
  invalid_signature: 'invalid_exact_ton_signature',
  /** Message valid_until has passed */
  expired: 'invalid_exact_ton_expired',
  /** BOC seqno does not match on-chain seqno */
  seqno_mismatch: 'invalid_exact_ton_seqno',
  /** Transfer amount is below required amount + fee */
  insufficient_amount: 'invalid_exact_ton_amount',
  /** Transfer destination does not match expected facilitator address */
  wrong_recipient: 'invalid_exact_ton_recipient',
  /** Missing required fields in payment requirements */
  invalid_payload: 'invalid_payload',
  /** Jetton transfer opcode does not match expected value */
  asset_mismatch: 'invalid_exact_ton_asset_mismatch',
  /** TonAPI emulation detected transaction failure */
  emulation_failed: 'emulation_failed',
  /** Emulation detected insufficient on-chain balance */
  insufficient_balance: 'insufficient_balance',
  /** TonAPI emulation service unavailable (graceful skip) */
  emulation_unavailable: 'emulation_unavailable',
  /** BOC broadcast to network failed */
  broadcast_failed: 'settlement_broadcast_failed',
  /** Seqno did not advance within timeout period */
  settlement_timeout: 'settlement_timeout',
  /** Fund routing from facilitator to vendor failed */
  routing_failed: 'settlement_route_failed',
} as const;

/** Union type of all x402ton error code string values */
export type X402ErrorCodeValue = (typeof X402ErrorCode)[keyof typeof X402ErrorCode];

/** Payload sent by the client containing the signed BOC */
export interface ExactTonPayload {
  /** Base64-encoded Bag of Cells containing the signed external message */
  boc: string;
  /** Hex-encoded Ed25519 public key (32 bytes = 64 hex chars) */
  publicKey: string;
  /** Wallet contract version used to construct the external message */
  walletVersion: WalletVersion;
}

/** Fee configuration for the facilitator */
export interface TonFee {
  /** Fee as a decimal fraction (e.g. 0.02 = 2%) */
  percentage: number;
  /** Minimum fee in atomic units */
  minimum: string;
  /** Facilitator wallet address receiving fees */
  address: string;
}

/** Extra fields appended to PaymentRequirements by the server */
export interface TonExtra {
  /** Raw hex address of the facilitator wallet */
  facilitatorAddress: string;
  /** Fee schedule for this payment */
  fee: TonFee;
}

/** Per-network configuration for TON endpoints and assets */
export interface TonNetworkConfig {
  /** CAIP-2 network identifier (e.g. "tvm:-239") */
  networkId: string;
  /** Toncenter API base URL */
  toncenterUrl: string;
  /** Map of asset identifier to asset config */
  assets: Record<string, TonAssetConfig>;
}

/** Configuration for a single asset on a TON network */
export interface TonAssetConfig {
  /** Human-readable symbol (e.g. "TON", "USDT") */
  symbol: string;
  /** Number of decimal places */
  decimals: number;
  /** Jetton master contract address (raw hex). Absent for native TON. */
  jettonMaster?: string;
}

/** Parsed verification context extracted from a BOC */
export interface TonVerifyContext {
  /** Raw hex address of the payer wallet */
  payer: string;
  /** Sequence number from the external message */
  seqno: number;
  /** Unix timestamp after which the message expires */
  validUntil: number;
  /** Transfer amount in atomic units */
  transferAmount: bigint;
  /** Raw hex address of the transfer destination */
  transferDest: string;
  /** Asset identifier ("native" or jetton master address) */
  asset: string;
}

/** x402 payment requirements sent from server to client */
export interface PaymentRequirements {
  /** Payment scheme identifier (always "exact" for this mechanism) */
  scheme: string;
  /** CAIP-2 network identifier */
  network: string;
  /** Asset identifier ("native" or jetton master address) */
  asset: string;
  /** Required payment amount in atomic units */
  amount: string;
  /** Raw hex address of the payment recipient (vendor) */
  payTo: string;
  /** Maximum seconds before the payment expires */
  maxTimeoutSeconds: number;
  /** TON-specific extra fields (facilitator address + fee) */
  extra?: TonExtra;
}

/** Response from verify() — always a result object, never throws */
export interface VerifyResponse {
  /** Whether the payment BOC passed all verification steps */
  isValid: boolean;
  /** Raw hex address of the payer (when derivable) */
  payer?: string;
  /** Error code if verification failed */
  invalidReason?: X402ErrorCodeValue;
  /** Human-readable error description */
  invalidMessage?: string;
}

/** Response from settle() — always a result object, never throws */
export interface SettleResponse {
  /** Whether settlement completed successfully */
  success: boolean;
  /** Raw hex address of the payer */
  payer?: string;
  /** Transaction hash (hex) */
  transaction?: string;
  /** CAIP-2 network identifier */
  network?: string;
  /** Error code if settlement failed */
  errorReason?: X402ErrorCodeValue;
  /** Human-readable error description */
  errorMessage?: string;
}

/** Configuration for TonAPI-based transaction emulation (Step 12) */
export interface EmulationConfig {
  /** TonAPI authentication key */
  tonApiKey?: string;
  /** TonAPI base URL override (defaults based on network) */
  tonApiEndpoint?: string;
  /** Enable/disable emulation check (default: true when tonApiKey is set) */
  enableEmulation?: boolean;
  /** Timeout in milliseconds for emulation requests (default: 5000) */
  emulationTimeout?: number;
}

/** Fee configuration for the facilitator constructor */
export interface FeeConfig {
  /** Fee as a decimal fraction (e.g. 0.02 = 2%). Default: 0.02 */
  feePercentage?: number;
  /** Minimum fee in atomic units. Default: "10000" */
  feeMinimum?: string;
}
