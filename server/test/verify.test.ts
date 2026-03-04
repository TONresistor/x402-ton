import { describe, it, expect, vi } from 'vitest';
import { verifyRoute } from '../src/routes/verify';
import { RateLimiter } from '../src/middleware/rate-limit';

function createVerifyApp(
  verifyResult = { isValid: true, payer: '0:1234' },
) {
  const facilitator = {
    verify: vi.fn().mockResolvedValue(verifyResult),
  };
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  const walletLimiter = new RateLimiter(1000, 60000);

  return {
    app: verifyRoute({ facilitator, logger: logger as never, walletLimiter }),
    facilitator,
  };
}

describe('POST /verify', () => {
  it('returns 200 with valid result', async () => {
    const { app } = createVerifyApp({ isValid: true, payer: '0:abc' });

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentPayload: { payload: { boc: 'dGVzdA==', publicKey: 'ab', walletVersion: 'v4r2' } },
        paymentRequirements: { scheme: 'exact', network: 'tvm:-239' },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(true);
  });

  it('returns 400 on malformed JSON', async () => {
    const { app } = createVerifyApp();

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.invalidReason).toBe('invalid_payload');
  });

  it('returns 400 when missing paymentPayload', async () => {
    const { app } = createVerifyApp();

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentRequirements: {} }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.invalidReason).toBe('invalid_payload');
  });
});
