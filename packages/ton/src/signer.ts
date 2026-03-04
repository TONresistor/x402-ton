import { Cell } from '@ton/core';
import { mnemonicToPrivateKey, sign, KeyPair } from '@ton/crypto';
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import type { WalletVersion } from './types';

/** Unified TON wallet signer. Derives keys from a BIP-39 mnemonic. */
export class TonSigner {
  private readonly mnemonic: string[];
  private keyPair: KeyPair | null = null;

  /** @param mnemonic BIP-39 mnemonic word array (typically 24 words) */
  constructor(mnemonic: string[]) {
    this.mnemonic = mnemonic;
  }

  async init(): Promise<void> {
    this.keyPair = await mnemonicToPrivateKey(this.mnemonic);
  }

  private ensureInitialized(): KeyPair {
    if (!this.keyPair) {
      throw new Error('Signer not initialized. Call init() first.');
    }
    return this.keyPair;
  }

  getPublicKey(): string {
    const kp = this.ensureInitialized();
    return kp.publicKey.toString('hex');
  }

  getAddress(walletVersion: WalletVersion): string {
    const contract = this.getWalletContract(walletVersion);
    return `${contract.address.workChain}:${contract.address.hash.toString('hex')}`;
  }

  getWalletContract(walletVersion: WalletVersion): WalletContractV4 | WalletContractV5R1 {
    const kp = this.ensureInitialized();
    switch (walletVersion) {
      case 'v4r2':
        return WalletContractV4.create({
          workchain: 0,
          publicKey: kp.publicKey,
        });
      case 'v5r1':
        return WalletContractV5R1.create({
          workchain: 0,
          publicKey: kp.publicKey,
        });
      default:
        throw new Error(`Unsupported wallet version: ${walletVersion}`);
    }
  }

  getSecretKey(): Buffer {
    const kp = this.ensureInitialized();
    return kp.secretKey;
  }

  async sign(cell: Cell): Promise<Buffer> {
    const kp = this.ensureInitialized();
    return sign(cell.hash(), kp.secretKey);
  }
}

/** @deprecated Use TonSigner directly. Kept for backward compatibility. */
export const ClientTonSigner = TonSigner;
/** @deprecated Use TonSigner directly. Kept for backward compatibility. */
export const FacilitatorTonSigner = TonSigner;
