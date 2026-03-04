import { Hono } from 'hono';
import type { Logger } from '../middleware/logging';
import type { IdempotencyStore } from '../store/idempotency-store';
import type { TxStateStore } from '../store/tx-state';
import { hashBoc, extractPayerFromPayload } from 'x402ton';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { RateLimiter } from '../middleware/rate-limit';

interface SettleDeps {
  facilitator: {
    verify(
      paymentPayload: unknown,
      paymentRequirements: unknown,
    ): Promise<{
      isValid: boolean;
      invalidReason?: string;
      invalidMessage?: string;
      payer?: string;
    }>;
    settle(
      paymentPayload: unknown,
      paymentRequirements: unknown,
    ): Promise<{
      success: boolean;
      payer?: string;
      transaction?: string;
      network?: string;
      errorReason?: string;
      errorMessage?: string;
    }>;
  };
  logger: Logger;
  idempotencyStore: IdempotencyStore;
  txStateStore: TxStateStore;
  settleLimiter: RateLimiter;
  walletLimiter: RateLimiter;
  network: string;
}

type Env = {
  Variables: {
    idempotencyKey: string;
    payloadHash: string;
    requestBody: string;
  };
};

export function settleRoute(deps: SettleDeps) {
  const app = new Hono<Env>();

  app.post('/settle', idempotencyMiddleware(deps.idempotencyStore), async (c) => {
    const startTime = Date.now();
    const idempotencyKey = c.get('idempotencyKey') as string;
    const payloadHash = c.get('payloadHash') as string;
    const rawBody = c.get('requestBody') as string;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json(
        {
          success: false,
          errorReason: 'invalid_payload',
          errorMessage: 'Malformed JSON body',
          payer: '',
          transaction: '',
          network: deps.network,
        },
        400,
      );
    }

    const { paymentPayload, paymentRequirements } = body;
    if (!paymentPayload || !paymentRequirements) {
      return c.json(
        {
          success: false,
          errorReason: 'invalid_payload',
          errorMessage: 'Missing paymentPayload or paymentRequirements',
          payer: '',
          transaction: '',
          network: deps.network,
        },
        400,
      );
    }

    const payload = (paymentPayload as Record<string, unknown>).payload as
      | Record<string, unknown>
      | undefined;
    const bocHash = payload?.boc ? hashBoc(payload.boc as string) : 'unknown';

    deps.logger.info({ operation: 'settle', idempotencyKey, bocHash }, 'settle request received');

    // Pre-processing rate limit: extract payer before calling facilitator
    const boc = payload?.boc as string | undefined;
    const pubKey = payload?.publicKey as string | undefined;
    const walletVer = payload?.walletVersion as string | undefined;
    const earlyPayer = extractPayerFromPayload(boc, pubKey, walletVer);
    if (earlyPayer) {
      if (!deps.settleLimiter.isAllowed(earlyPayer)) {
        return c.json(
          {
            success: false,
            payer: earlyPayer,
            transaction: '',
            network: deps.network,
            errorReason: 'rate_limited',
            errorMessage: 'Too many settlement requests for this wallet',
          },
          429,
        );
      }
      if (!deps.walletLimiter.isAllowed(earlyPayer)) {
        return c.json(
          {
            success: false,
            payer: earlyPayer,
            transaction: '',
            network: deps.network,
            errorReason: 'rate_limited',
            errorMessage: 'Too many requests for this wallet',
          },
          429,
        );
      }
    }

    try {
      // Mark as SETTLING before calling facilitator
      deps.txStateStore.create(bocHash, 'SETTLING', {
        idempotencyKey,
        payer: undefined,
        network: deps.network,
      });

      const result = await deps.facilitator.settle(paymentPayload, paymentRequirements);

      const response = {
        success: result.success,
        payer: result.payer || '',
        transaction: result.transaction || '',
        network: result.network || deps.network,
        ...(result.success
          ? {}
          : { errorReason: result.errorReason, errorMessage: result.errorMessage }),
      };

      // Update tx state
      if (result.success) {
        deps.txStateStore.update(bocHash, 'CONFIRMED');
        if (result.transaction) {
          deps.txStateStore.markSettled(
            result.transaction,
            idempotencyKey,
            result.payer || '',
            ((paymentRequirements as Record<string, unknown>).amount as string) || '',
          );
        }
      } else {
        deps.txStateStore.update(bocHash, 'FAILED');
      }

      // Cache response for idempotency
      deps.idempotencyStore.set(idempotencyKey, payloadHash, JSON.stringify(response));

      const durationMs = Date.now() - startTime;
      deps.logger.info(
        {
          operation: 'settle',
          idempotencyKey,
          payer: result.payer,
          txHash: result.transaction,
          result: result.success ? 'settled' : 'failed',
          reason: result.errorReason,
          bocHash,
          durationMs,
        },
        'settle completed',
      );

      return c.json(response);
    } catch (err) {
      // Mark as FAILED on unexpected error
      try {
        deps.txStateStore.update(bocHash, 'FAILED');
      } catch {
        // Ignore DB errors during error handling
      }

      const durationMs = Date.now() - startTime;
      deps.logger.error(
        { operation: 'settle', error: (err as Error).message, idempotencyKey, bocHash, durationMs },
        'settle error',
      );

      const errorResponse = {
        success: false,
        payer: '',
        transaction: '',
        network: deps.network,
        errorReason: 'unexpected_settle_error',
        errorMessage: (err as Error).message,
      };

      // Cache error response too for idempotency
      deps.idempotencyStore.set(idempotencyKey, payloadHash, JSON.stringify(errorResponse));

      return c.json(errorResponse, 500);
    }
  });

  return app;
}
