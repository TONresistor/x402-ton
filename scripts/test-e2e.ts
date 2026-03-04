/**
 * Real E2E test: Client pays for a resource, facilitator verifies + settles,
 * vendor receives funds.
 *
 * Usage:
 *   CLIENT_MNEMONIC="..." VENDOR_ADDRESS="0:..." npx tsx scripts/test-e2e.ts [facilitator-url]
 *
 * Env:
 *   CLIENT_MNEMONIC  — 24-word mnemonic of the funded client wallet
 *   VENDOR_ADDRESS    — raw address of the vendor (payTo)
 *   FACILITATOR_URL   — facilitator URL (default: https://x402.resistance.dog)
 */

import { TonSigner, SchemeNetworkClient, computeFee } from '../packages/ton/src/index';

const FACILITATOR_URL = process.argv[2] || process.env.FACILITATOR_URL || 'https://x402.resistance.dog';
const CLIENT_MNEMONIC = process.env.CLIENT_MNEMONIC;
const VENDOR_ADDRESS = process.env.VENDOR_ADDRESS;

if (!CLIENT_MNEMONIC) {
  console.error('CLIENT_MNEMONIC env var required');
  process.exit(1);
}
if (!VENDOR_ADDRESS) {
  console.error('VENDOR_ADDRESS env var required');
  process.exit(1);
}

async function main() {
  console.log('=== x402ton E2E Test ===\n');

  // 1. Fetch facilitator config
  console.log(`1. Fetching ${FACILITATOR_URL}/supported ...`);
  const supported = await fetch(`${FACILITATOR_URL}/supported`).then((r) => r.json());
  const kind = supported.kinds[0];
  const facilitatorAddress: string = kind.extra.facilitatorAddress;
  const fee = kind.extra.fee;
  console.log(`   Facilitator: ${facilitatorAddress}`);
  console.log(`   Fee: ${fee.percentage * 100}%, min ${fee.minimum}`);

  // 2. Init client signer
  console.log('\n2. Initializing client wallet ...');
  const mnemonic = CLIENT_MNEMONIC.trim().split(/\s+/);
  const signer = new TonSigner(mnemonic);
  await signer.init();
  const clientAddress = signer.getAddress('v5r1');
  console.log(`   Client: ${clientAddress}`);

  // 3. Build payment (SDK fetches seqno internally)
  const amount = '10000000'; // 0.01 TON (small test amount)
  const feeAmount = computeFee(amount, fee.percentage.toString(), fee.minimum.toString());
  console.log(`\n3. Building payment ...`);
  console.log(`   Amount: ${amount} nanoTON (0.01 TON)`);
  console.log(`   Fee: ${feeAmount} nanoTON`);
  console.log(`   Vendor (payTo): ${VENDOR_ADDRESS}`);

  const client = new SchemeNetworkClient(signer, 'v5r1');
  const payload = await client.createPaymentPayload(
    'tvm:-239',
    amount,
    'native',
    VENDOR_ADDRESS,
    120, // 2 min timeout
    {
      facilitatorAddress,
      fee: {
        percentage: fee.percentage.toString(),
        minimum: fee.minimum.toString(),
        address: facilitatorAddress,
      },
    },
  );

  console.log(`   BOC length: ${payload.boc.length} chars`);
  console.log(`   Wallet version: ${payload.walletVersion}`);

  // 4. Verify
  const paymentRequirements = {
    scheme: 'exact',
    network: 'tvm:-239',
    asset: 'native',
    amount,
    payTo: VENDOR_ADDRESS,
    maxTimeoutSeconds: 120,
    extra: {
      facilitatorAddress,
      fee,
    },
  };

  console.log(`\n4. POST ${FACILITATOR_URL}/verify ...`);
  const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentPayload: { payload },
      paymentRequirements,
    }),
  });
  const verifyResult = await verifyRes.json();
  console.log(`   Status: ${verifyRes.status}`);
  console.log(`   Result:`, JSON.stringify(verifyResult, null, 2));

  if (!verifyResult.isValid) {
    console.error(`\n   VERIFY FAILED: ${verifyResult.invalidReason} — ${verifyResult.invalidMessage}`);
    process.exit(1);
  }
  console.log(`   Payer: ${verifyResult.payer}`);

  // 5. Settle
  const idempotencyKey = crypto.randomUUID();
  console.log(`\n5. POST ${FACILITATOR_URL}/settle ...`);
  console.log(`   Idempotency-Key: ${idempotencyKey}`);
  const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      paymentPayload: { payload },
      paymentRequirements,
    }),
  });
  const settleResult = await settleRes.json();
  console.log(`   Status: ${settleRes.status}`);
  console.log(`   Result:`, JSON.stringify(settleResult, null, 2));

  if (!settleResult.success) {
    console.error(`\n   SETTLE FAILED: ${settleResult.errorReason} — ${settleResult.errorMessage}`);
    process.exit(1);
  }

  console.log(`\n=== E2E SUCCESS ===`);
  console.log(`   Transaction: ${settleResult.transaction}`);
  console.log(`   Payer: ${settleResult.payer}`);
  console.log(`   Network: ${settleResult.network}`);
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
