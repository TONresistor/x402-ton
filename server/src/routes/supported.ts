import { Hono } from 'hono';
import type { ServerConfig } from '../config';

export function supportedRoute(config: ServerConfig, facilitatorAddress: string) {
  const app = new Hono();

  app.get('/supported', (c) => {
    return c.json({
      kinds: [
        {
          x402Version: 2,
          scheme: 'exact',
          network: config.tonNetwork,
          extra: {
            facilitatorAddress,
            fee: {
              percentage: config.feePercentage,
              minimum: config.feeMinimum,
              address: facilitatorAddress,
            },
          },
        },
      ],
      extensions: [],
      signers: {
        'tvm:*': [facilitatorAddress],
      },
    });
  });

  return app;
}
