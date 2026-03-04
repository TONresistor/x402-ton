import type { TonNetworkConfig } from './types';

/** CAIP-2 identifier for TON mainnet */
export const TON_MAINNET = 'tvm:-239';
/** CAIP-2 identifier for TON testnet */
export const TON_TESTNET = 'tvm:-3';
/** CAIP-2 family pattern matching all TON networks */
export const TVM_CAIP_FAMILY = 'tvm:*';

/** USDT jetton master contract address on mainnet (raw hex) */
export const USDT_MAINNET_MASTER =
  '0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecd436021ff';
/** USDT jetton master contract address on testnet (raw hex) */
export const USDT_TESTNET_MASTER =
  '0:d042a064f1966eb895936684a6cdf53a6fd6fe09bf762488045e8b2e8c564f9b';

/** Regex for validating raw TON addresses (workchain:64-hex-chars) */
export const RAW_ADDRESS_REGEX = /^(-?\d+):([0-9a-f]{64})$/i;

/** List of supported wallet contract versions */
export const SUPPORTED_WALLET_VERSIONS = ['v4r2', 'v5r1'] as const;

/** Number of decimal places for native TON */
export const TON_DECIMALS = 9;
/** Number of decimal places for USDT on TON */
export const USDT_DECIMALS = 6;

/** Maximum allowed BOC size in bytes (64KB) */
export const MAX_BOC_SIZE = 65536;
/** Maximum allowed cell tree depth */
export const MAX_DEPTH = 256;
/** Maximum allowed total cells in a BOC */
export const MAX_CELLS = 1024;

/** Clock skew tolerance in seconds for valid_until checks */
export const CLOCK_SKEW_BUFFER_SECONDS = 30;
/** Maximum wait time in seconds for seqno confirmation after broadcast */
export const SETTLEMENT_TIMEOUT_SECONDS = 30;
/** Interval in seconds between seqno polling attempts */
export const POLL_INTERVAL_SECONDS = 5;

/** TonAPI base URL for mainnet */
export const TON_API_MAINNET = 'https://tonapi.io';
/** TonAPI base URL for testnet */
export const TON_API_TESTNET = 'https://testnet.tonapi.io';

/** Default emulation request timeout in milliseconds */
export const DEFAULT_EMULATION_TIMEOUT = 5000;

/** Per-network configuration for endpoints and supported assets */
export const NETWORK_CONFIG: Record<string, TonNetworkConfig> = {
  [TON_MAINNET]: {
    networkId: TON_MAINNET,
    toncenterUrl: 'https://toncenter.com/api/v2/jsonRPC',
    assets: {
      native: {
        symbol: 'TON',
        decimals: TON_DECIMALS,
      },
      [USDT_MAINNET_MASTER]: {
        symbol: 'USDT',
        decimals: USDT_DECIMALS,
        jettonMaster: USDT_MAINNET_MASTER,
      },
    },
  },
  [TON_TESTNET]: {
    networkId: TON_TESTNET,
    toncenterUrl: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    assets: {
      native: {
        symbol: 'TON',
        decimals: TON_DECIMALS,
      },
      [USDT_TESTNET_MASTER]: {
        symbol: 'USDT',
        decimals: USDT_DECIMALS,
        jettonMaster: USDT_TESTNET_MASTER,
      },
    },
  },
};
