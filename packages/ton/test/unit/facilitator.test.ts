import { describe, it, expect, beforeAll, vi } from 'vitest';
import { beginCell, Address, storeMessageRelaxed } from '@ton/core';
import { mnemonicNew, sign } from '@ton/crypto';
import { TonClient, internal } from '@ton/ton';
import { FacilitatorTonSigner, ClientTonSigner } from '../../src/signer';
import { SchemeNetworkFacilitator } from '../../src/exact/facilitator/scheme';
import { TON_MAINNET, TVM_CAIP_FAMILY } from '../../src/constants';
import type { PaymentRequirements, ExactTonPayload, TonExtra } from '../../src/types';

function createMockTonClient(seqno: number = 5): TonClient {
  return {
    open: vi.fn().mockReturnValue({
      getSeqno: vi.fn().mockResolvedValue(seqno),
    }),
    runMethod: vi.fn().mockResolvedValue({
      stack: {
        readAddress: vi
          .fn()
          .mockReturnValue(
            Address.parse(
              '0:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
            ),
          ),
      },
    }),
    sendFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as TonClient;
}

async function buildVerifyCompatiblePayload(
  clientSigner: ClientTonSigner,
  facilitatorAddress: string,
  extra: TonExtra,
  opts: {
    seqno?: number;
    validUntilOverride?: number;
    amountOverride?: bigint;
    recipientOverride?: string;
  } = {},
): Promise<ExactTonPayload> {
  const { computeFee } = await import('../../src/utils');
  const seqno = opts.seqno ?? 5;
  const validUntil = opts.validUntilOverride ?? Math.floor(Date.now() / 1000) + 120;

  const fee = computeFee('1000000000', extra.fee.percentage, extra.fee.minimum);
  const totalAmount = opts.amountOverride ?? BigInt('1000000000') + fee;
  const recipient = opts.recipientOverride ?? facilitatorAddress;

  // Build signing message (matches real V4R2 format from @ton/ton createWalletTransferV4)
  // signature at front + body inline with storeBuilder
  const msg = internal({
    to: Address.parse(recipient),
    value: totalAmount,
    body: undefined,
  });
  const bodyCell = beginCell()
    .storeUint(698983191, 32) // V4R2 default subwalletId
    .storeUint(validUntil, 32)
    .storeUint(seqno, 32)
    .storeUint(3, 8) // sendMode (PAY_GAS_SEPARATELY + IGNORE_ERRORS)
    .storeRef(beginCell().store(storeMessageRelaxed(msg)))
    .endCell();

  const secretKey = clientSigner.getSecretKey();
  const signature = sign(bodyCell.hash(), secretKey);

  // V4R2: packSignatureToFront — signature + body bits/refs inline
  const rootCell = beginCell().storeBuffer(signature).storeSlice(bodyCell.beginParse()).endCell();

  return {
    boc: rootCell.toBoc().toString('base64'),
    publicKey: clientSigner.getPublicKey(),
    walletVersion: 'v4r2',
  };
}

describe('SchemeNetworkFacilitator', () => {
  let facilitatorSigner: FacilitatorTonSigner;
  let clientSigner: ClientTonSigner;
  let facilitatorAddress: string;
  let extra: TonExtra;
  let baseRequirements: PaymentRequirements;

  beforeAll(async () => {
    const facMnemonic = await mnemonicNew(24);
    facilitatorSigner = new FacilitatorTonSigner(facMnemonic);
    await facilitatorSigner.init();
    facilitatorAddress = facilitatorSigner.getAddress('v5r1');

    const clientMnemonic = await mnemonicNew(24);
    clientSigner = new ClientTonSigner(clientMnemonic);
    await clientSigner.init();

    extra = {
      facilitatorAddress,
      fee: {
        percentage: 0.02,
        minimum: '10000',
        address: facilitatorAddress,
      },
    };

    baseRequirements = {
      scheme: 'exact',
      network: TON_MAINNET,
      asset: 'native',
      amount: '1000000000',
      payTo: '0:1111111111111111111111111111111111111111111111111111111111111111',
      maxTimeoutSeconds: 120,
      extra,
    };
  });

  describe('properties', () => {
    it('scheme is "exact"', () => {
      const mockClient = createMockTonClient();
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);
      expect(fac.scheme).toBe('exact');
    });

    it('caipFamily is "tvm:*"', () => {
      const mockClient = createMockTonClient();
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);
      expect(fac.caipFamily).toBe(TVM_CAIP_FAMILY);
    });
  });

  describe('getExtra', () => {
    it('returns facilitatorAddress and fee', () => {
      const mockClient = createMockTonClient();
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);
      const result = fac.getExtra();
      expect(result.facilitatorAddress).toMatch(/^0:[0-9a-f]{64}$/);
      expect(result.fee).toBeDefined();
      expect(result.fee.percentage).toBe(0.02);
      expect(result.fee.minimum).toBe('10000');
      expect(result.fee.address).toBe(result.facilitatorAddress);
    });

    it('uses custom fee config when provided', () => {
      const mockClient = createMockTonClient();
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient, {
        feePercentage: 0.05,
        feeMinimum: '50000',
      });
      const result = fac.getExtra();
      expect(result.fee.percentage).toBe(0.05);
      expect(result.fee.minimum).toBe('50000');
    });
  });

  describe('getSigners', () => {
    it('returns array with facilitator address', () => {
      const mockClient = createMockTonClient();
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);
      const signers = fac.getSigners();
      expect(signers).toHaveLength(1);
      expect(signers[0]).toMatch(/^0:[0-9a-f]{64}$/);
    });
  });

  describe('verify', () => {
    it('valid native TON payment returns isValid: true', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBeDefined();
    });

    it('invalid scheme returns invalid_scheme', async () => {
      const mockClient = createMockTonClient();
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      const result = await fac.verify(payload, {
        ...baseRequirements,
        scheme: 'wrong',
      });
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_scheme');
    });

    it('invalid network returns invalid_network', async () => {
      const mockClient = createMockTonClient();
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      const result = await fac.verify(payload, {
        ...baseRequirements,
        network: 'tvm:-999',
      });
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_network');
    });

    it('malformed BOC returns invalid_exact_ton_boc', async () => {
      const mockClient = createMockTonClient();
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload: ExactTonPayload = {
        boc: Buffer.from('not-a-valid-boc').toString('base64'),
        publicKey: clientSigner.getPublicKey(),
        walletVersion: 'v4r2',
      };

      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_exact_ton_boc');
    });

    it('unsupported wallet version returns invalid_exact_ton_wallet_version', async () => {
      const mockClient = createMockTonClient();
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      const result = await fac.verify(
        { ...payload, walletVersion: 'v3r2' as never },
        baseRequirements,
      );
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_exact_ton_wallet_version');
    });

    it('invalid signature returns invalid_exact_ton_signature', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      const otherMnemonic = await mnemonicNew(24);
      const otherSigner = new ClientTonSigner(otherMnemonic);
      await otherSigner.init();

      const result = await fac.verify(
        { ...payload, publicKey: otherSigner.getPublicKey() },
        baseRequirements,
      );
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_exact_ton_signature');
    });

    it('expired payment returns invalid_exact_ton_expired', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra, {
        validUntilOverride: Math.floor(Date.now() / 1000) - 120,
      });

      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_exact_ton_expired');
    });

    it('wrong seqno returns invalid_exact_ton_seqno', async () => {
      const mockClient = createMockTonClient(10);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_exact_ton_seqno');
    });

    it('insufficient amount returns invalid_exact_ton_amount', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra, {
        amountOverride: 100n,
      });

      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_exact_ton_amount');
    });

    it('wrong recipient returns invalid result', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra, {
        recipientOverride:
          '0:9999999999999999999999999999999999999999999999999999999999999999',
      });

      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(false);
      expect(['invalid_exact_ton_recipient', 'invalid_exact_ton_boc']).toContain(
        result.invalidReason,
      );
    });

    it('never throws - returns Result on unexpected error', async () => {
      const mockClient = {
        open: vi.fn().mockImplementation(() => {
          throw new Error('Simulated crash');
        }),
      } as unknown as TonClient;
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      // Should NOT throw
      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBeDefined();
    });
  });

  describe('settle', () => {
    it('returns failure when verify fails', async () => {
      const mockClient = createMockTonClient(10); // seqno mismatch
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      const result = await fac.settle(payload, baseRequirements);
      expect(result.success).toBe(false);
      expect(result.errorReason).toBe('invalid_exact_ton_seqno');
    });

    it('returns broadcast_failed when sendFile throws', async () => {
      const mockClient = {
        open: vi.fn().mockReturnValue({
          getSeqno: vi.fn().mockResolvedValue(5),
        }),
        sendFile: vi.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as TonClient;
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      const result = await fac.settle(payload, baseRequirements);
      expect(result.success).toBe(false);
      expect(result.errorReason).toBe('settlement_broadcast_failed');
    });

    it('returns settlement_timeout when seqno never advances', async () => {
      // Mock: seqno stays at 5 (never advances to 6)
      const mockClient = {
        open: vi.fn().mockReturnValue({
          getSeqno: vi.fn().mockResolvedValue(5),
        }),
        sendFile: vi.fn().mockResolvedValue(undefined),
      } as unknown as TonClient;
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      // Override settlement timeout constants for faster test
      vi.useFakeTimers();
      const settlePromise = fac.settle(payload, baseRequirements);

      // Fast-forward through all poll intervals
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(5000);
      }

      const result = await settlePromise;
      vi.useRealTimers();

      expect(result.success).toBe(false);
      expect(result.errorReason).toBe('settlement_timeout');
    });

    it('never throws - returns Result on unexpected error', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload: ExactTonPayload = {
        boc: Buffer.from('not-a-valid-boc').toString('base64'),
        publicKey: clientSigner.getPublicKey(),
        walletVersion: 'v4r2',
      };

      // Should NOT throw
      const result = await fac.settle(payload, baseRequirements);
      expect(result.success).toBe(false);
    });
  });

  describe('security', () => {
    it('rejects BOC with fake facilitator address in extra (address spoofing)', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      // Attacker address — NOT the facilitator
      const attackerAddress =
        '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      // Build BOC sending to attacker address
      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra, {
        recipientOverride: attackerAddress,
      });

      // Attacker sets extra.facilitatorAddress to match their address (circular bypass attempt)
      const tamperedRequirements: PaymentRequirements = {
        ...baseRequirements,
        extra: {
          facilitatorAddress: attackerAddress,
          fee: { percentage: 0.02, minimum: '10000', address: attackerAddress },
        },
      };

      const result = await fac.verify(payload, tamperedRequirements);
      // Server uses its OWN address, not the attacker's — rejects
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_exact_ton_recipient');
    });

    it('rejects BOC with 0% fee when server fee is 2% (fee bypass)', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      // Build BOC with exact base amount (no fee) — attacker tries to pay 0 fee
      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra, {
        amountOverride: BigInt('1000000000'), // exact price, no fee
      });

      // Attacker sets fee to 0% in extra
      const tamperedRequirements: PaymentRequirements = {
        ...baseRequirements,
        extra: {
          facilitatorAddress,
          fee: { percentage: 0, minimum: '0', address: facilitatorAddress },
        },
      };

      const result = await fac.verify(payload, tamperedRequirements);
      // Server uses its OWN 2% fee config — amount is insufficient
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_exact_ton_amount');
    });

    it('ignores tampered extra.fee — uses server fee config', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      // Build BOC with correct amount (base + server's default 2% fee)
      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);

      // Attacker sets fee to 50% — if trusted, BOC would be "insufficient"
      const tamperedRequirements: PaymentRequirements = {
        ...baseRequirements,
        extra: {
          facilitatorAddress,
          fee: { percentage: 0.5, minimum: '500000000', address: facilitatorAddress },
        },
      };

      const result = await fac.verify(payload, tamperedRequirements);
      // Server uses its OWN 2% fee — BOC amount is sufficient → valid
      expect(result.isValid).toBe(true);
    });
  });

  describe('Step 12: emulation', () => {
    it('skips when no tonApiKey configured', async () => {
      const mockClient = createMockTonClient(5);
      // No emulation config
      const fac = new SchemeNetworkFacilitator(facilitatorSigner, TON_MAINNET, mockClient);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);
      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(true);
    });

    it('skips when enableEmulation is false', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(
        facilitatorSigner,
        TON_MAINNET,
        mockClient,
        undefined,
        { tonApiKey: 'test-key', enableEmulation: false },
      );

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);
      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(true);
    });

    it('returns isValid: true when emulation succeeds', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(
        facilitatorSigner,
        TON_MAINNET,
        mockClient,
        undefined,
        { tonApiKey: 'test-key', enableEmulation: true },
      );

      // Mock fetch to return successful emulation
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            transaction: {
              aborted: false,
              compute_phase: { success: true, exit_code: 0 },
            },
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);
      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(true);

      vi.unstubAllGlobals();
    });

    it('returns insufficient_balance when exit code is 37', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(
        facilitatorSigner,
        TON_MAINNET,
        mockClient,
        undefined,
        { tonApiKey: 'test-key', enableEmulation: true },
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            transaction: {
              aborted: true,
              compute_phase: { success: false, exit_code: 37 },
            },
          }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);
      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('insufficient_balance');

      vi.unstubAllGlobals();
    });

    it('gracefully skips when fetch fails (network error)', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(
        facilitatorSigner,
        TON_MAINNET,
        mockClient,
        undefined,
        { tonApiKey: 'test-key', enableEmulation: true },
      );

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network unreachable'));
      vi.stubGlobal('fetch', mockFetch);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);
      const result = await fac.verify(payload, baseRequirements);
      // Should gracefully skip and return valid
      expect(result.isValid).toBe(true);

      vi.unstubAllGlobals();
    });

    it('gracefully skips when TonAPI returns non-200', async () => {
      const mockClient = createMockTonClient(5);
      const fac = new SchemeNetworkFacilitator(
        facilitatorSigner,
        TON_MAINNET,
        mockClient,
        undefined,
        { tonApiKey: 'test-key', enableEmulation: true },
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      vi.stubGlobal('fetch', mockFetch);

      const payload = await buildVerifyCompatiblePayload(clientSigner, facilitatorAddress, extra);
      const result = await fac.verify(payload, baseRequirements);
      expect(result.isValid).toBe(true);

      vi.unstubAllGlobals();
    });
  });
});
