import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { bodyLimit } from 'hono/body-limit';
import Database from 'better-sqlite3';
import { TonClient } from '@ton/ton';
import { mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import { TonSigner, SchemeNetworkFacilitator } from 'x402ton';
import type { ExactTonPayload, PaymentRequirements } from 'x402ton';

import { loadConfig } from './config';
import { createLogger } from './middleware/logging';
import { createRateLimiters } from './middleware/rate-limit';
import { IdempotencyStore } from './store/idempotency-store';
import { TxStateStore } from './store/tx-state';
import { supportedRoute } from './routes/supported';
import { verifyRoute } from './routes/verify';
import { settleRoute } from './routes/settle';
import { healthRoute } from './health';

const logger = createLogger();

async function start() {
  const config = loadConfig();

  // Ensure DB directory exists
  mkdirSync(dirname(config.dbPath), { recursive: true });

  // Init database
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // Init stores
  const idempotencyStore = new IdempotencyStore(db);
  const txStateStore = new TxStateStore(db);

  // Init rate limiters
  const limiters = createRateLimiters(config.rateLimits);

  // Init signer
  const facSigner = new TonSigner(config.tonMnemonic);
  await facSigner.init();
  const facilitatorAddress = facSigner.getAddress('v5r1');
  logger.info({ facilitatorAddress, network: config.tonNetwork }, 'facilitator signer initialized');

  // Init TON client
  const apiKey = process.env.TONCENTER_API_KEY;
  const tonClient = new TonClient({
    endpoint: config.toncenterUrl,
    ...(apiKey ? { apiKey } : {}),
  });

  // Init real facilitator
  const realFacilitator = new SchemeNetworkFacilitator(facSigner, config.tonNetwork, tonClient);

  // Adapter: routes pass {payload: ExactTonPayload}, facilitator expects ExactTonPayload directly
  const facilitator = {
    async verify(paymentPayload: { payload: ExactTonPayload }, paymentRequirements: PaymentRequirements) {
      return realFacilitator.verify(paymentPayload.payload, paymentRequirements);
    },
    async settle(paymentPayload: { payload: ExactTonPayload }, paymentRequirements: PaymentRequirements) {
      return realFacilitator.settle(paymentPayload.payload, paymentRequirements);
    },
  };

  // Build Hono app
  const app = new Hono();

  // Global middleware
  app.use('*', bodyLimit({ maxSize: 128 * 1024 }));

  app.use('*', async (c, next) => {
    if (!limiters.global.isAllowed('global')) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!limiters.perIp.isAllowed(ip)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    await next();
  });

  // Landing page
  const landingHtml = readFileSync(join(import.meta.dirname, '../public/index.html'), 'utf-8');
  app.get('/', (c) => c.html(landingHtml));

  // Mount routes
  app.route('/', supportedRoute(config, facilitatorAddress));
  app.route(
    '/',
    verifyRoute({
      facilitator,
      logger,
      walletLimiter: limiters.perWallet,
    }),
  );
  app.route(
    '/',
    settleRoute({
      facilitator,
      logger,
      idempotencyStore,
      txStateStore,
      settleLimiter: limiters.settlePerWallet,
      walletLimiter: limiters.perWallet,
      network: config.tonNetwork,
    }),
  );
  app.route(
    '/',
    healthRoute({
      tonClient,
      network: config.tonNetwork,
      startedAt: Date.now(),
    }),
  );

  // Reconcile SETTLING transactions from previous runs
  const settlingTxs = txStateStore.getSettling();
  if (settlingTxs.length > 0) {
    logger.warn(
      { count: settlingTxs.length },
      'found SETTLING transactions from previous run — manual reconciliation needed',
    );
  }

  // Start server
  serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    () => {
      logger.info(
        {
          port: config.port,
          network: config.tonNetwork,
          facilitatorAddress,
        },
        'x402ton facilitator server started',
      );
    },
  );

  // Periodic cleanup of idempotency keys and rate limiter windows (every hour)
  const cleanupInterval = setInterval(() => {
    try {
      idempotencyStore.cleanup(86400);
      limiters.global.cleanup();
      limiters.perIp.cleanup();
      limiters.perWallet.cleanup();
      limiters.settlePerWallet.cleanup();
      logger.debug('periodic cleanup completed');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'periodic cleanup failed');
    }
  }, 3600_000);

  // Graceful shutdown
  const shutdown = () => {
    logger.info('shutting down...');
    clearInterval(cleanupInterval);
    try {
      db.close();
      logger.info('database closed');
    } catch {
      // Already closed
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  logger.fatal({ error: (err as Error).message }, 'failed to start server');
  process.exit(1);
});
