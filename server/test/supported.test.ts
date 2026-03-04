import { describe, it, expect } from 'vitest';
import { supportedRoute } from '../src/routes/supported';
import type { ServerConfig } from '../src/config';

const mockConfig: ServerConfig = {
  port: 4020,
  tonMnemonic: [],
  tonNetwork: 'tvm:-239',
  toncenterUrl: 'https://toncenter.com/api/v2/jsonRPC',
  dbPath: ':memory:',
  feePercentage: 0.02,
  feeMinimum: '10000',
  rateLimits: { global: 1000, perIp: 100, perWallet: 30, settlePerWallet: 10 },
};

const facilitatorAddress = '0:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

describe('GET /supported', () => {
  it('returns kinds with facilitator info', async () => {
    const app = supportedRoute(mockConfig, facilitatorAddress);
    const res = await app.request('/supported');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.kinds).toHaveLength(1);
    expect(body.kinds[0].scheme).toBe('exact');
    expect(body.kinds[0].network).toBe('tvm:-239');
    expect(body.kinds[0].extra.facilitatorAddress).toBe(facilitatorAddress);
    expect(body.kinds[0].extra.fee.percentage).toBe(0.02);
    expect(body.kinds[0].extra.fee.minimum).toBe('10000');
  });

  it('returns signers map', async () => {
    const app = supportedRoute(mockConfig, facilitatorAddress);
    const res = await app.request('/supported');
    const body = await res.json();

    expect(body.signers['tvm:*']).toContain(facilitatorAddress);
  });
});
