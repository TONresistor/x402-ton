import { describe, it, expect, vi } from 'vitest';
import { settleRoute } from '../src/routes/settle';
import { RateLimiter } from '../src/middleware/rate-limit';

// A valid-looking 32-byte public key (64 hex chars) so extractPayerFromPayload works
const FAKE_PUBLIC_KEY = 'a'.repeat(64);

function createSettleApp(opts: { settleLimitExceeded?: boolean; walletLimitExceeded?: boolean } = {}) {
  const facilitator = {
    verify: vi.fn().mockResolvedValue({ isValid: true, payer: '0:1234' }),
    settle: vi.fn().mockResolvedValue({
      success: true,
      payer: '0:1234',
      transaction: 'abc',
      network: 'tvm:-239',
    }),
  };
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  const idempotencyStore = {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
  };
  const txStateStore = {
    create: vi.fn(),
    update: vi.fn(),
    markSettled: vi.fn(),
  };

  // Rate limiters that can be pre-configured to reject
  const settleLimiter = new RateLimiter(1000, 60000);
  const walletLimiter = new RateLimiter(1000, 60000);

  if (opts.settleLimitExceeded) {
    vi.spyOn(settleLimiter, 'isAllowed').mockReturnValue(false);
  }
  if (opts.walletLimitExceeded) {
    vi.spyOn(walletLimiter, 'isAllowed').mockReturnValue(false);
  }

  return {
    app: settleRoute({
      facilitator,
      logger: logger as never,
      idempotencyStore: idempotencyStore as never,
      txStateStore: txStateStore as never,
      settleLimiter,
      walletLimiter,
      network: 'tvm:-239',
    }),
    facilitator,
  };
}

function makeSettleRequest(app: ReturnType<typeof createSettleApp>['app']) {
  return app.request('/settle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `test-${Date.now()}`,
    },
    body: JSON.stringify({
      paymentPayload: {
        payload: {
          boc: 'dGVzdA==',
          publicKey: FAKE_PUBLIC_KEY,
          walletVersion: 'v4r2',
        },
      },
      paymentRequirements: {
        scheme: 'exact',
        network: 'tvm:-239',
        amount: '1000000000',
      },
    }),
  });
}

describe('POST /settle security', () => {
  it('rate-limits BEFORE calling facilitator.settle()', async () => {
    const { app, facilitator } = createSettleApp({ settleLimitExceeded: true });

    const res = await makeSettleRequest(app);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.errorReason).toBe('rate_limited');
    // The critical assertion: settle() was NEVER called
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it('wallet rate-limit blocks before facilitator.settle()', async () => {
    const { app, facilitator } = createSettleApp({ walletLimitExceeded: true });

    const res = await makeSettleRequest(app);

    expect(res.status).toBe(429);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
});
