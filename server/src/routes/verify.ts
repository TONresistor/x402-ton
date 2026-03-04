import { Hono } from 'hono';
import type { Logger } from '../middleware/logging';
import { hashBoc, extractPayerFromPayload } from 'x402ton';
import { RateLimiter } from '../middleware/rate-limit';

interface VerifyDeps {
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
  };
  logger: Logger;
  walletLimiter: RateLimiter;
}

export function verifyRoute(deps: VerifyDeps) {
  const app = new Hono();

  app.post('/verify', async (c) => {
    const startTime = Date.now();

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { isValid: false, invalidReason: 'invalid_payload', invalidMessage: 'Malformed JSON body' },
        400,
      );
    }

    const { paymentPayload, paymentRequirements } = body;
    if (!paymentPayload || !paymentRequirements) {
      return c.json(
        {
          isValid: false,
          invalidReason: 'invalid_payload',
          invalidMessage: 'Missing paymentPayload or paymentRequirements',
        },
        400,
      );
    }

    // Log BOC hash only, never the full BOC
    const payload = (paymentPayload as Record<string, unknown>).payload as
      | Record<string, unknown>
      | undefined;
    const bocHash = payload?.boc ? hashBoc(payload.boc as string) : 'unknown';

    deps.logger.info({ operation: 'verify', bocHash }, 'verify request received');

    // Pre-processing rate limit: extract payer before calling facilitator
    const boc = payload?.boc as string | undefined;
    const pubKey = payload?.publicKey as string | undefined;
    const walletVer = payload?.walletVersion as string | undefined;
    const earlyPayer = extractPayerFromPayload(boc, pubKey, walletVer);
    if (earlyPayer && !deps.walletLimiter.isAllowed(earlyPayer)) {
      return c.json(
        {
          isValid: false,
          invalidReason: 'rate_limited',
          invalidMessage: 'Too many requests for this wallet',
        },
        429,
      );
    }

    try {
      const result = await deps.facilitator.verify(paymentPayload, paymentRequirements);

      const durationMs = Date.now() - startTime;
      deps.logger.info(
        {
          operation: 'verify',
          payer: result.payer,
          result: result.isValid ? 'valid' : 'invalid',
          reason: result.invalidReason,
          bocHash,
          durationMs,
        },
        'verify completed',
      );

      return c.json(result);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      deps.logger.error(
        { operation: 'verify', error: (err as Error).message, bocHash, durationMs },
        'verify error',
      );
      return c.json(
        {
          isValid: false,
          invalidReason: 'unexpected_error',
          invalidMessage: (err as Error).message,
        },
        500,
      );
    }
  });

  return app;
}
