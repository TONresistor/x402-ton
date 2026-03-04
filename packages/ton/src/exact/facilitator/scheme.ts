import { TonClient, WalletContractV5R1, WalletContractV4, internal } from '@ton/ton';
import { Cell, beginCell, Address, toNano, SendMode, loadMessage, storeMessage } from '@ton/core';
import type { MessageRelaxed } from '@ton/core';
import { signVerify } from '@ton/crypto';
import { TonSigner } from '../../signer';
import { X402ErrorCode } from '../../types';
import type {
  ExactTonPayload,
  TonExtra,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  WalletVersion,
  EmulationConfig,
  FeeConfig,
  X402ErrorCodeValue,
} from '../../types';
import {
  NETWORK_CONFIG,
  CLOCK_SKEW_BUFFER_SECONDS,
  SETTLEMENT_TIMEOUT_SECONDS,
  POLL_INTERVAL_SECONDS,
  SUPPORTED_WALLET_VERSIONS,
  TVM_CAIP_FAMILY,
  TON_MAINNET,
  TON_API_MAINNET,
  TON_API_TESTNET,
  DEFAULT_EMULATION_TIMEOUT,
} from '../../constants';
import { validateBoc, computeFee } from '../../utils';

/**
 * Facilitator-side x402 payment verification and settlement for TON.
 *
 * Implements a 12-step verification pipeline and settlement flow:
 * - Steps 1-5: Scheme, network, and BOC validation
 * - Steps 6-7: Wallet version and Ed25519 signature verification
 * - Steps 8-9: Address derivation and expiry check
 * - Step 10: On-chain seqno verification
 * - Step 11: Internal message amount/recipient/asset validation
 * - Step 12: Optional TonAPI transaction emulation (graceful degradation)
 */
export class SchemeNetworkFacilitator {
  readonly scheme = 'exact';
  readonly caipFamily = TVM_CAIP_FAMILY;
  private readonly feePercentage: number;
  private readonly feeMinimum: string;
  private readonly emulationConfig: EmulationConfig;

  /**
   * @param signer Facilitator wallet signer (for settlement and fund routing)
   * @param network CAIP-2 network identifier (e.g. "tvm:-239")
   * @param tonClient TonClient instance for RPC calls
   * @param feeConfig Optional custom fee configuration
   * @param emulationConfig Optional TonAPI emulation configuration
   */
  constructor(
    private readonly signer: TonSigner,
    private readonly network: string,
    private readonly tonClient: TonClient,
    feeConfig?: FeeConfig,
    emulationConfig?: EmulationConfig,
  ) {
    this.feePercentage = feeConfig?.feePercentage ?? 0.02;
    this.feeMinimum = feeConfig?.feeMinimum ?? '10000';
    this.emulationConfig = emulationConfig ?? {};
  }

  /**
   * Verify a payment BOC against payment requirements.
   * Returns a result object — never throws.
   */
  async verify(
    payload: ExactTonPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    try {
      return await this.verifyInternal(payload, requirements);
    } catch (err) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_boc,
        invalidMessage: `Unexpected error: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  private async verifyInternal(
    payload: ExactTonPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // Step 2: Validate scheme
    if (requirements.scheme !== 'exact') {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_scheme,
        invalidMessage: `Expected scheme "exact", got "${requirements.scheme}"`,
      };
    }

    // Step 3: Validate network
    if (!NETWORK_CONFIG[requirements.network]) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_network,
        invalidMessage: `Unsupported network: ${requirements.network}`,
      };
    }

    // Step 4 & 5: Decode and validate BOC
    let rootCell: Cell;
    try {
      rootCell = validateBoc(payload.boc);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      const reason =
        message === 'boc_depth_exceeded'
          ? X402ErrorCode.boc_depth_exceeded
          : message === 'boc_cells_exceeded'
            ? X402ErrorCode.boc_cells_exceeded
            : X402ErrorCode.invalid_boc;
      return {
        isValid: false,
        invalidReason: reason,
        invalidMessage: `BOC validation failed: ${message}`,
      };
    }

    // Step 5b: Extract body from BOC (supports both raw body and full external message)
    let bodyRoot: Cell;
    try {
      const msg = loadMessage(rootCell.beginParse());
      if (msg.info.type !== 'external-in') {
        return {
          isValid: false,
          invalidReason: X402ErrorCode.invalid_boc,
          invalidMessage: 'Expected external-in message',
        };
      }
      bodyRoot = msg.body;
    } catch {
      // Fallback: treat as raw body (backwards compatibility)
      bodyRoot = rootCell;
    }

    // Step 6: Validate wallet version
    if (!(SUPPORTED_WALLET_VERSIONS as readonly string[]).includes(payload.walletVersion)) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_wallet_version,
        invalidMessage: `Unsupported wallet version: ${payload.walletVersion}`,
      };
    }

    // Step 7: Verify Ed25519 signature
    const publicKey = Buffer.from(payload.publicKey, 'hex');
    if (publicKey.length !== 32) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_signature,
        invalidMessage: 'Public key must be 32 bytes',
      };
    }

    // Parse body — extract signature and signed data (format differs by wallet version)
    // V4R2: signature(512 bits) + body_inline + refs  (signature at front)
    // V5R1: body_inline + signature(512 bits) + refs  (signature at tail)
    let signature: Buffer;
    let signedBody: Cell;
    try {
      const slice = bodyRoot.beginParse();
      if (payload.walletVersion === 'v5r1') {
        // V5R1: signature is the last 512 bits (64 bytes)
        const bodyBitLength = slice.remainingBits - 512;
        const bodyBits = slice.loadBits(bodyBitLength);
        signature = slice.loadBuffer(64);
        const builder = beginCell();
        builder.storeBits(bodyBits);
        while (slice.remainingRefs > 0) {
          builder.storeRef(slice.loadRef());
        }
        signedBody = builder.endCell();
      } else {
        // V4R2: signature is the first 512 bits (64 bytes)
        signature = slice.loadBuffer(64);
        signedBody = beginCell().storeSlice(slice).endCell();
      }
    } catch {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_signature,
        invalidMessage: 'Failed to parse signature from external message',
      };
    }

    if (!signVerify(signedBody.hash(), signature, publicKey)) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_signature,
        invalidMessage: 'Ed25519 signature verification failed',
      };
    }

    // Step 8: Derive wallet address
    const derivedWallet = this.deriveWalletContract(publicKey, payload.walletVersion);
    const payer = `${derivedWallet.address.workChain}:${derivedWallet.address.hash.toString('hex')}`;

    // Parse the signed body to extract validUntil, seqno, and internal messages
    // V4R2 body: subwalletId(32) + validUntil(32) + seqno(32) + [sendMode(8) + ref(msg)]...
    // V5R1 body: opcode(32) + walletId(32) + validUntil(32) + seqno(32) + actions
    let validUntil: number;
    let seqno: number;
    const bodySlice = signedBody.beginParse();
    try {
      if (payload.walletVersion === 'v5r1') {
        bodySlice.skip(32 + 32); // opcode (0x7369676e) + wallet_id (32-bit XOR-encoded)
      } else {
        bodySlice.skip(32); // subwallet_id
      }
      validUntil = bodySlice.loadUint(32);
      seqno = bodySlice.loadUint(32);
    } catch {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_boc,
        invalidMessage: 'Failed to parse valid_until/seqno from external message',
        payer,
      };
    }

    // Step 9: Check valid_until > now - CLOCK_SKEW_BUFFER
    const now = Math.floor(Date.now() / 1000);
    if (validUntil <= now - CLOCK_SKEW_BUFFER_SECONDS) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.expired,
        invalidMessage: `Message expired: valid_until=${validUntil}, now=${now}`,
        payer,
      };
    }

    // Step 10: Check seqno against on-chain
    try {
      const contract = this.tonClient.open(derivedWallet);
      let onChainSeqno: number;
      try {
        onChainSeqno = await contract.getSeqno();
      } catch (err: unknown) {
        // Only treat "uninit wallet" errors as seqno=0; propagate network errors
        const message = err instanceof Error ? err.message : '';
        const isUninitWallet =
          message.includes('exit_code: -13') ||
          message.includes('Unable to execute get method') ||
          message.includes('-256');
        if (isUninitWallet) {
          onChainSeqno = 0;
        } else {
          return {
            isValid: false,
            invalidReason: X402ErrorCode.seqno_mismatch,
            invalidMessage: `Failed to fetch on-chain seqno: ${message}`,
            payer,
          };
        }
      }
      if (seqno !== onChainSeqno) {
        return {
          isValid: false,
          invalidReason: X402ErrorCode.seqno_mismatch,
          invalidMessage: `Seqno mismatch: payload=${seqno}, on-chain=${onChainSeqno}`,
          payer,
        };
      }
    } catch {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.seqno_mismatch,
        invalidMessage: 'Failed to fetch on-chain seqno',
        payer,
      };
    }

    // Step 11: Parse internal messages and validate amount/recipient/asset
    // SECURITY: Use server-side extra (own address + fee config), never trust client-supplied values
    const extra = this.getExtra();
    const fee = computeFee(requirements.amount, this.feePercentage, this.feeMinimum);
    const requiredTotal = BigInt(requirements.amount) + fee;

    // Extract the internal message cell (format differs by wallet version)
    let internalMsgCell: Cell;
    try {
      if (payload.walletVersion === 'v5r1') {
        // V5R1 actions: storeMaybeRef(outListPacked) + hasExtended(1)
        // outListPacked: ref(previousEmpty) + actionTag(32) + sendMode(8) + ref(messageCell)
        const hasActionsRef = bodySlice.loadBit();
        if (!hasActionsRef) {
          return {
            isValid: false,
            invalidReason: X402ErrorCode.invalid_boc,
            invalidMessage: 'No actions in V5R1 message',
            payer,
          };
        }
        const actionsCell = bodySlice.loadRef();
        const actionsSlice = actionsCell.beginParse();
        actionsSlice.loadRef(); // skip previous actions (empty for single action)
        actionsSlice.loadUint(32); // action_send_msg tag (0x0ec3c86d)
        actionsSlice.loadUint(8); // sendMode
        internalMsgCell = actionsSlice.loadRef(); // the message
      } else {
        // V4R2: sendMode(8) stored in bits, ref(messageCell) in refs
        // loadRef() accesses refs independently of bit position
        internalMsgCell = bodySlice.loadRef();
      }
    } catch {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_boc,
        invalidMessage: 'Failed to extract internal message from payload',
        payer,
      };
    }

    const msgValidation = this.validateInternalMessage(
      internalMsgCell,
      requirements.asset,
      extra,
      requiredTotal,
      payer,
    );
    if (msgValidation) {
      return msgValidation;
    }

    // Step 12: Optional TonAPI emulation
    const emulationResult = await this.runEmulation(payload.boc, requirements.asset);
    if (emulationResult) {
      return { ...emulationResult, payer };
    }

    // All checks passed
    return {
      isValid: true,
      payer,
    };
  }

  /**
   * Settle a payment: verify, broadcast BOC, poll for confirmation, route funds.
   * Returns a result object — never throws.
   */
  async settle(
    payload: ExactTonPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    // Step 1: Verify first
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        payer: verifyResult.payer,
        transaction: '',
        network: requirements.network,
        errorReason: verifyResult.invalidReason,
        errorMessage: verifyResult.invalidMessage,
      };
    }

    const payer = verifyResult.payer ?? '';

    // Step 2: Broadcast BOC
    let bocHash: string;
    try {
      const bocBuffer = Buffer.from(payload.boc, 'base64');
      const cells = Cell.fromBoc(bocBuffer);
      const rootCell = cells[0];
      if (!rootCell) {
        return {
          success: false,
          payer,
          transaction: '',
          network: requirements.network,
          errorReason: X402ErrorCode.broadcast_failed,
          errorMessage: 'Empty BOC',
        };
      }
      bocHash = rootCell.hash().toString('hex');
      await this.tonClient.sendFile(bocBuffer);
    } catch (err) {
      return {
        success: false,
        payer,
        transaction: '',
        network: requirements.network,
        errorReason: X402ErrorCode.broadcast_failed,
        errorMessage: `Failed to broadcast BOC: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }

    // Step 3: Poll for confirmation
    const derivedWallet = this.deriveWalletContract(
      Buffer.from(payload.publicKey, 'hex'),
      payload.walletVersion,
    );
    const contract = this.tonClient.open(derivedWallet);

    // Extract expected seqno from BOC (seqno in payload + 1 = expected after confirmation)
    // This reuses parsing logic from verify — safe because verify already validated the BOC
    const bocRoot = Cell.fromBoc(Buffer.from(payload.boc, 'base64'))[0];
    if (!bocRoot) {
      return {
        success: false,
        payer,
        transaction: bocHash,
        network: requirements.network,
        errorReason: X402ErrorCode.invalid_boc,
        errorMessage: 'Empty BOC in settle',
      };
    }
    let bodyCell: Cell;
    try {
      const msg = loadMessage(bocRoot.beginParse());
      bodyCell = msg.body;
    } catch {
      bodyCell = bocRoot;
    }
    const s = bodyCell.beginParse();
    let expectedSeqno: number;
    if (payload.walletVersion === 'v5r1') {
      const bodyBitLen = s.remainingBits - 512;
      const bodyBits = s.loadBits(bodyBitLen);
      s.loadBuffer(64); // skip signature
      const bodySlice = beginCell().storeBits(bodyBits).endCell().beginParse();
      bodySlice.skip(32 + 32 + 32); // opcode + walletId + validUntil
      expectedSeqno = bodySlice.loadUint(32) + 1;
    } else {
      s.skip(512); // signature
      s.skip(32 + 32); // subwalletId + validUntil
      expectedSeqno = s.loadUint(32) + 1;
    }

    let confirmed = false;
    const startTime = Date.now();

    while (Date.now() - startTime < SETTLEMENT_TIMEOUT_SECONDS * 1000) {
      await this.sleep(POLL_INTERVAL_SECONDS * 1000);
      try {
        const currentSeqno = await contract.getSeqno();
        if (currentSeqno >= expectedSeqno) {
          confirmed = true;
          break;
        }
      } catch {
        // Continue polling
      }
    }

    if (!confirmed) {
      return {
        success: false,
        payer,
        transaction: bocHash,
        network: requirements.network,
        errorReason: X402ErrorCode.settlement_timeout,
        errorMessage: `Transaction not confirmed within ${SETTLEMENT_TIMEOUT_SECONDS} seconds`,
      };
    }

    // Step 5: Route funds to payTo
    try {
      await this.routeFunds(requirements);
    } catch (err) {
      return {
        success: false,
        payer,
        transaction: bocHash,
        network: requirements.network,
        errorReason: X402ErrorCode.routing_failed,
        errorMessage: `Failed to route funds: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }

    return {
      success: true,
      payer,
      transaction: bocHash,
      network: requirements.network,
    };
  }

  /** Get facilitator extra info (address + fee schedule) for payment requirements */
  getExtra(): TonExtra {
    const facilitatorAddress = this.signer.getAddress('v5r1');
    return {
      facilitatorAddress,
      fee: {
        percentage: this.feePercentage,
        minimum: this.feeMinimum,
        address: facilitatorAddress,
      },
    };
  }

  /** Get list of facilitator signer addresses */
  getSigners(): string[] {
    return [this.signer.getAddress('v5r1')];
  }

  // --------------- private helpers ---------------

  private validateInternalMessage(
    msgCell: Cell,
    asset: string,
    extra: TonExtra,
    requiredTotal: bigint,
    payer: string,
  ): VerifyResponse | null {
    try {
      if (asset === 'native') {
        return this.validateNativeTransfer(msgCell, extra, requiredTotal, payer);
      } else {
        return this.validateJettonTransfer(msgCell, extra, requiredTotal, payer);
      }
    } catch {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_boc,
        invalidMessage: 'Failed to parse internal messages',
        payer,
      };
    }
  }

  private validateNativeTransfer(
    msgCell: Cell,
    extra: TonExtra,
    requiredTotal: bigint,
    payer: string,
  ): VerifyResponse | null {
    const internalMsg = msgCell.beginParse();
    const prefix = internalMsg.loadBit();
    if (prefix) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_boc,
        invalidMessage: 'Expected internal message, got external',
        payer,
      };
    }
    internalMsg.loadBit(); // ihr_disabled
    internalMsg.loadBit(); // bounce
    internalMsg.loadBit(); // bounced
    internalMsg.loadMaybeAddress(); // src (addr_none)
    const dest = internalMsg.loadAddress();
    const value = internalMsg.loadCoins();

    if (!dest) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.wrong_recipient,
        invalidMessage: 'No destination address in internal message',
        payer,
      };
    }

    const destRaw = `${dest.workChain}:${dest.hash.toString('hex')}`;
    if (destRaw !== extra.facilitatorAddress) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.wrong_recipient,
        invalidMessage: `Recipient mismatch: got ${destRaw}, expected ${extra.facilitatorAddress}`,
        payer,
      };
    }

    if (value < requiredTotal) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.insufficient_amount,
        invalidMessage: `Insufficient amount: got ${value}, required ${requiredTotal}`,
        payer,
      };
    }

    return null; // valid
  }

  private validateJettonTransfer(
    msgCell: Cell,
    extra: TonExtra,
    requiredTotal: bigint,
    payer: string,
  ): VerifyResponse | null {
    const internalMsg = msgCell.beginParse();
    const prefix = internalMsg.loadBit();
    if (prefix) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.invalid_boc,
        invalidMessage: 'Expected internal message, got external',
        payer,
      };
    }
    internalMsg.loadBit(); // ihr_disabled
    internalMsg.loadBit(); // bounce
    internalMsg.loadBit(); // bounced
    internalMsg.loadMaybeAddress(); // src
    internalMsg.loadAddress(); // dest (payer's jetton wallet)
    internalMsg.loadCoins(); // TON value (gas)
    internalMsg.loadBit(); // extra currencies
    internalMsg.loadCoins(); // ihr_fee
    internalMsg.loadCoins(); // fwd_fee
    internalMsg.loadUint(64); // created_lt
    internalMsg.loadUint(32); // created_at

    // State init
    const hasStateInit = internalMsg.loadBit();
    if (hasStateInit) {
      if (internalMsg.loadBit()) {
        internalMsg.loadRef();
      }
    }

    // Body
    const hasBody = internalMsg.loadBit();
    const jettonBody = hasBody ? internalMsg.loadRef().beginParse() : internalMsg;

    const opcode = jettonBody.loadUint(32);
    if (opcode !== 0x0f8a7ea5) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.asset_mismatch,
        invalidMessage: `Expected jetton transfer opcode 0x0f8a7ea5, got 0x${opcode.toString(16)}`,
        payer,
      };
    }

    jettonBody.loadUint(64); // query_id
    const jettonAmount = jettonBody.loadCoins();
    const jettonDest = jettonBody.loadAddress();
    const destRaw = `${jettonDest.workChain}:${jettonDest.hash.toString('hex')}`;

    if (destRaw !== extra.facilitatorAddress) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.wrong_recipient,
        invalidMessage: `Jetton recipient mismatch: got ${destRaw}, expected ${extra.facilitatorAddress}`,
        payer,
      };
    }

    if (jettonAmount < requiredTotal) {
      return {
        isValid: false,
        invalidReason: X402ErrorCode.insufficient_amount,
        invalidMessage: `Insufficient jetton amount: got ${jettonAmount}, required ${requiredTotal}`,
        payer,
      };
    }

    return null; // valid
  }

  /**
   * Step 12: Emulate the transaction via TonAPI.
   * Returns null on success or when emulation is skipped.
   * Returns VerifyResponse on failure.
   * Graceful degradation: network/timeout errors are silently skipped.
   */
  private async runEmulation(
    boc: string,
    asset: string,
  ): Promise<Omit<VerifyResponse, 'payer'> | null> {
    const { tonApiKey, enableEmulation } = this.emulationConfig;

    // Skip if not configured or explicitly disabled
    if (!tonApiKey || enableEmulation === false) {
      return null;
    }

    try {
      const result = await this.emulateTransaction(boc, asset);
      if (!result.success) {
        return {
          isValid: false,
          invalidReason: result.reason,
          invalidMessage: result.message,
        };
      }
      return null;
    } catch {
      // Graceful degradation: skip on any error
      return null;
    }
  }

  private async emulateTransaction(
    boc: string,
    asset: string,
  ): Promise<{ success: true } | { success: false; reason: X402ErrorCodeValue; message: string }> {
    const endpoint =
      this.emulationConfig.tonApiEndpoint ??
      (this.network === TON_MAINNET ? TON_API_MAINNET : TON_API_TESTNET);
    const timeout = this.emulationConfig.emulationTimeout ?? DEFAULT_EMULATION_TIMEOUT;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.emulationConfig.tonApiKey) {
        headers['Authorization'] = `Bearer ${this.emulationConfig.tonApiKey}`;
      }

      const res = await fetch(`${endpoint}/v2/traces/emulate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ boc }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Graceful: treat API errors as skip
        return { success: true };
      }

      const trace = await res.json();
      return this.analyzeTrace(trace, asset);
    } finally {
      clearTimeout(timer);
    }
  }

  private analyzeTrace(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trace: any,
    asset: string,
  ): { success: true } | { success: false; reason: X402ErrorCodeValue; message: string } {
    const tx = trace?.transaction;
    if (!tx) return { success: true };

    // Check root transaction
    if (tx.aborted) {
      const exitCode = tx.compute_phase?.exit_code ?? tx.computePhase?.exit_code;
      if (exitCode === 37 || exitCode === 38 || exitCode === 40) {
        return {
          success: false,
          reason: X402ErrorCode.insufficient_balance,
          message: `Emulation failed: insufficient balance (exit code ${exitCode})`,
        };
      }
      return {
        success: false,
        reason: X402ErrorCode.emulation_failed,
        message: `Emulation failed: transaction aborted (exit code ${exitCode ?? 'unknown'})`,
      };
    }

    // For jetton transfers, check child transaction
    if (asset !== 'native' && trace.children) {
      for (const child of trace.children) {
        const childTx = child?.transaction;
        if (!childTx) continue;
        if (childTx.aborted) {
          const exitCode = childTx.compute_phase?.exit_code ?? childTx.computePhase?.exit_code;
          if (exitCode === 706) {
            return {
              success: false,
              reason: X402ErrorCode.insufficient_balance,
              message: `Emulation failed: insufficient jetton balance (exit code 706)`,
            };
          }
          return {
            success: false,
            reason: X402ErrorCode.emulation_failed,
            message: `Emulation failed: child transaction aborted (exit code ${exitCode ?? 'unknown'})`,
          };
        }
      }
    }

    return { success: true };
  }

  private deriveWalletContract(
    publicKey: Buffer,
    walletVersion: WalletVersion,
  ): WalletContractV4 | WalletContractV5R1 {
    switch (walletVersion) {
      case 'v4r2':
        return WalletContractV4.create({ workchain: 0, publicKey });
      case 'v5r1':
        return WalletContractV5R1.create({ workchain: 0, publicKey });
      default:
        throw new Error(`Unsupported wallet version: ${walletVersion}`);
    }
  }

  private async routeFunds(requirements: PaymentRequirements): Promise<void> {
    const facilitatorWallet = this.signer.getWalletContract('v5r1');
    const v5Wallet = facilitatorWallet as WalletContractV5R1;
    const contract = this.tonClient.open(v5Wallet);
    const seqno = await contract.getSeqno();
    const payToAddress = Address.parse(requirements.payTo);
    const amount = BigInt(requirements.amount);

    let messages: MessageRelaxed[];

    if (requirements.asset === 'native') {
      messages = [
        internal({
          to: payToAddress,
          value: amount,
          body: undefined,
        }),
      ];
    } else {
      const jettonMaster = Address.parse(requirements.asset);
      const facilitatorJettonWalletResult = await this.tonClient.runMethod(
        jettonMaster,
        'get_wallet_address',
        [
          {
            type: 'slice',
            cell: beginCell().storeAddress(v5Wallet.address).endCell(),
          },
        ],
      );
      const facilitatorJettonWallet = facilitatorJettonWalletResult.stack.readAddress();

      const jettonBody = beginCell()
        .storeUint(0x0f8a7ea5, 32)
        .storeUint(0, 64)
        .storeCoins(amount)
        .storeAddress(payToAddress)
        .storeAddress(v5Wallet.address)
        .storeBit(0)
        .storeCoins(toNano('0.01'))
        .storeBit(0)
        .endCell();

      messages = [
        internal({
          to: facilitatorJettonWallet,
          value: toNano('0.05'),
          body: jettonBody,
        }),
      ];
    }

    const transfer = v5Wallet.createTransfer({
      seqno,
      secretKey: this.signer.getSecretKey(),
      messages,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    });

    // Wrap transfer body in full external message (with stateInit for first tx)
    const needsInit = seqno === 0;
    const extMsg = beginCell()
      .store(
        storeMessage({
          info: {
            type: 'external-in',
            dest: v5Wallet.address,
            importFee: 0n,
          },
          init: needsInit ? v5Wallet.init : undefined,
          body: transfer,
        }),
      )
      .endCell();
    await this.tonClient.sendFile(extMsg.toBoc());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
