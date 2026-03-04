import { Hono } from 'hono';
import type { TonClient } from '@ton/ton';

interface HealthDeps {
  tonClient: TonClient;
  network: string;
  startedAt: number;
}

export function healthRoute(deps: HealthDeps) {
  const app = new Hono();

  app.get('/health', async (c) => {
    let connected = false;
    let latestBlock = 0;

    try {
      // Use getMasterchainInfo to check connectivity
      const info = await deps.tonClient.getMasterchainInfo();
      connected = true;
      latestBlock = info.latestSeqno;
    } catch {
      connected = false;
    }

    const uptime = Math.floor((Date.now() - deps.startedAt) / 1000);

    return c.json({
      status: connected ? 'healthy' : 'degraded',
      version: '1.0.0',
      uptime,
      ton: {
        connected,
        network: deps.network,
        latestBlock,
      },
    });
  });

  return app;
}
