import { TonClient, WalletContractV5R1, WalletContractV4, internal } from '@ton/ton';
import { Cell, beginCell, Address, toNano, SendMode, storeMessage } from '@ton/core';
import { TonSigner } from '../../signer';
import type { ExactTonPayload, TonExtra, WalletVersion } from '../../types';
import { NETWORK_CONFIG } from '../../constants';
import { computeFee } from '../../utils';
import type { MessageRelaxed } from '@ton/core';

/**
 * Client-side x402 payment payload creator for TON.
 *
 * Constructs and signs external messages containing payment transfers
 * to the facilitator address. Used by AI agents or client applications
 * to create payment BOCs for x402 HTTP 402 flows.
 */
export class SchemeNetworkClient {
  readonly scheme = 'exact';

  /**
   * @param signer Client wallet signer
   * @param walletVersion Wallet contract version to use (default: "v5r1")
   */
  constructor(
    private readonly signer: TonSigner,
    private readonly walletVersion: WalletVersion = 'v5r1',
  ) {}

  /**
   * Create a signed payment payload (BOC) for the given payment requirements.
   *
   * @param network CAIP-2 network identifier
   * @param amount Payment amount in atomic units
   * @param asset Asset identifier ("native" or jetton master address)
   * @param payTo Vendor address (raw hex)
   * @param maxTimeoutSeconds Maximum time before payment expires
   * @param extra Facilitator info (address + fee schedule)
   * @returns Signed payment payload with BOC, public key, and wallet version
   * @throws Error if network is unsupported
   */
  async createPaymentPayload(
    network: string,
    amount: string,
    asset: string,
    payTo: string,
    maxTimeoutSeconds: number,
    extra: TonExtra,
  ): Promise<ExactTonPayload> {
    const config = NETWORK_CONFIG[network];
    if (!config) {
      throw new Error(`Unsupported network: ${network}`);
    }

    const client = new TonClient({ endpoint: config.toncenterUrl });
    const walletContract = this.signer.getWalletContract(this.walletVersion);
    const contract = client.open(walletContract);
    let seqno: number;
    try {
      seqno = await contract.getSeqno();
    } catch (err: unknown) {
      // Distinguish uninitialized wallet (exit_code -13 / method not found) from network errors.
      // Network errors (429, 500, timeout) must propagate — silently using seqno=0 would
      // produce an invalid BOC for already-deployed wallets.
      const message = err instanceof Error ? err.message : '';
      const isUninitWallet =
        message.includes('exit_code: -13') ||
        message.includes('Unable to execute get method') ||
        message.includes('-256'); // account not found
      if (isUninitWallet) {
        seqno = 0;
      } else {
        throw new Error(`Failed to fetch wallet seqno: ${message}`);
      }
    }

    const fee = computeFee(amount, extra.fee.percentage, extra.fee.minimum);
    const totalAmount = BigInt(amount) + fee;

    const validUntil = Math.floor(Date.now() / 1000) + maxTimeoutSeconds;
    const facilitatorAddress = Address.parse(extra.facilitatorAddress);
    const payerAddress = walletContract.address;

    let messages: MessageRelaxed[];

    if (asset === 'native') {
      messages = [
        internal({
          to: facilitatorAddress,
          value: totalAmount,
          body: undefined,
        }),
      ];
    } else {
      const jettonBody = beginCell()
        .storeUint(0x0f8a7ea5, 32)
        .storeUint(0, 64)
        .storeCoins(totalAmount)
        .storeAddress(facilitatorAddress)
        .storeAddress(payerAddress)
        .storeBit(0)
        .storeCoins(toNano('0.01'))
        .storeBit(0)
        .endCell();

      const jettonMaster = Address.parse(asset);
      const jettonWalletResult = await client.runMethod(jettonMaster, 'get_wallet_address', [
        { type: 'slice', cell: beginCell().storeAddress(payerAddress).endCell() },
      ]);
      const payerJettonWallet = jettonWalletResult.stack.readAddress();

      messages = [
        internal({
          to: payerJettonWallet,
          value: toNano('0.05'),
          body: jettonBody,
        }),
      ];
    }

    const secretKey = this.signer.getSecretKey();
    const sendMode = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS;
    let transferCell: Cell;

    if (walletContract instanceof WalletContractV5R1) {
      transferCell = walletContract.createTransfer({
        seqno,
        secretKey,
        messages,
        sendMode,
        timeout: validUntil,
      });
    } else {
      transferCell = (walletContract as WalletContractV4).createTransfer({
        seqno,
        secretKey,
        messages,
        sendMode,
        timeout: validUntil,
      });
    }

    // Wrap transfer body in a full external message (with stateInit for first tx)
    const needsInit = seqno === 0;
    const extMsg = beginCell()
      .store(
        storeMessage({
          info: {
            type: 'external-in',
            dest: walletContract.address,
            importFee: 0n,
          },
          init: needsInit ? walletContract.init : undefined,
          body: transferCell,
        }),
      )
      .endCell();
    const boc = extMsg.toBoc().toString('base64');

    return {
      boc,
      publicKey: this.signer.getPublicKey(),
      walletVersion: this.walletVersion,
    };
  }
}
