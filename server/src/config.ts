export interface ServerConfig {
  port: number;
  tonMnemonic: string[];
  tonNetwork: string;
  toncenterUrl: string;
  tonapiKey?: string;
  dbPath: string;
  feePercentage: number;
  feeMinimum: string;
  rateLimits: {
    global: number;
    perIp: number;
    perWallet: number;
    settlePerWallet: number;
  };
}

export function loadConfig(): ServerConfig {
  const mnemonicStr = process.env.TON_MNEMONIC;
  if (!mnemonicStr) {
    throw new Error('TON_MNEMONIC environment variable is required (space-separated)');
  }

  const tonMnemonic = mnemonicStr.trim().split(/\s+/);
  if (tonMnemonic.length !== 24) {
    throw new Error('TON_MNEMONIC must contain exactly 24 words');
  }

  const tonNetwork = process.env.TON_NETWORK;
  if (!tonNetwork) {
    throw new Error('TON_NETWORK environment variable is required (tvm:-239 or tvm:-3)');
  }
  if (tonNetwork !== 'tvm:-239' && tonNetwork !== 'tvm:-3') {
    throw new Error('TON_NETWORK must be tvm:-239 or tvm:-3');
  }

  const toncenterUrl =
    process.env.TONCENTER_URL ||
    (tonNetwork === 'tvm:-239'
      ? 'https://toncenter.com/api/v2/jsonRPC'
      : 'https://testnet.toncenter.com/api/v2/jsonRPC');

  const feePercentage = parseFloat(process.env.FEE_PERCENTAGE || '0.02');
  if (Number.isNaN(feePercentage) || feePercentage < 0 || feePercentage > 1) {
    throw new Error('FEE_PERCENTAGE must be a number between 0 and 1');
  }

  return {
    port: parseInt(process.env.PORT || '4020', 10),
    tonMnemonic,
    tonNetwork,
    toncenterUrl,
    tonapiKey: process.env.TONAPI_KEY || undefined,
    dbPath: process.env.DB_PATH || './data/facilitator.db',
    feePercentage,
    feeMinimum: process.env.FEE_MINIMUM || '10000',
    rateLimits: {
      global: parseInt(process.env.RATE_LIMIT_GLOBAL || '1000', 10),
      perIp: parseInt(process.env.RATE_LIMIT_PER_IP || '100', 10),
      perWallet: parseInt(process.env.RATE_LIMIT_PER_WALLET || '30', 10),
      settlePerWallet: parseInt(process.env.RATE_LIMIT_SETTLE_PER_WALLET || '10', 10),
    },
  };
}
