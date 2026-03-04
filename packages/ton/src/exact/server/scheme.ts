import type { TonFee, TonExtra, PaymentRequirements } from '../../types';
import { NETWORK_CONFIG } from '../../constants';
import { toAtomicUnits } from '../../utils';

/**
 * Server-side x402 helper for TON payment requirements.
 *
 * Used by vendor servers to convert human-readable prices to atomic units
 * and attach facilitator/fee information to payment requirements.
 */
export class SchemeNetworkServer {
  readonly scheme = 'exact';

  /**
   * @param network CAIP-2 network identifier (e.g. "tvm:-239")
   * @param facilitatorAddress Raw hex address of the facilitator wallet
   * @param fee Fee schedule for the facilitator
   */
  constructor(
    private readonly network: string,
    private readonly facilitatorAddress: string,
    private readonly fee: TonFee,
  ) {}

  /**
   * Convert a human-readable price to atomic units for the given asset.
   *
   * @param humanPrice Human-readable price string (e.g. "1.5")
   * @param asset Asset identifier ("native" or jetton master address)
   * @returns Object with asset identifier and atomic amount string
   * @throws Error if network or asset is unsupported
   */
  parsePrice(humanPrice: string, asset: string): { asset: string; amount: string } {
    const config = NETWORK_CONFIG[this.network];
    if (!config) {
      throw new Error(`Unsupported network: ${this.network}`);
    }

    const assetConfig = config.assets[asset];
    if (!assetConfig) {
      throw new Error(`Unsupported asset: ${asset} on network ${this.network}`);
    }

    const atomicUnits = toAtomicUnits(humanPrice, assetConfig.decimals);

    return {
      asset,
      amount: atomicUnits.toString(),
    };
  }

  /**
   * Attach facilitator address and fee info to payment requirements.
   *
   * @param requirements Base payment requirements from the vendor
   * @returns Requirements with TON-specific `extra` field appended
   */
  enhancePaymentRequirements(
    requirements: Omit<PaymentRequirements, 'extra'>,
  ): PaymentRequirements {
    const extra: TonExtra = {
      facilitatorAddress: this.facilitatorAddress,
      fee: this.fee,
    };

    return {
      ...requirements,
      extra,
    };
  }
}
